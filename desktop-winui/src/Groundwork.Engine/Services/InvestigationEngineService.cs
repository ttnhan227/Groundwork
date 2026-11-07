using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

/// <summary>
/// Executes structured, multi-tool Groundwork Investigations (Performance, Storage, Network,
/// Windows Health, Startup, Hardware, and Custom user queries), separating confirmed telemetry
/// observations from potential causes and unverified hypotheses.
/// </summary>
public sealed class InvestigationEngineService
{
    private static readonly JsonSerializerOptions PrettyJsonOptions = new()
    {
        WriteIndented = true
    };

    private readonly ToolRegistryService _toolRegistry;
    private readonly List<InvestigationReport> _recentReports = [];
    private readonly object _reportsLock = new();

    public InvestigationEngineService(ToolRegistryService? toolRegistry = null)
    {
        _toolRegistry = toolRegistry ?? new ToolRegistryService();
    }

    public ToolRegistryService ToolRegistry => _toolRegistry;

    public IReadOnlyList<InvestigationReport> GetRecentReports()
    {
        lock (_reportsLock)
        {
            return _recentReports.ToList();
        }
    }

    public async Task<InvestigationReport> RunInvestigationAsync(
        InvestigationType type,
        string? customUserQuery = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var startedAt = DateTimeOffset.UtcNow;

        var report = type switch
        {
            InvestigationType.Performance => await RunPerformanceInvestigationAsync(startedAt, customUserQuery, cancellationToken).ConfigureAwait(false),
            InvestigationType.Storage => await RunStorageInvestigationAsync(startedAt, customUserQuery, cancellationToken).ConfigureAwait(false),
            InvestigationType.Network => await RunNetworkInvestigationAsync(startedAt, customUserQuery, cancellationToken).ConfigureAwait(false),
            InvestigationType.WindowsHealth => await RunWindowsHealthInvestigationAsync(startedAt, customUserQuery, cancellationToken).ConfigureAwait(false),
            InvestigationType.Startup => await RunStartupInvestigationAsync(startedAt, customUserQuery, cancellationToken).ConfigureAwait(false),
            InvestigationType.Hardware => await RunHardwareInvestigationAsync(startedAt, customUserQuery, cancellationToken).ConfigureAwait(false),
            _ => await RunCustomInvestigationAsync(startedAt, customUserQuery ?? "General system investigation", cancellationToken).ConfigureAwait(false)
        };

        lock (_reportsLock)
        {
            _recentReports.Insert(0, report);
            if (_recentReports.Count > 50)
            {
                _recentReports.RemoveRange(50, _recentReports.Count - 50);
            }
        }

        return report;
    }

