using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

public sealed class Win32StorageScanner
{
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private const uint FILE_ATTRIBUTE_OFFLINE = 0x00001000;
    private const uint FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x00040000;
    private const uint FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x00400000;
    private const uint FIND_FIRST_EX_LARGE_FETCH = 0x00000002;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new(-1);

    private enum FINDEX_INFO_LEVELS
    {
        FindExInfoStandard = 0,
        FindExInfoBasic = 1
    }

    private enum FINDEX_SEARCH_OPS
    {
        FindExSearchNameMatch = 0
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME
    {
        public uint dwLowDateTime;
        public uint dwHighDateTime;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WIN32_FIND_DATAW
    {
        public uint dwFileAttributes;
        public FILETIME ftCreationTime;
        public FILETIME ftLastAccessTime;
        public FILETIME ftLastWriteTime;
        public uint nFileSizeHigh;
        public uint nFileSizeLow;
        public uint dwReserved0;
        public uint dwReserved1;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string cFileName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)]
        public string cAlternateFileName;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindFirstFileExW(
        string lpFileName,
        FINDEX_INFO_LEVELS fInfoLevelId,
        out WIN32_FIND_DATAW lpFindFileData,
        FINDEX_SEARCH_OPS fSearchOp,
        IntPtr lpSearchFilter,
        uint dwAdditionalFlags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FindNextFileW(IntPtr hFindFile, out WIN32_FIND_DATAW lpFindFileData);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FindClose(IntPtr hFindFile);

    private sealed class MutableFolderNode
    {
        public int Id;
        public int ParentId;
        public required string Name;
        public required string FullPath;
        public long LogicalBytes;
        public long AllocatedBytes;
        public int RecursiveFileCount;
        public int RecursiveFolderCount;
        public long LastWriteUnixSeconds;
        public uint FileAttributes;
    }

    private sealed class FolderTable
    {
        private const int ChunkBits = 14; // 16,384 nodes per chunk
        private const int ChunkSize = 1 << ChunkBits;
        private const int ChunkMask = ChunkSize - 1;
        private readonly MutableFolderNode?[][] _chunks = new MutableFolderNode?[2048][];
        private int _count;

        public int Count => Volatile.Read(ref _count);

        public int Allocate(int count)
        {
            int start = Interlocked.Add(ref _count, count) - count;
            int end = start + count;
            int startChunk = start >> ChunkBits;
            int endChunk = (end - 1) >> ChunkBits;
            for (int c = startChunk; c <= endChunk; c++)
            {
                if (Volatile.Read(ref _chunks[c]) == null)
                {
                    var newChunk = new MutableFolderNode?[ChunkSize];
                    Interlocked.CompareExchange(ref _chunks[c], newChunk, null);
                }
            }
            return start;
        }

        public MutableFolderNode this[int index]
        {
            get => _chunks[index >> ChunkBits][index & ChunkMask]!;
            set => _chunks[index >> ChunkBits][index & ChunkMask] = value;
        }
    }

    public async Task<DriveScanResult> ScanAsync(
        string rootPath,
        IProgress<ScanProgressReport>? progress = null,
        int topN = 25,
        bool retainAllEntries = false,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(rootPath))
        {
            throw new ArgumentException("Root path cannot be empty.", nameof(rootPath));
        }

        string normalizedRoot = Path.GetFullPath(rootPath);
        if (!Directory.Exists(normalizedRoot))
        {
            throw new DirectoryNotFoundException($"Directory not found: {normalizedRoot}");
        }

        return await Task.Run(() => ExecuteScan(normalizedRoot, progress, topN, retainAllEntries, cancellationToken), cancellationToken).ConfigureAwait(false);
    }

