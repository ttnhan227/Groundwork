using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

public sealed class DuplicateEngineService
{
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private const uint CLOUD_PLACEHOLDER_MASK = 0x00001000 | 0x00040000 | 0x00400000;
    private const int PREHASH_WINDOW_BYTES = 4096;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new(-1);

    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION
    {
        public uint dwFileAttributes;
        public uint ftCreationTimeLow;
        public uint ftCreationTimeHigh;
        public uint ftLastAccessTimeLow;
        public uint ftLastAccessTimeHigh;
        public uint ftLastWriteTimeLow;
        public uint ftLastWriteTimeHigh;
        public uint dwVolumeSerialNumber;
        public uint nFileSizeHigh;
        public uint nFileSizeLow;
        public uint nNumberOfLinks;
        public uint nFileIndexHigh;
        public uint nFileIndexLow;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(
        IntPtr hFile,
        out BY_HANDLE_FILE_INFORMATION lpFileInformation);

    public async Task<DuplicateScanReport> FindDuplicatesAsync(
        IEnumerable<ScannedEntry> scannedEntries,
        CancellationToken cancellationToken = default)
    {
        return await Task.Run(() => ExecuteDuplicateScan(scannedEntries, cancellationToken), cancellationToken).ConfigureAwait(false);
    }

    public async Task<DuplicateScanReport> ScanDirectoryForDuplicatesAsync(
        string rootPath,
        CancellationToken cancellationToken = default)
    {
        var scanResult = await new Win32StorageScanner().ScanAsync(
            rootPath,
            progress: null,
            topN: 25,
            retainAllEntries: true,
            cancellationToken: cancellationToken).ConfigureAwait(false);

        return await FindDuplicatesAsync(scanResult.AllEntries, cancellationToken).ConfigureAwait(false);
    }

    private DuplicateScanReport ExecuteDuplicateScan(
        IEnumerable<ScannedEntry> scannedEntries,
        CancellationToken cancellationToken)
    {
        var sw = Stopwatch.StartNew();
        int skippedCloud = 0;

        // Stage 1: Exact logical size grouping (non-empty files, skip reparse points & cloud placeholders)
        var sizeBuckets = new Dictionary<long, List<ScannedEntry>>();
        foreach (var entry in scannedEntries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (entry.IsDirectory || entry.LogicalBytes <= 0)
            {
                continue;
            }

            if ((entry.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
            {
                continue;
            }

            if ((entry.FileAttributes & CLOUD_PLACEHOLDER_MASK) != 0)
            {
                skippedCloud++;
                continue;
            }

            if (!sizeBuckets.TryGetValue(entry.LogicalBytes, out var list))
            {
                list = new List<ScannedEntry>();
                sizeBuckets[entry.LogicalBytes] = list;
            }
            list.Add(entry);
        }

        var collidingSizes = sizeBuckets
            .Where(kvp => kvp.Value.Count > 1)
            .OrderByDescending(kvp => kvp.Key)
            .ToList();

        if (collidingSizes.Count == 0)
        {
            sw.Stop();
            return new DuplicateScanReport(
                TotalGroups: 0,
                TotalDuplicateFiles: 0,
                TotalPotentialWasteBytes: 0,
                SkippedCloudPlaceholders: skippedCloud,
                ElapsedMilliseconds: Math.Round(sw.Elapsed.TotalMilliseconds, 2),
                Groups: Array.Empty<DuplicateGroup>());
        }

        // Stage 2: 4 KB head + 4 KB tail pre-hash on size-colliding files
        var prehashBuckets = new ConcurrentDictionary<(long Size, string PreHash), ConcurrentBag<(ScannedEntry Entry, ulong VolumeId, ulong FileIndex)>>();
        int maxDegree = Math.Clamp(Environment.ProcessorCount, 2, 8);

        Parallel.ForEach(
            collidingSizes.SelectMany(kvp => kvp.Value),
            new ParallelOptions { MaxDegreeOfParallelism = maxDegree, CancellationToken = cancellationToken },
            entry =>
            {
                try
                {
                    var attrs = File.GetAttributes(entry.FullPath);
                    if (((uint)attrs & CLOUD_PLACEHOLDER_MASK) != 0)
                    {
                        Interlocked.Increment(ref skippedCloud);
                        return;
                    }
                    if (((uint)attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                    {
                        return;
                    }

                    using var fs = new FileStream(entry.FullPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 8192);
                    if (fs.Length != entry.LogicalBytes)
                    {
                        return;
                    }

                    var (volId, fileIdx) = GetVolumeAndFileIndex(fs);
                    string preHash = ComputeHeadTailPreHash(fs, entry.LogicalBytes);

                    var bag = prehashBuckets.GetOrAdd((entry.LogicalBytes, preHash), _ => new ConcurrentBag<(ScannedEntry, ulong, ulong)>());
                    bag.Add((entry, volId, fileIdx));
                }
                catch
                {
                    // Skip locked or deleted files safely
                }
            });

        var prehashCollisions = prehashBuckets
            .Where(kvp => kvp.Value.Count > 1)
            .ToList();

        // Stage 3: Full SHA-256 verification only on pre-hash collisions
        var shaBuckets = new ConcurrentDictionary<(long Size, string Sha256), ConcurrentBag<(ScannedEntry Entry, ulong VolumeId, ulong FileIndex)>>();

        Parallel.ForEach(
            prehashCollisions.SelectMany(kvp => kvp.Value),
            new ParallelOptions { MaxDegreeOfParallelism = maxDegree, CancellationToken = cancellationToken },
            candidate =>
            {
                try
                {
                    using var fs = new FileStream(candidate.Entry.FullPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 65536);
                    if (fs.Length != candidate.Entry.LogicalBytes)
                    {
                        return;
                    }

                    byte[] hashBytes = SHA256.HashData(fs);
                    string shaHex = Convert.ToHexStringLower(hashBytes);

                    var bag = shaBuckets.GetOrAdd((candidate.Entry.LogicalBytes, shaHex), _ => new ConcurrentBag<(ScannedEntry, ulong, ulong)>());
                    bag.Add(candidate);
                }
                catch
                {
                    // Skip unreadable or concurrently modified files
                }
            });

        var groups = new List<DuplicateGroup>();
        foreach (var kvp in shaBuckets)
        {
            var items = kvp.Value
                .OrderBy(i => i.Entry.LastWriteUnixSeconds)
                .ThenBy(i => i.Entry.FullPath.Length)
                .ThenBy(i => i.Entry.FullPath, StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (items.Count < 2)
            {
                continue;
            }

            var seenInodes = new HashSet<(ulong Vol, ulong Idx)>();
            var groupFiles = new List<DuplicateFileEntry>(items.Count);
            int uniquePhysicalFiles = 0;

            foreach (var (entry, volId, fileIdx) in items)
            {
                bool isHardLink = false;
                if (fileIdx != 0)
                {
                    if (!seenInodes.Add((volId, fileIdx)))
                    {
                        isHardLink = true;
                    }
                }
                if (!isHardLink)
                {
                    uniquePhysicalFiles++;
                }

                groupFiles.Add(new DuplicateFileEntry(
                    FullPath: entry.FullPath,
                    Name: entry.Name,
                    SizeBytes: entry.LogicalBytes,
                    LastWriteUnixSeconds: entry.LastWriteUnixSeconds,
                    IsHardLinkAlias: isHardLink));
            }

            long wasteBytes = Math.Max(0L, (uniquePhysicalFiles - 1) * kvp.Key.Size);
            int hardLinkCount = items.Count - uniquePhysicalFiles;

            groups.Add(new DuplicateGroup(
                Sha256: kvp.Key.Sha256,
                SizeBytes: kvp.Key.Size,
                FileCount: items.Count,
                HardLinkAliases: hardLinkCount,
                PotentialWasteBytes: wasteBytes,
                Files: groupFiles));
        }

        var orderedGroups = groups
            .OrderByDescending(g => g.PotentialWasteBytes)
            .ThenByDescending(g => g.SizeBytes)
            .ToList();

        sw.Stop();
        return new DuplicateScanReport(
            TotalGroups: orderedGroups.Count,
            TotalDuplicateFiles: orderedGroups.Sum(g => g.FileCount),
            TotalPotentialWasteBytes: orderedGroups.Sum(g => g.PotentialWasteBytes),
            SkippedCloudPlaceholders: skippedCloud,
            ElapsedMilliseconds: Math.Round(sw.Elapsed.TotalMilliseconds, 2),
            Groups: orderedGroups);
    }

    private static string ComputeHeadTailPreHash(FileStream fs, long sizeBytes)
    {
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        byte[] buffer = new byte[PREHASH_WINDOW_BYTES * 2];

        if (sizeBytes <= PREHASH_WINDOW_BYTES * 2)
        {
            int read = fs.Read(buffer, 0, (int)sizeBytes);
            sha.AppendData(buffer, 0, read);
        }
        else
        {
            int headRead = fs.Read(buffer, 0, PREHASH_WINDOW_BYTES);
            sha.AppendData(buffer, 0, headRead);

            fs.Seek(sizeBytes - PREHASH_WINDOW_BYTES, SeekOrigin.Begin);
            int tailRead = fs.Read(buffer, 0, PREHASH_WINDOW_BYTES);
            sha.AppendData(buffer, 0, tailRead);
        }

        return Convert.ToHexStringLower(sha.GetHashAndReset());
    }

    private static (ulong VolumeId, ulong FileIndex) GetVolumeAndFileIndex(FileStream fs)
    {
        try
        {
            IntPtr handle = fs.SafeFileHandle.DangerousGetHandle();
            if (GetFileInformationByHandle(handle, out var info))
            {
                ulong fileIndex = ((ulong)info.nFileIndexHigh << 32) | info.nFileIndexLow;
                return (info.dwVolumeSerialNumber, fileIndex);
            }
        }
        catch
        {
        }
        return (0, 0);
    }
}
