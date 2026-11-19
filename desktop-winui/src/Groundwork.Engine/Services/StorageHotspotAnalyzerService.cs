using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

/// <summary>
/// Inspects real-world Windows storage bottlenecks (virtual disks, GPU shader/OTA caches,
/// developer package caches, heavy AppData/user folders, and Win32 folder/file hotspots)
/// and prepares safe, token-gated cleanup proposals for regenerable cache targets.
/// </summary>
public sealed class StorageHotspotAnalyzerService
{
    public const string CleanSpaceHogsOperationId = "maintenance.clean_space_hogs";
    public const string RecycleItemsOperationId = "maintenance.recycle_selected_items";
    public const string EmptyRecycleBinOperationId = "cleanup.empty_recycle_bin";

    public static readonly SystemOperationDescriptor EmptyRecycleBinDescriptor = new(
        OperationTypeId: EmptyRecycleBinOperationId,
        DisplayName: "Empty Windows Recycle Bin",
        Category: "Maintenance / Cleanup",
        Description: "Permanently empties items currently inside the Windows Recycle Bin across fixed drives via SHEmptyRecycleBinW.",
        Reversibility: OperationReversibility.Irreversible,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "Items currently in the Windows Recycle Bin will be permanently deleted and cannot be restored from the bin."
        ],
        VerificationMethodDescription: "Queries SHQueryRecycleBin after execution to confirm reclaimed items and remaining count.",
        RollbackMethodDescription: "Irreversible deletion from the Windows Recycle Bin.");

    public static readonly SystemOperationDescriptor RecycleItemsDescriptor = new(
        OperationTypeId: RecycleItemsOperationId,
        DisplayName: "Move Selected Items to Recycle Bin",
        Category: "Maintenance / Cleanup",
        Description: "Moves user-selected duplicates, large files, or app leftovers to the Windows Recycle Bin with full path/symlink boundary validation.",
        Reversibility: OperationReversibility.ReadOnly,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "Files are sent to the Windows Recycle Bin (not permanently shredded) and can be restored from Recycle Bin until emptied."
        ],
        VerificationMethodDescription: "Confirms each path was accepted by the Windows Recycle Bin and no longer occupies its original location.",
        RollbackMethodDescription: "Restore items anytime from the Windows Recycle Bin.");

    public static readonly SystemOperationDescriptor CleanSpaceHogsDescriptor = new(
        OperationTypeId: CleanSpaceHogsOperationId,
        DisplayName: "Clean Regenerable System, GPU & Developer Caches",
        Category: "Maintenance / Cleanup",
        Description: "Safely removes regenerable cache files (GPU shader caches, NVIDIA OTA installer leftovers, NuGet/npm/bun/pip/VS Code extension caches) while leaving virtual disks and user data untouched.",
        Reversibility: OperationReversibility.Irreversible,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "Games or 3D apps may recompile shaders on next launch after clearing DXCache/D3DSCache.",
            "Package managers (NuGet/npm/bun/pip) will re-download cached packages on future installs."
        ],
        VerificationMethodDescription: "Measures reclaimed bytes and verifies remaining unlocked files in the targeted cache directories.",
        RollbackMethodDescription: "Irreversible deletion of regenerable cache files (applications rebuild caches automatically as needed).");

    private sealed record CleanSpaceHogsPayload(
        IReadOnlyList<string> EntryIds,
        IReadOnlyList<string> TargetDirectories,
        long EstimatedBytes,
        int EstimatedItemCount);

    private sealed record RecycleItemsPayload(
        string Label,
        string CleanupToken,
        IReadOnlyList<string> AllowedRoots,
        IReadOnlyList<string> ValidatedPaths,
        long EstimatedBytes);

    private readonly SafeOperationEngine _safeOperationEngine;
    private readonly Win32StorageScanner _scanner;
    private readonly string _userProfile;
    private readonly string _localAppData;
    private readonly string _roamingAppData;
    private readonly string _programData;
    private readonly string _windowsDir;
    private readonly bool _usingCustomRoots;

    public StorageHotspotAnalyzerService(
        SafeOperationEngine? safeOperationEngine = null,
        Win32StorageScanner? scanner = null,
        string? customUserProfile = null,
        string? customLocalAppData = null,
        string? customRoamingAppData = null,
        string? customProgramData = null,
        string? customWindowsDir = null)
    {
        _safeOperationEngine = safeOperationEngine ?? new SafeOperationEngine();
        _scanner = scanner ?? new Win32StorageScanner();

        _usingCustomRoots = !string.IsNullOrWhiteSpace(customUserProfile) ||
                            !string.IsNullOrWhiteSpace(customLocalAppData) ||
                            !string.IsNullOrWhiteSpace(customRoamingAppData) ||
                            !string.IsNullOrWhiteSpace(customProgramData) ||
                            !string.IsNullOrWhiteSpace(customWindowsDir);

        _userProfile = !string.IsNullOrWhiteSpace(customUserProfile)
            ? customUserProfile
            : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        _localAppData = !string.IsNullOrWhiteSpace(customLocalAppData)
            ? customLocalAppData
            : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        _roamingAppData = !string.IsNullOrWhiteSpace(customRoamingAppData)
            ? customRoamingAppData
            : Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        _programData = !string.IsNullOrWhiteSpace(customProgramData)
            ? customProgramData
            : Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        _windowsDir = !string.IsNullOrWhiteSpace(customWindowsDir)
            ? customWindowsDir
            : Environment.GetFolderPath(Environment.SpecialFolder.Windows);

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: CleanSpaceHogsDescriptor,
            ExecuteAsync: ExecuteCleanSpaceHogsAsync));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: RecycleItemsDescriptor,
            ExecuteAsync: ExecuteRecycleItemsAsync));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: EmptyRecycleBinDescriptor,
            ExecuteAsync: ExecuteEmptyRecycleBinAsync));
    }

    public SafeOperationEngine SafeOperations => _safeOperationEngine;

    public async Task<StorageHotspotReport> ScanFolderHotspotsAsync(
        string rootPath,
        int topN = 15,
        long minFileBytes = 50L * 1024 * 1024,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var targetRoot = string.IsNullOrWhiteSpace(rootPath) ? _userProfile : Path.GetFullPath(rootPath);
        var scanResult = await _scanner.ScanAsync(
            targetRoot,
            topN: Math.Max(topN, 25),
            retainAllEntries: false,
            cancellationToken: cancellationToken).ConfigureAwait(false);

        long? volumeUsedBytes = null;
        long unaccountedProtectedBytes = 0;
        var pathRoot = Path.GetPathRoot(targetRoot);
        if (!string.IsNullOrEmpty(pathRoot) &&
            string.Equals(targetRoot.TrimEnd('\\'), pathRoot.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var di = new DriveInfo(pathRoot);
                if (di.IsReady)
                {
                    volumeUsedBytes = Math.Max(0, di.TotalSize - di.AvailableFreeSpace);
                    var delta = volumeUsedBytes.Value - scanResult.TotalLogicalBytes;
                    if (delta > 2L * 1024 * 1024 * 1024)
                    {
                        unaccountedProtectedBytes = delta;
                    }
                }
            }
            catch { }
        }

        var denom = Math.Max(1, scanResult.TotalLogicalBytes);
        var topRootFolders = scanResult.TopLevelSpaceMap
            .Where(d => d.LogicalBytes > 0)
            .OrderByDescending(d => d.LogicalBytes)
            .Take(topN)
            .Select(d => new StorageHotspotFolder(
                Name: d.Name,
                FullPath: d.FullPath,
                LogicalBytes: d.LogicalBytes,
                ShareOfRootPercent: Math.Round(d.LogicalBytes * 100.0 / denom, 1),
                FileCount: d.RecursiveFileCount))
            .ToList();

        var normalizedRootTrimmed = targetRoot.TrimEnd('\\');
        var topSubfolders = (scanResult.AllFolders ?? [])
            .Skip(1)
            .Where(d => d.LogicalBytes > 0 && GetRelativeDepth(normalizedRootTrimmed, d.FullPath) is >= 2 and <= 4)
            .OrderByDescending(d => d.LogicalBytes)
            .Take(topN)
            .Select(d => new StorageHotspotFolder(
                Name: d.Name,
                FullPath: d.FullPath,
                LogicalBytes: d.LogicalBytes,
                ShareOfRootPercent: Math.Round(d.LogicalBytes * 100.0 / denom, 1),
                FileCount: d.RecursiveFileCount))
            .ToList();

        var largestFiles = scanResult.LargestFiles
            .Where(f => f.LogicalBytes >= minFileBytes)
            .OrderByDescending(f => f.LogicalBytes)
            .Take(topN)
            .Select(f => new StorageLargeFileItem(
                Name: f.Name,
                FullPath: f.FullPath,
                Category: f.Category,
                LogicalBytes: f.LogicalBytes,
                LastWriteUnixSeconds: f.LastWriteUnixSeconds))
            .ToList();

        return new StorageHotspotReport(
            RootPath: scanResult.RootPath,
            ScannedBytes: scanResult.TotalLogicalBytes,
            TotalFiles: scanResult.TotalFiles,
            TotalFolders: scanResult.TotalFolders,
            ElapsedMs: scanResult.ElapsedMilliseconds,
            VolumeUsedBytes: volumeUsedBytes,
            UnaccountedProtectedBytes: unaccountedProtectedBytes,
            TopRootFolders: topRootFolders,
            TopSubfolders: topSubfolders,
            LargestFiles: largestFiles,
            AccessDeniedCount: scanResult.AccessDeniedPaths.Count);
    }

    public async Task<SpaceHogReport> InspectSpaceHogsAsync(
        long minReportThresholdBytes = 100L * 1024 * 1024,
        CancellationToken cancellationToken = default)
    {
        return await InspectSpaceHogsInternalAsync(minReportThresholdBytes, cancellationToken)
            .ConfigureAwait(false);
    }

    private async Task<SpaceHogReport> InspectSpaceHogsInternalAsync(long minReportThresholdBytes, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var entries = new List<SpaceHogEntry>();
        var coveredPrefixes = new List<string>();

        // Single parallel Win32 FindFirstFileExW pass over UserProfile covers AppData\Local,
        // AppData\Roaming, .nuget, .bun, npm-cache, Docker\wsl, NVIDIA\DXCache, D3DSCache, etc.
        var folderByPath = new Dictionary<string, ScannedEntry>(StringComparer.OrdinalIgnoreCase);
        var childrenByParent = new Dictionary<int, List<ScannedEntry>>();
        if (!string.IsNullOrWhiteSpace(_userProfile) && Directory.Exists(_userProfile))
        {
            var profileScan = await _scanner.ScanAsync(_userProfile, topN: 25, retainAllEntries: false, cancellationToken: ct)
                .ConfigureAwait(false);
            foreach (var folder in profileScan.AllFolders ?? [])
            {
                folderByPath[NormalizePath(folder.FullPath)] = folder;
                if (folder.ParentId >= 0)
                {
                    if (!childrenByParent.TryGetValue(folder.ParentId, out var list))
                    {
                        list = [];
                        childrenByParent[folder.ParentId] = list;
                    }
                    list.Add(folder);
                }
            }
        }

        async Task<(long Bytes, int Count)> MeasureTargetAsync(string dirPath, string filePattern)
        {
            if (string.IsNullOrWhiteSpace(dirPath) || !Directory.Exists(dirPath))
            {
                return (0, 0);
            }

            if (filePattern == "*" && folderByPath.TryGetValue(NormalizePath(dirPath), out var cached))
            {
                return (cached.LogicalBytes, cached.RecursiveFileCount);
            }

            if (filePattern != "*")
            {
                long b = 0;
                int c = 0;
                try
                {
                    foreach (var fi in new DirectoryInfo(dirPath).EnumerateFiles(filePattern, SearchOption.TopDirectoryOnly))
                    {
                        b += fi.Length;
                        c++;
                    }
                }
                catch { }
                return (b, c);
            }

            var subScan = await _scanner.ScanAsync(dirPath, topN: 5, retainAllEntries: false, cancellationToken: ct)
                .ConfigureAwait(false);
            return (subScan.TotalLogicalBytes, (int)Math.Min(int.MaxValue, subScan.TotalFiles));
        }

        async Task AddKnownTargetAsync(
            string id,
            string category,
            string title,
            string dirPath,
            string impactNote,
            string safetyGuidance,
            bool canSafeClean,
            string? cleanupHint = null,
            string filePattern = "*")
        {
            ct.ThrowIfCancellationRequested();
            var (bytes, count) = await MeasureTargetAsync(dirPath, filePattern).ConfigureAwait(false);
            if (bytes >= minReportThresholdBytes && count > 0)
            {
                entries.Add(new SpaceHogEntry(
                    Id: id,
                    Category: category,
                    Title: title,
                    LocationPath: dirPath,
                    SizeBytes: bytes,
                    ItemCount: count,
                    ImpactNote: impactNote,
                    SafetyGuidance: safetyGuidance,
                    CanSafeCleanDirectly: canSafeClean,
                    CleanupToolHint: cleanupHint));
                coveredPrefixes.Add(NormalizePath(dirPath));
            }
        }

        // 1. Docker & WSL Virtual Disks (NEVER auto-delete!)
        await AddKnownTargetAsync(
            id: "docker_wsl_disk",
            category: "Virtual Disk",
            title: "Docker Desktop WSL2 Virtual Disk",
            dirPath: Path.Combine(_localAppData, "Docker", "wsl"),
            impactNote: "docker_data.vhdx grows dynamically with pulled images/containers and never auto-shrinks on delete.",
            safetyGuidance: "Do NOT delete directly (contains Docker images/volumes). Run 'docker system prune -a' or move disk image in Docker Desktop Settings.",
            canSafeClean: false).ConfigureAwait(false);

        if (!_usingCustomRoots)
        {
            var programFilesWsl = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WSL");
            await AddKnownTargetAsync(
                id: "wsl_system_vhd",
                category: "Virtual Disk",
                title: "Windows Subsystem for Linux System VHD",
                dirPath: programFilesWsl,
                impactNote: "WSL2 kernel/system virtual disk image.",
                safetyGuidance: "Managed by WSL; compact unused distros via 'wsl --manage <distro> --resize' or Optimize-VHD.",
                canSafeClean: false,
                filePattern: "*.vhd*").ConfigureAwait(false);
        }

        // 2. GPU Shader Caches & Driver Update Leftovers
        await AddKnownTargetAsync(
            id: "nvidia_dxcache",
            category: "GPU & Driver Cache",
            title: "NVIDIA DirectX Shader Cache (DXCache)",
            dirPath: Path.Combine(_localAppData, "NVIDIA", "DXCache"),
            impactNote: "Accumulated compiled DirectX shaders across games and 3D apps.",
            safetyGuidance: "Safe to clear; NVIDIA driver rebuilds only actively used shaders.",
            canSafeClean: true,
            cleanupHint: "propose_clean_space_hogs").ConfigureAwait(false);

        await AddKnownTargetAsync(
            id: "nvidia_glcache",
            category: "GPU & Driver Cache",
            title: "NVIDIA OpenGL/Vulkan Shader Cache (GLCache)",
            dirPath: Path.Combine(_localAppData, "NVIDIA", "GLCache"),
            impactNote: "Compiled OpenGL/Vulkan shader cache.",
            safetyGuidance: "Safe to clear; regenerated automatically on app launch.",
            canSafeClean: true,
            cleanupHint: "propose_clean_space_hogs").ConfigureAwait(false);

        await AddKnownTargetAsync(
            id: "d3d_scache",
            category: "GPU & Driver Cache",
            title: "Windows Direct3D Shader Cache (D3DSCache)",
            dirPath: Path.Combine(_localAppData, "D3DSCache"),
            impactNote: "Direct3D pipeline shader cache.",
            safetyGuidance: "Safe to clear; matches Windows Disk Cleanup 'DirectX Shader Cache'.",
            canSafeClean: true,
            cleanupHint: "propose_clean_space_hogs").ConfigureAwait(false);

        await AddKnownTargetAsync(
            id: "amd_dxcache",
            category: "GPU & Driver Cache",
            title: "AMD DirectX Shader Cache",
            dirPath: Path.Combine(_localAppData, "AMD", "DxCache"),
            impactNote: "Accumulated AMD DirectX shader cache.",
            safetyGuidance: "Safe to clear; regenerated automatically.",
            canSafeClean: true,
            cleanupHint: "propose_clean_space_hogs").ConfigureAwait(false);

        var nvidiaOta = Path.Combine(_programData, "NVIDIA Corporation", "NVIDIA App", "UpdateFramework", "ota-artifacts");
        if (Directory.Exists(nvidiaOta))
        {
            var (otaBytes, otaCount) = await MeasureTargetAsync(nvidiaOta, "*").ConfigureAwait(false);
            if (otaBytes >= minReportThresholdBytes && otaCount > 0)
            {
                bool writable = IsDirectoryWritable(nvidiaOta);
                entries.Add(new SpaceHogEntry(
                    Id: "nvidia_ota_artifacts",
                    Category: "GPU & Driver Cache",
                    Title: "NVIDIA App Driver Update Payloads (ota-artifacts)",
                    LocationPath: nvidiaOta,
                    SizeBytes: otaBytes,
                    ItemCount: otaCount,
                    ImpactNote: "Leftover downloaded driver installer archives and extracted payloads from NVIDIA App updates.",
                    SafetyGuidance: writable
                        ? "Safe to remove once driver update is installed."
                        : "Safe to remove once driver update is installed (requires Administrator permission under ProgramData).",
                    CanSafeCleanDirectly: writable,
                    CleanupToolHint: writable ? "propose_clean_space_hogs" : null));
                coveredPrefixes.Add(NormalizePath(nvidiaOta));
            }
        }

        // 3. Developer Package & Extension Caches
        await AddKnownTargetAsync(
            id: "nuget_packages",
            category: "Developer Cache",
            title: "NuGet Global Package Cache (.nuget\\packages)",
            dirPath: Path.Combine(_userProfile, ".nuget", "packages"),
            impactNote: "Cached .NET NuGet packages across projects and versions.",
            safetyGuidance: "Safe to clear ('dotnet nuget locals all --clear'); next build restores needed packages.",
            canSafeClean: true,
            cleanupHint: "propose_clean_space_hogs").ConfigureAwait(false);

        await AddKnownTargetAsync(
            id: "nuget_v3_cache",
            category: "Developer Cache",
            title: "NuGet HTTP v3 Cache",
            dirPath: Path.Combine(_localAppData, "NuGet", "v3-cache"),
            impactNote: "Cached NuGet feed metadata.",
            safetyGuidance: "Safe to clear; regenerated automatically on NuGet restore.",
            canSafeClean: true,
            cleanupHint: "propose_clean_space_hogs").ConfigureAwait(false);

        await AddKnownTargetAsync(
            id: "npm_cache",
            category: "Developer Cache",
            title: "npm Package Cache (npm-cache)",
            dirPath: Path.Combine(_localAppData, "npm-cache"),
            impactNote: "Cached JavaScript tarballs and HTTP cache.",
            safetyGuidance: "Safe to clear ('npm cache clean --force'); packages are re-downloaded if needed.",
            canSafeClean: true,
            cleanupHint: "propose_clean_space_hogs").ConfigureAwait(false);

        await AddKnownTargetAsync(
            id: "bun_cache",
            category: "Developer Cache",
            title: "Bun Install Cache (.bun\\install\\cache)",
            dirPath: Path.Combine(_userProfile, ".bun", "install", "cache"),
            impactNote: "Cached Bun package versions and binaries.",
            safetyGuidance: "Safe to clear; Bun re-fetches required packages on next install.",
            canSafeClean: true,
            cleanupHint: "propose_clean_space_hogs").ConfigureAwait(false);

        await AddKnownTargetAsync(
            id: "pip_cache",
            category: "Developer Cache",
            title: "Python pip Wheel Cache",
            dirPath: Path.Combine(_localAppData, "pip", "cache"),
            impactNote: "Cached Python wheels and HTTP downloads.",
            safetyGuidance: "Safe to clear; pip re-downloads packages when needed.",
            canSafeClean: true,
            cleanupHint: "propose_clean_space_hogs").ConfigureAwait(false);

        await AddKnownTargetAsync(
            id: "vscode_cached_vsix",
            category: "Developer Cache",
            title: "VS Code Cached Extension Installers",
            dirPath: Path.Combine(_roamingAppData, "Code", "CachedExtensionVSIXs"),
            impactNote: "Archived VSIX extension packages kept after extension updates.",
            safetyGuidance: "Safe to clear; does not uninstall active VS Code extensions.",
            canSafeClean: true,
            cleanupHint: "propose_clean_space_hogs").ConfigureAwait(false);

        // 4. Windows Servicing Logs
        var cbsLogsDir = Path.Combine(_windowsDir, "Logs", "CBS");
        if (Directory.Exists(cbsLogsDir))
        {
            var (cbsBytes, cbsCount) = await MeasureTargetAsync(cbsLogsDir, "*").ConfigureAwait(false);
            if (cbsBytes >= minReportThresholdBytes && cbsCount > 0)
            {
                bool writable = IsDirectoryWritable(cbsLogsDir);
                entries.Add(new SpaceHogEntry(
                    Id: "windows_cbs_logs",
                    Category: "Windows Servicing",
                    Title: "Windows CBS Servicing Logs",
                    LocationPath: cbsLogsDir,
                    SizeBytes: cbsBytes,
                    ItemCount: cbsCount,
                    ImpactNote: "Accumulated Component-Based Servicing CbsPersist_*.log diagnostic logs.",
                    SafetyGuidance: writable
                        ? "Old CBS logs can be cleared safely."
                        : "Old CBS logs can be cleared from an elevated session or Disk Cleanup.",
                    CanSafeCleanDirectly: writable,
                    CleanupToolHint: writable ? "propose_clean_space_hogs" : null));
                coveredPrefixes.Add(NormalizePath(cbsLogsDir));
            }
        }

        // 5. Heavy AppData & User Profile Folders (instant from the single profile scan!)
        var scanParents = new (string Label, string DirPath)[]
        {
            ("AppData\\Local", _localAppData),
            ("AppData\\Roaming", _roamingAppData),
            ("User Profile", _userProfile)
        };

        foreach (var (label, parentDir) in scanParents)
        {
            if (string.IsNullOrWhiteSpace(parentDir) ||
                !folderByPath.TryGetValue(NormalizePath(parentDir), out var parentNode) ||
                !childrenByParent.TryGetValue(parentNode.Id, out var childFolders))
            {
                continue;
            }

            foreach (var sub in childFolders)
            {
                if (string.Equals(label, "User Profile", StringComparison.Ordinal) &&
                    string.Equals(sub.Name, "AppData", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var normSub = NormalizePath(sub.FullPath);
                if (coveredPrefixes.Any(p => string.Equals(p, normSub, StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                if (string.Equals(label, "AppData\\Local", StringComparison.Ordinal) &&
                    string.Equals(sub.Name, "Temp", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                long alreadyAccountedChildBytes = entries
                    .Where(e => IsSubPathOf(e.LocationPath, sub.FullPath))
                    .Sum(e => e.SizeBytes);

                long residualBytes = Math.Max(0, sub.LogicalBytes - alreadyAccountedChildBytes);
                if (residualBytes >= Math.Max(minReportThresholdBytes, 512L * 1024 * 1024))
                {
                    entries.Add(new SpaceHogEntry(
                        Id: $"folder_{SanitizeId(label)}_{SanitizeId(sub.Name)}",
                        Category: $"Heavy {label} Folder",
                        Title: $"{sub.Name} ({label})",
                        LocationPath: sub.FullPath,
                        SizeBytes: residualBytes,
                        ItemCount: sub.RecursiveFileCount,
                        ImpactNote: alreadyAccountedChildBytes > 0
                            ? $"Occupies {FormatGbOrMb(sub.LogicalBytes)} total ({FormatGbOrMb(residualBytes)} outside specific caches already listed)."
                            : $"Large directory under {label} occupying {FormatGbOrMb(residualBytes)} across {sub.RecursiveFileCount:N0} files.",
                        SafetyGuidance: "Review in Space Analyzer or Explorer before removing—may contain installed apps, browser profiles, or personal files.",
                        CanSafeCleanDirectly: false));
                }
            }
        }

        var ordered = entries.OrderByDescending(e => e.SizeBytes).ToList();
        var totalIdentified = ordered.Sum(e => e.SizeBytes);
        var safeReclaimable = ordered.Where(e => e.CanSafeCleanDirectly).Sum(e => e.SizeBytes);

        return new SpaceHogReport(
            Entries: ordered,
            TotalIdentifiedBytes: totalIdentified,
            SafeReclaimableBytes: safeReclaimable,
            CapturedAtUtc: DateTimeOffset.UtcNow);
    }

    public async Task<OperationProposal> ProposeCleanSafeSpaceHogsAsync(
        IEnumerable<string>? entryIds = null,
        CancellationToken cancellationToken = default)
    {
        var report = await InspectSpaceHogsAsync(minReportThresholdBytes: 1, cancellationToken).ConfigureAwait(false);
        var requested = entryIds?
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var eligible = report.Entries
            .Where(e => e.CanSafeCleanDirectly &&
                        (requested == null || requested.Count == 0 || requested.Contains(e.Id)))
            .ToList();

        var totalBytes = eligible.Sum(e => e.SizeBytes);
        var totalItems = eligible.Sum(e => e.ItemCount);
        var targetDirs = eligible.Select(e => e.LocationPath).ToList();
        var chosenIds = eligible.Select(e => e.Id).ToList();
        var payload = new CleanSpaceHogsPayload(chosenIds, targetDirs, totalBytes, totalItems);
        var payloadJson = JsonSerializer.Serialize(payload);
        var mb = totalBytes / (1024.0 * 1024.0);

        var summaryList = eligible.Count > 0
            ? string.Join(", ", eligible.Select(e => $"{e.Title} ({FormatGbOrMb(e.SizeBytes)})"))
            : "None";

        return _safeOperationEngine.CreateProposal(
            descriptor: CleanSpaceHogsDescriptor,
            targetDescription: eligible.Count > 0
                ? $"{eligible.Count} Regenerable Cache Group(s) ({FormatGbOrMb(totalBytes)}, {totalItems:N0} files)"
                : "No eligible regenerable cache groups selected",
            inspectedCurrentStateSummary: summaryList,
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: eligible.Count > 0
                ? $"Clean {totalItems:N0} cached file(s) (~{mb:F1} MB) across: {summaryList}. Virtual disks and user documents are never touched."
                : "No eligible safe cache files found to clean.",
            expectedEffects:
            [
                $"Reclaims up to {FormatGbOrMb(totalBytes)} from regenerable GPU/developer/installer caches.",
                "Virtual disks (.vhdx), documents, and personal user folders remain untouched."
            ],
            payloadJson: payloadJson,
            customPrerequisiteValidator: () =>
            {
                if (eligible.Count == 0 || totalItems == 0)
                {
                    return (false, "No eligible regenerable cache directories matched the request.");
                }
                return (true, $"Verified {eligible.Count} safe cache target(s) totaling {FormatGbOrMb(totalBytes)}.");
            });
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteCleanSpaceHogsAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<CleanSpaceHogsPayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid space-hog cleanup payload.");

        var removedFiles = 0;
        long reclaimedBytes = 0;
        var skippedLocked = 0;

        foreach (var dir in payload.TargetDirectories)
        {
            if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir) || IsUnsafeDeleteRoot(dir))
            {
                continue;
            }

            var queue = new Queue<string>();
            queue.Enqueue(dir);
            while (queue.Count > 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var currentDir = queue.Dequeue();
                try
                {
                    var di = new DirectoryInfo(currentDir);
                    if ((di.Attributes & FileAttributes.ReparsePoint) != 0)
                    {
                        continue;
                    }

                    foreach (var fi in di.EnumerateFiles("*", SearchOption.TopDirectoryOnly))
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        try
                        {
                            var len = fi.Length;
                            fi.Delete();
                            removedFiles++;
                            reclaimedBytes += len;
                        }
                        catch
                        {
                            skippedLocked++;
                        }
                    }

                    foreach (var sub in di.EnumerateDirectories("*", SearchOption.TopDirectoryOnly))
                    {
                        if ((sub.Attributes & FileAttributes.ReparsePoint) == 0)
                        {
                            queue.Enqueue(sub.FullName);
                        }
                    }
                }
                catch { }
            }
        }

        var ok = removedFiles > 0;
        var summary = $"Removed {removedFiles:N0} cached file(s) ({FormatGbOrMb(reclaimedBytes)} reclaimed); {skippedLocked} locked/in-use file(s) skipped.";
        var verification = new OperationVerificationResult(
            IsVerified: ok,
            ObservedStateSummary: summary,
            VerificationDetails: $"Targeted {payload.TargetDirectories.Count} cache directory/directories.",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: ok,
            PostStateSummary: summary,
            StatusMessage: ok ? summary : "No unlocked cache files could be removed.",
            Verification: verification));
    }

    public OperationProposal ProposeRecycleItems(
        IEnumerable<string> paths,
        IEnumerable<string> allowedRoots,
        string label)
    {
        var rootsList = allowedRoots.Where(r => !string.IsNullOrWhiteSpace(r)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var cleanupSvc = new SafeCleanupService();
        var cleanupProposal = cleanupSvc.ProposeCleanup(paths, rootsList, mode: "recycle");

        var payload = new RecycleItemsPayload(
            Label: string.IsNullOrWhiteSpace(label) ? "Selected Items" : label,
            CleanupToken: cleanupProposal.Token,
            AllowedRoots: rootsList,
            ValidatedPaths: cleanupProposal.ValidatedPaths,
            EstimatedBytes: cleanupProposal.TotalBytes);

        var payloadJson = JsonSerializer.Serialize(payload);
        var sizeText = FormatGbOrMb(cleanupProposal.TotalBytes);
        return _safeOperationEngine.CreateProposal(
            descriptor: RecycleItemsDescriptor,
            targetDescription: $"{payload.Label}: {cleanupProposal.ItemCount} item(s) ({sizeText})",
            inspectedCurrentStateSummary: $"{cleanupProposal.ItemCount} validated path(s) inside allowed roots.",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: $"Move {cleanupProposal.ItemCount} item(s) ({sizeText}) from {payload.Label} to the Windows Recycle Bin.",
            expectedEffects:
            [
                $"Frees {sizeText} on disk while keeping items recoverable in the Recycle Bin."
            ],
            payloadJson: payloadJson);
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteRecycleItemsAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<RecycleItemsPayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid recycle payload.");

        var cleanupSvc = new SafeCleanupService();
        var report = cleanupSvc.ExecuteCleanup(payload.CleanupToken, payload.AllowedRoots);
        var ok = report.RemovedCount > 0;
        var summary = ok
            ? $"Moved {report.RemovedCount} item(s) ({FormatGbOrMb(report.BytesReclaimed)}) to Recycle Bin."
            : (report.FailedReasons.FirstOrDefault() ?? "No items could be recycled.");

        var verification = new OperationVerificationResult(
            IsVerified: ok && report.FailedReasons.Count == 0,
            ObservedStateSummary: summary,
            VerificationDetails: report.FailedReasons.Count > 0
                ? string.Join("; ", report.FailedReasons.Take(3))
                : "Verified via SHFileOperationW (Recycle Bin).",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: ok,
            PostStateSummary: summary,
            StatusMessage: summary,
            Verification: verification));
    }

    public OperationProposal ProposeEmptyRecycleBin()
    {
        var (bytes, items) = SafeCleanupService.GetRecycleBinMetrics();
        var sizeText = FormatGbOrMb(bytes);
        return _safeOperationEngine.CreateProposal(
            descriptor: EmptyRecycleBinDescriptor,
            targetDescription: "Windows Recycle Bin",
            inspectedCurrentStateSummary: $"{items} item(s), {sizeText}",
            preChangeStateJson: JsonSerializer.Serialize(new { EstimatedBytes = bytes, ItemCount = items }),
            proposedChangeExplanation: $"Permanently empties {items} item(s) ({sizeText}) from the Windows Recycle Bin.",
            expectedEffects: [$"Reclaims up to {sizeText} on fixed drives."],
            payloadJson: "{}");
    }

    private static Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteEmptyRecycleBinAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var (beforeBytes, beforeItems) = SafeCleanupService.GetRecycleBinMetrics();
        var ok = beforeItems == 0 || SafeCleanupService.EmptyRecycleBin();
        var (afterBytes, afterItems) = SafeCleanupService.GetRecycleBinMetrics();

        var reclaimed = Math.Max(0, beforeBytes - afterBytes);
        var summary = ok
            ? $"Emptied Windows Recycle Bin ({FormatGbOrMb(reclaimed)} reclaimed, {afterItems} item(s) remaining)."
            : "Recycle Bin could not be emptied cleanly (some items may be in use).";

        return Task.FromResult((
            ok,
            summary,
            summary,
            new OperationVerificationResult(ok, $"{afterItems} items remaining", summary, DateTimeOffset.UtcNow)));
    }

    private static bool IsUnsafeDeleteRoot(string path)
    {
        if (SafeCleanupService.IsProtectedSystemPath(path))
        {
            return true;
        }
        var lower = NormalizePath(path);
        return lower.EndsWith(@"\docker", StringComparison.OrdinalIgnoreCase) ||
               lower.EndsWith(@"\docker\wsl", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsDirectoryWritable(string dir)
    {
        try
        {
            var probe = Path.Combine(dir, $".gw_write_probe_{Guid.NewGuid():N}.tmp");
            using (File.Create(probe, 1, FileOptions.DeleteOnClose)) { }
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static int GetRelativeDepth(string rootTrimmed, string fullPath)
    {
        var p = fullPath.TrimEnd('\\');
        if (p.Length <= rootTrimmed.Length || !p.StartsWith(rootTrimmed, StringComparison.OrdinalIgnoreCase))
        {
            return 0;
        }
        var rel = p.Substring(rootTrimmed.Length).TrimStart('\\');
        return string.IsNullOrEmpty(rel) ? 0 : rel.Split('\\', StringSplitOptions.RemoveEmptyEntries).Length;
    }

    private static string NormalizePath(string path) =>
        Path.GetFullPath(path).TrimEnd('\\', '/');

    private static bool IsSubPathOf(string candidateChild, string parent)
    {
        var c = NormalizePath(candidateChild) + "\\";
        var p = NormalizePath(parent) + "\\";
        return c.Length > p.Length && c.StartsWith(p, StringComparison.OrdinalIgnoreCase);
    }

    private static string SanitizeId(string value) =>
        new(value.ToLowerInvariant().Select(ch => char.IsLetterOrDigit(ch) ? ch : '_').ToArray());

    public static string FormatGbOrMb(long bytes)
    {
        if (bytes >= 1024L * 1024 * 1024)
        {
            return $"{bytes / (1024.0 * 1024 * 1024):F2} GB";
        }
        if (bytes >= 1024L * 1024)
        {
            return $"{bytes / (1024.0 * 1024):F1} MB";
        }
        return $"{Math.Max(0, bytes / 1024.0):F0} KB";
    }
}
