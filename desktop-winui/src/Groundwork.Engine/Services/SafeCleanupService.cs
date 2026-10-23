using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

public sealed class SafeCleanupService
{
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private static readonly TimeSpan ConfirmationTtl = TimeSpan.FromMinutes(5);
    private static readonly ConcurrentDictionary<string, CleanupProposal> PendingProposals = new(StringComparer.Ordinal);

    private static readonly HashSet<string> TempLogExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".tmp", ".temp", ".bak", ".old", ".orig", ".dmp", ".crash", ".swp", ".swo"
    };

    private static readonly HashSet<string> TempFileNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "thumbs.db", ".ds_store", "desktop.ini"
    };

    private static readonly HashSet<string> CacheDirNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache", ".cache", ".parcel-cache", ".next", ".nuxt", ".turbo"
    };

    private static readonly HashSet<string> InstallerArchiveExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".msi", ".exe", ".iso", ".img", ".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".xz"
    };

    private static readonly HashSet<string> ProtectedTopLevelNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "windows", "system32", "syswow64", "program files", "program files (x86)",
        "programdata", "users", "recovery", "$recycle.bin", "system volume information"
    };

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEOPSTRUCTW
    {
        public IntPtr hwnd;
        public uint wFunc;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pFrom;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string? pTo;
        public ushort fFlags;
        [MarshalAs(UnmanagedType.Bool)]
        public bool fAnyOperationsAborted;
        public IntPtr hNameMappings;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string? lpszProgressTitle;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHFileOperationW(ref SHFILEOPSTRUCTW lpFileOp);

    public IReadOnlyList<CleanupRuleGroup> AnalyzeCleanupRules(
        IEnumerable<ScannedEntry> scannedEntries,
        DuplicateScanReport? duplicateReport = null,
        int staleDays = 60,
        long minLargeBytes = 25L * 1024 * 1024,
        long minArchiveBytes = 5L * 1024 * 1024)
    {
        long nowUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        long staleCutoff = nowUnix - Math.Max(1, staleDays) * 86400L;

        var tempItems = new List<CleanupCandidateItem>();
        var cacheItems = new List<CleanupCandidateItem>();
        var installerItems = new List<CleanupCandidateItem>();
        var staleItems = new List<CleanupCandidateItem>();

        foreach (var entry in scannedEntries.Where(e => !e.IsDirectory && e.LogicalBytes > 0).OrderByDescending(e => e.LogicalBytes))
        {
            string ext = entry.Extension;
            string name = entry.Name;
            string parentPath = Path.GetDirectoryName(entry.FullPath) ?? string.Empty;
            int ageDays = entry.LastWriteUnixSeconds > 0
                ? (int)Math.Max(0, (nowUnix - entry.LastWriteUnixSeconds) / 86400L)
                : 0;

            string[] segments = entry.FullPath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

            // Rule 1: Temp, Log & Backup Files
            if (TempLogExtensions.Contains(ext) ||
                TempFileNames.Contains(name) ||
                name.EndsWith('~') ||
                (string.Equals(ext, ".log", StringComparison.OrdinalIgnoreCase) && entry.LogicalBytes >= 256 * 1024))
            {
                tempItems.Add(new CleanupCandidateItem(
                    FullPath: entry.FullPath,
                    Name: name,
                    ParentPath: parentPath,
                    RuleId: "temp_and_logs",
                    Confidence: "high",
                    Reason: string.Equals(ext, ".log", StringComparison.OrdinalIgnoreCase)
                        ? $"Log file ({ext}, {ageDays}d old)"
                        : $"Temporary or backup artifact ({ext})",
                    SizeBytes: entry.LogicalBytes,
                    AgeDays: ageDays));
            }

            // Rule 2: Build, Package & Runtime Caches
            string? matchedCacheDir = segments.FirstOrDefault(s => CacheDirNames.Contains(s));
            if (matchedCacheDir != null ||
                string.Equals(ext, ".pyc", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(ext, ".pyo", StringComparison.OrdinalIgnoreCase))
            {
                cacheItems.Add(new CleanupCandidateItem(
                    FullPath: entry.FullPath,
                    Name: name,
                    ParentPath: parentPath,
                    RuleId: "cache_and_build",
                    Confidence: "high",
                    Reason: matchedCacheDir != null
                        ? $"Inside cache/build directory '{matchedCacheDir}'"
                        : $"Compiled bytecode cache file ({ext})",
                    SizeBytes: entry.LogicalBytes,
                    AgeDays: ageDays));
            }

            // Rule 3: Installers & Archives
            if (InstallerArchiveExtensions.Contains(ext) && entry.LogicalBytes >= minArchiveBytes)
            {
                bool inDownloads = segments.Any(s => string.Equals(s, "Downloads", StringComparison.OrdinalIgnoreCase));
                installerItems.Add(new CleanupCandidateItem(
                    FullPath: entry.FullPath,
                    Name: name,
                    ParentPath: parentPath,
                    RuleId: "installers_and_archives",
                    Confidence: "review_required",
                    Reason: $"{(inDownloads ? "Downloaded installer/archive" : "Installer or archive package")} ({ext}, modified {ageDays}d ago)",
                    SizeBytes: entry.LogicalBytes,
                    AgeDays: ageDays));
            }

            // Rule 4: Large Untouched Files
            if (entry.LogicalBytes >= minLargeBytes && (entry.LastWriteUnixSeconds <= staleCutoff || staleDays == 0))
            {
                staleItems.Add(new CleanupCandidateItem(
                    FullPath: entry.FullPath,
                    Name: name,
                    ParentPath: parentPath,
                    RuleId: "large_stale_files",
                    Confidence: "review_required",
                    Reason: $"Large file untouched for {ageDays} days",
                    SizeBytes: entry.LogicalBytes,
                    AgeDays: ageDays));
            }
        }

        // Rule 5: Exact SHA-256 Duplicates (excluding hard-link aliases)
        var duplicateItems = new List<CleanupCandidateItem>();
        if (duplicateReport != null)
        {
            foreach (var group in duplicateReport.Groups)
            {
                if (group.PotentialWasteBytes <= 0 || group.Files.Count < 2)
                {
                    continue;
                }

                var kept = group.Files[0];
                foreach (var extra in group.Files.Skip(1))
                {
                    if (extra.IsHardLinkAlias)
                    {
                        continue;
                    }

                    int ageDays = extra.LastWriteUnixSeconds > 0
                        ? (int)Math.Max(0, (nowUnix - extra.LastWriteUnixSeconds) / 86400L)
                        : 0;
                    duplicateItems.Add(new CleanupCandidateItem(
                        FullPath: extra.FullPath,
                        Name: extra.Name,
                        ParentPath: Path.GetDirectoryName(extra.FullPath) ?? string.Empty,
                        RuleId: "exact_duplicates",
                        Confidence: "high",
                        Reason: $"Identical SHA-256 content to '{kept.Name}' ({kept.FullPath})",
                        SizeBytes: extra.SizeBytes,
                        AgeDays: ageDays,
                        KeptReferencePath: kept.FullPath));
                }
            }
        }

        return new List<CleanupRuleGroup>
        {
            new(
                Id: "exact_duplicates",
                Name: "Exact Duplicate Files (SHA-256)",
                Description: "Redundant copies with identical byte-for-byte SHA-256 content hashes. One primary copy in each group is preserved.",
                RiskLevel: "low",
                CandidateCount: duplicateItems.Count,
                ReclaimableBytes: duplicateItems.Sum(i => i.SizeBytes),
                Items: duplicateItems.Take(100).ToList()),
            new(
                Id: "temp_and_logs",
                Name: "Temporary, Log & Backup Files",
                Description: "Scratch files (.tmp, .bak, .old, .dmp) and large log files safe to review for cleanup.",
                RiskLevel: "low",
                CandidateCount: tempItems.Count,
                ReclaimableBytes: tempItems.Sum(i => i.SizeBytes),
                Items: tempItems.Take(100).ToList()),
            new(
                Id: "cache_and_build",
                Name: "Build, Package & Runtime Caches",
                Description: "Generated cache files (__pycache__, .pytest_cache, .cache, .pyc) that tools recreate automatically.",
                RiskLevel: "low",
                CandidateCount: cacheItems.Count,
                ReclaimableBytes: cacheItems.Sum(i => i.SizeBytes),
                Items: cacheItems.Take(100).ToList()),
            new(
                Id: "installers_and_archives",
                Name: "Installers & Compressed Archives",
                Description: "Setup packages (.exe, .msi, .iso) and large archives (.zip, .7z, .rar) that may no longer be needed.",
                RiskLevel: "medium",
                CandidateCount: installerItems.Count,
                ReclaimableBytes: installerItems.Sum(i => i.SizeBytes),
                Items: installerItems.Take(100).ToList()),
            new(
                Id: "large_stale_files",
                Name: $"Large Untouched Files (>{Math.Max(1, minLargeBytes / (1024 * 1024))} MB, >{staleDays}d old)",
                Description: "High-capacity files that have not been modified recently. Always verify before removing.",
                RiskLevel: "medium",
                CandidateCount: staleItems.Count,
                ReclaimableBytes: staleItems.Sum(i => i.SizeBytes),
                Items: staleItems.Take(100).ToList())
        };
    }

    public static bool IsProtectedSystemPath(string path, IEnumerable<string>? allowedRoots = null)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return true;
        }

        string fullPath;
        try
        {
            fullPath = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }
        catch
        {
            return true;
        }

        // Never delete a drive root (e.g. C: or C:\)
        string? root = Path.GetPathRoot(fullPath)?.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (string.IsNullOrEmpty(root) || string.Equals(fullPath, root, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        // Reject reparse points (symlinks / junctions)
        try
        {
            if (File.Exists(fullPath) || Directory.Exists(fullPath))
            {
                var attrs = File.GetAttributes(fullPath);
                if (((uint)attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                {
                    return true;
                }
            }
        }
        catch
        {
            return true;
        }

        if (allowedRoots != null)
        {
            foreach (var allowed in allowedRoots)
            {
                string cleanAllowed = Path.GetFullPath(allowed).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                if (string.Equals(fullPath, cleanAllowed, StringComparison.OrdinalIgnoreCase))
                {
                    // Never delete an entire allowed root folder itself
                    return true;
                }
            }
        }

        string[] parts = fullPath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            .Where(p => !string.IsNullOrEmpty(p))
            .ToArray();

        if (parts.Length <= 2 && parts.Length >= 1 && ProtectedTopLevelNames.Contains(parts[^1]))
        {
            return true;
        }

        if (parts.Length >= 2)
        {
            string topDir = parts[1].ToLowerInvariant();
            if (topDir is "windows" or "recovery" or "$recycle.bin" or "system volume information")
            {
                return true;
            }

            if (parts.Length == 3 && topDir == "users")
            {
                // Never delete C:\Users\<username> root profile folder
                return true;
            }
        }

        if (parts.Any(p => p.Equals("system32", StringComparison.OrdinalIgnoreCase) ||
                           p.Equals("syswow64", StringComparison.OrdinalIgnoreCase) ||
                           p.Equals("winsxs", StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        return false;
    }

    public CleanupProposal ProposeCleanup(
        IEnumerable<string> candidatePaths,
        IEnumerable<string> allowedRoots,
        string mode = "recycle")
    {
        if (mode is not ("recycle" or "permanent"))
        {
            throw new ArgumentException("Cleanup mode must be 'recycle' or 'permanent'.", nameof(mode));
        }

        var normalizedRoots = allowedRoots
            .Where(r => !string.IsNullOrWhiteSpace(r))
            .Select(r => Path.GetFullPath(r).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (normalizedRoots.Count == 0)
        {
            throw new UnauthorizedAccessException("No allowed scan roots are configured for cleanup validation.");
        }

        var validated = new List<string>();
        var skipped = new List<string>();
        long totalBytes = 0;

        foreach (var rawPath in candidatePaths.Where(p => !string.IsNullOrWhiteSpace(p)).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                string full = ValidateTargetInsideRoots(rawPath, normalizedRoots);
                if (!File.Exists(full) && !Directory.Exists(full))
                {
                    skipped.Add($"{rawPath}: Item no longer exists on disk.");
                    continue;
                }

                long size = Directory.Exists(full)
                    ? new DirectoryInfo(full).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length)
                    : new FileInfo(full).Length;

                totalBytes += size;
                validated.Add(full);
            }
            catch (Exception ex)
            {
                skipped.Add($"{rawPath}: {ex.Message}");
            }
        }

        if (validated.Count == 0)
        {
            string reason = skipped.FirstOrDefault() ?? "No accessible items found.";
            throw new InvalidOperationException($"None of the selected items can be removed: {reason}");
        }

        PurgeExpiredProposals();

        string token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(24));
        var proposal = new CleanupProposal(
            Token: token,
            Mode: mode,
            ExpiresAt: DateTimeOffset.UtcNow.Add(ConfirmationTtl),
            TotalBytes: totalBytes,
            ItemCount: validated.Count,
            Warning: mode == "recycle"
                ? "Selected items will be moved to the Windows Recycle Bin. If Recycle Bin is unavailable, items will not be deleted unless you explicitly select permanent deletion."
                : "Selected items will be permanently deleted from disk and cannot be undone.",
            ValidatedPaths: validated,
            SkippedReasons: skipped);

        PendingProposals[token] = proposal;
        return proposal;
    }

    public CleanupExecutionReport ExecuteCleanup(
        string confirmationToken,
        IEnumerable<string> allowedRoots,
        Func<string, bool>? customRecycleHandler = null)
    {
        if (string.IsNullOrWhiteSpace(confirmationToken) || !PendingProposals.TryRemove(confirmationToken, out var proposal))
        {
            throw new UnauthorizedAccessException("Cleanup confirmation token is invalid or has already been used.");
        }

        if (DateTimeOffset.UtcNow > proposal.ExpiresAt)
        {
            throw new UnauthorizedAccessException("Cleanup confirmation token has expired. Please review and confirm again.");
        }

        var normalizedRoots = allowedRoots
            .Where(r => !string.IsNullOrWhiteSpace(r))
            .Select(r => Path.GetFullPath(r).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var removed = new List<string>();
        var failed = new List<string>();
        var skipped = new List<string>();
        long bytesReclaimed = 0;

        foreach (var path in proposal.ValidatedPaths)
        {
            try
            {
                string full = ValidateTargetInsideRoots(path, normalizedRoots);
                bool isDir = Directory.Exists(full);
                bool isFile = File.Exists(full);
                if (!isDir && !isFile)
                {
                    skipped.Add($"{full}: Already removed.");
                    continue;
                }

                long size = isDir
                    ? new DirectoryInfo(full).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length)
                    : new FileInfo(full).Length;

                if (proposal.Mode == "recycle")
                {
                    bool ok = customRecycleHandler != null
                        ? customRecycleHandler(full)
                        : SendToRecycleBinWindows(full);

                    if (!ok)
                    {
                        // Strictly refuse silent permanent fallback!
                        throw new IOException("Windows Recycle Bin could not accept this item. Choose permanent deletion explicitly to remove it without Recycle Bin recovery.");
                    }
                }
                else
                {
                    if (isDir)
                    {
                        Directory.Delete(full, recursive: true);
                    }
                    else
                    {
                        File.Delete(full);
                    }
                }

                removed.Add(full);
                bytesReclaimed += size;
            }
            catch (Exception ex)
            {
                failed.Add($"{path}: {ex.Message}");
            }
        }

        string status = failed.Count == 0 ? "completed" : (removed.Count > 0 ? "partial" : "failed");
        return new CleanupExecutionReport(
            Status: status,
            Mode: proposal.Mode,
            RemovedCount: removed.Count,
            BytesReclaimed: bytesReclaimed,
            RemovedPaths: removed,
            FailedReasons: failed,
            SkippedReasons: skipped);
    }

    private static string ValidateTargetInsideRoots(string rawPath, IReadOnlyList<string> normalizedRoots)
    {
        string full = Path.GetFullPath(rawPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (IsProtectedSystemPath(full, normalizedRoots))
        {
            throw new UnauthorizedAccessException($"Refusing to delete protected system path, reparse point, or root folder: '{rawPath}'.");
        }

        bool insideAllowed = false;
        foreach (var root in normalizedRoots)
        {
            string prefix = root + Path.DirectorySeparatorChar;
            if (full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                // Verify no intermediate parent directory between root and full is a reparse point
                string? current = Path.GetDirectoryName(full);
                while (!string.IsNullOrEmpty(current) && !string.Equals(current, root, StringComparison.OrdinalIgnoreCase))
                {
                    if (Directory.Exists(current))
                    {
                        var attrs = File.GetAttributes(current);
                        if (((uint)attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                        {
                            throw new UnauthorizedAccessException($"Access denied: '{rawPath}' traverses a symlink or junction '{current}'.");
                        }
                    }
                    current = Path.GetDirectoryName(current);
                }

                insideAllowed = true;
                break;
            }
        }

        if (!insideAllowed)
        {
            throw new UnauthorizedAccessException($"Access denied: '{rawPath}' is outside allowed boundaries.");
        }

        return full;
    }

    public static bool MoveToRecycleBin(string fullPath)
    {
        return SendToRecycleBinWindows(fullPath);
    }

    private static bool SendToRecycleBinWindows(string fullPath)
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        const uint FO_DELETE = 3;
        const ushort FOF_SILENT = 0x0004;
        const ushort FOF_NOCONFIRMATION = 0x0010;
        const ushort FOF_ALLOWUNDO = 0x0040;
        const ushort FOF_NOERRORUI = 0x0400;

        var op = new SHFILEOPSTRUCTW
        {
            hwnd = IntPtr.Zero,
            wFunc = FO_DELETE,
            pFrom = fullPath + "\0\0",
            pTo = null,
            fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT,
            fAnyOperationsAborted = false,
            hNameMappings = IntPtr.Zero,
            lpszProgressTitle = null
        };

        int res = SHFileOperationW(ref op);
        return res == 0 && !op.fAnyOperationsAborted && !File.Exists(fullPath) && !Directory.Exists(fullPath);
    }

    private static void PurgeExpiredProposals()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var kvp in PendingProposals)
        {
            if (now > kvp.Value.ExpiresAt)
            {
                PendingProposals.TryRemove(kvp.Key, out _);
            }
        }
    }
}
