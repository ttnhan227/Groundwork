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
/// Central registry of strongly typed diagnostic and system operation tools available to
/// Groundwork Investigations and the AI Assistant.
/// </summary>
public sealed class ToolRegistryService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = false
    };

    private readonly HardwareSpecsEngineService _hardwareService;
    private readonly DriveDiscoveryService _driveDiscoveryService;
    private readonly SafeCleanupService _cleanupService;
    private readonly InstalledAppsEngineService _installedAppsService;
    private readonly WindowsOptimizationService _optimizationService;
    private readonly DiagnosticsAndTroubleshootingService _troubleshootingService;
    private readonly FileOrganizerService _fileOrganizerService;

    private readonly Dictionary<string, (AgentToolDefinition Definition, Func<IReadOnlyDictionary<string, string>, CancellationToken, Task<AgentToolCallResult>> Handler)> _tools
        = new(StringComparer.OrdinalIgnoreCase);

    public ToolRegistryService(
        HardwareSpecsEngineService? hardwareService = null,
        DriveDiscoveryService? driveDiscoveryService = null,
        SafeCleanupService? cleanupService = null,
        InstalledAppsEngineService? installedAppsService = null,
        WindowsOptimizationService? optimizationService = null,
        DiagnosticsAndTroubleshootingService? troubleshootingService = null,
        FileOrganizerService? fileOrganizerService = null)
    {
        var sharedSafeOps = optimizationService?.SafeOperations
            ?? troubleshootingService?.SafeOperations
            ?? fileOrganizerService?.SafeOperations
            ?? new SafeOperationEngine();

        _hardwareService = hardwareService ?? new HardwareSpecsEngineService();
        _driveDiscoveryService = driveDiscoveryService ?? new DriveDiscoveryService();
        _cleanupService = cleanupService ?? new SafeCleanupService();
        _installedAppsService = installedAppsService ?? new InstalledAppsEngineService();
        _optimizationService = optimizationService ?? new WindowsOptimizationService(sharedSafeOps);
        _troubleshootingService = troubleshootingService ?? new DiagnosticsAndTroubleshootingService(sharedSafeOps);
        _fileOrganizerService = fileOrganizerService ?? new FileOrganizerService(sharedSafeOps);

        RegisterDefaultTools();
    }

    public SafeOperationEngine SafeOperations => _optimizationService.SafeOperations;
    public WindowsOptimizationService Optimization => _optimizationService;
    public DiagnosticsAndTroubleshootingService Troubleshooting => _troubleshootingService;
    public FileOrganizerService FileOrganizer => _fileOrganizerService;
    public HardwareSpecsEngineService Hardware => _hardwareService;
    public DriveDiscoveryService Drives => _driveDiscoveryService;
    public SafeCleanupService Cleanup => _cleanupService;
    public InstalledAppsEngineService InstalledApps => _installedAppsService;

    public IReadOnlyList<AgentToolDefinition> GetRegisteredTools() =>
        _tools.Values.Select(v => v.Definition).OrderBy(d => d.Category).ThenBy(d => d.Name).ToList();

    public AgentToolDefinition? GetToolDefinition(string toolName) =>
        !string.IsNullOrWhiteSpace(toolName) && _tools.TryGetValue(toolName, out var entry)
            ? entry.Definition
            : null;

    public async Task<AgentToolCallResult> ExecuteToolAsync(
        AgentToolCallRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        cancellationToken.ThrowIfCancellationRequested();

        if (string.IsNullOrWhiteSpace(request.ToolName) || !_tools.TryGetValue(request.ToolName, out var entry))
        {
            return new AgentToolCallResult(
                ToolName: request.ToolName ?? string.Empty,
                Succeeded: false,
                IsModifyingProposal: false,
                SummaryText: $"Unknown tool '{request.ToolName}'. Only registered Groundwork tools may be invoked.",
                StructuredDataJson: "{}",
                PendingProposal: null,
                ExecutedAtUtc: DateTimeOffset.UtcNow);
        }

        var args = request.Arguments ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var param in entry.Definition.Parameters.Where(p => p.IsRequired))
        {
            if (!args.TryGetValue(param.Name, out var val) || string.IsNullOrWhiteSpace(val))
            {
                return new AgentToolCallResult(
                    ToolName: entry.Definition.Name,
                    Succeeded: false,
                    IsModifyingProposal: false,
                    SummaryText: $"Missing required parameter '{param.Name}' for tool '{entry.Definition.Name}'.",
                    StructuredDataJson: "{}",
                    PendingProposal: null,
                    ExecutedAtUtc: DateTimeOffset.UtcNow);
            }
        }

        return await entry.Handler(args, cancellationToken).ConfigureAwait(false);
    }

    private void RegisterTool(
        AgentToolDefinition definition,
        Func<IReadOnlyDictionary<string, string>, CancellationToken, Task<AgentToolCallResult>> handler)
    {
        _tools[definition.Name] = (definition, handler);
    }

    private void RegisterDefaultTools()
    {
        // 1. inspect_hardware_and_os
        RegisterTool(
            new AgentToolDefinition(
                Name: "inspect_hardware_and_os",
                DisplayName: "Inspect Hardware, OS & Live Telemetry",
                Category: "Analyze / System & Hardware",
                Description: "Collects CPU, RAM, Motherboard/BIOS/SecureBoot, GPUs, Physical Disks, OS build/uptime, and live CPU/GPU/Disk utilization counters.",
                Parameters: [],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: false,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.None,
                Preconditions: "Windows OS.",
                ExpectedOutputDescription: "HardwareSpecsSnapshot with CPU, Memory, GPUs, Disks, OS, and LiveDiagnostics.",
                PotentialRisks: []),
            async (_, ct) =>
            {
                var snap = await _hardwareService.GetHardwareReportAsync(maskSensitiveData: false, ct: ct).ConfigureAwait(false);
                var cpuLoad = snap.LiveDiagnostics.CpuUtilizationPercent ?? 0.0;
                var summary = $"CPU: {snap.Cpu.Name} ({snap.Cpu.PhysicalCores}C/{snap.Cpu.LogicalProcessors}T, Load: {cpuLoad:F1}%) | " +
                              $"RAM: {snap.Memory.UsedPhysicalBytes / (1024.0 * 1024 * 1024):F1}/{snap.Memory.TotalPhysicalBytes / (1024.0 * 1024 * 1024):F1} GB ({snap.Memory.UsedPercent:F1}%) | " +
                              $"OS: {snap.Os.Caption} (Build {snap.Os.BuildNumber}, Uptime: {snap.Os.Uptime.TotalHours:F1}h) | " +
                              $"GPUs: {snap.Gpus.Count}, Physical Disks: {snap.Disks.Count}.";
                return new AgentToolCallResult(
                    ToolName: "inspect_hardware_and_os",
                    Succeeded: true,
                    IsModifyingProposal: false,
                    SummaryText: summary,
                    StructuredDataJson: JsonSerializer.Serialize(snap, JsonOptions),
                    PendingProposal: null,
                    ExecutedAtUtc: DateTimeOffset.UtcNow);
            });

        // 2. inspect_storage_volumes
        RegisterTool(
            new AgentToolDefinition(
                Name: "inspect_storage_volumes",
                DisplayName: "Inspect Storage Volumes & Free Space",
                Category: "Analyze / Storage",
                Description: "Enumerates all mounted drives, filesystem types, total capacity, used space, and free space percentages.",
                Parameters: [],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: false,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.None,
                Preconditions: "Mounted local drives.",
                ExpectedOutputDescription: "List of VolumeMetadata with capacity and utilization metrics.",
                PotentialRisks: []),
            (_, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var drives = _driveDiscoveryService.DiscoverVolumes();
                var driveSummaries = drives.Select(d =>
                    $"{d.RootPath} ({d.FileSystem}): {d.FreeBytes / (1024.0 * 1024 * 1024):F1} GB free of {d.TotalBytes / (1024.0 * 1024 * 1024):F1} GB ({d.UsedPercent:F1}% used)");
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "inspect_storage_volumes",
                    Succeeded: true,
                    IsModifyingProposal: false,
                    SummaryText: drives.Count > 0 ? string.Join(" | ", driveSummaries) : "No fixed drives discovered.",
                    StructuredDataJson: JsonSerializer.Serialize(drives, JsonOptions),
                    PendingProposal: null,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 3. inspect_live_processes
        RegisterTool(
            new AgentToolDefinition(
                Name: "inspect_live_processes",
                DisplayName: "Inspect Top Resource-Consuming Processes",
                Category: "Analyze / Processes",
                Description: "Lists running processes ordered by memory working set and total CPU processor time, plus unresponsive process detection.",
                Parameters:
                [
                    new AgentToolParameter("top_count", "integer", false, "Number of top processes to return (default 15).")
                ],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: false,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.None,
                Preconditions: "None.",
                ExpectedOutputDescription: "ProcessResourceSnapshot with top memory and CPU processes.",
                PotentialRisks: []),
            (args, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var top = args.TryGetValue("top_count", out var s) && int.TryParse(s, out var parsed) ? parsed : 15;
                var snap = _troubleshootingService.InspectProcesses(top);
                var top3Mem = string.Join(", ", snap.TopMemoryProcesses.Take(5).Select(p => $"{p.ProcessName} ({p.WorkingSetDisplay})"));
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "inspect_live_processes",
                    Succeeded: true,
                    IsModifyingProposal: false,
                    SummaryText: $"Active Processes: {snap.TotalProcessCount} | Top Memory: {top3Mem}",
                    StructuredDataJson: JsonSerializer.Serialize(snap, JsonOptions),
                    PendingProposal: null,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 4. inspect_startup_items
        RegisterTool(
            new AgentToolDefinition(
                Name: "inspect_startup_items",
                DisplayName: "Inspect Windows Startup Entries",
                Category: "Optimize / Startup",
                Description: "Inspects HKCU/HKLM Run registry keys and Startup folders, verifying publisher metadata, missing executables, and startup impact.",
                Parameters: [],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: false,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.None,
                Preconditions: "None.",
                ExpectedOutputDescription: "List of StartupItemEntry records.",
                PotentialRisks: []),
            (_, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var items = _optimizationService.InspectStartupItems();
                var enabledCount = items.Count(i => i.IsEnabled);
                var highImpact = items.Count(i => i.IsEnabled && i.ImpactAssessment.Contains("High", StringComparison.OrdinalIgnoreCase));
                var orphaned = items.Count(i => !i.TargetExists);
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "inspect_startup_items",
                    Succeeded: true,
                    IsModifyingProposal: false,
                    SummaryText: $"Startup Items: {items.Count} total ({enabledCount} enabled, {highImpact} high-impact, {orphaned} orphaned/missing target).",
                    StructuredDataJson: JsonSerializer.Serialize(items, JsonOptions),
                    PendingProposal: null,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 5. inspect_power_plans
        RegisterTool(
            new AgentToolDefinition(
                Name: "inspect_power_plans",
                DisplayName: "Inspect Windows Power Plans",
                Category: "Optimize / Power",
                Description: "Lists installed Windows power schemes via powercfg and identifies the currently active power scheme and its performance/energy tradeoffs.",
                Parameters: [],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: false,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.None,
                Preconditions: "None.",
                ExpectedOutputDescription: "PowerManagementSnapshot with active scheme and available schemes.",
                PotentialRisks: []),
            (_, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var snap = _optimizationService.InspectPowerPlans();
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "inspect_power_plans",
                    Succeeded: true,
                    IsModifyingProposal: false,
                    SummaryText: $"Active Power Plan: {snap.ActiveSchemeName} ({snap.ActiveSchemeGuid}) out of {snap.Plans.Count} scheme(s).",
                    StructuredDataJson: JsonSerializer.Serialize(snap, JsonOptions),
                    PendingProposal: null,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 6. inspect_configurable_settings
        RegisterTool(
            new AgentToolDefinition(
                Name: "inspect_configurable_settings",
                DisplayName: "Inspect Windows Performance, Gaming & Privacy Settings",
                Category: "Optimize / Configuration",
                Description: "Inspects Game Mode, Game DVR, Visual Transparency, HAGS, Advertising ID, Tailored Experiences, and File Extension visibility.",
                Parameters: [],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: false,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.None,
                Preconditions: "None.",
                ExpectedOutputDescription: "List of WindowsConfigurableSetting objects.",
                PotentialRisks: []),
            (_, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var settings = _optimizationService.InspectConfigurableSettings();
                var summary = string.Join(" | ", settings.Select(s => $"{s.DisplayName}: {s.StateBadge}"));
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "inspect_configurable_settings",
                    Succeeded: true,
                    IsModifyingProposal: false,
                    SummaryText: summary,
                    StructuredDataJson: JsonSerializer.Serialize(settings, JsonOptions),
                    PendingProposal: null,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 7. inspect_network_health
        RegisterTool(
            new AgentToolDefinition(
                Name: "inspect_network_health",
                DisplayName: "Run Network Connectivity & DNS Diagnostics",
                Category: "Troubleshoot / Network",
                Description: "Inspects active network adapters, IP/Gateway/DNS servers, pings default gateway and 1.1.1.1, and tests DNS hostname resolution.",
                Parameters:
                [
                    new AgentToolParameter("test_host", "string", false, "Optional hostname to test DNS resolution (defaults to www.microsoft.com).")
                ],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: false,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.None,
                Preconditions: "None.",
                ExpectedOutputDescription: "NetworkTroubleshootingReport with interface status, gateway ping, external ping, and DNS lookup results.",
                PotentialRisks: []),
            async (args, ct) =>
            {
                args.TryGetValue("test_host", out var host);
                var report = await _troubleshootingService.RunNetworkTroubleshootingAsync(host, ct).ConfigureAwait(false);
                return new AgentToolCallResult(
                    ToolName: "inspect_network_health",
                    Succeeded: true,
                    IsModifyingProposal: false,
                    SummaryText: report.SummaryDiagnosis,
                    StructuredDataJson: JsonSerializer.Serialize(report, JsonOptions),
                    PendingProposal: null,
                    ExecutedAtUtc: DateTimeOffset.UtcNow);
            });

        // 8. inspect_event_log_errors
        RegisterTool(
            new AgentToolDefinition(
                Name: "inspect_event_log_errors",
                DisplayName: "Inspect Recent Windows Event Log Errors & Warnings",
                Category: "Troubleshoot / Event Log",
                Description: "Queries Windows System and Application Event Logs for Critical, Error, and Warning events from the past 7 days with plain-English explanations.",
                Parameters:
                [
                    new AgentToolParameter("max_events", "integer", false, "Maximum number of events to return (default 30).")
                ],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: false,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.None,
                Preconditions: "None.",
                ExpectedOutputDescription: "List of EventLogDiagnosticEntry records with plain-English explanations.",
                PotentialRisks: []),
            (args, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var max = args.TryGetValue("max_events", out var s) && int.TryParse(s, out var parsed) ? parsed : 30;
                var events = _troubleshootingService.InspectRecentEventLogErrors(max);
                var critCount = events.Count(e => string.Equals(e.LevelDisplay, "Critical", StringComparison.OrdinalIgnoreCase));
                var errCount = events.Count(e => string.Equals(e.LevelDisplay, "Error", StringComparison.OrdinalIgnoreCase));
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "inspect_event_log_errors",
                    Succeeded: true,
                    IsModifyingProposal: false,
                    SummaryText: $"Recent Event Log (7d): {events.Count} notable entry/entries ({critCount} Critical, {errCount} Error).",
                    StructuredDataJson: JsonSerializer.Serialize(events, JsonOptions),
                    PendingProposal: null,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 9. inspect_windows_services
        RegisterTool(
            new AgentToolDefinition(
                Name: "inspect_windows_services",
                DisplayName: "Inspect Core Windows Services Status",
                Category: "Troubleshoot / Services",
                Description: "Audits key Windows services (Windows Update, Defender, Firewall, DNS Client, DHCP, Event Log, Search, SysMain) for disabled or stopped states.",
                Parameters: [],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: false,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.None,
                Preconditions: "None.",
                ExpectedOutputDescription: "List of WindowsServiceDiagnosticEntry records.",
                PotentialRisks: []),
            (_, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var services = _troubleshootingService.InspectKeyWindowsServices();
                var abnormal = services.Where(s => s.IsAbnormal).ToList();
                var summary = abnormal.Count == 0
                    ? $"All {services.Count} monitored core Windows services are in healthy startup/running states."
                    : $"Found {abnormal.Count} service anomaly/anomalies: {string.Join(", ", abnormal.Select(a => $"{a.DisplayName} ({a.Status}/{a.StartType})"))}";
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "inspect_windows_services",
                    Succeeded: true,
                    IsModifyingProposal: false,
                    SummaryText: summary,
                    StructuredDataJson: JsonSerializer.Serialize(services, JsonOptions),
                    PendingProposal: null,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 10. inspect_windows_repair_status
        RegisterTool(
            new AgentToolDefinition(
                Name: "inspect_windows_repair_status",
                DisplayName: "Inspect Windows Health, Pending Reboot & Repair Status",
                Category: "Troubleshoot / Windows Repair",
                Description: "Checks Component-Based Servicing and Windows Update pending restart flags, System Restore status, Device Manager error codes, and SFC/DISM guidance.",
                Parameters: [],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: false,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.None,
                Preconditions: "None.",
                ExpectedOutputDescription: "WindowsRepairAndHealthStatus record.",
                PotentialRisks: []),
            (_, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var status = _troubleshootingService.InspectWindowsRepairAndHealthStatus();
                var summary = $"Reboot Pending: {(status.RebootPending ? "Yes (" + string.Join("; ", status.RebootPendingReasons) + ")" : "No")} | " +
                              $"Device Manager Errors: {status.DeviceManagerErrors.Count} | " +
                              $"System Protection: {(status.SystemProtectionLikelyAvailable ? "Enabled" : "Not confirmed")}.";
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "inspect_windows_repair_status",
                    Succeeded: true,
                    IsModifyingProposal: false,
                    SummaryText: summary,
                    StructuredDataJson: JsonSerializer.Serialize(status, JsonOptions),
                    PendingProposal: null,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 11. inspect_cleanup_candidates
        RegisterTool(
            new AgentToolDefinition(
                Name: "inspect_cleanup_candidates",
                DisplayName: "Inspect Safe Storage Cleanup Candidates",
                Category: "Maintenance / Cleanup",
                Description: "Scans user Temp, crash dumps, and Recycle Bin for safely reclaimable disk space without deleting any files.",
                Parameters: [],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: false,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.None,
                Preconditions: "None.",
                ExpectedOutputDescription: "CleanupPreviewToken and RecycleBinInfo.",
                PotentialRisks: []),
            async (_, ct) =>
            {
                var diag = await _cleanupService.PreloadDiagnosticReportAsync(ct).ConfigureAwait(false);
                var totalReclaimMb = diag.TotalReclaimableBytes / (1024.0 * 1024.0);
                var tempAndDumpMb = (diag.TempFilesBytes + diag.CrashDumpsBytes) / (1024.0 * 1024.0);
                var rbMb = diag.RecycleBinBytes / (1024.0 * 1024.0);
                var summary = $"Reclaimable Temp/Dumps: {diag.TempFilesCount + diag.CrashDumpsCount} item(s) ({tempAndDumpMb:F1} MB) | " +
                              $"Recycle Bin: {diag.RecycleBinItemCount} item(s) ({rbMb:F1} MB) | Total Reclaimable: {totalReclaimMb:F1} MB.";
                return new AgentToolCallResult(
                    ToolName: "inspect_cleanup_candidates",
                    Succeeded: true,
                    IsModifyingProposal: false,
                    SummaryText: summary,
                    StructuredDataJson: JsonSerializer.Serialize(diag, JsonOptions),
                    PendingProposal: null,
                    ExecutedAtUtc: DateTimeOffset.UtcNow);
            });

        // 12. Modify Proposal Tool: propose_switch_power_plan
        RegisterTool(
            new AgentToolDefinition(
                Name: "propose_switch_power_plan",
                DisplayName: "Propose Switching Windows Power Plan",
                Category: "Optimize / Power",
                Description: "Creates an approval-gated proposal to switch the active Windows power scheme to a target SchemeGuid.",
                Parameters:
                [
                    new AgentToolParameter("scheme_guid", "string", true, "Target Windows Power Scheme GUID.")
                ],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: true,
                Reversibility: OperationReversibility.Reversible,
                RiskLevel: OperationRiskLevel.Low,
                Preconditions: "Target power scheme GUID must exist on the system.",
                ExpectedOutputDescription: "OperationProposal with single-use confirmation token.",
                PotentialRisks: PowerSwitchRisks),
            (args, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var guid = args["scheme_guid"];
                var proposal = _optimizationService.ProposeSwitchPowerPlan(guid);
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "propose_switch_power_plan",
                    Succeeded: proposal.PrerequisitesMet,
                    IsModifyingProposal: true,
                    SummaryText: proposal.PrerequisitesMet
                        ? $"Prepared approval proposal: {proposal.ProposedChangeExplanation}"
                        : $"Cannot propose power plan switch: {proposal.PrerequisiteFailureReason}",
                    StructuredDataJson: JsonSerializer.Serialize(proposal, JsonOptions),
                    PendingProposal: proposal,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 13. Modify Proposal Tool: propose_toggle_startup_item
        RegisterTool(
            new AgentToolDefinition(
                Name: "propose_toggle_startup_item",
                DisplayName: "Propose Enabling or Disabling a Startup Item",
                Category: "Optimize / Startup",
                Description: "Creates an approval-gated proposal to reversibly enable or disable a user startup entry.",
                Parameters:
                [
                    new AgentToolParameter("entry_id", "string", true, "Startup EntryId from inspect_startup_items."),
                    new AgentToolParameter("enable", "boolean", true, "'true' to enable or 'false' to disable.")
                ],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: true,
                Reversibility: OperationReversibility.Reversible,
                RiskLevel: OperationRiskLevel.Low,
                Preconditions: "Target startup item must be user-scoped (HKCU or User Startup Folder).",
                ExpectedOutputDescription: "OperationProposal with single-use confirmation token.",
                PotentialRisks: WindowsOptimizationService.StartupToggleDescriptor.PotentialRisks),
            (args, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var entryId = args["entry_id"];
                var enable = bool.TryParse(args["enable"], out var b) && b;
                var proposal = _optimizationService.ProposeToggleStartupItem(entryId, enable);
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "propose_toggle_startup_item",
                    Succeeded: proposal.PrerequisitesMet,
                    IsModifyingProposal: true,
                    SummaryText: proposal.PrerequisitesMet
                        ? $"Prepared approval proposal: {proposal.ProposedChangeExplanation}"
                        : $"Cannot propose startup toggle: {proposal.PrerequisiteFailureReason}",
                    StructuredDataJson: JsonSerializer.Serialize(proposal, JsonOptions),
                    PendingProposal: proposal,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 14. Modify Proposal Tool: propose_toggle_windows_setting
        RegisterTool(
            new AgentToolDefinition(
                Name: "propose_toggle_windows_setting",
                DisplayName: "Propose Toggling a Windows Performance or Privacy Setting",
                Category: "Optimize / Configuration",
                Description: "Creates an approval-gated proposal to toggle a supported user-scoped Windows setting.",
                Parameters:
                [
                    new AgentToolParameter("setting_id", "string", true, "SettingId (e.g., gaming.game_mode, performance.visual_transparency, privacy.advertising_id)."),
                    new AgentToolParameter("enable", "boolean", true, "'true' to enable or 'false' to disable.")
                ],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: true,
                Reversibility: OperationReversibility.Reversible,
                RiskLevel: OperationRiskLevel.Low,
                Preconditions: "SettingId must be a supported HKCU setting.",
                ExpectedOutputDescription: "OperationProposal with single-use confirmation token.",
                PotentialRisks: WindowsOptimizationService.SettingToggleDescriptor.PotentialRisks),
            (args, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var settingId = args["setting_id"];
                var enable = bool.TryParse(args["enable"], out var b) && b;
                var proposal = _optimizationService.ProposeToggleSetting(settingId, enable);
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "propose_toggle_windows_setting",
                    Succeeded: proposal.PrerequisitesMet,
                    IsModifyingProposal: true,
                    SummaryText: proposal.PrerequisitesMet
                        ? $"Prepared approval proposal: {proposal.ProposedChangeExplanation}"
                        : $"Cannot propose setting change: {proposal.PrerequisiteFailureReason}",
                    StructuredDataJson: JsonSerializer.Serialize(proposal, JsonOptions),
                    PendingProposal: proposal,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 15. Modify Proposal Tool: propose_flush_dns_cache
        RegisterTool(
            new AgentToolDefinition(
                Name: "propose_flush_dns_cache",
                DisplayName: "Propose Flushing Windows DNS Cache",
                Category: "Troubleshoot / Network",
                Description: "Creates an approval-gated proposal to flush the Windows DNS resolver cache via ipconfig /flushdns.",
                Parameters: [],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: true,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.Low,
                Preconditions: "None.",
                ExpectedOutputDescription: "OperationProposal with single-use confirmation token.",
                PotentialRisks: DiagnosticsAndTroubleshootingService.FlushDnsDescriptor.PotentialRisks),
            (_, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var proposal = _troubleshootingService.ProposeFlushDnsCache();
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "propose_flush_dns_cache",
                    Succeeded: proposal.PrerequisitesMet,
                    IsModifyingProposal: true,
                    SummaryText: proposal.ProposedChangeExplanation,
                    StructuredDataJson: JsonSerializer.Serialize(proposal, JsonOptions),
                    PendingProposal: proposal,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 16. Read-Only Tool: inspect_browser_caches
        RegisterTool(
            new AgentToolDefinition(
                Name: "inspect_browser_caches",
                DisplayName: "Inspect User Temp & Browser Cache Directories",
                Category: "Maintenance / Cleanup",
                Description: "Inspects %TEMP%, CrashDumps, and HTTP/Code/GPU cache folders for Microsoft Edge, Google Chrome, Brave, and Mozilla Firefox without modifying any files.",
                Parameters: [],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: false,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.None,
                Preconditions: "None.",
                ExpectedOutputDescription: "SafeTempAndCacheCleanupSummary with per-browser cache sizes and running state.",
                PotentialRisks: []),
            (_, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var summary = _troubleshootingService.InspectSafeTempAndBrowserCaches();
                var totalMb = summary.TotalSafeReclaimableBytes / (1024.0 * 1024.0);
                var browserNotes = summary.BrowserCaches.Count > 0
                    ? string.Join(", ", summary.BrowserCaches.Select(b => $"{b.BrowserName}: {b.SizeDisplay} ({(b.IsBrowserProcessRunning ? "Running/Locked" : "Closed/Ready")})"))
                    : "No browser caches detected";
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "inspect_browser_caches",
                    Succeeded: true,
                    IsModifyingProposal: false,
                    SummaryText: $"Safe Temp & Browser Cache Reclaimable: {totalMb:F1} MB ({summary.TotalSafeFileCount} files) | {browserNotes}",
                    StructuredDataJson: JsonSerializer.Serialize(summary, JsonOptions),
                    PendingProposal: null,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 17. Modify Proposal Tool: propose_switch_dns_provider
        RegisterTool(
            new AgentToolDefinition(
                Name: "propose_switch_dns_provider",
                DisplayName: "Propose Switching Network Adapter DNS Provider",
                Category: "Troubleshoot / Network",
                Description: "Creates an approval-gated reversible proposal to switch the active network interface DNS to Cloudflare (1.1.1.1), Google (8.8.8.8), Quad9 (9.9.9.9), or Automatic (DHCP).",
                Parameters:
                [
                    new AgentToolParameter("provider", "string", true, "DNS provider name or IP ('Cloudflare', 'Google', 'Quad9', or 'Automatic')."),
                    new AgentToolParameter("adapter_name", "string", false, "Optional network adapter name (defaults to active gateway adapter).")
                ],
                RequiredPermissions: OperationElevationRequirement.AdministratorRequired,
                IsModifying: true,
                Reversibility: OperationReversibility.Reversible,
                RiskLevel: OperationRiskLevel.Low,
                Preconditions: "Active network interface and Administrator privileges for netsh execution.",
                ExpectedOutputDescription: "OperationProposal with single-use confirmation token and previous DNS rollback state.",
                PotentialRisks: DiagnosticsAndTroubleshootingService.SwitchDnsDescriptor.PotentialRisks),
            (args, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var provider = args["provider"];
                args.TryGetValue("adapter_name", out var adapterName);
                var proposal = _troubleshootingService.ProposeSwitchDnsProvider(provider, adapterName);
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "propose_switch_dns_provider",
                    Succeeded: proposal.PrerequisitesMet,
                    IsModifyingProposal: true,
                    SummaryText: proposal.PrerequisitesMet
                        ? $"Prepared approval proposal: {proposal.ProposedChangeExplanation}"
                        : $"Cannot propose DNS switch: {proposal.PrerequisiteFailureReason}",
                    StructuredDataJson: JsonSerializer.Serialize(proposal, JsonOptions),
                    PendingProposal: proposal,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 18. Modify Proposal Tool: propose_safe_cleanup
        RegisterTool(
            new AgentToolDefinition(
                Name: "propose_safe_cleanup",
                DisplayName: "Propose Safe Temp, Crash Dump & Browser Cache Cleanup",
                Category: "Maintenance / Cleanup",
                Description: "Creates an approval-gated proposal to clean unlocked files in %TEMP%, CrashDumps, and closed browser cache folders.",
                Parameters:
                [
                    new AgentToolParameter("include_browser_caches", "boolean", false, "Whether to include closed browser caches (default true).")
                ],
                RequiredPermissions: OperationElevationRequirement.StandardUser,
                IsModifying: true,
                Reversibility: OperationReversibility.Irreversible,
                RiskLevel: OperationRiskLevel.Low,
                Preconditions: "At least one eligible temporary or cache file must exist.",
                ExpectedOutputDescription: "OperationProposal with preview of files and bytes to clean.",
                PotentialRisks: DiagnosticsAndTroubleshootingService.SafeTempAndCacheCleanupDescriptor.PotentialRisks),
            (args, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var includeBrowsers = !args.TryGetValue("include_browser_caches", out var s) || !bool.TryParse(s, out var b) || b;
                var proposal = _troubleshootingService.ProposeSafeTempAndCacheCleanup(includeBrowsers);
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "propose_safe_cleanup",
                    Succeeded: proposal.PrerequisitesMet,
                    IsModifyingProposal: true,
                    SummaryText: proposal.PrerequisitesMet
                        ? $"Prepared cleanup proposal: {proposal.ProposedChangeExplanation}"
                        : $"No cleanup needed: {proposal.PrerequisiteFailureReason}",
                    StructuredDataJson: JsonSerializer.Serialize(proposal, JsonOptions),
                    PendingProposal: proposal,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 19. Modify Proposal Tool: propose_create_restore_point
        RegisterTool(
            new AgentToolDefinition(
                Name: "propose_create_restore_point",
                DisplayName: "Propose Creating a Windows System Restore Point",
                Category: "Maintenance / System Protection",
                Description: "Creates an approval-gated proposal to capture a Windows System Restore checkpoint.",
                Parameters:
                [
                    new AgentToolParameter("description", "string", false, "Optional label for the System Restore point.")
                ],
                RequiredPermissions: OperationElevationRequirement.AdministratorRequired,
                IsModifying: true,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.Low,
                Preconditions: "Requires Administrator privileges and System Protection enabled on C:.",
                ExpectedOutputDescription: "OperationProposal with single-use confirmation token.",
                PotentialRisks: DiagnosticsAndTroubleshootingService.CreateRestorePointDescriptor.PotentialRisks),
            (args, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                args.TryGetValue("description", out var desc);
                var proposal = _troubleshootingService.ProposeCreateRestorePoint(desc);
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "propose_create_restore_point",
                    Succeeded: proposal.PrerequisitesMet,
                    IsModifyingProposal: true,
                    SummaryText: proposal.PrerequisitesMet
                        ? $"Prepared restore point proposal: {proposal.ProposedChangeExplanation}"
                        : $"Cannot create restore point in current session: {proposal.PrerequisiteFailureReason}",
                    StructuredDataJson: JsonSerializer.Serialize(proposal, JsonOptions),
                    PendingProposal: proposal,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });

        // 20. Modify Proposal Tool: propose_verify_system_health
        RegisterTool(
            new AgentToolDefinition(
                Name: "propose_verify_system_health",
                DisplayName: "Propose Running DISM Component Store Health Check",
                Category: "Troubleshoot / Windows Repair",
                Description: "Creates an approval-gated proposal to verify Windows Component Store health via DISM /Online /Cleanup-Image /CheckHealth.",
                Parameters: [],
                RequiredPermissions: OperationElevationRequirement.AdministratorRequired,
                IsModifying: true,
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.Low,
                Preconditions: "Requires Administrator privileges for DISM online image inspection.",
                ExpectedOutputDescription: "OperationProposal with single-use confirmation token.",
                PotentialRisks: DiagnosticsAndTroubleshootingService.VerifyDismHealthDescriptor.PotentialRisks),
            (_, ct) =>
            {
                ct.ThrowIfCancellationRequested();
                var proposal = _troubleshootingService.ProposeVerifySystemHealth();
                return Task.FromResult(new AgentToolCallResult(
                    ToolName: "propose_verify_system_health",
                    Succeeded: proposal.PrerequisitesMet,
                    IsModifyingProposal: true,
                    SummaryText: proposal.PrerequisitesMet
                        ? $"Prepared DISM verification proposal: {proposal.ProposedChangeExplanation}"
                        : $"Cannot run DISM verification in non-elevated session: {proposal.PrerequisiteFailureReason}",
                    StructuredDataJson: JsonSerializer.Serialize(proposal, JsonOptions),
                    PendingProposal: proposal,
                    ExecutedAtUtc: DateTimeOffset.UtcNow));
            });
    }

    private static readonly IReadOnlyList<string> PowerSwitchRisks =
        WindowsOptimizationService.PowerSwitchDescriptor.PotentialRisks;
}
