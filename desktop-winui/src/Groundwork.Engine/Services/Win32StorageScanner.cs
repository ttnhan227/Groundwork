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

    private sealed class MutableNode
    {
        public int Id;
        public int ParentId;
        public required string Name;
        public required string FullPath;
        public required string Extension;
        public required string Category;
        public bool IsDirectory;
        public long LogicalBytes;
        public long AllocatedBytes;
        public int RecursiveFileCount;
        public int RecursiveFolderCount;
        public long LastWriteUnixSeconds;
        public uint FileAttributes;
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

        var folders = new List<MutableNode>(capacity: 16384);
        var files = new List<MutableNode>(capacity: 65536);
        var accessDenied = new ConcurrentBag<string>();
        var syncLock = new object();

        var rootNode = new MutableNode
        {
            Id = 0,
            ParentId = -1,
            Name = string.IsNullOrEmpty(Path.GetFileName(normalizedRoot)) ? normalizedRoot : Path.GetFileName(normalizedRoot),
            FullPath = normalizedRoot,
            Extension = string.Empty,
            Category = "folder",
            IsDirectory = true,
            LogicalBytes = 0,
            AllocatedBytes = 0,
            RecursiveFileCount = 0,
            RecursiveFolderCount = 0,
            LastWriteUnixSeconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            FileAttributes = FILE_ATTRIBUTE_DIRECTORY
        };
        folders.Add(rootNode);

        // Work queue of (FolderNodeIndex, FullDirectoryPath)
        var workQueue = new ConcurrentQueue<(int FolderIdx, string Path)>();
        workQueue.Enqueue((0, normalizedRoot));

        long filesScanned = 0;
        long foldersScanned = 1;
        long totalLogicalBytes = 0;
        long totalAllocatedBytes = 0;
        long lastReportTicks = sw.ElapsedTicks;
        long reportIntervalTicks = Stopwatch.Frequency / 5; // 200ms

        int maxDegree = Math.Clamp(Environment.ProcessorCount, 2, 8);
        int activeWorkers = 0;

        using var doneEvent = new ManualResetEventSlim(false);

        Parallel.For(0, maxDegree, new ParallelOptions { CancellationToken = cancellationToken }, _ =>
        {
            var localFiles = new List<MutableNode>(256);
            var localSubfolders = new List<MutableNode>(64);

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
                    localSubfolders.Clear();

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
                                // Never traverse junctions, symlinks, or mount points to prevent loops and cross-volume walks
                                continue;
                            }

                            bool isDir = (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0;
                            string childPath = CombineFast(current.Path, name);
                            long mtimeUnix = FileTimeToUnixSeconds(findData.ftLastWriteTime);

                            if (isDir)
                            {
                                localSubfolders.Add(new MutableNode
                                {
                                    ParentId = current.FolderIdx,
                                    Name = name,
                                    FullPath = childPath,
                                    Extension = string.Empty,
                                    Category = "folder",
                                    IsDirectory = true,
                                    LastWriteUnixSeconds = mtimeUnix,
                                    FileAttributes = attrs
                                });
                            }
                            else
                            {
                                long size = ((long)findData.nFileSizeHigh << 32) | findData.nFileSizeLow;
                                bool isCloudPlaceholder = (attrs & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)) != 0;
                                long alloc = isCloudPlaceholder ? 0 : RoundUpToCluster(size, clusterSize);
                                string ext = Path.GetExtension(name).ToLowerInvariant();
                                string cat = FileCategoryClassifier.ClassifyExtension(ext);

                                localFiles.Add(new MutableNode
                                {
                                    ParentId = current.FolderIdx,
                                    Name = name,
                                    FullPath = childPath,
                                    Extension = ext,
                                    Category = cat,
                                    IsDirectory = false,
                                    LogicalBytes = size,
                                    AllocatedBytes = alloc,
                                    RecursiveFileCount = 1,
                                    RecursiveFolderCount = 0,
                                    LastWriteUnixSeconds = mtimeUnix,
                                    FileAttributes = attrs
                                });
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
                        batchLogical += localFiles[i].LogicalBytes;
                        batchAlloc += localFiles[i].AllocatedBytes;
                    }

                    lock (syncLock)
                    {
                        var parentFolder = folders[current.FolderIdx];
                        parentFolder.LogicalBytes += batchLogical;
                        parentFolder.AllocatedBytes += batchAlloc;
                        parentFolder.RecursiveFileCount += localFiles.Count;
                        parentFolder.RecursiveFolderCount += localSubfolders.Count;

                        foreach (var sub in localSubfolders)
                        {
                            int newIdx = folders.Count;
                            sub.Id = newIdx;
                            folders.Add(sub);
                            workQueue.Enqueue((newIdx, sub.FullPath));
                        }

                        foreach (var file in localFiles)
                        {
                            file.Id = files.Count;
                            files.Add(file);
                        }
                    }

                    long currentFiles = Interlocked.Add(ref filesScanned, localFiles.Count);
                    long currentFolders = Interlocked.Add(ref foldersScanned, localSubfolders.Count);
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
        });

        cancellationToken.ThrowIfCancellationRequested();

        // Bottom-up O(N) folder size rollup: since child folders always have Id > ParentId,
        // iterating from folders.Count - 1 down to 1 rolls up all descendants in a single pass.
        for (int i = folders.Count - 1; i >= 1; i--)
        {
            var child = folders[i];
            int pIdx = child.ParentId;
            if (pIdx >= 0 && pIdx < folders.Count)
            {
                var parent = folders[pIdx];
                parent.LogicalBytes += child.LogicalBytes;
                parent.AllocatedBytes += child.AllocatedBytes;
                parent.RecursiveFileCount += child.RecursiveFileCount;
                parent.RecursiveFolderCount += child.RecursiveFolderCount;
            }
        }

        // Compute category breakdown
        var catTotals = new Dictionary<string, (long Count, long Bytes)>(StringComparer.OrdinalIgnoreCase);
        foreach (var f in files)
        {
            if (catTotals.TryGetValue(f.Category, out var prev))
            {
                catTotals[f.Category] = (prev.Count + 1, prev.Bytes + f.LogicalBytes);
            }
            else
            {
                catTotals[f.Category] = (1, f.LogicalBytes);
            }
        }

        var categoryBreakdown = catTotals
            .Select(kvp => new CategorySummary(
                Key: kvp.Key,
                Label: FileCategoryClassifier.CategoryLabels.GetValueOrDefault(kvp.Key, "Other Files"),
                FileCount: kvp.Value.Count,
                TotalBytes: kvp.Value.Bytes,
                SharePercent: totalLogicalBytes > 0 ? Math.Round((double)kvp.Value.Bytes / totalLogicalBytes * 100.0, 1) : 0.0
            ))
            .OrderByDescending(c => c.TotalBytes)
            .ToList();

        var largestFiles = files
            .OrderByDescending(f => f.LogicalBytes)
            .ThenBy(f => f.Name, StringComparer.OrdinalIgnoreCase)
            .Take(topN)
            .Select(ToScannedEntry)
            .ToList();

        var largestFolders = folders
            .Skip(1) // Skip root itself
            .Where(d => d.LogicalBytes > 0)
            .OrderByDescending(d => d.LogicalBytes)
            .ThenBy(d => d.Name, StringComparer.OrdinalIgnoreCase)
            .Take(topN)
            .Select(ToScannedEntry)
            .ToList();

        var topLevelChildren = folders
            .Skip(1)
            .Where(d => d.ParentId == 0 && d.LogicalBytes > 0)
            .Concat(files.Where(f => f.ParentId == 0 && f.LogicalBytes > 0))
            .OrderByDescending(e => e.LogicalBytes)
            .Take(24)
            .Select(ToScannedEntry)
            .ToList();

        IReadOnlyList<ScannedEntry> allEntries = retainAllEntries
            ? folders.Concat(files).Select(ToScannedEntry).ToList()
            : Array.Empty<ScannedEntry>();

        sw.Stop();
        progress?.Report(new ScanProgressReport(
            RootPath: normalizedRoot,
            Mode: ScanEngineMode.StandardWin32,
            CurrentDirectory: normalizedRoot,
            FilesScanned: files.Count,
            FoldersScanned: folders.Count,
            TotalLogicalBytes: totalLogicalBytes,
            AccessDeniedCount: accessDenied.Count,
            ElapsedMilliseconds: sw.Elapsed.TotalMilliseconds
        ));

        return new DriveScanResult(
            RootPath: normalizedRoot,
            EngineUsed: ScanEngineMode.StandardWin32,
            TotalFiles: files.Count,
            TotalFolders: folders.Count,
            TotalLogicalBytes: totalLogicalBytes,
            TotalAllocatedBytes: totalAllocatedBytes,
            ElapsedMilliseconds: Math.Round(sw.Elapsed.TotalMilliseconds, 2),
            AccessDeniedPaths: accessDenied.OrderBy(p => p, StringComparer.OrdinalIgnoreCase).ToList(),
            LargestFiles: largestFiles,
            LargestFolders: largestFolders,
            TopLevelSpaceMap: topLevelChildren,
            CategoryBreakdown: categoryBreakdown,
            AllEntries: allEntries
        );
    }

    private static ScannedEntry ToScannedEntry(MutableNode n) => new(
        Id: n.Id,
        ParentId: n.ParentId,
        Name: n.Name,
        FullPath: n.FullPath,
        Extension: n.Extension,
        Category: n.Category,
        IsDirectory: n.IsDirectory,
        LogicalBytes: n.LogicalBytes,
        AllocatedBytes: n.AllocatedBytes,
        RecursiveFileCount: n.RecursiveFileCount,
        RecursiveFolderCount: n.RecursiveFolderCount,
        LastWriteUnixSeconds: n.LastWriteUnixSeconds,
        FileAttributes: n.FileAttributes
    );

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