    private DriveScanResult ExecuteScan(
        string normalizedRoot,
        IProgress<ScanProgressReport>? progress,
        int topN,
        bool retainAllEntries,
        CancellationToken cancellationToken)
    {
        var sw = Stopwatch.StartNew();
        const long clusterSize = 4096;

        var folderTable = new FolderTable();
        int rootIdx = folderTable.Allocate(1);

        var rootNode = new MutableFolderNode
        {
            Id = rootIdx,
            ParentId = -1,
            Name = string.IsNullOrEmpty(Path.GetFileName(normalizedRoot)) ? normalizedRoot : Path.GetFileName(normalizedRoot),
            FullPath = normalizedRoot,
            LogicalBytes = 0,
            AllocatedBytes = 0,
            RecursiveFileCount = 0,
            RecursiveFolderCount = 0,
            LastWriteUnixSeconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            FileAttributes = FILE_ATTRIBUTE_DIRECTORY
        };
        folderTable[0] = rootNode;

        var accessDenied = new ConcurrentBag<string>();
        var workQueue = new ConcurrentQueue<(int FolderIdx, string Path)>();
        workQueue.Enqueue((0, normalizedRoot));

        long filesScanned = 0;
        long foldersScanned = 1;
        long totalLogicalBytes = 0;
        long totalAllocatedBytes = 0;
        long lastReportTicks = sw.ElapsedTicks;
        long reportIntervalTicks = Stopwatch.Frequency / 5; // 200ms

        int maxDegree = Math.Clamp(Environment.ProcessorCount, 2, 16);
        int activeWorkers = 0;

        var allWorkerTopFiles = new ConcurrentBag<PriorityQueue<ScannedEntry, long>>();
        var allWorkerCategories = new ConcurrentBag<Dictionary<string, (long Count, long Bytes)>>();
        var allRetainedChunks = new ConcurrentQueue<List<ScannedEntry>>();

        using var doneEvent = new ManualResetEventSlim(false);

        Parallel.For(0, maxDegree, new ParallelOptions { CancellationToken = cancellationToken }, _ =>
        {
            var localFiles = new List<ScannedEntry>(128);
            var localSubfolderNames = new List<(string Name, string FullPath, long MTime, uint Attr)>(32);

            var threadTopFiles = new PriorityQueue<ScannedEntry, long>(topN + 1);
            var threadCategoryTotals = new Dictionary<string, (long Count, long Bytes)>(StringComparer.OrdinalIgnoreCase);
            var currentRetainedChunk = retainAllEntries ? new List<ScannedEntry>(4096) : null;

            while (!cancellationToken.IsCancellationRequested)
            {
                if (!workQueue.TryDequeue(out var current))
                {
                    if (Volatile.Read(ref activeWorkers) == 0 && workQueue.IsEmpty)
                    {
                        doneEvent.Set();
                        break;
                    }
                    Thread.SpinWait(64);
                    if (workQueue.IsEmpty && Volatile.Read(ref activeWorkers) == 0)
                    {
                        doneEvent.Set();
                        break;
                    }
                    continue;
                }

                Interlocked.Increment(ref activeWorkers);
                try
                {
                    localFiles.Clear();
                    localSubfolderNames.Clear();

                    string searchSpec = ToExtendedSearchPattern(current.Path);
                    IntPtr hFind = FindFirstFileExW(
                        searchSpec,
                        FINDEX_INFO_LEVELS.FindExInfoBasic,
                        out WIN32_FIND_DATAW findData,
                        FINDEX_SEARCH_OPS.FindExSearchNameMatch,
                        IntPtr.Zero,
                        FIND_FIRST_EX_LARGE_FETCH);

                    if (hFind == INVALID_HANDLE_VALUE)
                    {
                        int err = Marshal.GetLastWin32Error();
                        if (err == 5) // ERROR_ACCESS_DENIED
                        {
                            accessDenied.Add(current.Path);
                        }
                        continue;
                    }

                    try
                    {
                        do
                        {
                            cancellationToken.ThrowIfCancellationRequested();

                            string name = findData.cFileName;
                            if (name == "." || name == "..")
                            {
                                continue;
                            }

                            uint attrs = findData.dwFileAttributes;
                            bool isReparse = (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
                            if (isReparse)
                            {
                                // Never traverse junctions, symlinks, or volume mount points to prevent infinite loops and cross-volume walks
                                continue;
                            }

                            bool isDir = (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0;
                            string childPath = CombineFast(current.Path, name);
                            long mtimeUnix = FileTimeToUnixSeconds(findData.ftLastWriteTime);

                            if (isDir)
                            {
                                localSubfolderNames.Add((name, childPath, mtimeUnix, attrs));
                            }
                            else
                            {
                                long size = ((long)findData.nFileSizeHigh << 32) | findData.nFileSizeLow;
                                bool isCloudPlaceholder = (attrs & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)) != 0;
                                long alloc = isCloudPlaceholder ? 0 : RoundUpToCluster(size, clusterSize);
                                string ext = Path.GetExtension(name).ToLowerInvariant();
                                string cat = FileCategoryClassifier.ClassifyExtension(ext);

                                localFiles.Add(new ScannedEntry(
                                    Id: 0,
                                    ParentId: current.FolderIdx,
                                    Name: name,
                                    FullPath: childPath,
                                    Extension: ext,
                                    Category: cat,
                                    IsDirectory: false,
                                    LogicalBytes: size,
                                    AllocatedBytes: alloc,
                                    RecursiveFileCount: 1,
                                    RecursiveFolderCount: 0,
                                    LastWriteUnixSeconds: mtimeUnix,
                                    FileAttributes: attrs
                                ));
                            }
                        } while (FindNextFileW(hFind, out findData));
                    }
                    finally
                    {
                        FindClose(hFind);
                    }

                    long batchLogical = 0;
                    long batchAlloc = 0;
                    for (int i = 0; i < localFiles.Count; i++)
                    {
                        var f = localFiles[i];
                        batchLogical += f.LogicalBytes;
                        batchAlloc += f.AllocatedBytes;

                        // Category breakdown update
                        if (threadCategoryTotals.TryGetValue(f.Category, out var prev))
                        {
                            threadCategoryTotals[f.Category] = (prev.Count + 1, prev.Bytes + f.LogicalBytes);
                        }
                        else
                        {
                            threadCategoryTotals[f.Category] = (1, f.LogicalBytes);
                        }

                        // Top-N min-heap
                        if (threadTopFiles.Count < topN)
                        {
                            threadTopFiles.Enqueue(f, f.LogicalBytes);
                        }
                        else if (f.LogicalBytes > threadTopFiles.Peek().LogicalBytes)
                        {
                            threadTopFiles.Dequeue();
                            threadTopFiles.Enqueue(f, f.LogicalBytes);
                        }

                        if (retainAllEntries && currentRetainedChunk != null)
                        {
                            currentRetainedChunk.Add(f);
                            if (currentRetainedChunk.Count >= 4096)
                            {
                                allRetainedChunks.Enqueue(currentRetainedChunk);
                                currentRetainedChunk = new List<ScannedEntry>(4096);
                            }
                        }
                    }

                    // Store direct folder metrics on this folder (sole owner of current.FolderIdx)
                    var parentFolder = folderTable[current.FolderIdx];
                    parentFolder.LogicalBytes = batchLogical;
                    parentFolder.AllocatedBytes = batchAlloc;
                    parentFolder.RecursiveFileCount = localFiles.Count;
                    parentFolder.RecursiveFolderCount = localSubfolderNames.Count;

                    // Allocate subfolder IDs lock-free and enqueue for traversal
                    if (localSubfolderNames.Count > 0)
                    {
                        int startIdx = folderTable.Allocate(localSubfolderNames.Count);
                        for (int j = 0; j < localSubfolderNames.Count; j++)
                        {
                            int subId = startIdx + j;
                            var subInfo = localSubfolderNames[j];
                            var subNode = new MutableFolderNode
                            {
                                Id = subId,
                                ParentId = current.FolderIdx,
                                Name = subInfo.Name,
                                FullPath = subInfo.FullPath,
                                LogicalBytes = 0,
                                AllocatedBytes = 0,
                                RecursiveFileCount = 0,
                                RecursiveFolderCount = 0,
                                LastWriteUnixSeconds = subInfo.MTime,
                                FileAttributes = subInfo.Attr
                            };
                            folderTable[subId] = subNode;
                            workQueue.Enqueue((subId, subInfo.FullPath));
                        }
                    }

                    long currentFiles = Interlocked.Add(ref filesScanned, localFiles.Count);
                    long currentFolders = Interlocked.Add(ref foldersScanned, localSubfolderNames.Count);
                    long currentBytes = Interlocked.Add(ref totalLogicalBytes, batchLogical);
                    Interlocked.Add(ref totalAllocatedBytes, batchAlloc);

                    long nowTicks = sw.ElapsedTicks;
                    long prevTicks = Interlocked.Read(ref lastReportTicks);
                    if (progress != null && nowTicks - prevTicks >= reportIntervalTicks)
                    {
                        if (Interlocked.CompareExchange(ref lastReportTicks, nowTicks, prevTicks) == prevTicks)
                        {
                            progress.Report(new ScanProgressReport(
                                RootPath: normalizedRoot,
                                Mode: ScanEngineMode.StandardWin32,
                                CurrentDirectory: current.Path,
                                FilesScanned: currentFiles,
                                FoldersScanned: currentFolders,
                                TotalLogicalBytes: currentBytes,
                                AccessDeniedCount: accessDenied.Count,
                                ElapsedMilliseconds: sw.Elapsed.TotalMilliseconds
                            ));
                        }
                    }
                }
                finally
                {
                    if (Interlocked.Decrement(ref activeWorkers) == 0 && workQueue.IsEmpty)
                    {
                        doneEvent.Set();
                    }
                }
            }

            allWorkerTopFiles.Add(threadTopFiles);
            allWorkerCategories.Add(threadCategoryTotals);
            if (retainAllEntries && currentRetainedChunk != null && currentRetainedChunk.Count > 0)
            {
                allRetainedChunks.Enqueue(currentRetainedChunk);
            }
        });

        cancellationToken.ThrowIfCancellationRequested();

        int totalFolders = folderTable.Count;

        // Bottom-up O(N) folder size rollup: since child folders always have Id > ParentId,
        // iterating from totalFolders - 1 down to 1 rolls up all descendants in a single pass.
        for (int i = totalFolders - 1; i >= 1; i--)
        {
            var child = folderTable[i];
            int pIdx = child.ParentId;
            if (pIdx >= 0 && pIdx < totalFolders)
            {
                var parent = folderTable[pIdx];
                parent.LogicalBytes += child.LogicalBytes;
                parent.AllocatedBytes += child.AllocatedBytes;
                parent.RecursiveFileCount += child.RecursiveFileCount;
                parent.RecursiveFolderCount += child.RecursiveFolderCount;
            }
        }

        // Convert folders to ScannedEntry list
        var allFoldersList = new List<ScannedEntry>(totalFolders);
        for (int i = 0; i < totalFolders; i++)
        {
            var f = folderTable[i];
            allFoldersList.Add(new ScannedEntry(
                Id: f.Id,
                ParentId: f.ParentId,
                Name: f.Name,
                FullPath: f.FullPath,
                Extension: string.Empty,
                Category: "folder",
                IsDirectory: true,
                LogicalBytes: f.LogicalBytes,
                AllocatedBytes: f.AllocatedBytes,
                RecursiveFileCount: f.RecursiveFileCount,
                RecursiveFolderCount: f.RecursiveFolderCount,
                LastWriteUnixSeconds: f.LastWriteUnixSeconds,
                FileAttributes: f.FileAttributes
            ));
        }

        // Merge categories across workers
        var globalCatTotals = new Dictionary<string, (long Count, long Bytes)>(StringComparer.OrdinalIgnoreCase);
        foreach (var wCat in allWorkerCategories)
        {
            foreach (var kvp in wCat)
            {
                if (globalCatTotals.TryGetValue(kvp.Key, out var prev))
                {
                    globalCatTotals[kvp.Key] = (prev.Count + kvp.Value.Count, prev.Bytes + kvp.Value.Bytes);
                }
                else
                {
                    globalCatTotals[kvp.Key] = (kvp.Value.Count, kvp.Value.Bytes);
                }
            }
        }

        var categoryBreakdown = globalCatTotals
            .Select(kvp => new CategorySummary(
                Key: kvp.Key,
                Label: FileCategoryClassifier.CategoryLabels.GetValueOrDefault(kvp.Key, "Other Files"),
                FileCount: kvp.Value.Count,
                TotalBytes: kvp.Value.Bytes,
                SharePercent: totalLogicalBytes > 0 ? Math.Round((double)kvp.Value.Bytes / totalLogicalBytes * 100.0, 1) : 0.0
            ))
            .OrderByDescending(c => c.TotalBytes)
            .ToList();

        // Merge top files across workers
        var mergedTopFiles = new PriorityQueue<ScannedEntry, long>(topN + 1);
        foreach (var wQueue in allWorkerTopFiles)
        {
            while (wQueue.TryDequeue(out var file, out var priority))
            {
                if (mergedTopFiles.Count < topN)
                {
                    mergedTopFiles.Enqueue(file, priority);
                }
                else if (priority > mergedTopFiles.Peek().LogicalBytes)
                {
                    mergedTopFiles.Dequeue();
                    mergedTopFiles.Enqueue(file, priority);
                }
            }
        }

        var largestFilesList = new List<ScannedEntry>(mergedTopFiles.Count);
        while (mergedTopFiles.TryDequeue(out var file, out _))
        {
            largestFilesList.Add(file);
        }
        largestFilesList.Reverse(); // Largest first

        var largestFolders = allFoldersList
            .Skip(1) // Skip root itself
            .Where(d => d.LogicalBytes > 0)
            .OrderByDescending(d => d.LogicalBytes)
            .ThenBy(d => d.Name, StringComparer.OrdinalIgnoreCase)
            .Take(topN)
            .ToList();

        var topLevelSpaceMap = allFoldersList
            .Where(d => d.ParentId == 0)
            .OrderByDescending(d => d.LogicalBytes)
            .ToList();

        IReadOnlyList<ScannedEntry> allEntries;
        if (retainAllEntries)
        {
            var combinedEntries = new List<ScannedEntry>(allFoldersList.Count + (int)filesScanned);
            combinedEntries.AddRange(allFoldersList);
            foreach (var chunk in allRetainedChunks)
            {
                combinedEntries.AddRange(chunk);
            }
            allEntries = combinedEntries;
        }
        else
        {
            allEntries = Array.Empty<ScannedEntry>();
        }

        return new DriveScanResult(
            RootPath: normalizedRoot,
            EngineUsed: ScanEngineMode.StandardWin32,
            TotalFiles: filesScanned,
            TotalFolders: foldersScanned,
            TotalLogicalBytes: totalLogicalBytes,
            TotalAllocatedBytes: totalAllocatedBytes,
            ElapsedMilliseconds: sw.Elapsed.TotalMilliseconds,
            AccessDeniedPaths: accessDenied.ToArray(),
            LargestFiles: largestFilesList,
            LargestFolders: largestFolders,
            TopLevelSpaceMap: topLevelSpaceMap,
            CategoryBreakdown: categoryBreakdown,
            AllEntries: allEntries,
            AllFolders: allFoldersList
        );
    }

    private static string ToExtendedSearchPattern(string path)
    {
        string clean = path.EndsWith('\\') ? path + "*" : path + "\\*";
        if (clean.StartsWith(@"\\?\", StringComparison.Ordinal))
        {
            return clean;
        }
        if (clean.StartsWith(@"\\", StringComparison.Ordinal))
        {
            return @"\\?\UNC\" + clean.Substring(2);
        }
        return @"\\?\" + clean;
    }

    private static string CombineFast(string parent, string child)
    {
        return parent.EndsWith('\\') ? parent + child : parent + "\\" + child;
    }

    private static long RoundUpToCluster(long bytes, long clusterSize)
    {
        if (bytes <= 0)
        {
            return 0;
        }
        return ((bytes + clusterSize - 1) / clusterSize) * clusterSize;
    }

    private static long FileTimeToUnixSeconds(FILETIME ft)
    {
        long ticks = ((long)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
        if (ticks <= 116444736000000000L)
        {
            return 0;
        }
        return (ticks - 116444736000000000L) / 10_000_000L;
    }
}