    public static InvestigationType InferInvestigationTypeFromQuery(string? query)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return InvestigationType.WindowsHealth;
        }

        var q = query.ToLowerInvariant();
        if (q.Contains("internet") || q.Contains("wifi") || q.Contains("wi-fi") || q.Contains("network") ||
            q.Contains("dns") || q.Contains("disconnect") || q.Contains("ping") || q.Contains("ethernet"))
        {
            return InvestigationType.Network;
        }

        if (q.Contains("full") || q.Contains("storage") || q.Contains("disk space") || q.Contains("c drive") ||
            q.Contains("c:") || q.Contains("clean") || q.Contains("free space") || q.Contains("large file"))
        {
            return InvestigationType.Storage;
        }

        if (q.Contains("startup") || q.Contains("boot") || q.Contains("sign-in") || q.Contains("sign in") || q.Contains("login") || q.Contains("logon") || q.Contains("autostart"))
        {
            return InvestigationType.Startup;
        }

        if (q.Contains("slow") || q.Contains("lag") || q.Contains("stutter") || q.Contains("memory") ||
            q.Contains("ram") || q.Contains("cpu") || q.Contains("gaming") || q.Contains("fps") || q.Contains("freeze"))
        {
            return InvestigationType.Performance;
        }

        if (q.Contains("hardware") || q.Contains("specs") || q.Contains("motherboard") || q.Contains("gpu") ||
            q.Contains("bios") || q.Contains("spd"))
        {
            return InvestigationType.Hardware;
        }

        if (q.Contains("update") || q.Contains("error") || q.Contains("crash") || q.Contains("bsod") ||
            q.Contains("health") || q.Contains("repair") || q.Contains("sfc") || q.Contains("dism"))
        {
            return InvestigationType.WindowsHealth;
        }

        return InvestigationType.Custom;
    }

    private async Task<InvestigationReport> RunPerformanceInvestigationAsync(
        DateTimeOffset startedAt,
        string? userQuery,
        CancellationToken ct)
    {
        var toolResults = new List<AgentToolCallResult>();
        var confirmed = new List<InvestigationFinding>();
        var causes = new List<InvestigationFinding>();
        var hypotheses = new List<InvestigationFinding>();
        var recommendations = new List<InvestigationRecommendation>();

        var hwCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_hardware_and_os"), ct).ConfigureAwait(false);
        var procCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_live_processes"), ct).ConfigureAwait(false);
        var powerCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_power_plans"), ct).ConfigureAwait(false);
        var startupCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_startup_items"), ct).ConfigureAwait(false);
        var repairCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_windows_repair_status"), ct).ConfigureAwait(false);

        toolResults.AddRange([hwCall, procCall, powerCall, startupCall, repairCall]);

        var hw = await _toolRegistry.Hardware.GetHardwareReportAsync(maskSensitiveData: false, ct: ct).ConfigureAwait(false);
        var procs = _toolRegistry.Troubleshooting.InspectProcesses(10);
        var power = _toolRegistry.Optimization.InspectPowerPlans();
        var startups = _toolRegistry.Optimization.InspectStartupItems();
        var repair = _toolRegistry.Troubleshooting.InspectWindowsRepairAndHealthStatus();

        var cpuLoad = hw.LiveDiagnostics.CpuUtilizationPercent ?? 0.0;

        // Confirmed Observations
        confirmed.Add(new InvestigationFinding(
            FindingCategory.ConfirmedObservation,
            $"Memory Utilization: {hw.Memory.UsedPercent:F1}% ({hw.Memory.UsedPhysicalBytes / (1024.0 * 1024 * 1024):F1} GB / {hw.Memory.TotalPhysicalBytes / (1024.0 * 1024 * 1024):F1} GB)",
            $"Live physical RAM usage is {hw.Memory.UsedPercent:F1}% with {hw.Memory.AvailablePhysicalBytes / (1024.0 * 1024 * 1024):F1} GB available.",
            "HardwareSpecsEngineService (GlobalMemoryStatusEx)",
            "Confirmed (Live Telemetry)",
            hw.Memory.UsedPercent >= 85 ? "High" : "Normal"));

        confirmed.Add(new InvestigationFinding(
            FindingCategory.ConfirmedObservation,
            $"CPU Load: {cpuLoad:F1}% on {hw.Cpu.Name}",
            $"Processor has {hw.Cpu.PhysicalCores} physical cores / {hw.Cpu.LogicalProcessors} logical threads across {procs.TotalProcessCount} active processes.",
            "HardwareSpecsEngineService (PDH / WMI)",
            "Confirmed (Live Telemetry)",
            cpuLoad >= 80 ? "High" : "Normal"));

        if (procs.TopMemoryProcesses.Count > 0)
        {
            var top3 = string.Join(", ", procs.TopMemoryProcesses.Take(3).Select(p => $"{p.ProcessName} ({p.WorkingSetDisplay})"));
            confirmed.Add(new InvestigationFinding(
                FindingCategory.ConfirmedObservation,
                "Top Memory Consumers",
                $"Highest working-set processes right now: {top3}.",
                "DiagnosticsAndTroubleshootingService (Process.GetProcesses)",
                "Confirmed (Live Telemetry)",
                "Info"));
        }

        confirmed.Add(new InvestigationFinding(
            FindingCategory.ConfirmedObservation,
            $"Active Power Plan: {power.ActiveSchemeName}",
            $"Windows power scheme is currently set to '{power.ActiveSchemeName}' ({power.ActiveSchemeGuid}).",
            "WindowsOptimizationService (powercfg)",
            "Confirmed (Live Telemetry)",
            "Info"));

        // Potential Contributing Factors
        if (hw.Memory.UsedPercent >= 80)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                "Elevated Memory Pressure & Pagefile Swapping",
                $"RAM utilization is at {hw.Memory.UsedPercent:F1}%. When physical memory exceeds 80–85%, Windows pages memory blocks to disk, causing UI stalls and application switching lag.",
                "Memory Usage + Process Working Set Analysis",
                "High Confidence",
                "High"));
        }

        if (power.ActiveSchemeName.Contains("Saver", StringComparison.OrdinalIgnoreCase) ||
            power.ActiveSchemeName.Contains("Eco", StringComparison.OrdinalIgnoreCase))
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                "Power Saver Plan Throttling CPU Boost Clocks",
                $"The active power scheme ('{power.ActiveSchemeName}') caps processor frequency scaling to save energy, which reduces responsiveness.",
                "powercfg /getactivescheme",
                "High Confidence",
                "Medium"));

            var balancedPlan = power.Plans.FirstOrDefault(p => p.Name.Contains("Balanced", StringComparison.OrdinalIgnoreCase));
            if (balancedPlan is not null)
            {
                recommendations.Add(new InvestigationRecommendation(
                    RecommendationId: "rec-power-balanced",
                    Title: $"Switch Power Plan to '{balancedPlan.Name}'",
                    Explanation: "Restores full dynamic CPU boost frequencies under load while maintaining idle efficiency.",
                    Reversibility: OperationReversibility.Reversible,
                    RiskLevel: OperationRiskLevel.Low,
                    RequiresUserApproval: true,
                    AssociatedToolName: "propose_switch_power_plan",
                    ToolArguments: new Dictionary<string, string> { ["scheme_guid"] = balancedPlan.SchemeGuid }));
            }
        }

        var enabledHighImpact = startups.Where(s => s.IsEnabled && s.ImpactAssessment.Contains("High", StringComparison.OrdinalIgnoreCase)).ToList();
        if (enabledHighImpact.Count > 0)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                $"{enabledHighImpact.Count} High-Impact Background Startup Application(s) Enabled",
                $"Enabled high-impact auto-launchers ({string.Join(", ", enabledHighImpact.Select(s => s.Name))}) consume RAM and background CPU cycles from sign-in.",
                "WindowsOptimizationService (Startup Inspection)",
                "Medium-High Confidence",
                "Medium"));
        }

        if (repair.RebootPending)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                "Pending Windows Servicing Reboot",
                $"Windows has a pending reboot ({string.Join(" ", repair.RebootPendingReasons)}). Background servicing tasks often hold locks or run post-update indexing until the restart completes.",
                "Registry CBS / WindowsUpdate Reboot Flags",
                "High Confidence",
                "Medium"));
        }

        var notResponding = procs.TopMemoryProcesses.Where(p => !p.IsResponding).ToList();
        if (notResponding.Count > 0)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                $"{notResponding.Count} Unresponsive Application Window(s) Detected",
                $"Process(es) currently not responding to Windows message pump: {string.Join(", ", notResponding.Select(p => $"{p.ProcessName} (PID {p.ProcessId})"))}.",
                "Process.Responding Inspection",
                "Confirmed",
                "High"));
        }

        if (causes.Count == 0)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                "Transient Workload Spike or Per-Application Bottleneck",
                "Current system-wide CPU and RAM utilization are within normal operating margins; intermittent slowdowns may be caused by browser tab spikes, shader compilation, or network latency.",
                "Combined Telemetry Correlation",
                "Moderate Confidence",
                "Low"));
        }

        // Unverified Hypotheses
        hypotheses.Add(new InvestigationFinding(
            FindingCategory.UnverifiedHypothesis,
            "CPU / GPU Thermal Throttling Under Sustained Load",
            "Standard Windows user-mode WMI does not expose accurate core package die temperatures without a Ring-0 kernel driver. If slowdowns occur after 5–10 minutes of heavy load, thermal throttling due to dust buildup or fan curves is a possible cause.",
            "Sensor Boundary Notice",
            "Unverified (Requires Hardware Thermal Sensor)",
            "Info"));

        // Recommendations
        recommendations.Add(new InvestigationRecommendation(
            RecommendationId: "rec-review-startup",
            Title: "Review and Disable Unneeded Startup Applications",
            Explanation: $"You have {startups.Count(s => s.IsEnabled)} enabled startup entries ({enabledHighImpact.Count} high-impact). Disabling unneeded auto-launchers in the Optimize > Startup module frees background RAM.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            RequiresUserApproval: true));

        recommendations.Add(new InvestigationRecommendation(
            RecommendationId: "rec-enable-gamemode",
            Title: "Ensure Windows Game Mode is Enabled for Foreground Workloads",
            Explanation: "Prevents background Windows Update driver installations and prioritizes foreground interactive applications.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            RequiresUserApproval: true,
            AssociatedToolName: "propose_toggle_windows_setting",
            ToolArguments: new Dictionary<string, string> { ["setting_id"] = "gaming.game_mode", ["enable"] = "true" }));

        var execSummary = $"Inspected CPU ({cpuLoad:F1}%), RAM ({hw.Memory.UsedPercent:F1}%), {procs.TotalProcessCount} processes, power plan ('{power.ActiveSchemeName}'), and {startups.Count} startup entries. " +
                          $"Identified {confirmed.Count} confirmed observations and {causes.Count} potential contributing factor(s).";

        return new InvestigationReport(
            ReportId: $"inv-perf-{Guid.NewGuid():N}",
            InvestigationType: InvestigationType.Performance,
            Title: "System Performance & Responsiveness Investigation",
            UserQuery: string.IsNullOrWhiteSpace(userQuery) ? "Investigate system performance and responsiveness." : userQuery,
            ExecutiveSummary: execSummary,
            ExecutedTools: toolResults.Select(t => t.ToolName).ToList(),
            ConfirmedObservations: confirmed,
            PotentialCauses: causes,
            UnverifiedHypotheses: hypotheses,
            RecommendedActions: recommendations,
            ToolResults: toolResults,
            StartedAtUtc: startedAt,
            CompletedAtUtc: DateTimeOffset.UtcNow);
    }

    private async Task<InvestigationReport> RunStorageInvestigationAsync(
        DateTimeOffset startedAt,
        string? userQuery,
        CancellationToken ct)
    {
        var toolResults = new List<AgentToolCallResult>();
        var confirmed = new List<InvestigationFinding>();
        var causes = new List<InvestigationFinding>();
        var hypotheses = new List<InvestigationFinding>();
        var recommendations = new List<InvestigationRecommendation>();

        var volCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_storage_volumes"), ct).ConfigureAwait(false);
        var cleanCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_cleanup_candidates"), ct).ConfigureAwait(false);
        var browserCacheCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_browser_caches"), ct).ConfigureAwait(false);
        toolResults.AddRange([volCall, cleanCall, browserCacheCall]);

        var drives = _toolRegistry.Drives.DiscoverVolumes();
        var diag = await _toolRegistry.Cleanup.PreloadDiagnosticReportAsync(ct).ConfigureAwait(false);
        var cacheSummary = _toolRegistry.Troubleshooting.InspectSafeTempAndBrowserCaches();

        foreach (var d in drives)
        {
            var freeGb = d.FreeBytes / (1024.0 * 1024 * 1024);
            var totalGb = d.TotalBytes / (1024.0 * 1024 * 1024);
            confirmed.Add(new InvestigationFinding(
                FindingCategory.ConfirmedObservation,
                $"Volume {d.RootPath} ({d.VolumeName}): {freeGb:F1} GB Free of {totalGb:F1} GB ({d.UsedPercent:F1}% Used)",
                $"Filesystem: {d.FileSystem}. Used space: {d.UsedBytes / (1024.0 * 1024 * 1024):F1} GB.",
                "DriveDiscoveryService (DriveInfo)",
                "Confirmed (Live Telemetry)",
                d.UsedPercent >= 90 ? "High" : (d.UsedPercent >= 80 ? "Medium" : "Normal")));

            if (d.UsedPercent >= 85 || (d.IsReady && freeGb < 20))
            {
                causes.Add(new InvestigationFinding(
                    FindingCategory.PotentialCause,
                    $"Low Free Space on Volume {d.RootPath} ({freeGb:F1} GB Remaining)",
                    "SSD wear-leveling, Windows Update staging, and virtual memory pagefile growth degrade when free space drops below 10–15%.",
                    "Drive Capacity Threshold Analysis",
                    "Confirmed",
                    "High"));
            }
        }

        var tempMb = (diag.TempFilesBytes + diag.CrashDumpsBytes) / (1024.0 * 1024.0);
        var rbMb = diag.RecycleBinBytes / (1024.0 * 1024.0);
        var candidateCount = diag.TempFilesCount + diag.CrashDumpsCount;
        var browserCacheMb = cacheSummary.BrowserCaches.Sum(b => b.CacheSizeBytes) / (1024.0 * 1024.0);
        confirmed.Add(new InvestigationFinding(
            FindingCategory.ConfirmedObservation,
            $"Reclaimable Temp & Crash Dumps: {tempMb:F1} MB ({candidateCount} items) | Browser Caches: {browserCacheMb:F1} MB | Recycle Bin: {rbMb:F1} MB ({diag.RecycleBinItemCount} items)",
            $"Safe cleanup inspection found {(tempMb + rbMb + browserCacheMb):F1} MB of immediately reclaimable temporary, browser cache, and Recycle Bin storage.",
            "SafeCleanupService + Browser Cache Inspector",
            "Confirmed (Live Telemetry)",
            (tempMb + rbMb + browserCacheMb) > 1024 ? "Medium" : "Normal"));

        if (tempMb + rbMb + browserCacheMb > 100)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                "Accumulated Temporary Files, Browser Caches & Recycle Bin Items",
                $"Approximately {(tempMb + rbMb + browserCacheMb):F1} MB is currently occupied by temporary build/installer artifacts, web browser caches, and unemptied Recycle Bin items.",
                "SafeCleanupService Preview",
                "Confirmed",
                "Medium"));
        }

        hypotheses.Add(new InvestigationFinding(
            FindingCategory.UnverifiedHypothesis,
            "Large Application Caches, Game Installations, or Duplicate Media Files",
            "Run a full Storage Analyzer scan or Duplicate Finder scan in the Analyze / Maintenance modules to pinpoint multi-gigabyte folders and duplicate archives across user directories.",
            "Full Volume Tree Scan Pending",
            "Requires Full Directory Scan",
            "Info"));

        recommendations.Add(new InvestigationRecommendation(
            RecommendationId: "rec-storage-cleanup",
            Title: "Clean Temporary Files, Crash Dumps & Closed Browser Caches",
            Explanation: $"Reclaim up to {(cacheSummary.TotalSafeReclaimableBytes / (1024.0 * 1024.0)):F1} MB from %TEMP%, crash dumps, and closed browser caches while preserving all cookies, logins, and documents.",
            Reversibility: OperationReversibility.Irreversible,
            RiskLevel: OperationRiskLevel.Low,
            RequiresUserApproval: true,
            AssociatedToolName: "propose_safe_cleanup",
            ToolArguments: new Dictionary<string, string> { ["include_browser_caches"] = "true" }));

        recommendations.Add(new InvestigationRecommendation(
            RecommendationId: "rec-storage-scan",
            Title: "Run Parallel Win32 Storage Scan on Primary Drive",
            Explanation: "Builds a complete bottom-up folder size breakdown and identifies the largest individual files consuming disk space.",
            Reversibility: OperationReversibility.ReadOnly,
            RiskLevel: OperationRiskLevel.None,
            RequiresUserApproval: false));

        var summary = $"Inspected {drives.Count} storage volume(s) and found {(tempMb + rbMb):F1} MB of immediately reclaimable Temp/Recycle Bin space.";
        return new InvestigationReport(
            ReportId: $"inv-stor-{Guid.NewGuid():N}",
            InvestigationType: InvestigationType.Storage,
            Title: "Storage Capacity & Disk Utilization Investigation",
            UserQuery: string.IsNullOrWhiteSpace(userQuery) ? "Investigate disk space utilization and reclaimable storage." : userQuery,
            ExecutiveSummary: summary,
            ExecutedTools: toolResults.Select(t => t.ToolName).ToList(),
            ConfirmedObservations: confirmed,
            PotentialCauses: causes,
            UnverifiedHypotheses: hypotheses,
            RecommendedActions: recommendations,
            ToolResults: toolResults,
            StartedAtUtc: startedAt,
            CompletedAtUtc: DateTimeOffset.UtcNow);
    }

    private async Task<InvestigationReport> RunNetworkInvestigationAsync(
        DateTimeOffset startedAt,
        string? userQuery,
        CancellationToken ct)
    {
        var toolResults = new List<AgentToolCallResult>();
        var confirmed = new List<InvestigationFinding>();
        var causes = new List<InvestigationFinding>();
        var hypotheses = new List<InvestigationFinding>();
        var recommendations = new List<InvestigationRecommendation>();

        var netCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_network_health"), ct).ConfigureAwait(false);
        toolResults.Add(netCall);

        var netReport = await _toolRegistry.Troubleshooting.RunNetworkTroubleshootingAsync(null, ct).ConfigureAwait(false);
        var upAdapters = netReport.ActiveInterfaces.Where(i => string.Equals(i.OperationalStatus, "Up", StringComparison.OrdinalIgnoreCase)).ToList();

        confirmed.Add(new InvestigationFinding(
            FindingCategory.ConfirmedObservation,
            $"Active Network Adapters: {upAdapters.Count} Up (of {netReport.ActiveInterfaces.Count} physical/virtual adapters)",
            upAdapters.Count > 0
                ? string.Join(" | ", upAdapters.Select(a => $"{a.Name} ({a.Description}): IP [{a.IpSummary}], Gateway [{a.GatewaySummary}], DNS [{a.DnsSummary}]"))
                : "No network interfaces are currently in the 'Up' operational state.",
            "DiagnosticsAndTroubleshootingService (NetworkInterface)",
            "Confirmed (Live Telemetry)",
            upAdapters.Count == 0 ? "High" : "Normal"));

        confirmed.Add(new InvestigationFinding(
            FindingCategory.ConfirmedObservation,
            $"Gateway Ping ({netReport.GatewayPing.TargetHost}): {netReport.GatewayPing.LatencyDisplay}",
            netReport.GatewayPing.StatusMessage,
            "ICMP Ping (Default Gateway)",
            "Confirmed (Live Telemetry)",
            netReport.GatewayPing.Succeeded ? "Normal" : "Medium"));

        confirmed.Add(new InvestigationFinding(
            FindingCategory.ConfirmedObservation,
            $"External Reachability Ping (1.1.1.1): {netReport.ExternalPing.LatencyDisplay}",
            netReport.ExternalPing.StatusMessage,
            "ICMP Ping (1.1.1.1)",
            "Confirmed (Live Telemetry)",
            netReport.ExternalPing.Succeeded ? "Normal" : "High"));

        confirmed.Add(new InvestigationFinding(
            FindingCategory.ConfirmedObservation,
            $"DNS Resolution ({netReport.DnsCheck.HostName}): {(netReport.DnsCheck.Succeeded ? $"Succeeded in {netReport.DnsCheck.ElapsedMs} ms" : "Failed")}",
            netReport.DnsCheck.StatusMessage,
            "System.Net.Dns",
            "Confirmed (Live Telemetry)",
            netReport.DnsCheck.Succeeded ? "Normal" : "High"));

        if (upAdapters.Count == 0)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                "Disconnected Physical Link or Disabled Wi-Fi/Ethernet Adapter",
                "All non-loopback network interfaces report OperationalStatus != Up.",
                "NetworkInterface Inspection",
                "Confirmed",
                "High"));
        }
        else if (netReport.ExternalPing.Succeeded && !netReport.DnsCheck.Succeeded)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                "Unresponsive or Misconfigured DNS Server",
                "Raw IP packets reach 1.1.1.1, but domain name resolution failed. Your current DNS resolver may be down or blocked.",
                "Ping vs. DNS Differential Check",
                "High Confidence",
                "High"));
        }
        else if (!netReport.ExternalPing.Succeeded)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                "Upstream Router or ISP Connectivity Outage",
                "Outbound ICMP echo requests to 1.1.1.1 timed out or were unreachable.",
                "External Connectivity Check",
                "High Confidence",
                "High"));
        }
        else if (netReport.ExternalPing.RoundtripTimeMs > 120 || netReport.DnsCheck.ElapsedMs > 250)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                "Elevated Network or DNS Lookup Latency",
                $"External ping is {netReport.ExternalPing.RoundtripTimeMs} ms and DNS lookup took {netReport.DnsCheck.ElapsedMs} ms, which can make web browsing feel sluggish.",
                "Latency Threshold Check",
                "Moderate Confidence",
                "Medium"));
        }

        hypotheses.Add(new InvestigationFinding(
            FindingCategory.UnverifiedHypothesis,
            "Intermittent Wi-Fi Signal Interference or Router DHCP Lease Renewal Drops",
            "If disconnects occur only periodically rather than right now, 2.4 GHz/5 GHz channel congestion, Wi-Fi adapter power-saving sleep states, or ISP modem drops may be responsible.",
            "Historical Pattern Hypothesis",
            "Unverified (Point-in-time snapshot is currently reachable)",
            "Info"));

        recommendations.Add(new InvestigationRecommendation(
            RecommendationId: "rec-flush-dns",
            Title: "Flush Windows DNS Resolver Cache",
            Explanation: "Clears stale or failed DNS entries from the Windows DNS Client cache via 'ipconfig /flushdns'.",
            Reversibility: OperationReversibility.ReadOnly,
            RiskLevel: OperationRiskLevel.Low,
            RequiresUserApproval: true,
            AssociatedToolName: "propose_flush_dns_cache",
            ToolArguments: new Dictionary<string, string>()));

        var requestedProvider = "Cloudflare";
        if (!string.IsNullOrWhiteSpace(userQuery))
        {
            if (userQuery.Contains("google", StringComparison.OrdinalIgnoreCase) || userQuery.Contains("8.8.8.8", StringComparison.OrdinalIgnoreCase))
            {
                requestedProvider = "Google";
            }
            else if (userQuery.Contains("quad9", StringComparison.OrdinalIgnoreCase) || userQuery.Contains("9.9.9.9", StringComparison.OrdinalIgnoreCase))
            {
                requestedProvider = "Quad9";
            }
            else if (userQuery.Contains("auto", StringComparison.OrdinalIgnoreCase) || userQuery.Contains("dhcp", StringComparison.OrdinalIgnoreCase))
            {
                requestedProvider = "Automatic";
            }
        }

        var switchDnsRec = new InvestigationRecommendation(
            RecommendationId: "rec-switch-dns",
            Title: $"Switch Active Adapter DNS Provider to {requestedProvider}",
            Explanation: $"Configures your active network adapter to use {requestedProvider} DNS while capturing the current DNS configuration for one-click rollback.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            RequiresUserApproval: true,
            AssociatedToolName: "propose_switch_dns_provider",
            ToolArguments: new Dictionary<string, string> { ["provider"] = requestedProvider });

        bool explicitDnsSwitch = !string.IsNullOrWhiteSpace(userQuery) &&
            (userQuery.Contains("switch", StringComparison.OrdinalIgnoreCase) ||
             userQuery.Contains("cloudflare", StringComparison.OrdinalIgnoreCase) ||
             userQuery.Contains("google", StringComparison.OrdinalIgnoreCase) ||
             userQuery.Contains("quad9", StringComparison.OrdinalIgnoreCase) ||
             userQuery.Contains("1.1.1.1", StringComparison.OrdinalIgnoreCase) ||
             userQuery.Contains("8.8.8.8", StringComparison.OrdinalIgnoreCase) ||
             userQuery.Contains("9.9.9.9", StringComparison.OrdinalIgnoreCase));

        if (explicitDnsSwitch)
        {
            recommendations.Insert(0, switchDnsRec);
        }
        else
        {
            recommendations.Add(switchDnsRec);
        }

        return new InvestigationReport(
            ReportId: $"inv-net-{Guid.NewGuid():N}",
            InvestigationType: InvestigationType.Network,
            Title: "Network Connectivity, Gateway & DNS Investigation",
            UserQuery: string.IsNullOrWhiteSpace(userQuery) ? "Investigate network connectivity and DNS health." : userQuery,
            ExecutiveSummary: netReport.SummaryDiagnosis,
            ExecutedTools: toolResults.Select(t => t.ToolName).ToList(),
            ConfirmedObservations: confirmed,
            PotentialCauses: causes,
            UnverifiedHypotheses: hypotheses,
            RecommendedActions: recommendations,
            ToolResults: toolResults,
            StartedAtUtc: startedAt,
            CompletedAtUtc: DateTimeOffset.UtcNow);
    }

    private async Task<InvestigationReport> RunWindowsHealthInvestigationAsync(
        DateTimeOffset startedAt,
        string? userQuery,
        CancellationToken ct)
    {
        var toolResults = new List<AgentToolCallResult>();
        var confirmed = new List<InvestigationFinding>();
        var causes = new List<InvestigationFinding>();
        var hypotheses = new List<InvestigationFinding>();
        var recommendations = new List<InvestigationRecommendation>();

        var hwCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_hardware_and_os"), ct).ConfigureAwait(false);
        var repairCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_windows_repair_status"), ct).ConfigureAwait(false);
        var svcCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_windows_services"), ct).ConfigureAwait(false);
        var evtCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_event_log_errors"), ct).ConfigureAwait(false);
        toolResults.AddRange([hwCall, repairCall, svcCall, evtCall]);

        var hw = await _toolRegistry.Hardware.GetHardwareReportAsync(maskSensitiveData: false, ct: ct).ConfigureAwait(false);
        var repair = _toolRegistry.Troubleshooting.InspectWindowsRepairAndHealthStatus();
        var services = _toolRegistry.Troubleshooting.InspectKeyWindowsServices();
        var events = _toolRegistry.Troubleshooting.InspectRecentEventLogErrors(25);

        var secureBootState = hw.Motherboard.IsSecureBootEnabled switch
        {
            true => "Enabled",
            false => "Disabled",
            null => "Unknown"
        };

        confirmed.Add(new InvestigationFinding(
            FindingCategory.ConfirmedObservation,
            $"Windows Environment: {hw.Os.Caption} (Version {hw.Os.Version}, Build {hw.Os.BuildNumber})",
            $"Architecture: {hw.Os.Architecture} | Uptime: {hw.Os.Uptime.Days}d {hw.Os.Uptime.Hours}h {hw.Os.Uptime.Minutes}m | Secure Boot: {secureBootState}.",
            "HardwareSpecsEngineService",
            "Confirmed (Live Telemetry)",
            "Normal"));

        foreach (var disk in hw.Disks)
        {
            confirmed.Add(new InvestigationFinding(
                FindingCategory.ConfirmedObservation,
                $"Physical Disk '{disk.Model}' ({disk.MediaType}, {disk.InterfaceType}): Status '{disk.Status}'",
                $"Capacity: {disk.SizeBytes / (1024.0 * 1024 * 1024):F0} GB | Partitions: {disk.PartitionsCount}.",
                "Win32_DiskDrive",
                "Confirmed (Live Telemetry)",
                string.Equals(disk.Status, "OK", StringComparison.OrdinalIgnoreCase) ? "Normal" : "High"));
        }

        confirmed.Add(new InvestigationFinding(
            FindingCategory.ConfirmedObservation,
            $"Pending Servicing Reboot: {(repair.RebootPending ? "Yes" : "No")}",
            repair.RebootPending ? string.Join(" ", repair.RebootPendingReasons) : "No pending Component-Based Servicing or Windows Update reboot flags.",
            "WindowsRepairAndHealthStatus",
            "Confirmed (Live Telemetry)",
            repair.RebootPending ? "Medium" : "Normal"));

        confirmed.Add(new InvestigationFinding(
            FindingCategory.ConfirmedObservation,
            $"Device Manager PnP Status: {(repair.DeviceManagerErrors.Count == 0 ? "0 device errors" : $"{repair.DeviceManagerErrors.Count} device error(s)")}",
            repair.DeviceManagerErrors.Count == 0
                ? "All enumerated Plug-and-Play hardware devices report ConfigManagerErrorCode = 0."
                : string.Join("; ", repair.DeviceManagerErrors),
            "Win32_PnPEntity",
            "Confirmed (Live Telemetry)",
            repair.DeviceManagerErrors.Count == 0 ? "Normal" : "High"));

        var abnormalServices = services.Where(s => s.IsAbnormal).ToList();
        if (abnormalServices.Count > 0)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                $"{abnormalServices.Count} Core Windows Service(s) in Abnormal State",
                string.Join(" | ", abnormalServices.Select(s => $"{s.DisplayName} ({s.Status}, StartMode={s.StartType}): {s.HealthNote}")),
                "WindowsServicesInspection",
                "Confirmed",
                "High"));
        }

        var criticalOrErrors = events.Where(e => e.LevelDisplay is "Critical" or "Error").Take(5).ToList();
        if (criticalOrErrors.Count > 0)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                $"{criticalOrErrors.Count} Recent System/Application Error Event(s) in Windows Event Log",
                string.Join(" || ", criticalOrErrors.Select(e => $"[{e.LogName} {e.LevelDisplay}] {e.ProviderName} (ID {e.EventId} at {e.TimeDisplay}): {e.PlainEnglishExplanation}")),
                "Windows Event Log (7-day window)",
                "Confirmed Log Evidence",
                "Medium"));
        }

        if (repair.RebootPending)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                "Unfinished Windows Update / Component Servicing Queue",
                "Pending reboot flags can block new Windows Updates or software installers from running until the system restarts.",
                "Registry Servicing Flags",
                "High Confidence",
                "Medium"));
        }

        hypotheses.Add(new InvestigationFinding(
            FindingCategory.UnverifiedHypothesis,
            "Component Store (WinSxS) or Protected System File Corruption",
            "Verifying the cryptographic hashes of all protected Windows system files requires running 'DISM /Online /Cleanup-Image /CheckHealth' and 'sfc /scannow' from an elevated Administrator session.",
            "SFC / DISM Guidance",
            "Requires Elevated Integrity Scan",
            "Info"));

        if (repair.RebootPending)
        {
            recommendations.Add(new InvestigationRecommendation(
                RecommendationId: "rec-restart-windows",
                Title: "Restart Windows to Finalize Pending Servicing Operations",
                Explanation: string.Join(" ", repair.RebootPendingReasons),
                Reversibility: OperationReversibility.ReadOnly,
                RiskLevel: OperationRiskLevel.Low,
                RequiresUserApproval: true));
        }

        recommendations.Add(new InvestigationRecommendation(
            RecommendationId: "rec-review-events",
            Title: "Inspect Detailed Event Log Explanations in Troubleshoot > Event Log",
            Explanation: "Review recent Application and System error records alongside plain-English root cause notes.",
            Reversibility: OperationReversibility.ReadOnly,
            RiskLevel: OperationRiskLevel.None,
            RequiresUserApproval: false));

        var summary = $"Audited OS build {hw.Os.BuildNumber}, {hw.Disks.Count} physical disk(s), {services.Count} core services ({abnormalServices.Count} abnormal), " +
                      $"Device Manager ({repair.DeviceManagerErrors.Count} errors), and {events.Count} recent event log entries.";

        return new InvestigationReport(
            ReportId: $"inv-health-{Guid.NewGuid():N}",
            InvestigationType: InvestigationType.WindowsHealth,
            Title: "Windows System Health, Servicing & Event Investigation",
            UserQuery: string.IsNullOrWhiteSpace(userQuery) ? "Check Windows system health, services, disks, and recent errors." : userQuery,
            ExecutiveSummary: summary,
            ExecutedTools: toolResults.Select(t => t.ToolName).ToList(),
            ConfirmedObservations: confirmed,
            PotentialCauses: causes,
            UnverifiedHypotheses: hypotheses,
            RecommendedActions: recommendations,
            ToolResults: toolResults,
            StartedAtUtc: startedAt,
            CompletedAtUtc: DateTimeOffset.UtcNow);
    }

    private async Task<InvestigationReport> RunStartupInvestigationAsync(
        DateTimeOffset startedAt,
        string? userQuery,
        CancellationToken ct)
    {
        var startupCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_startup_items"), ct).ConfigureAwait(false);
        var items = _toolRegistry.Optimization.InspectStartupItems();

        var confirmed = new List<InvestigationFinding>();
        var causes = new List<InvestigationFinding>();
        var hypotheses = new List<InvestigationFinding>();
        var recommendations = new List<InvestigationRecommendation>();

        var enabled = items.Where(i => i.IsEnabled).ToList();
        var highImpact = enabled.Where(i => i.ImpactAssessment.Contains("High", StringComparison.OrdinalIgnoreCase)).ToList();
        var orphaned = items.Where(i => !i.TargetExists).ToList();

        confirmed.Add(new InvestigationFinding(
            FindingCategory.ConfirmedObservation,
            $"Discovered {items.Count} Startup Entries ({enabled.Count} Enabled, {items.Count - enabled.Count} Disabled)",
            $"User Registry (HKCU): {items.Count(i => i.Scope == StartupEntryScope.CurrentUserRegistry)} | " +
            $"Machine Registry (HKLM): {items.Count(i => i.Scope is StartupEntryScope.LocalMachineRegistry or StartupEntryScope.LocalMachineWow64Registry)} | " +
            $"Startup Folders: {items.Count(i => i.Scope is StartupEntryScope.CurrentUserStartupFolder or StartupEntryScope.CommonStartupFolder)}.",
            "WindowsOptimizationService (Startup Enumeration)",
            "Confirmed (Live Telemetry)",
            "Normal"));

        foreach (var hi in highImpact)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                $"High-Impact Startup Entry: '{hi.Name}' ({hi.Publisher})",
                $"{hi.ImpactReason} Command: {hi.CommandOrTarget}",
                hi.LocationDisplay,
                "Confirmed",
                "Medium"));

            if (!hi.RequiresAdminToModify)
            {
                recommendations.Add(new InvestigationRecommendation(
                    RecommendationId: $"rec-disable-{hi.EntryId}",
                    Title: $"Disable Optional Startup Item '{hi.Name}'",
                    Explanation: $"Prevents '{hi.Name}' from auto-launching at sign-in while preserving its command for one-click re-enabling.",
                    Reversibility: OperationReversibility.Reversible,
                    RiskLevel: OperationRiskLevel.Low,
                    RequiresUserApproval: true,
                    AssociatedToolName: "propose_toggle_startup_item",
                    ToolArguments: new Dictionary<string, string>
                    {
                        ["entry_id"] = hi.EntryId,
                        ["enable"] = "false"
                    }));
            }
        }

        if (orphaned.Count > 0)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                $"{orphaned.Count} Startup Entry/Entries Point to Missing Executable Files",
                $"Entries with missing targets: {string.Join(", ", orphaned.Select(o => $"{o.Name} ({o.ExecutablePath})"))}.",
                "File.Exists Verification",
                "Confirmed",
                "Low"));
        }

        hypotheses.Add(new InvestigationFinding(
            FindingCategory.UnverifiedHypothesis,
            "Scheduled Tasks or Third-Party Background Services Triggered at Logon",
            "Some applications register logon triggers in Windows Task Scheduler or install background services rather than standard Run keys.",
            "Startup Scope Boundary",
            "Info",
            "Info"));

        return new InvestigationReport(
            ReportId: $"inv-start-{Guid.NewGuid():N}",
            InvestigationType: InvestigationType.Startup,
            Title: "Windows Startup Configuration & Impact Investigation",
            UserQuery: string.IsNullOrWhiteSpace(userQuery) ? "Inspect startup applications and logon impact." : userQuery,
            ExecutiveSummary: $"Found {items.Count} startup entries ({enabled.Count} enabled, {highImpact.Count} high-impact, {orphaned.Count} orphaned).",
            ExecutedTools: [startupCall.ToolName],
            ConfirmedObservations: confirmed,
            PotentialCauses: causes,
            UnverifiedHypotheses: hypotheses,
            RecommendedActions: recommendations,
            ToolResults: [startupCall],
            StartedAtUtc: startedAt,
            CompletedAtUtc: DateTimeOffset.UtcNow);
    }

    private async Task<InvestigationReport> RunHardwareInvestigationAsync(
        DateTimeOffset startedAt,
        string? userQuery,
        CancellationToken ct)
    {
        var hwCall = await _toolRegistry.ExecuteToolAsync(new AgentToolCallRequest("inspect_hardware_and_os"), ct).ConfigureAwait(false);
        var hw = await _toolRegistry.Hardware.GetHardwareReportAsync(maskSensitiveData: false, ct: ct).ConfigureAwait(false);

        var secureBootText = hw.Motherboard.IsSecureBootEnabled switch
        {
            true => "Enabled",
            false => "Disabled",
            null => "Unknown"
        };

        var confirmed = new List<InvestigationFinding>
        {
            new(
                FindingCategory.ConfirmedObservation,
                $"Processor: {hw.Cpu.Name}",
                $"Cores: {hw.Cpu.PhysicalCores} | Threads: {hw.Cpu.LogicalProcessors} | Max Clock: {hw.Cpu.MaxClockSpeedMHz} MHz | Socket: {hw.Cpu.Socket} | L2/L3 Cache: {hw.Cpu.L2CacheKB} KB / {hw.Cpu.L3CacheKB} KB.",
                "Win32_Processor",
                "Confirmed (Live Telemetry)",
                "Normal"),
            new(
                FindingCategory.ConfirmedObservation,
                $"Motherboard & BIOS: {hw.Motherboard.Manufacturer} {hw.Motherboard.Product}",
                $"BIOS: {hw.Motherboard.BiosVendor} {hw.Motherboard.BiosVersion} ({hw.Motherboard.BiosReleaseDate}) | Secure Boot: {secureBootText}.",
                "Win32_BaseBoard / Win32_BIOS",
                "Confirmed (Live Telemetry)",
                "Normal"),
            new(
                FindingCategory.ConfirmedObservation,
                $"Memory Configuration: {hw.Memory.TotalPhysicalBytes / (1024.0 * 1024 * 1024):F1} GB Total ({hw.Memory.PopulatedSlots}/{hw.Memory.TotalSlots} Slots Populated)",
                hw.Memory.Modules.Count > 0
                    ? string.Join(" | ", hw.Memory.Modules.Select(m => $"{m.BankLocator}: {m.CapacityBytes / (1024.0 * 1024 * 1024):F0} GB {m.MemoryType} @ {m.SpeedMHz} MHz ({m.Manufacturer} {m.PartNumber})"))
                    : "SMBIOS DIMM slot details not reported by firmware.",
                "Win32_PhysicalMemory",
                "Confirmed (Live Telemetry)",
                "Normal")
        };

        foreach (var gpu in hw.Gpus)
        {
            confirmed.Add(new InvestigationFinding(
                FindingCategory.ConfirmedObservation,
                $"Graphics Adapter: {gpu.Name}",
                $"VRAM: {gpu.DedicatedMemoryBytes / (1024.0 * 1024 * 1024.0):F1} GB | Driver: {gpu.DriverVersion} ({gpu.DriverDate}) | Mode: {gpu.ResolutionAndRefreshRate} | Processor: {gpu.VideoProcessor}.",
                "Win32_VideoController / Registry",
                "Confirmed (Live Telemetry)",
                "Normal"));
        }

        var causes = new List<InvestigationFinding>();
        var unsignedDrivers = hw.TopDrivers.Where(d => !d.IsSigned).ToList();
        if (unsignedDrivers.Count > 0)
        {
            causes.Add(new InvestigationFinding(
                FindingCategory.PotentialCause,
                $"{unsignedDrivers.Count} Unsigned Driver Package(s) Detected",
                $"Unsigned drivers: {string.Join(", ", unsignedDrivers.Take(5).Select(d => $"{d.DeviceName} ({d.DriverVersion})"))}.",
                "Win32_PnPSignedDriver",
                "Confirmed",
                "Medium"));
        }

        var hypotheses = new List<InvestigationFinding>
        {
            new(
                FindingCategory.UnverifiedHypothesis,
                "Hardware Voltage, Fan RPM, and Die Temperature Sensors",
                "Direct Super I/O and MSR hardware sensor polling requires an elevated signed kernel driver, which Groundwork intentionally avoids to protect system stability and HVCI/Core Isolation compatibility.",
                "Kernel Driver Policy",
                "By Design",
                "Info")
        };

        return new InvestigationReport(
            ReportId: $"inv-hw-{Guid.NewGuid():N}",
            InvestigationType: InvestigationType.Hardware,
            Title: "Hardware Topology, Firmware & Driver Investigation",
            UserQuery: string.IsNullOrWhiteSpace(userQuery) ? "Inspect hardware configuration and driver health." : userQuery,
            ExecutiveSummary: $"CPU: {hw.Cpu.Name}, RAM: {hw.Memory.TotalPhysicalBytes / (1024.0 * 1024 * 1024):F1} GB ({hw.Memory.PopulatedSlots} DIMMs), GPUs: {hw.Gpus.Count}, Disks: {hw.Disks.Count}.",
            ExecutedTools: [hwCall.ToolName],
            ConfirmedObservations: confirmed,
            PotentialCauses: causes,
            UnverifiedHypotheses: hypotheses,
            RecommendedActions: [],
            ToolResults: [hwCall],
            StartedAtUtc: startedAt,
            CompletedAtUtc: DateTimeOffset.UtcNow);
    }

    private async Task<InvestigationReport> RunCustomInvestigationAsync(
        DateTimeOffset startedAt,
        string userQuery,
        CancellationToken ct)
    {
        var inferred = InferInvestigationTypeFromQuery(userQuery);
        if (inferred != InvestigationType.Custom)
        {
            var specific = await RunInvestigationAsync(inferred, userQuery, ct).ConfigureAwait(false);
            return specific with { InvestigationType = InvestigationType.Custom };
        }

        // General multi-subsystem diagnostic pass
        var healthReport = await RunWindowsHealthInvestigationAsync(startedAt, userQuery, ct).ConfigureAwait(false);
        return healthReport with
        {
            InvestigationType = InvestigationType.Custom,
            Title = $"Custom Investigation: {userQuery}"
        };
    }

    // =========================================================================
    // REPORT EXPORT (MARKDOWN / TEXT / JSON)
    // =========================================================================

    public static string ExportToMarkdown(InvestigationReport report)
    {
        ArgumentNullException.ThrowIfNull(report);
        var sb = new StringBuilder();
        sb.AppendLine($"# {report.Title}");
        sb.AppendLine();
        sb.AppendLine($"- **Report ID**: `{report.ReportId}`");
        sb.AppendLine($"- **Investigation Type**: `{report.InvestigationType}`");
        sb.AppendLine($"- **Completed At**: {report.CompletedAtDisplay} ({report.DurationSeconds:F2}s)");
        sb.AppendLine($"- **User Request**: {report.UserQuery}");
        sb.AppendLine($"- **Tools Executed**: {string.Join(", ", report.ExecutedTools.Select(t => $"`{t}`"))}");
        sb.AppendLine();
        sb.AppendLine("## Executive Summary");
        sb.AppendLine(report.ExecutiveSummary);
        sb.AppendLine();

        sb.AppendLine("## 1. Confirmed Observations (Live Telemetry)");
        if (report.ConfirmedObservations.Count == 0)
        {
            sb.AppendLine("_No observations recorded._");
        }
        else
        {
            foreach (var f in report.ConfirmedObservations)
            {
                sb.AppendLine($"- **{f.Title}** [{f.Severity}]");
                sb.AppendLine($"  - {f.Detail}");
                sb.AppendLine($"  - *Source*: `{f.EvidenceSource}` | *Confidence*: {f.ConfidenceLevel}");
            }
        }
        sb.AppendLine();

        sb.AppendLine("## 2. Potential Contributing Factors");
        if (report.PotentialCauses.Count == 0)
        {
            sb.AppendLine("_No abnormal contributing factors identified._");
        }
        else
        {
            foreach (var f in report.PotentialCauses)
            {
                sb.AppendLine($"- **{f.Title}** [{f.Severity}]");
                sb.AppendLine($"  - {f.Detail}");
                sb.AppendLine($"  - *Evidence*: `{f.EvidenceSource}` | *Confidence*: {f.ConfidenceLevel}");
            }
        }
        sb.AppendLine();

        sb.AppendLine("## 3. Unverified Hypotheses & Sensor Boundaries");
        foreach (var f in report.UnverifiedHypotheses)
        {
            sb.AppendLine($"- **{f.Title}**: {f.Detail} (*{f.ConfidenceLevel}*)");
        }
        sb.AppendLine();

        sb.AppendLine("## 4. Recommended Actions");
        if (report.RecommendedActions.Count == 0)
        {
            sb.AppendLine("_No system modifications needed._");
        }
        else
        {
            foreach (var r in report.RecommendedActions)
            {
                sb.AppendLine($"- **{r.Title}** ({r.SafetyBadge})");
                sb.AppendLine($"  - {r.Explanation}");
            }
        }

        return sb.ToString();
    }

    public static string ExportToText(InvestigationReport report)
    {
        ArgumentNullException.ThrowIfNull(report);
        return ExportToMarkdown(report)
            .Replace("# ", "")
            .Replace("## ", "")
            .Replace("**", "")
            .Replace("`", "");
    }

    public static string ExportToJson(InvestigationReport report)
    {
        ArgumentNullException.ThrowIfNull(report);
        return JsonSerializer.Serialize(report, PrettyJsonOptions);
    }
}
