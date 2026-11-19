using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;
using Microsoft.Win32;

namespace Groundwork.Engine.Services;

/// <summary>
/// Provides unique Windows-native utilities that go beyond built-in Windows Settings:
/// 1-click IT repair workflows, essential runtime health auditing (VC++, .NET, WebView2),
/// Microsoft Store (Appx) bloatware inspection &amp; safe removal, and winget essential software setup.
/// Every system-modifying action goes through <see cref="SafeOperationEngine"/>.
/// </summary>
public sealed class WindowsRepairAndDebloatService
{
    public const string RepairActionOperationId = "repair.execute_fix";
    public const string RemoveAppxOperationId = "apps.remove_appx_package";
    public const string RemoveAppxBatchOperationId = "apps.remove_appx_batch";
    public const string CleanRegistryLeftoversOperationId = "apps.clean_registry_leftovers";
    public const string InstallWingetToolOperationId = "apps.install_essential_tool";
    public const string InstallWingetBatchOperationId = "apps.install_essential_batch";

    private static readonly Regex SafeIdentifierRegex = new(@"^[A-Za-z0-9._+\-]+$", RegexOptions.Compiled);

    private static readonly string[] ProtectedAppxPrefixes =
    [
        "Microsoft.WindowsStore",
        "Microsoft.StorePurchaseApp",
        "Microsoft.DesktopAppInstaller",
        "Microsoft.UI.Xaml",
        "Microsoft.VCLibs",
        "Microsoft.NET.Native",
        "Microsoft.WindowsAppRuntime",
        "Microsoft.SecHealthUI",
        "Microsoft.Windows.ShellExperienceHost",
        "Microsoft.Windows.StartMenuExperienceHost",
        "MicrosoftWindows.Client",
        "Microsoft.WindowsTerminal",
        "Microsoft.HEIFImageExtension",
        "Microsoft.VP9VideoExtensions",
        "Microsoft.WebpImageExtension",
        "Microsoft.WebMediaExtensions"
    ];

