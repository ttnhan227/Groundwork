using System;

namespace Groundwork.Engine.Models;

public sealed record VolumeMetadata(
    string RootPath,
    string VolumeName,
    string FileSystem,
    string DriveType,
    long TotalBytes,
    long UsedBytes,
    long FreeBytes,
    double UsedPercent,
    bool IsReady,
    bool SupportsUsnMftScan
);

public enum ScanEngineMode
{
    StandardWin32,
    ElevatedNtfsMft
}

public sealed record ScanProgressReport(
    string RootPath,
    ScanEngineMode Mode,
    string CurrentDirectory,
    long FilesScanned,
    long FoldersScanned,
    long TotalLogicalBytes,
    int AccessDeniedCount,
    double ElapsedMilliseconds
);

public sealed record ScannedEntry(
    int Id,
    int ParentId,
    string Name,
    string FullPath,
    string Extension,
    string Category,
    bool IsDirectory,
    long LogicalBytes,
    long AllocatedBytes,
    int RecursiveFileCount,
    int RecursiveFolderCount,
    long LastWriteUnixSeconds,
    uint FileAttributes
);

public sealed record CategorySummary(
    string Key,
    string Label,
    long FileCount,
    long TotalBytes,
    double SharePercent
);

public sealed record DriveScanResult(
    string RootPath,
    ScanEngineMode EngineUsed,
    long TotalFiles,
    long TotalFolders,
    long TotalLogicalBytes,
    long TotalAllocatedBytes,
    double ElapsedMilliseconds,
    IReadOnlyList<string> AccessDeniedPaths,
    IReadOnlyList<ScannedEntry> LargestFiles,
    IReadOnlyList<ScannedEntry> LargestFolders,
    IReadOnlyList<ScannedEntry> TopLevelSpaceMap,
    IReadOnlyList<CategorySummary> CategoryBreakdown,
    IReadOnlyList<ScannedEntry> AllEntries,
    IReadOnlyList<ScannedEntry>? AllFolders = null
);

public sealed record StorageScanOptions(
    int WorkerCount,
    IReadOnlySet<string> ExcludedDirectoryNames,
    IReadOnlySet<string> ExcludedPaths,
    IReadOnlySet<string> ExcludedExtensions
);

public sealed record DuplicateFileEntry(
    string FullPath,
    string Name,
    long SizeBytes,
    long LastWriteUnixSeconds,
    bool IsHardLinkAlias
);

public sealed record DuplicateGroup(
    string Sha256,
    long SizeBytes,
    int FileCount,
    int HardLinkAliases,
    long PotentialWasteBytes,
    IReadOnlyList<DuplicateFileEntry> Files
);

public sealed record DuplicateScanReport(
    int TotalGroups,
    int TotalDuplicateFiles,
    long TotalPotentialWasteBytes,
    int SkippedCloudPlaceholders,
    double ElapsedMilliseconds,
    IReadOnlyList<DuplicateGroup> Groups
);

public sealed record CleanupCandidateItem(
    string FullPath,
    string Name,
    string ParentPath,
    string RuleId,
    string Confidence,
    string Reason,
    long SizeBytes,
    int AgeDays,
    string? KeptReferencePath = null
);

public sealed record CleanupRuleGroup(
    string Id,
    string Name,
    string Description,
    string RiskLevel,
    int CandidateCount,
    long ReclaimableBytes,
    IReadOnlyList<CleanupCandidateItem> Items
);

public sealed record CleanupProposal(
    string Token,
    string Mode,
    DateTimeOffset ExpiresAt,
    long TotalBytes,
    int ItemCount,
    string Warning,
    IReadOnlyList<string> ValidatedPaths,
    IReadOnlyList<string> SkippedReasons
);

public sealed record CleanupExecutionReport(
    string Status,
    string Mode,
    int RemovedCount,
    long BytesReclaimed,
    IReadOnlyList<string> RemovedPaths,
    IReadOnlyList<string> FailedReasons,
    IReadOnlyList<string> SkippedReasons
);

public sealed record InstalledApplicationInfo(
    string Id,
    string Name,
    string Publisher,
    string Version,
    string InstallDate,
    string InstallLocation,
    string UninstallString,
    string QuietUninstallString,
    long? EstimatedSizeBytes,
    string Source,
    bool CanUninstall,
    bool IsSystemComponent,
    string IconPngPath = ""
);

public sealed record LeftoverFileSystemItem(
    string FullPath,
    string Name,
    string Kind,
    string LocationGroup,
    long SizeBytes,
    int FileCount,
    string Confidence,
    string Evidence
);

public sealed record LeftoverRegistryItem(
    string KeyPath,
    string Confidence,
    string Evidence
);

public sealed record AppLeftoverReport(
    string AppId,
    string AppName,
    string Publisher,
    string InstallLocation,
    int TotalCount,
    int HighConfidenceCount,
    int ReviewRequiredCount,
    long TotalReclaimableBytes,
    long HighConfidenceBytes,
    IReadOnlyList<LeftoverFileSystemItem> FileSystemLeftovers,
    IReadOnlyList<LeftoverRegistryItem> RegistryLeftovers
);

public sealed record UninstallSessionResult(
    string AppId,
    string AppName,
    int LaunchedProcessId,
    int? ExitCode,
    bool StillRegisteredAfterExit,
    AppLeftoverReport PostUninstallLeftovers
);

public sealed record SystemDiagnosticReport(
    long TotalReclaimableBytes,
    long RecycleBinBytes,
    long RecycleBinItemCount,
    long TempFilesBytes,
    long TempFilesCount,
    long CrashDumpsBytes,
    long CrashDumpsCount,
    long InstallerLeftoversBytes,
    long InstallerLeftoversCount,
    IReadOnlyList<CleanupCandidateItem> DiagnosticCandidates,
    IReadOnlyList<DuplicateGroup> DuplicateGroups
);