    private static readonly Dictionary<string, string> KnownBloatDescriptions = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Clipchamp.Clipchamp"] = "Preinstalled Clipchamp video editor.",
        ["Microsoft.BingNews"] = "MSN / Microsoft News Store app.",
        ["Microsoft.BingWeather"] = "MSN Weather Store app.",
        ["Microsoft.BingSearch"] = "Microsoft Bing Search integration app.",
        ["Microsoft.MicrosoftSolitaireCollection"] = "Preinstalled casual card games with ads.",
        ["Microsoft.WindowsFeedbackHub"] = "Windows diagnostic Feedback Hub app.",
        ["Microsoft.GetHelp"] = "Microsoft automated Get Help troubleshooter.",
        ["Microsoft.Getstarted"] = "Windows Tips / Get Started onboarding app.",
        ["Microsoft.Todos"] = "Microsoft To Do app.",
        ["Microsoft.WindowsMaps"] = "Offline Windows Maps app.",
        ["Microsoft.ZuneMusic"] = "Legacy Groove / Media Player Music wrapper.",
        ["Microsoft.ZuneVideo"] = "Movies & TV storefront app.",
        ["Microsoft.People"] = "Windows People contacts integration.",
        ["Microsoft.PowerAutomateDesktop"] = "Power Automate RPA background client.",
        ["Microsoft.Copilot"] = "Microsoft Copilot Store app.",
        ["Microsoft.549981C3F5F10"] = "Legacy Cortana assistant package.",
        ["Microsoft.YourPhone"] = "Phone Link companion app (safe to remove if unused).",
        ["Microsoft.windowscommunicationsapps"] = "Legacy Mail & Calendar Store app.",
        ["MicrosoftTeams"] = "Preinstalled consumer Microsoft Teams chat app.",
        ["MSTeams"] = "Microsoft Teams Store package.",
        ["Microsoft.DevHome"] = "Microsoft Dev Home preview dashboard.",
        ["Microsoft.MixedReality.Portal"] = "Windows Mixed Reality VR portal (deprecated).",
        ["Microsoft.WindowsSoundRecorder"] = "Windows Sound Recorder app.",
        ["Microsoft.SkypeApp"] = "Consumer Skype Store app."
    };

    private static readonly IReadOnlyList<EssentialToolSpec> EssentialToolsCatalog =
    [
        new("Microsoft.VCRedist.2015+.x64", "Visual C++ 2015–2022 Runtime (x64)", "Runtime", "Required by most PC games, CAD apps, and native 64-bit software."),
        new("Microsoft.VCRedist.2015+.x86", "Visual C++ 2015–2022 Runtime (x86)", "Runtime", "Required by 32-bit games, launchers, and older desktop utilities."),
        new("Microsoft.DotNet.DesktopRuntime.10", ".NET 10 Desktop Runtime", "Runtime", "Required to run modern Windows .NET WPF/WinForms/WinUI desktop apps."),
        new("7zip.7zip", "7-Zip", "Utilities", "Fast, ad-free archive extractor supporting .zip, .7z, .rar, .tar, and .iso."),
        new("voidtools.Everything", "Everything Search", "Productivity", "Instant NTFS filename search across millions of files in milliseconds."),
        new("Microsoft.PowerToys", "Microsoft PowerToys", "Productivity", "Official Microsoft power utilities: FancyZones, Color Picker, Text Extractor, Quick Accent."),
        new("AntibodySoftware.WizTree", "WizTree", "Utilities", "Ultra-fast NTFS MFT disk space visualizer."),
        new("VideoLAN.VLC", "VLC Media Player", "Media", "Open-source media player supporting nearly every video and audio codec.")
    ];

    private sealed record EssentialToolSpec(string WingetId, string DisplayName, string Category, string Description);
    private sealed record RepairActionPayload(string RepairId, string DisplayName);
    private sealed record RemoveAppxPayload(string PackageFullName, string PackageName);
    private sealed record RemoveAppxBatchPayload(IReadOnlyList<RemoveAppxPayload> Packages);
    private sealed record CleanRegistryLeftoversPayload(IReadOnlyList<string> KeyPaths);
    private sealed record InstallToolPayload(string WingetId, string DisplayName);
    private sealed record InstallToolBatchPayload(IReadOnlyList<string> WingetIds);

    private readonly SafeOperationEngine _safeOperationEngine;
    private readonly InstalledAppsEngineService _installedAppsService;
    private readonly Func<bool> _isElevatedFunc;
    private readonly Func<string, IReadOnlyList<string>, int, (int ExitCode, string Output)> _processRunner;
    private readonly Func<IReadOnlyList<RuntimeHealthEntry>>? _customRuntimeInspector;

    public WindowsRepairAndDebloatService(
        SafeOperationEngine? safeOperationEngine = null,
        InstalledAppsEngineService? installedAppsService = null,
        Func<bool>? isElevatedFunc = null,
        Func<string, IReadOnlyList<string>, int, (int ExitCode, string Output)>? processRunner = null,
        Func<IReadOnlyList<RuntimeHealthEntry>>? customRuntimeInspector = null)
    {
        _safeOperationEngine = safeOperationEngine ?? new SafeOperationEngine();
        _installedAppsService = installedAppsService ?? new InstalledAppsEngineService();
        _isElevatedFunc = isElevatedFunc ?? DefaultIsProcessElevated;
        _processRunner = processRunner ?? DefaultRunProcess;
        _customRuntimeInspector = customRuntimeInspector;

        RegisterHandlers();
    }

    public SafeOperationEngine SafeOperations => _safeOperationEngine;
    public bool IsCurrentSessionElevated => _isElevatedFunc();

    public static SystemOperationDescriptor RepairActionDescriptor { get; } = new(
        OperationTypeId: RepairActionOperationId,
        DisplayName: "Execute Windows Repair Workflow",
        Category: "Troubleshoot / Repair Toolkit",
        Description: "Runs a deterministic built-in Windows maintenance or repair sequence (Explorer icon cache, DNS/Winsock reset, Print Spooler queue, Windows Update cache, DISM WinSxS cleanup, or SFC).",
        Reversibility: OperationReversibility.PartiallyReversible,
        RiskLevel: OperationRiskLevel.Medium,
        ElevationRequirement: OperationElevationRequirement.AdministratorRequired,
        PotentialRisks:
        [
            "Explorer or service resets briefly restart File Explorer, Print Spooler, or Windows Update services.",
            "Network stack resets (Winsock + IP reset) may require a system restart to fully apply."
        ],
        VerificationMethodDescription: "Verifies process exit code and post-repair system/cache state.",
        RollbackMethodDescription: "Windows regenerates caches (icons, update downloads, Winsock catalog) automatically.");

    public static SystemOperationDescriptor RemoveAppxDescriptor { get; } = new(
        OperationTypeId: RemoveAppxOperationId,
        DisplayName: "Remove Preinstalled Windows Store (Appx) App",
        Category: "Applications / Debloat",
        Description: "Removes a non-essential Microsoft Store / UWP package for the current user via PowerShell Remove-AppxPackage.",
        Reversibility: OperationReversibility.PartiallyReversible,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "Core Windows components (Microsoft Store, Terminal, UI frameworks) are strictly blocked from removal.",
            "Removed consumer apps can be reinstalled from the Microsoft Store at any time."
        ],
        VerificationMethodDescription: "Queries Get-AppxPackage to verify the package is no longer installed for the current user.",
        RollbackMethodDescription: "Reinstall the app from Microsoft Store if needed later.");

    public static SystemOperationDescriptor InstallWingetToolDescriptor { get; } = new(
        OperationTypeId: InstallWingetToolOperationId,
        DisplayName: "Install Essential Software via Windows Package Manager (winget)",
        Category: "Applications / Essential Setup",
        Description: "Installs a curated runtime or utility cleanly from Microsoft's official winget repository without bundled installers.",
        Reversibility: OperationReversibility.Reversible,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "Downloads the official package installer via Microsoft's Windows Package Manager (winget).",
            "Can be uninstalled normally anytime from Groundwork Installed Apps or Windows Settings."
        ],
        VerificationMethodDescription: "Verifies winget exit code and confirms installation output.",
        RollbackMethodDescription: "Uninstall the application via Installed Apps.");

    private void RegisterHandlers()
    {
        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: RepairActionDescriptor,
            ExecuteAsync: ExecuteRepairActionAsync,
            RollbackAsync: null));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: RemoveAppxDescriptor,
            ExecuteAsync: ExecuteRemoveAppxAsync,
            RollbackAsync: null));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: RemoveAppxDescriptor with
            {
                OperationTypeId = RemoveAppxBatchOperationId,
                DisplayName = "Batch Remove Selected Store (Appx) Apps"
            },
            ExecuteAsync: ExecuteRemoveAppxBatchAsync,
            RollbackAsync: null));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: RemoveAppxDescriptor with
            {
                OperationTypeId = CleanRegistryLeftoversOperationId,
                DisplayName = "Clean Uninstalled Application Registry Traces",
                Category = "Applications / Leftovers",
                Description = "Deletes verified application leftover subkeys under HKCU\\Software (or HKLM\\Software when elevated) after uninstallation.",
                Reversibility = OperationReversibility.Irreversible,
                RiskLevel = OperationRiskLevel.Low
            },
            ExecuteAsync: ExecuteCleanRegistryLeftoversAsync,
            RollbackAsync: null));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: InstallWingetToolDescriptor,
            ExecuteAsync: ExecuteInstallEssentialToolAsync,
            RollbackAsync: null));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: InstallWingetToolDescriptor with
            {
                OperationTypeId = InstallWingetBatchOperationId,
                DisplayName = "Batch Install Essential Runtimes & Utilities (winget)"
            },
            ExecuteAsync: ExecuteInstallEssentialToolsBatchAsync,
            RollbackAsync: null));
    }

    // =========================================================================
    // 1. RUNTIME HEALTH CHECKS (VC++, .NET DESKTOP, WEBVIEW2, WINGET)
    // =========================================================================

    public IReadOnlyList<RuntimeHealthEntry> InspectInstalledRuntimes()
    {
        if (_customRuntimeInspector is not null)
        {
            return _customRuntimeInspector();
        }

        var list = new List<RuntimeHealthEntry>();

        // VC++ 2015-2022 x64
        var vc64 = ReadVcRedistVersion(@"SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64");
        list.Add(new RuntimeHealthEntry(
            RuntimeId: "runtime.vcredist_x64",
            DisplayName: "Visual C++ 2015–2022 (x64)",
            IsInstalled: vc64 is not null,
            DetectedVersion: vc64 ?? "Missing",
            StatusSummary: vc64 is not null ? $"Installed (v{vc64})" : "Missing — 64-bit games/apps may fail with VCRUNTIME140.dll errors.",
            RecommendedWingetId: vc64 is null ? "Microsoft.VCRedist.2015+.x64" : null));

        // VC++ 2015-2022 x86
        var vc86 = ReadVcRedistVersion(@"SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x86")
                   ?? ReadVcRedistVersion(@"SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x86");
        list.Add(new RuntimeHealthEntry(
            RuntimeId: "runtime.vcredist_x86",
            DisplayName: "Visual C++ 2015–2022 (x86)",
            IsInstalled: vc86 is not null,
            DetectedVersion: vc86 ?? "Missing",
            StatusSummary: vc86 is not null ? $"Installed (v{vc86})" : "Missing — older 32-bit utilities/games may require x86 runtime.",
            RecommendedWingetId: vc86 is null ? "Microsoft.VCRedist.2015+.x86" : null));

        // .NET Desktop Runtime
        var dotnetVersions = DetectDotNetDesktopRuntimes();
        var latestDotNet = dotnetVersions.LastOrDefault();
        list.Add(new RuntimeHealthEntry(
            RuntimeId: "runtime.dotnet_desktop",
            DisplayName: ".NET Desktop Runtime",
            IsInstalled: dotnetVersions.Count > 0,
            DetectedVersion: latestDotNet ?? "Missing",
            StatusSummary: dotnetVersions.Count > 0
                ? $"Installed: {string.Join(", ", dotnetVersions.TakeLast(3))}"
                : "Not detected under Program Files\\dotnet.",
            RecommendedWingetId: dotnetVersions.Count == 0 ? "Microsoft.DotNet.DesktopRuntime.10" : null));

        // WebView2 Runtime
        var webView2Ver = ReadWebView2Version();
        list.Add(new RuntimeHealthEntry(
            RuntimeId: "runtime.webview2",
            DisplayName: "Microsoft Edge WebView2 Runtime",
            IsInstalled: !string.IsNullOrWhiteSpace(webView2Ver),
            DetectedVersion: webView2Ver ?? "Missing",
            StatusSummary: !string.IsNullOrWhiteSpace(webView2Ver)
                ? $"Installed (v{webView2Ver})"
                : "Missing — required by modern Windows apps and embedded dashboards.",
            RecommendedWingetId: null));

        return list;
    }

    // =========================================================================
    // 2. 1-CLICK WINDOWS REPAIR TOOLKIT
    // =========================================================================

    public IReadOnlyList<WindowsRepairActionInfo> GetAvailableRepairActions()
    {
        var isAdmin = _isElevatedFunc();
        return
        [
            new("repair.explorer_icon_cache", "Rebuild Icon & Thumbnail Cache + Restart Explorer", "Shell & Visuals",
                "Clears corrupted Windows iconcache_*.db / thumbcache_*.db files and restarts File Explorer cleanly.",
                "File Explorer windows will briefly close and reopen.", false, true),
            new("repair.network_reset", "Full Network Stack & Winsock Reset", "Network",
                "Flushes DNS resolver cache, resets Winsock catalog, and resets TCP/IP stack.",
                "Requires Administrator; a PC restart may be needed to finalize Winsock changes.", true, isAdmin),
            new("repair.print_spooler", "Clear Stuck Print Spooler Queue", "Printers",
                "Stops Windows Print Spooler service, clears jammed .SPL/.SHD queue files, and restarts the spooler.",
                "Requires Administrator; cancels all pending print jobs.", true, isAdmin),
            new("repair.windows_update_cache", "Reset Stuck Windows Update Download Cache", "Windows Update",
                "Stops Windows Update (wuauserv) and BITS, clears C:\\Windows\\SoftwareDistribution\\Download, and restarts services.",
                "Requires Administrator; clears unfinished update downloads without deleting installed updates.", true, isAdmin),
            new("repair.winsxs_cleanup", "Clean Old Windows Component Store (DISM WinSxS)", "Disk & Servicing",
                "Runs DISM /Online /Cleanup-Image /StartComponentCleanup to reclaim gigabytes of superseded update backups.",
                "Requires Administrator; may take 1–3 minutes. Old update uninstall packages are removed.", true, isAdmin),
            new("repair.sfc_scan", "Repair Corrupted Windows Files (SFC /scannow)", "System Integrity",
                "Scans protected Windows system DLLs/EXEs and replaces corrupted copies from the healthy component store.",
                "Requires Administrator; typically takes 2–5 minutes.", true, isAdmin)
        ];
    }

    public OperationProposal ProposeRepairAction(string repairId)
    {
        var action = GetAvailableRepairActions()
            .FirstOrDefault(a => string.Equals(a.RepairId, repairId, StringComparison.OrdinalIgnoreCase));

        var payloadJson = JsonSerializer.Serialize(new RepairActionPayload(
            action?.RepairId ?? repairId,
            action?.DisplayName ?? repairId));

        var descriptor = action is not null
            ? RepairActionDescriptor with
            {
                DisplayName = action.DisplayName,
                RiskLevel = action.RequiresAdministrator ? OperationRiskLevel.Medium : OperationRiskLevel.Low,
                ElevationRequirement = action.RequiresAdministrator
                    ? OperationElevationRequirement.AdministratorRequired
                    : OperationElevationRequirement.StandardUser
            }
            : RepairActionDescriptor;

        return _safeOperationEngine.CreateProposal(
            descriptor: descriptor,
            targetDescription: action?.DisplayName ?? repairId,
            inspectedCurrentStateSummary: $"Session privilege: {(_isElevatedFunc() ? "Administrator" : "Standard User")}",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: action?.Summary ?? $"Executes repair action '{repairId}'.",
            expectedEffects: [action?.RiskNote ?? "Runs targeted Windows repair steps."],
            payloadJson: payloadJson,
            customPrerequisiteValidator: () =>
            {
                if (action is null)
                {
                    return (false, $"Unknown repair action '{repairId}'.");
                }
                if (action.RequiresAdministrator && !_isElevatedFunc())
                {
                    return (false, $"'{action.DisplayName}' requires Administrator privileges. Restart Groundwork as Administrator to run it.");
                }
                return (true, "Prerequisites satisfied.");
            });
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteRepairActionAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<RepairActionPayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid repair action payload.");

        bool succeeded;
        string summary;

        switch (payload.RepairId)
        {
            case "repair.explorer_icon_cache":
                (succeeded, summary) = ExecuteRebuildIconCache();
                break;

            case "repair.network_reset":
                var r1 = _processRunner("ipconfig.exe", ["/flushdns"], 10_000);
                var r2 = _processRunner("netsh.exe", ["winsock", "reset"], 15_000);
                var r3 = _processRunner("netsh.exe", ["int", "ip", "reset"], 15_000);
                succeeded = r1.ExitCode == 0 && r2.ExitCode == 0;
                summary = succeeded
                    ? "Flushed DNS cache, reset Winsock catalog, and reset TCP/IP stack (reboot recommended if issues persist)."
                    : $"Network reset returned error (DNS={r1.ExitCode}, Winsock={r2.ExitCode}, IP={r3.ExitCode}): {FirstLine(r2.Output)}";
                break;

            case "repair.print_spooler":
                _processRunner("net.exe", ["stop", "spooler"], 15_000);
                var spoolDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "spool", "PRINTERS");
                var deleted = ClearDirectoryContentsSafe(spoolDir);
                var startSpool = _processRunner("net.exe", ["start", "spooler"], 15_000);
                succeeded = startSpool.ExitCode == 0;
                summary = succeeded
                    ? $"Cleared {deleted} stuck print spooler file(s) and restarted Print Spooler."
                    : $"Print Spooler restart failed (exit {startSpool.ExitCode}): {FirstLine(startSpool.Output)}";
                break;

            case "repair.windows_update_cache":
                _processRunner("net.exe", ["stop", "wuauserv"], 15_000);
                _processRunner("net.exe", ["stop", "bits"], 15_000);
                var wuDownloadDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "SoftwareDistribution", "Download");
                var wuDeleted = ClearDirectoryContentsSafe(wuDownloadDir);
                _processRunner("net.exe", ["start", "bits"], 15_000);
                var startWu = _processRunner("net.exe", ["start", "wuauserv"], 15_000);
                succeeded = startWu.ExitCode == 0;
                summary = succeeded
                    ? $"Cleared {wuDeleted} cached update download item(s) and restarted BITS & Windows Update."
                    : $"Windows Update service restart returned exit {startWu.ExitCode}: {FirstLine(startWu.Output)}";
                break;

            case "repair.winsxs_cleanup":
                var dism = _processRunner("Dism.exe", ["/Online", "/Cleanup-Image", "/StartComponentCleanup"], 240_000);
                succeeded = dism.ExitCode == 0;
                summary = succeeded
                    ? "DISM /StartComponentCleanup completed successfully."
                    : $"DISM cleanup exited with code {dism.ExitCode}: {FirstLine(dism.Output)}";
                break;

            case "repair.sfc_scan":
                var sfc = _processRunner("sfc.exe", ["/scannow"], 300_000);
                succeeded = sfc.ExitCode == 0;
                summary = string.IsNullOrWhiteSpace(sfc.Output)
                    ? (succeeded ? "SFC /scannow finished cleanly." : $"SFC exited with code {sfc.ExitCode}.")
                    : FirstMeaningfulLines(sfc.Output, 3);
                break;

            default:
                succeeded = false;
                summary = $"Unsupported repair workflow '{payload.RepairId}'.";
                break;
        }

        var verification = new OperationVerificationResult(
            IsVerified: succeeded,
            ObservedStateSummary: summary,
            VerificationDetails: summary,
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((succeeded, summary, summary, verification));
    }

    private (bool Succeeded, string Summary) ExecuteRebuildIconCache()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var deletedCount = 0;

        try
        {
            var explorer = Process.GetProcessesByName("explorer");
            foreach (var p in explorer)
            {
                try { p.Kill(false); p.WaitForExit(3000); } catch { }
                finally { p.Dispose(); }
            }

            var iconDb = Path.Combine(localAppData, "IconCache.db");
            if (File.Exists(iconDb))
            {
                try { File.Delete(iconDb); deletedCount++; } catch { }
            }

            var explorerCacheDir = Path.Combine(localAppData, "Microsoft", "Windows", "Explorer");
            if (Directory.Exists(explorerCacheDir))
            {
                foreach (var pattern in new[] { "iconcache_*.db", "thumbcache_*.db" })
                {
                    foreach (var file in Directory.GetFiles(explorerCacheDir, pattern))
                    {
                        try { File.Delete(file); deletedCount++; } catch { }
                    }
                }
            }

            Process.Start(new ProcessStartInfo { FileName = "explorer.exe", UseShellExecute = true });
            return (true, $"Cleared {deletedCount} icon/thumbnail cache database file(s) and restarted File Explorer.");
        }
        catch (Exception ex)
        {
            try { Process.Start(new ProcessStartInfo { FileName = "explorer.exe", UseShellExecute = true }); } catch { }
            return (false, $"Failed while rebuilding icon cache: {ex.Message}");
        }
    }

    // =========================================================================
    // 3. WINDOWS STORE (APPX) BLOATWARE INSPECTOR & SAFE REMOVER
    // =========================================================================

    public Task<IReadOnlyList<AppxPackageEntry>> InspectAppxPackagesAsync(CancellationToken cancellationToken = default)
    {
        return Task.Run<IReadOnlyList<AppxPackageEntry>>(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            var script = "$ProgressPreference = 'SilentlyContinue'; Get-AppxPackage | Where-Object { -not $_.IsFramework } | Select-Object @{n='Name';e={$_.Name}},@{n='PackageFullName';e={$_.PackageFullName}},@{n='Publisher';e={$_.Publisher}},@{n='Version';e={[string]$_.Version}},@{n='IsFramework';e={[bool]$_.IsFramework}},@{n='NonRemovable';e={[bool]$_.NonRemovable}} | ConvertTo-Json -Compress";
            var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
            var (exitCode, output) = _processRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], 30_000);
            if (exitCode != 0 || string.IsNullOrWhiteSpace(output))
            {
                return [];
            }

            return ParseAppxPackagesJson(output);
        }, cancellationToken);
    }

    public static IReadOnlyList<AppxPackageEntry> ParseAppxPackagesJson(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        var trimmed = json.Trim();
        var clixmlIdx = trimmed.IndexOf("#< CLIXML", StringComparison.Ordinal);
        if (clixmlIdx >= 0)
        {
            trimmed = trimmed[..clixmlIdx].Trim();
        }
        if (!trimmed.StartsWith('{'))
        {
            var arrayStart = trimmed.IndexOf('[');
            var arrayEnd = trimmed.LastIndexOf(']');
            if (arrayStart >= 0 && arrayEnd > arrayStart)
            {
                trimmed = trimmed[arrayStart..(arrayEnd + 1)];
            }
        }
        List<RawAppxJsonItem>? rawItems = null;
        try
        {
            if (trimmed.StartsWith('['))
            {
                rawItems = JsonSerializer.Deserialize<List<RawAppxJsonItem>>(trimmed);
            }
            else if (trimmed.StartsWith('{'))
            {
                var single = JsonSerializer.Deserialize<RawAppxJsonItem>(trimmed);
                if (single is not null) rawItems = [single];
            }
        }
        catch
        {
            return [];
        }

        if (rawItems is null) return [];

        var results = new List<AppxPackageEntry>(rawItems.Count);
        foreach (var item in rawItems)
        {
            var name = item.Name?.Trim() ?? string.Empty;
            var fullName = item.PackageFullName?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(fullName) || item.IsFramework)
            {
                continue;
            }

            var isProtected = item.NonRemovable || IsProtectedAppxPackage(name);
            var hasBloatDesc = KnownBloatDescriptions.TryGetValue(name, out var desc);
            var isSuggestedBloat = !isProtected && hasBloatDesc;

            string classification;
            if (isProtected) classification = "Protected System";
            else if (isSuggestedBloat) classification = "Suggested Bloatware";
            else classification = "Store / Optional App";

            results.Add(new AppxPackageEntry(
                Name: name,
                PackageFullName: fullName,
                Publisher: SimplifyPublisher(item.Publisher),
                Version: item.Version ?? "Unknown",
                Classification: classification,
                PlainDescription: isProtected
                    ? "Protected Windows system package (locked against removal to keep Windows stable)."
                    : desc ?? "Removable Microsoft Store / UWP package.",
                IsProtectedSystemPackage: isProtected,
                IsSuggestedBloat: isSuggestedBloat));
        }

        return results
            .OrderByDescending(p => p.IsSuggestedBloat)
            .ThenBy(p => p.IsProtectedSystemPackage)
            .ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static bool IsProtectedAppxPackage(string packageName)
    {
        if (string.IsNullOrWhiteSpace(packageName)) return true;
        foreach (var prefix in ProtectedAppxPrefixes)
        {
            if (packageName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }

    public OperationProposal ProposeRemoveAppxPackage(string packageFullName, string packageName)
    {
        var isProtected = IsProtectedAppxPackage(packageName);
        var isValidFullName = !string.IsNullOrWhiteSpace(packageFullName) && SafeIdentifierRegex.IsMatch(packageFullName);
        var payloadJson = JsonSerializer.Serialize(new RemoveAppxPayload(packageFullName ?? string.Empty, packageName ?? string.Empty));

        return _safeOperationEngine.CreateProposal(
            descriptor: RemoveAppxDescriptor,
            targetDescription: $"{packageName} ({packageFullName})",
            inspectedCurrentStateSummary: isProtected
                ? $"Package '{packageName}' is classified as Protected Windows System infrastructure."
                : $"Package '{packageName}' is eligible for safe current-user removal.",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: $"Uninstalls Microsoft Store package '{packageName}' for the current Windows user without touching system store infrastructure.",
            expectedEffects:
            [
                "Frees disk space and prevents this app from launching or updating in background.",
                "Can be reinstalled from Microsoft Store later if needed."
            ],
            payloadJson: payloadJson,
            customPrerequisiteValidator: () =>
            {
                if (!isValidFullName)
                {
                    return (false, "Invalid Appx package identifier.");
                }
                if (isProtected)
                {
                    return (false, $"'{packageName}' is a protected Windows system package and cannot be removed.");
                }
                return (true, "Safe removable Appx package.");
            });
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteRemoveAppxAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<RemoveAppxPayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid Appx removal payload.");

        if (IsProtectedAppxPackage(payload.PackageName) || !SafeIdentifierRegex.IsMatch(payload.PackageFullName))
        {
            return Task.FromResult((false, "Blocked", $"Refused unsafe or protected Appx removal for '{payload.PackageName}'.",
                new OperationVerificationResult(false, "Blocked", "Safety check failed.", DateTimeOffset.UtcNow)));
        }

        var script = $"Remove-AppxPackage -Package '{payload.PackageFullName}' -ErrorAction Stop";
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        var (exitCode, output) = _processRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], 60_000);

        var ok = exitCode == 0;
        var summary = ok
            ? $"Removed Microsoft Store package '{payload.PackageName}'."
            : $"Failed removing '{payload.PackageName}': {FirstLine(output)}";

        return Task.FromResult((
            ok,
            summary,
            summary,
            new OperationVerificationResult(ok, summary, summary, DateTimeOffset.UtcNow)));
    }

    public OperationProposal ProposeRemoveAppxPackagesBatch(IReadOnlyList<AppxPackageEntry> packages)
    {
        var eligible = (packages ?? [])
            .Where(p => !p.IsProtectedSystemPackage &&
                        !IsProtectedAppxPackage(p.Name) &&
                        SafeIdentifierRegex.IsMatch(p.PackageFullName))
            .Select(p => new RemoveAppxPayload(p.PackageFullName, p.Name))
            .ToList();

        var names = eligible.Select(p => p.PackageName).ToList();
        var payloadJson = JsonSerializer.Serialize(new RemoveAppxBatchPayload(eligible));

        return _safeOperationEngine.CreateProposal(
            descriptor: RemoveAppxDescriptor with
            {
                OperationTypeId = RemoveAppxBatchOperationId,
                DisplayName = $"Remove {eligible.Count} Store (Appx) App(s)"
            },
            targetDescription: eligible.Count > 0 ? string.Join(", ", names.Take(6)) + (names.Count > 6 ? $" (+{names.Count - 6} more)" : string.Empty) : "None",
            inspectedCurrentStateSummary: $"{eligible.Count} removable Store package(s) selected.",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: $"Uninstalls {eligible.Count} non-system Microsoft Store package(s) for the current user.",
            expectedEffects: names.Select(n => $"Remove {n}").ToList(),
            payloadJson: payloadJson,
            customPrerequisiteValidator: () => eligible.Count > 0
                ? (true, "Removable Store packages ready.")
                : (false, "Select at least one non-protected Store package."));
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteRemoveAppxBatchAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Deserialize<RemoveAppxBatchPayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid batch Appx payload.");

        int removed = 0;
        var failed = new List<string>();
        foreach (var pkg in payload.Packages)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (IsProtectedAppxPackage(pkg.PackageName) || !SafeIdentifierRegex.IsMatch(pkg.PackageFullName))
            {
                failed.Add($"{pkg.PackageName} (protected)");
                continue;
            }
            var script = $"Remove-AppxPackage -Package '{pkg.PackageFullName}' -ErrorAction Stop";
            var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
            var (exitCode, _) = _processRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], 60_000);
            if (exitCode == 0) removed++;
            else failed.Add(pkg.PackageName);
        }

        var ok = failed.Count == 0 && removed > 0;
        var summary = failed.Count == 0
            ? $"Removed {removed} Microsoft Store package(s)."
            : $"Removed {removed}/{payload.Packages.Count}; failed: {string.Join(", ", failed)}.";
        return Task.FromResult((ok, summary, summary, new OperationVerificationResult(ok, summary, summary, DateTimeOffset.UtcNow)));
    }

    private static readonly HashSet<string> SafeValueParentSubKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        @"Software\Microsoft\Windows\CurrentVersion\Run",
        @"Software\Microsoft\Windows\CurrentVersion\RunOnce",
        @"Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache",
        @"Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers"
    };

    private static readonly HashSet<string> ProtectedServices = new(StringComparer.OrdinalIgnoreCase)
    {
        "BITS", "Dhcp", "Dnscache", "EventLog", "LanmanServer", "LanmanWorkstation", "RpcSs",
        "Schedule", "Spooler", "TrustedInstaller", "W32Time", "WinDefend", "wuauserv", "BFE", "MpsSvc"
    };

    public static bool IsSafeLeftoverRegistryKey(string fullKeyOrValuePath)
    {
        if (string.IsNullOrWhiteSpace(fullKeyOrValuePath)) return false;
        var trimmed = fullKeyOrValuePath.Trim();

        // 1. Value-level spec: "HKCU\...\Run::SomeApp" (deletes ONLY the single named value, never the parent key)
        var valueSepIndex = trimmed.IndexOf("::", StringComparison.Ordinal);
        if (valueSepIndex >= 0)
        {
            var keyPart = trimmed[..valueSepIndex].Trim();
            var valueName = trimmed[(valueSepIndex + 2)..];
            if (string.IsNullOrWhiteSpace(valueName)) return false;
            if (!TrySplitHive(keyPart, out var valueHive, out var valueSubKey)) return false;
            if (valueHive != "HKCU" && valueHive != "HKLM") return false;
            return SafeValueParentSubKeys.Contains(valueSubKey.Trim('\\'));
        }

        // 2. Key-level spec
        if (!TrySplitHive(trimmed, out var hiveLabel, out var fullSubKey)) return false;
        var norm = fullSubKey.Trim('\\');

        // HKLM Third-Party Windows Service key (leaf only, never protected system services)
        const string servicesPrefix = @"SYSTEM\CurrentControlSet\Services\";
        if (hiveLabel == "HKLM" && norm.StartsWith(servicesPrefix, StringComparison.OrdinalIgnoreCase))
        {
            var svcLeaf = norm[servicesPrefix.Length..];
            return !string.IsNullOrWhiteSpace(svcLeaf) &&
                   !svcLeaf.Contains('\\') &&
                   !ProtectedServices.Contains(svcLeaf);
        }

        if (!norm.StartsWith(@"Software\", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var subPath = norm[@"Software\".Length..];
        if (string.IsNullOrWhiteSpace(subPath) ||
            (subPath.StartsWith(@"WOW6432Node\", StringComparison.OrdinalIgnoreCase) && subPath.Length <= @"WOW6432Node\".Length + 1))
        {
            return false;
        }

        // Specific leaf Uninstall remnant subkeys (must include non-empty subkey name)
        foreach (var uninstPrefix in new[]
        {
            @"Microsoft\Windows\CurrentVersion\Uninstall\",
            @"WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\"
        })
        {
            if (subPath.StartsWith(uninstPrefix, StringComparison.OrdinalIgnoreCase))
            {
                var leaf = subPath[uninstPrefix.Length..];
                return !string.IsNullOrWhiteSpace(leaf) && !leaf.Contains('\\');
            }
        }

        // Specific App Paths leaf subkey (e.g. App Paths\myapp.exe)
        const string appPathsPrefix = @"Microsoft\Windows\CurrentVersion\App Paths\";
        if (subPath.StartsWith(appPathsPrefix, StringComparison.OrdinalIgnoreCase))
        {
            var leaf = subPath[appPathsPrefix.Length..];
            return !string.IsNullOrWhiteSpace(leaf) && !leaf.Contains('\\');
        }

        // Custom URL protocol handler directly under HKCU\Software\Classes\<customAppName>
        if (hiveLabel == "HKCU" && subPath.StartsWith(@"Classes\", StringComparison.OrdinalIgnoreCase))
        {
            var clsLeaf = subPath[@"Classes\".Length..];
            if (string.IsNullOrWhiteSpace(clsLeaf) || clsLeaf.Contains('\\') || clsLeaf.StartsWith('.'))
            {
                return false;
            }
            if (clsLeaf.Equals("Local Settings", StringComparison.OrdinalIgnoreCase) ||
                clsLeaf.Equals("CLSID", StringComparison.OrdinalIgnoreCase) ||
                clsLeaf.Equals("Interface", StringComparison.OrdinalIgnoreCase) ||
                clsLeaf.Equals("TypeLib", StringComparison.OrdinalIgnoreCase) ||
                clsLeaf.Equals("Installer", StringComparison.OrdinalIgnoreCase) ||
                clsLeaf == "*")
            {
                return false;
            }
            return true;
        }

        // Never delete Windows core hives, policies, Run keys, Classes root, or Groundwork settings
        if (subPath.Equals("Groundwork", StringComparison.OrdinalIgnoreCase) ||
            subPath.StartsWith(@"Groundwork\", StringComparison.OrdinalIgnoreCase) ||
            subPath.Equals("Classes", StringComparison.OrdinalIgnoreCase) ||
            subPath.StartsWith(@"Classes\", StringComparison.OrdinalIgnoreCase) ||
            subPath.Equals("Policies", StringComparison.OrdinalIgnoreCase) ||
            subPath.StartsWith(@"Policies\", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var forbiddenSegments = new[] { @"\Microsoft\Windows", @"\Microsoft\Windows NT", @"\Run", @"\RunOnce" };
        return !forbiddenSegments.Any(f => trimmed.Contains(f, StringComparison.OrdinalIgnoreCase));
    }

    private static bool TrySplitHive(string fullKey, out string hiveLabel, out string subKey)
    {
        if (fullKey.StartsWith(@"HKCU\", StringComparison.OrdinalIgnoreCase))
        {
            hiveLabel = "HKCU";
            subKey = fullKey[5..];
            return true;
        }
        if (fullKey.StartsWith(@"HKLM\", StringComparison.OrdinalIgnoreCase))
        {
            hiveLabel = "HKLM";
            subKey = fullKey[5..];
            return true;
        }
        hiveLabel = string.Empty;
        subKey = string.Empty;
        return false;
    }

    public OperationProposal ProposeCleanLeftoverRegistryKeys(IReadOnlyList<string> keyPaths)
    {
        var validKeys = (keyPaths ?? [])
            .Where(IsSafeLeftoverRegistryKey)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var needsAdmin = validKeys.Any(k => k.StartsWith(@"HKLM\", StringComparison.OrdinalIgnoreCase));
        var payloadJson = JsonSerializer.Serialize(new CleanRegistryLeftoversPayload(validKeys));

        return _safeOperationEngine.CreateProposal(
            descriptor: RemoveAppxDescriptor with
            {
                OperationTypeId = CleanRegistryLeftoversOperationId,
                DisplayName = $"Delete {validKeys.Count} Leftover Registry Trace(s)",
                Category = "Applications / Leftovers",
                ElevationRequirement = needsAdmin ? OperationElevationRequirement.AdministratorRequired : OperationElevationRequirement.StandardUser,
                Reversibility = OperationReversibility.Irreversible,
                RiskLevel = OperationRiskLevel.Low
            },
            targetDescription: string.Join(", ", validKeys.Take(4)) + (validKeys.Count > 4 ? $" (+{validKeys.Count - 4} more)" : string.Empty),
            inspectedCurrentStateSummary: $"{validKeys.Count} leftover app registry trace(s) selected.",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: $"Deletes {validKeys.Count} orphaned application registry subkey(s)/value(s) left behind after uninstallation.",
            expectedEffects: validKeys.Select(k => $"Delete {k}").ToList(),
            payloadJson: payloadJson,
            customPrerequisiteValidator: () =>
            {
                if (validKeys.Count == 0) return (false, "No eligible application registry traces selected.");
                if (needsAdmin && !_isElevatedFunc()) return (false, "Deleting HKLM registry leftovers requires Administrator privileges. Uncheck HKLM entries or Restart as Admin.");
                return (true, "Safe registry leftover cleanup ready.");
            });
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteCleanRegistryLeftoversAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<CleanRegistryLeftoversPayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid registry leftover payload.");

        int deleted = 0;
        var failed = new List<string>();
        foreach (var spec in payload.KeyPaths)
        {
            if (!IsSafeLeftoverRegistryKey(spec))
            {
                failed.Add($"{spec} (blocked)");
                continue;
            }

            try
            {
                if (!OperatingSystem.IsWindows()) continue;

                var valueSepIndex = spec.IndexOf("::", StringComparison.Ordinal);
                if (valueSepIndex >= 0)
                {
                    var keyPart = spec[..valueSepIndex].Trim();
                    var valueName = spec[(valueSepIndex + 2)..];
                    if (!TrySplitHive(keyPart, out var vHive, out var vSub)) { failed.Add(spec); continue; }
                    var hive = vHive == "HKCU" ? Registry.CurrentUser : Registry.LocalMachine;
                    using var k = hive.OpenSubKey(vSub, writable: true);
                    if (k is not null)
                    {
                        k.DeleteValue(valueName, throwOnMissingValue: false);
                        deleted++;
                    }
                    continue;
                }

                if (!TrySplitHive(spec, out var kHive, out var subKey)) { failed.Add(spec); continue; }
                var rootHive = kHive == "HKCU" ? Registry.CurrentUser : Registry.LocalMachine;
                var lastSlash = subKey.LastIndexOf('\\');
                if (lastSlash <= 0) { failed.Add(spec); continue; }

                using var parent = rootHive.OpenSubKey(subKey[..lastSlash], writable: true);
                if (parent is not null)
                {
                    parent.DeleteSubKeyTree(subKey[(lastSlash + 1)..], throwOnMissingSubKey: false);
                    deleted++;
                }
            }
            catch
            {
                failed.Add(spec);
            }
        }

        var ok = deleted > 0 && failed.Count == 0;
        var summary = failed.Count == 0
            ? $"Cleaned {deleted} leftover registry trace(s)."
            : $"Cleaned {deleted}; skipped/failed: {string.Join(", ", failed)}.";
        return Task.FromResult((ok, summary, summary, new OperationVerificationResult(ok, summary, summary, DateTimeOffset.UtcNow)));
    }

    // =========================================================================
    // 4. ESSENTIAL TOOLS & RUNTIMES QUICK-INSTALLER (WINGET)
    // =========================================================================

    public IReadOnlyList<EssentialToolEntry> InspectEssentialTools()
    {
        var runtimes = InspectInstalledRuntimes();
        var win32Apps = _installedAppsService.EnumerateInstalledApps();
        string? wingetListCache = null;

        var list = new List<EssentialToolEntry>(EssentialToolsCatalog.Count);
        foreach (var item in EssentialToolsCatalog)
        {
            var matchedRuntime = runtimes.FirstOrDefault(r =>
                string.Equals(r.RecommendedWingetId, item.WingetId, StringComparison.OrdinalIgnoreCase) ||
                (item.WingetId.EndsWith(".x64", StringComparison.OrdinalIgnoreCase) && r.RuntimeId == "runtime.vcredist_x64") ||
                (item.WingetId.EndsWith(".x86", StringComparison.OrdinalIgnoreCase) && r.RuntimeId == "runtime.vcredist_x86") ||
                (item.WingetId.Contains("DotNet.DesktopRuntime", StringComparison.OrdinalIgnoreCase) && r.RuntimeId == "runtime.dotnet_desktop"));

            if (matchedRuntime is not null)
            {
                list.Add(new EssentialToolEntry(
                    item.WingetId, item.DisplayName, item.Category, item.Description,
                    matchedRuntime.IsInstalled,
                    matchedRuntime.IsInstalled ? $"Installed ({matchedRuntime.DetectedVersion})" : "Not Installed"));
                continue;
            }

            var shortKeyword = item.WingetId.Split('.').Last();
            var cleanDisplay = item.DisplayName.StartsWith("Microsoft ", StringComparison.OrdinalIgnoreCase)
                ? item.DisplayName["Microsoft ".Length..]
                : item.DisplayName;
            var primaryWord = cleanDisplay.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? shortKeyword;
            var matchedApp = win32Apps.FirstOrDefault(a =>
                a.Name.Contains(shortKeyword, StringComparison.OrdinalIgnoreCase) ||
                (primaryWord.Length >= 3 && a.Name.Contains(primaryWord, StringComparison.OrdinalIgnoreCase)));

            if (matchedApp is not null)
            {
                list.Add(new EssentialToolEntry(
                    item.WingetId, item.DisplayName, item.Category, item.Description,
                    true, $"Installed ({matchedApp.Version})"));
                continue;
            }

            // Fallback: check exact winget package ID once across catalog for custom-named or portable installs
            if (wingetListCache is null)
            {
                var (exitCode, output) = _processRunner("winget.exe", ["list", "--accept-source-agreements"], 8_000);
                wingetListCache = exitCode == 0 ? output : string.Empty;
            }

            var inWinget = !string.IsNullOrWhiteSpace(wingetListCache) &&
                           wingetListCache.Contains(item.WingetId, StringComparison.OrdinalIgnoreCase);
            list.Add(new EssentialToolEntry(
                item.WingetId, item.DisplayName, item.Category, item.Description,
                inWinget, inWinget ? "Installed (winget)" : "Not Detected"));
        }

        return list;
    }

    public OperationProposal ProposeInstallEssentialTool(string wingetId)
    {
        var spec = EssentialToolsCatalog.FirstOrDefault(t => string.Equals(t.WingetId, wingetId, StringComparison.OrdinalIgnoreCase));
        var payloadJson = JsonSerializer.Serialize(new InstallToolPayload(spec?.WingetId ?? wingetId, spec?.DisplayName ?? wingetId));

        return _safeOperationEngine.CreateProposal(
            descriptor: InstallWingetToolDescriptor with { DisplayName = $"Install {spec?.DisplayName ?? wingetId}" },
            targetDescription: $"{spec?.DisplayName ?? wingetId} (winget ID: {wingetId})",
            inspectedCurrentStateSummary: "Official Microsoft winget package source",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: $"Installs '{spec?.DisplayName ?? wingetId}' silently via 'winget install --id {wingetId} --exact'. {spec?.Description}",
            expectedEffects:
            [
                "Downloads the official signed installer from winget and installs cleanly without bundled adware."
            ],
            payloadJson: payloadJson,
            customPrerequisiteValidator: () =>
            {
                if (spec is null)
                {
                    return (false, $"'{wingetId}' is not in Groundwork's curated catalog.");
                }
                return (true, "Curated winget package ready.");
            });
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteInstallEssentialToolAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<InstallToolPayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid winget install payload.");

        var spec = EssentialToolsCatalog.FirstOrDefault(t => string.Equals(t.WingetId, payload.WingetId, StringComparison.OrdinalIgnoreCase));
        if (spec is null)
        {
            return Task.FromResult((false, "Rejected", "Unknown winget package ID.",
                new OperationVerificationResult(false, "Rejected", "Not in catalog.", DateTimeOffset.UtcNow)));
        }

        var (exitCode, output) = _processRunner(
            "winget.exe",
            ["install", "--id", spec.WingetId, "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements"],
            180_000);

        // winget returns 0 on install or -1978335189 (0x8A15002B) when already up-to-date
        var alreadyCurrent = output.Contains("No available upgrade found", StringComparison.OrdinalIgnoreCase)
                             || output.Contains("already installed", StringComparison.OrdinalIgnoreCase);
        var ok = exitCode == 0 || alreadyCurrent;
        var summary = ok
            ? (alreadyCurrent ? $"{spec.DisplayName} is already installed and up to date." : $"Successfully installed {spec.DisplayName} via winget.")
            : $"winget install exited with {exitCode}: {FirstMeaningfulLines(output, 2)}";

        return Task.FromResult((ok, summary, summary, new OperationVerificationResult(ok, summary, summary, DateTimeOffset.UtcNow)));
    }

    public OperationProposal ProposeInstallEssentialToolsBatch(IReadOnlyList<string> wingetIds)
    {
        var specs = (wingetIds ?? [])
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(id => EssentialToolsCatalog.FirstOrDefault(t => string.Equals(t.WingetId, id, StringComparison.OrdinalIgnoreCase)))
            .Where(s => s is not null)
            .Cast<EssentialToolSpec>()
            .ToList();

        var validIds = specs.Select(s => s.WingetId).ToList();
        var names = specs.Select(s => s.DisplayName).ToList();
        var payloadJson = JsonSerializer.Serialize(new InstallToolBatchPayload(validIds));

        return _safeOperationEngine.CreateProposal(
            descriptor: InstallWingetToolDescriptor with
            {
                OperationTypeId = InstallWingetBatchOperationId,
                DisplayName = $"Install {specs.Count} Essential App(s) via winget"
            },
            targetDescription: string.Join(", ", names),
            inspectedCurrentStateSummary: $"{specs.Count} curated winget package(s) selected.",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: $"Silently installs {specs.Count} selected package(s) in sequence from Microsoft's winget catalog: {string.Join(", ", names)}.",
            expectedEffects: names.Select(n => $"Install/update {n}").ToList(),
            payloadJson: payloadJson,
            customPrerequisiteValidator: () => specs.Count > 0
                ? (true, "Valid curated packages selected.")
                : (false, "Select at least one valid package from the catalog."));
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteInstallEssentialToolsBatchAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Deserialize<InstallToolBatchPayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid batch winget payload.");

        int succeeded = 0;
        var failures = new List<string>();
        foreach (var wingetId in payload.WingetIds)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var spec = EssentialToolsCatalog.FirstOrDefault(t => string.Equals(t.WingetId, wingetId, StringComparison.OrdinalIgnoreCase));
            if (spec is null) continue;

            var (exitCode, output) = _processRunner(
                "winget.exe",
                ["install", "--id", spec.WingetId, "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements"],
                180_000);
            var alreadyCurrent = output.Contains("No available upgrade found", StringComparison.OrdinalIgnoreCase)
                                 || output.Contains("already installed", StringComparison.OrdinalIgnoreCase);
            if (exitCode == 0 || alreadyCurrent)
            {
                succeeded++;
            }
            else
            {
                failures.Add($"{spec.DisplayName} (exit {exitCode})");
            }
        }

        var ok = failures.Count == 0 && succeeded > 0;
        var summary = failures.Count == 0
            ? $"Successfully installed/verified {succeeded} essential package(s) via winget."
            : $"Installed {succeeded}/{payload.WingetIds.Count}; failed: {string.Join(", ", failures)}.";

        return Task.FromResult((ok, summary, summary, new OperationVerificationResult(ok, summary, summary, DateTimeOffset.UtcNow)));
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    private static bool DefaultIsProcessElevated()
    {
        if (!OperatingSystem.IsWindows()) return false;
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            var principal = new WindowsPrincipal(identity);
            return principal.IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }

    private static (int ExitCode, string Output) DefaultRunProcess(string fileName, IReadOnlyList<string> args, int timeoutMs)
    {
        if (!OperatingSystem.IsWindows()) return (-1, "Unsupported OS");
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = fileName,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            foreach (var a in args) psi.ArgumentList.Add(a);

            using var proc = Process.Start(psi);
            if (proc is null) return (-1, $"Failed to start {fileName}");

            var stdout = proc.StandardOutput.ReadToEndAsync();
            var stderr = proc.StandardError.ReadToEndAsync();
            if (!proc.WaitForExit(timeoutMs))
            {
                try { proc.Kill(true); } catch { }
                return (-1, $"{fileName} timed out after {timeoutMs / 1000}s.");
            }

            var combined = (stdout.GetAwaiter().GetResult() + "\n" + stderr.GetAwaiter().GetResult()).Replace("\0", string.Empty).Trim();
            return (proc.ExitCode, combined);
        }
        catch (Exception ex)
        {
            return (-1, ex.Message);
        }
    }

    private static string? ReadVcRedistVersion(string subKey)
    {
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(subKey, writable: false);
            if (key is null) return null;
            var installed = Convert.ToInt32(key.GetValue("Installed", 0));
            if (installed != 1) return null;
            return key.GetValue("Version")?.ToString()?.TrimStart('v') ?? "Installed";
        }
        catch { return null; }
    }

    private static string? ReadWebView2Version()
    {
        if (!OperatingSystem.IsWindows()) return null;
        const string guid = @"{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
        foreach (var root in new[] { Registry.LocalMachine, Registry.CurrentUser })
        {
            foreach (var sub in new[]
            {
                $@"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{guid}",
                $@"SOFTWARE\Microsoft\EdgeUpdate\Clients\{guid}"
            })
            {
                try
                {
                    using var key = root.OpenSubKey(sub, writable: false);
                    var pv = key?.GetValue("pv")?.ToString();
                    if (!string.IsNullOrWhiteSpace(pv) && pv != "0.0.0.0") return pv;
                }
                catch { }
            }
        }
        return null;
    }

    private static IReadOnlyList<string> DetectDotNetDesktopRuntimes()
    {
        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "dotnet", "shared", "Microsoft.WindowsDesktop.App");
            if (!Directory.Exists(dir)) return [];
            return Directory.GetDirectories(dir)
                .Select(Path.GetFileName)
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .Cast<string>()
                .OrderBy(v => Version.TryParse(v, out var parsed) ? parsed : new Version(0, 0))
                .ToList();
        }
        catch
        {
            return [];
        }
    }

    private static int ClearDirectoryContentsSafe(string dir)
    {
        if (!Directory.Exists(dir)) return 0;
        var count = 0;
        foreach (var file in Directory.GetFiles(dir))
        {
            try { File.Delete(file); count++; } catch { }
        }
        foreach (var sub in Directory.GetDirectories(dir))
        {
            try { Directory.Delete(sub, recursive: true); count++; } catch { }
        }
        return count;
    }

    private static string SimplifyPublisher(string? rawPublisher)
    {
        if (string.IsNullOrWhiteSpace(rawPublisher)) return "Microsoft / Store";
        var idx = rawPublisher.IndexOf("CN=", StringComparison.OrdinalIgnoreCase);
        if (idx >= 0)
        {
            var start = idx + 3;
            var comma = rawPublisher.IndexOf(',', start);
            var cn = comma > start ? rawPublisher[start..comma] : rawPublisher[start..];
            if (!string.IsNullOrWhiteSpace(cn)) return cn.Trim();
        }
        return rawPublisher.Length > 42 ? rawPublisher[..42] + "…" : rawPublisher;
    }

    private static string FirstLine(string s) =>
        string.IsNullOrWhiteSpace(s) ? string.Empty : s.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim() ?? string.Empty;

    private static string FirstMeaningfulLines(string s, int count) =>
        string.IsNullOrWhiteSpace(s)
            ? string.Empty
            : string.Join(" | ", s.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).Select(l => l.Trim()).Where(l => l.Length > 0).TakeLast(count));
}
