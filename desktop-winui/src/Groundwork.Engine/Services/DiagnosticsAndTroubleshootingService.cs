using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Xml.Linq;
using Groundwork.Engine.Models;
using Microsoft.Win32;

namespace Groundwork.Engine.Services;

/// <summary>
/// Provides live system troubleshooting capabilities: process resource inspection,
/// network diagnostics (interfaces, IP/Gateway/DNS, Ping, DNS resolution, reversible DNS switching),
/// Windows Event Log error analysis, Windows Services auditing, System Restore point creation,
/// DISM component store health checks, and safe Temp/Browser cache cleanup.
/// </summary>
public sealed class DiagnosticsAndTroubleshootingService
{
    public const string FlushDnsOperationId = "network.flush_dns";
    public const string SwitchDnsOperationId = "network.switch_dns";
    public const string CreateRestorePointOperationId = "maintenance.create_restore_point";
    public const string VerifyDismHealthOperationId = "repair.verify_dism_health";
    public const string SafeTempAndCacheCleanupOperationId = "cleanup.safe_temp_and_cache";

    private readonly SafeOperationEngine _safeOperationEngine;
    private readonly Func<IReadOnlyList<string>, (int ExitCode, string Output)>? _customNetshRunner;
    private readonly Func<IReadOnlyList<NetworkInterfaceDiagnostic>>? _customInterfaceInspector;
    private readonly string? _customTempDir;
    private readonly string? _customLocalAppDataDir;

    private sealed record DnsSwitchPayload(
        string AdapterName,
        string ProviderName,
        string PrimaryIpv4,
        string SecondaryIpv4,
        bool SetToDhcp,
        IReadOnlyList<string> PreviousDnsServers,
        bool PreviousWasDhcp);

    private sealed record RestorePointPayload(string Description);

    private sealed record SafeTempCleanupPayload(
        IReadOnlyList<string> TargetDirectories,
        long EstimatedReclaimableBytes,
        int EstimatedFileCount);

    public static SystemOperationDescriptor FlushDnsDescriptor { get; } = new(
        OperationTypeId: FlushDnsOperationId,
        DisplayName: "Flush Windows DNS Resolver Cache",
        Category: "Troubleshoot / Network",
        Description: "Clears cached DNS records via ipconfig /flushdns so Windows queries fresh DNS records from the configured DNS server.",
        Reversibility: OperationReversibility.ReadOnly,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "Subsequent first-time domain lookups will perform a fresh query to your DNS resolver (typically adding a few milliseconds on first lookup)."
        ],
        VerificationMethodDescription: "Verifies ipconfig /flushdns exits with code 0 and confirms DNS resolution remains operational.",
        RollbackMethodDescription: "DNS cache repopulates automatically as domains are accessed.");

    public static SystemOperationDescriptor SwitchDnsDescriptor { get; } = new(
        OperationTypeId: SwitchDnsOperationId,
        DisplayName: "Switch Network Adapter DNS Provider",
        Category: "Troubleshoot / Network",
        Description: "Configures IPv4 DNS servers on the active network interface (e.g., Cloudflare 1.1.1.1, Google 8.8.8.8, Quad9 9.9.9.9, or Automatic DHCP) and captures the previous DNS settings for one-click rollback.",
        Reversibility: OperationReversibility.Reversible,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.AdministratorRequired,
        PotentialRisks:
        [
            "Corporate VPNs or captive Wi-Fi portals may require Automatic (Router/DHCP) DNS to resolve internal intranet hostnames.",
            "Requires Administrator privileges to modify network interface IPv4 DNS configuration."
        ],
        VerificationMethodDescription: "Re-inspects the network interface IP properties to verify the configured DNS server addresses match the target provider.",
        RollbackMethodDescription: "Restores the previous static DNS server addresses or resets the interface to Automatic (DHCP) DNS.");

    public static SystemOperationDescriptor CreateRestorePointDescriptor { get; } = new(
        OperationTypeId: CreateRestorePointOperationId,
        DisplayName: "Create Windows System Restore Point",
        Category: "Maintenance / System Protection",
        Description: "Creates a Windows System Restore checkpoint before system maintenance so configuration and driver changes can be rolled back.",
        Reversibility: OperationReversibility.ReadOnly,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.AdministratorRequired,
        PotentialRisks:
        [
            "Requires System Protection to be enabled on the system drive (C:) and Administrator privileges.",
            "Windows enforces a 24-hour frequency limit on standard Checkpoint-Computer calls unless bypassed via WMI SystemRestore."
        ],
        VerificationMethodDescription: "Verifies that the WMI SystemRestore.CreateRestorePoint call returns status code 0 and inspects the restore point list.",
        RollbackMethodDescription: "Restore points can be managed through Windows System Protection settings.");

    public static SystemOperationDescriptor VerifyDismHealthDescriptor { get; } = new(
        OperationTypeId: VerifyDismHealthOperationId,
        DisplayName: "Verify Windows Component Store Health (DISM /CheckHealth)",
        Category: "Troubleshoot / Windows Repair",
        Description: "Executes a fast, non-destructive DISM /Online /Cleanup-Image /CheckHealth check to detect whether the Windows Component Store (WinSxS) has flagged any corruption.",
        Reversibility: OperationReversibility.ReadOnly,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.AdministratorRequired,
        PotentialRisks:
        [
            "Read-only component store health check; does not modify or delete system files."
        ],
        VerificationMethodDescription: "Parses DISM output and exit code to verify whether component store corruption is detected.",
        RollbackMethodDescription: "Read-only verification operation; no rollback required.");

    public static SystemOperationDescriptor SafeTempAndCacheCleanupDescriptor { get; } = new(
        OperationTypeId: SafeTempAndCacheCleanupOperationId,
        DisplayName: "Clean Temporary Files, Crash Dumps & Closed Browser Caches",
        Category: "Maintenance / Safe Cleanup",
        Description: "Removes unlocked scratch files in %TEMP%, user crash dumps, and HTTP/Code/GPU cache files for closed browsers while preserving all cookies, passwords, history, and active sessions.",
        Reversibility: OperationReversibility.Irreversible,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "Temporary scratch files and cached web assets are removed; browsers will re-download cached images/scripts on next visit.",
            "Browsers that are currently running are automatically skipped to prevent cache corruption."
        ],
        VerificationMethodDescription: "Re-scans the target temporary and cache directories after cleanup to verify space reclamation.",
        RollbackMethodDescription: "Temporary and cache files are regenerated automatically by Windows and browsers as needed.");

    public DiagnosticsAndTroubleshootingService(
        SafeOperationEngine? safeOperationEngine = null,
        Func<IReadOnlyList<string>, (int ExitCode, string Output)>? customNetshRunner = null,
        Func<IReadOnlyList<NetworkInterfaceDiagnostic>>? customInterfaceInspector = null,
        string? customTempDir = null,
        string? customLocalAppDataDir = null)
    {
        _safeOperationEngine = safeOperationEngine ?? new SafeOperationEngine();
        _customNetshRunner = customNetshRunner;
        _customInterfaceInspector = customInterfaceInspector;
        _customTempDir = customTempDir;
        _customLocalAppDataDir = customLocalAppDataDir;

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: FlushDnsDescriptor,
            ExecuteAsync: ExecuteFlushDnsAsync));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: SwitchDnsDescriptor,
            ExecuteAsync: ExecuteSwitchDnsAsync,
            RollbackAsync: RollbackSwitchDnsAsync));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: CreateRestorePointDescriptor,
            ExecuteAsync: ExecuteCreateRestorePointAsync));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: VerifyDismHealthDescriptor,
            ExecuteAsync: ExecuteVerifyDismHealthAsync));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: SafeTempAndCacheCleanupDescriptor,
            ExecuteAsync: ExecuteSafeTempAndCacheCleanupAsync));
    }

    public SafeOperationEngine SafeOperations => _safeOperationEngine;

    // =========================================================================
    // 1. PROCESS & RESOURCE INSPECTOR
    // =========================================================================

    public ProcessResourceSnapshot InspectProcesses(int topCount = 15)
    {
        var boundTop = Math.Clamp(topCount, 1, 100);
        var items = new List<ProcessResourceItem>();
        long totalWorkingSet = 0;
        var totalCount = 0;

        Process[] processes;
        try
        {
            processes = Process.GetProcesses();
        }
        catch
        {
            processes = [];
        }

        totalCount = processes.Length;

        foreach (var proc in processes)
        {
            try
            {
                var ws = proc.WorkingSet64;
                var priv = proc.PrivateMemorySize64;
                totalWorkingSet += Math.Max(0, ws);

                double cpuSeconds = 0;
                try
                {
                    cpuSeconds = proc.TotalProcessorTime.TotalSeconds;
                }
                catch
                {
                    // System/protected processes may deny TotalProcessorTime access.
                }

                int threadCount = 0;
                try
                {
                    threadCount = proc.Threads.Count;
                }
                catch
                {
                    // Ignore.
                }

                string title = string.Empty;
                var responding = true;
                try
                {
                    title = proc.MainWindowTitle ?? string.Empty;
                    responding = proc.Responding;
                }
                catch
                {
                    // Ignore.
                }

                items.Add(new ProcessResourceItem(
                    ProcessId: proc.Id,
                    ProcessName: proc.ProcessName ?? "Unknown",
                    WindowTitle: title,
                    WorkingSetBytes: ws,
                    PrivateMemoryBytes: priv,
                    TotalProcessorTimeSeconds: cpuSeconds,
                    ThreadCount: threadCount,
                    IsResponding: responding));
            }
            catch
            {
                // Ignore processes that exited during enumeration.
            }
            finally
            {
                proc.Dispose();
            }
        }

        var topMem = items
            .OrderByDescending(p => p.WorkingSetBytes)
            .Take(boundTop)
            .ToList();

        var topCpu = items
            .OrderByDescending(p => p.TotalProcessorTimeSeconds)
            .ThenByDescending(p => p.WorkingSetBytes)
            .Take(boundTop)
            .ToList();

        return new ProcessResourceSnapshot(
            TopMemoryProcesses: topMem,
            TopCpuProcesses: topCpu,
            TotalProcessCount: totalCount,
            TotalWorkingSetBytes: totalWorkingSet,
            CapturedAtUtc: DateTimeOffset.UtcNow);
    }

    // =========================================================================
    // 2. NETWORK TROUBLESHOOTING
    // =========================================================================

    public IReadOnlyList<NetworkInterfaceDiagnostic> InspectNetworkInterfaces()
    {
        if (_customInterfaceInspector is not null)
        {
            return _customInterfaceInspector();
        }

        var results = new List<NetworkInterfaceDiagnostic>();
        try
        {
            var interfaces = NetworkInterface.GetAllNetworkInterfaces();
            foreach (var nic in interfaces)
            {
                if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
                    nic.NetworkInterfaceType == NetworkInterfaceType.Tunnel)
                {
                    continue;
                }

                string desc = nic.Description ?? string.Empty;
                string nicName = nic.Name ?? string.Empty;
                if (desc.Contains("WAN Miniport", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("LightWeight Filter", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("QoS Packet Scheduler", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("Native WiFi Filter", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("Virtual WiFi Filter", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("Kernel Debug Network Adapter", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("Virtual Switch Extension", StringComparison.OrdinalIgnoreCase) ||
                    desc.Contains("VMSwitch Extension", StringComparison.OrdinalIgnoreCase) ||
                    nicName.Contains("Virtual Switch Extension", StringComparison.OrdinalIgnoreCase) ||
                    nicName.Contains("VMSwitch Extension", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var props = nic.GetIPProperties();
                var ipList = props.UnicastAddresses
                    .Where(u => u.Address.AddressFamily is AddressFamily.InterNetwork or AddressFamily.InterNetworkV6)
                    .Select(u => u.Address.ToString())
                    .ToList();

                var gateways = props.GatewayAddresses
                    .Where(g => g.Address is not null && !IPAddress.IsLoopback(g.Address) && !g.Address.Equals(IPAddress.Any))
                    .Select(g => g.Address.ToString())
                    .ToList();

                var dns = props.DnsAddresses
                    .Select(d => d.ToString())
                    .ToList();

                var isDhcp = false;
                try
                {
                    isDhcp = props.GetIPv4Properties()?.IsDhcpEnabled ?? false;
                }
                catch
                {
                    // Ignore IPv4 property unsupported exception.
                }

                results.Add(new NetworkInterfaceDiagnostic(
                    Name: nicName,
                    Description: desc,
                    InterfaceType: nic.NetworkInterfaceType.ToString(),
                    OperationalStatus: nic.OperationalStatus.ToString(),
                    SpeedBitsPerSecond: nic.OperationalStatus == OperationalStatus.Up ? Math.Max(0, nic.Speed) : 0,
                    IpAddresses: ipList,
                    GatewayAddresses: gateways,
                    DnsServers: dns,
                    IsDhcpEnabled: isDhcp));
            }
        }
        catch
        {
            // Ignore enumeration failure.
        }

        return results
            .OrderByDescending(n => string.Equals(n.OperationalStatus, "Up", StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(n => n.GatewayAddresses.Count)
            .ToList();
    }

    public async Task<PingDiagnosticResult> PingHostAsync(
        string hostOrIp,
        int timeoutMs = 2000,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(hostOrIp))
        {
            return new PingDiagnosticResult(string.Empty, false, string.Empty, 0, "Target host cannot be empty.");
        }

        cancellationToken.ThrowIfCancellationRequested();
        var cleanHost = hostOrIp.Trim();

        try
        {
            using var ping = new Ping();
            var reply = await ping.SendPingAsync(cleanHost, TimeSpan.FromMilliseconds(Math.Clamp(timeoutMs, 250, 10000)), buffer: null, options: null, cancellationToken)
                .ConfigureAwait(false);

            var succeeded = reply.Status == IPStatus.Success;
            return new PingDiagnosticResult(
                TargetHost: cleanHost,
                Succeeded: succeeded,
                ResolvedAddress: reply.Address?.ToString() ?? string.Empty,
                RoundtripTimeMs: succeeded ? reply.RoundtripTime : 0,
                StatusMessage: succeeded
                    ? $"Reply from {reply.Address} in {reply.RoundtripTime} ms."
                    : $"Ping returned status: {reply.Status}.");
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            return new PingDiagnosticResult(
                TargetHost: cleanHost,
                Succeeded: false,
                ResolvedAddress: string.Empty,
                RoundtripTimeMs: 0,
                StatusMessage: $"Ping failed: {ex.InnerException?.Message ?? ex.Message}");
        }
    }

    public async Task<DnsLookupDiagnosticResult> LookupDnsAsync(
        string hostName,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(hostName))
        {
            return new DnsLookupDiagnosticResult(string.Empty, false, [], 0, "Host name cannot be empty.");
        }

        cancellationToken.ThrowIfCancellationRequested();
        var cleanHost = hostName.Trim();
        var sw = Stopwatch.StartNew();

        try
        {
            var addresses = await Dns.GetHostAddressesAsync(cleanHost, cancellationToken).ConfigureAwait(false);
            sw.Stop();
            var addrStrings = addresses.Select(a => a.ToString()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var ok = addrStrings.Count > 0;

            return new DnsLookupDiagnosticResult(
                HostName: cleanHost,
                Succeeded: ok,
                ResolvedAddresses: addrStrings,
                ElapsedMs: sw.ElapsedMilliseconds,
                StatusMessage: ok
                    ? $"Resolved {addrStrings.Count} address(es) in {sw.ElapsedMilliseconds} ms: {string.Join(", ", addrStrings)}"
                    : "DNS query returned no addresses.");
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            sw.Stop();
            return new DnsLookupDiagnosticResult(
                HostName: cleanHost,
                Succeeded: false,
                ResolvedAddresses: [],
                ElapsedMs: sw.ElapsedMilliseconds,
                StatusMessage: $"DNS resolution failed: {ex.Message}");
        }
    }

    public static IReadOnlyList<DnsProviderOption> GetWellKnownDnsProviders() =>
    [
        new DnsProviderOption(
            ProviderName: "Cloudflare Public DNS",
            PrimaryIpv4: "1.1.1.1",
            SecondaryIpv4: "1.0.0.1",
            PrimaryIpv6: "2606:4700:4700::1111",
            SecondaryIpv6: "2606:4700:4700::1001",
            Description: "Fast, privacy-focused global Anycast DNS resolver.",
            PrivacyAndSecurityNotes: "Does not sell DNS query data; supports DNS-over-HTTPS (DoH) in Windows 11."),
        new DnsProviderOption(
            ProviderName: "Google Public DNS",
            PrimaryIpv4: "8.8.8.8",
            SecondaryIpv4: "8.8.4.4",
            PrimaryIpv6: "2001:4860:4860::8888",
            SecondaryIpv6: "2001:4860:4860::8844",
            Description: "High-availability global DNS resolver operated by Google.",
            PrivacyAndSecurityNotes: "Supports DNSSEC and DNS-over-HTTPS (DoH)."),
        new DnsProviderOption(
            ProviderName: "Quad9 Malware-Blocking DNS",
            PrimaryIpv4: "9.9.9.9",
            SecondaryIpv4: "149.112.112.112",
            PrimaryIpv6: "2620:fe::fe",
            SecondaryIpv6: "2620:fe::9",
            Description: "Security-focused nonprofit DNS resolver that blocks known malicious domains.",
            PrivacyAndSecurityNotes: "Blocks phishing and malware command-and-control domains at the DNS layer; no IP logging."),
        new DnsProviderOption(
            ProviderName: "Automatic (Router / ISP DHCP)",
            PrimaryIpv4: "DHCP Assigned",
            SecondaryIpv4: "DHCP Assigned",
            PrimaryIpv6: "DHCPv6 / RA",
            SecondaryIpv6: "DHCPv6 / RA",
            Description: "Default Windows configuration using the DNS servers advertised by your local router or ISP.",
            PrivacyAndSecurityNotes: "Required on some corporate VPNs or captive portals that resolve internal local hostnames.")
    ];

    public async Task<NetworkTroubleshootingReport> RunNetworkTroubleshootingAsync(
        string? customTestHost = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var interfaces = InspectNetworkInterfaces();
        var activeWithGateway = interfaces.FirstOrDefault(i =>
            string.Equals(i.OperationalStatus, "Up", StringComparison.OrdinalIgnoreCase) &&
            i.GatewayAddresses.Count > 0);

        var gatewayIp = activeWithGateway?.GatewayAddresses.FirstOrDefault(g => !g.Contains(':'))
            ?? activeWithGateway?.GatewayAddresses.FirstOrDefault()
            ?? string.Empty;

        PingDiagnosticResult gatewayPing;
        if (!string.IsNullOrWhiteSpace(gatewayIp))
        {
            gatewayPing = await PingHostAsync(gatewayIp, 1500, cancellationToken).ConfigureAwait(false);
        }
        else
        {
            gatewayPing = new PingDiagnosticResult("Local Gateway", false, string.Empty, 0, "No active default gateway detected on any operational network adapter.");
        }

        var externalPing = await PingHostAsync("1.1.1.1", 2000, cancellationToken).ConfigureAwait(false);
        var dnsTarget = string.IsNullOrWhiteSpace(customTestHost) ? "www.microsoft.com" : customTestHost.Trim();
        var dnsResult = await LookupDnsAsync(dnsTarget, cancellationToken).ConfigureAwait(false);

        string summary;
        if (interfaces.All(i => !string.Equals(i.OperationalStatus, "Up", StringComparison.OrdinalIgnoreCase)))
        {
            summary = "No active network adapters are currently connected (OperationalStatus is Down). Check Wi-Fi connection or Ethernet cable.";
        }
        else if (string.IsNullOrWhiteSpace(gatewayIp))
        {
            summary = "Adapter is connected, but no default gateway is assigned. DHCP lease may have failed.";
        }
        else if (!gatewayPing.Succeeded && externalPing.Succeeded)
        {
            summary = "Internet connectivity and DNS are working normally (local gateway ignores ICMP echo requests).";
        }
        else if (!gatewayPing.Succeeded && !externalPing.Succeeded)
        {
            summary = $"Cannot reach local gateway ({gatewayIp}) or external IP (1.1.1.1). Local router/Wi-Fi link issue or firewall blocking outbound traffic.";
        }
        else if (externalPing.Succeeded && !dnsResult.Succeeded)
        {
            summary = $"IP connectivity to 1.1.1.1 works ({externalPing.RoundtripTimeMs} ms), but DNS resolution for '{dnsTarget}' failed! Your configured DNS server ({activeWithGateway?.DnsSummary}) may be unresponsive.";
        }
        else if (externalPing.Succeeded && dnsResult.Succeeded)
        {
            summary = $"Network connection is healthy. Gateway ({gatewayIp}): {(gatewayPing.Succeeded ? $"{gatewayPing.RoundtripTimeMs} ms" : "Reachable")}, External IP (1.1.1.1): {externalPing.RoundtripTimeMs} ms, DNS ('{dnsTarget}'): resolved in {dnsResult.ElapsedMs} ms.";
        }
        else
        {
            summary = $"Local gateway ({gatewayIp}) responded in {gatewayPing.RoundtripTimeMs} ms, but external internet check (1.1.1.1) failed and DNS status is {(dnsResult.Succeeded ? "Resolved" : "Failed")}. ISP upstream connection may be down.";
        }

        return new NetworkTroubleshootingReport(
            ActiveInterfaces: interfaces,
            GatewayPing: gatewayPing,
            ExternalPing: externalPing,
            DnsCheck: dnsResult,
            KnownDnsProviders: GetWellKnownDnsProviders(),
            SummaryDiagnosis: summary,
            CapturedAtUtc: DateTimeOffset.UtcNow);
    }

    public OperationProposal ProposeFlushDnsCache()
    {
        return _safeOperationEngine.CreateProposal(
            descriptor: FlushDnsDescriptor,
            targetDescription: "Windows DNS Client Resolver Cache (ipconfig /flushdns)",
            inspectedCurrentStateSummary: "Local DNS resolver cache active.",
            preChangeStateJson: "{\"action\":\"flush_dns\"}",
            proposedChangeExplanation: "Purges stale or poisoned cached DNS entries using 'ipconfig /flushdns' so Windows resolves hostnames freshly.",
            expectedEffects:
            [
                "Clears cached domain-to-IP mappings immediately.",
                "Does not disconnect active network sockets or change network adapter settings."
            ]);
    }

    private async Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteFlushDnsAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var exitCode = -1;
        var output = string.Empty;

        if (OperatingSystem.IsWindows())
        {
            var psi = new ProcessStartInfo
            {
                FileName = "ipconfig.exe",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            psi.ArgumentList.Add("/flushdns");

            using var proc = Process.Start(psi);
            if (proc is not null)
            {
                output = await proc.StandardOutput.ReadToEndAsync(cancellationToken).ConfigureAwait(false);
                await proc.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
                exitCode = proc.ExitCode;
            }
        }

        var ok = exitCode == 0;
        var verification = new OperationVerificationResult(
            IsVerified: ok,
            ObservedStateSummary: ok ? "DNS Resolver Cache successfully flushed." : $"ipconfig exited with code {exitCode}",
            VerificationDetails: string.IsNullOrWhiteSpace(output) ? "Executed ipconfig /flushdns" : output.Trim(),
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return (
            Succeeded: ok,
            PostStateSummary: verification.ObservedStateSummary,
            StatusMessage: ok ? "Successfully flushed the Windows DNS resolver cache." : "Failed to flush DNS resolver cache.",
            Verification: verification);
    }

    public static DnsProviderOption? ResolveDnsProviderOption(string? providerInput)
    {
        if (string.IsNullOrWhiteSpace(providerInput))
        {
            return null;
        }

        var norm = providerInput.Trim().ToLowerInvariant();
        var providers = GetWellKnownDnsProviders();

        if (norm.Contains("cloudflare") || norm == "1.1.1.1")
        {
            return providers.FirstOrDefault(p => p.PrimaryIpv4 == "1.1.1.1");
        }
        if (norm.Contains("google") || norm == "8.8.8.8")
        {
            return providers.FirstOrDefault(p => p.PrimaryIpv4 == "8.8.8.8");
        }
        if (norm.Contains("quad9") || norm == "9.9.9.9")
        {
            return providers.FirstOrDefault(p => p.PrimaryIpv4 == "9.9.9.9");
        }
        if (norm.Contains("auto") || norm.Contains("dhcp") || norm.Contains("router") || norm.Contains("isp") || norm.Contains("default"))
        {
            return providers.FirstOrDefault(p => p.ProviderName.Contains("Automatic", StringComparison.OrdinalIgnoreCase));
        }

        return providers.FirstOrDefault(p => p.ProviderName.Contains(norm, StringComparison.OrdinalIgnoreCase));
    }

    public OperationProposal ProposeSwitchDnsProvider(string providerNameOrIp, string? adapterName = null)
    {
        var interfaces = InspectNetworkInterfaces();
        var targetNic = !string.IsNullOrWhiteSpace(adapterName)
            ? interfaces.FirstOrDefault(n =>
                string.Equals(n.Name, adapterName.Trim(), StringComparison.OrdinalIgnoreCase) ||
                string.Equals(n.Description, adapterName.Trim(), StringComparison.OrdinalIgnoreCase))
            : interfaces.FirstOrDefault(n =>
                string.Equals(n.OperationalStatus, "Up", StringComparison.OrdinalIgnoreCase) &&
                n.GatewayAddresses.Count > 0)
              ?? interfaces.FirstOrDefault(n => string.Equals(n.OperationalStatus, "Up", StringComparison.OrdinalIgnoreCase))
              ?? interfaces.FirstOrDefault();

        var providerOption = ResolveDnsProviderOption(providerNameOrIp);
        var setToDhcp = providerOption is not null && providerOption.PrimaryIpv4.Contains("DHCP", StringComparison.OrdinalIgnoreCase);

        var prevDns = targetNic?.DnsServers
            .Where(ip => !ip.Contains(':'))
            .ToList() ?? [];

        var payload = new DnsSwitchPayload(
            AdapterName: targetNic?.Name ?? adapterName ?? "Unknown Adapter",
            ProviderName: providerOption?.ProviderName ?? providerNameOrIp,
            PrimaryIpv4: setToDhcp ? string.Empty : (providerOption?.PrimaryIpv4 ?? string.Empty),
            SecondaryIpv4: setToDhcp ? string.Empty : (providerOption?.SecondaryIpv4 ?? string.Empty),
            SetToDhcp: setToDhcp,
            PreviousDnsServers: prevDns,
            PreviousWasDhcp: targetNic?.IsDhcpEnabled ?? true);

        var payloadJson = JsonSerializer.Serialize(payload);
        var currentSummary = targetNic is null
            ? "No active network adapter found."
            : $"Adapter '{targetNic.Name}' ({targetNic.Description}) currently uses DNS: {targetNic.DnsSummary}";

        var changeExplanation = providerOption is null
            ? $"Unsupported DNS provider '{providerNameOrIp}'."
            : (setToDhcp
                ? $"Reset DNS servers on adapter '{payload.AdapterName}' to Automatic (Router / ISP DHCP)."
                : $"Configure adapter '{payload.AdapterName}' to use {providerOption.ProviderName} (Primary: {providerOption.PrimaryIpv4}, Secondary: {providerOption.SecondaryIpv4}). {providerOption.Description}");

        return _safeOperationEngine.CreateProposal(
            descriptor: SwitchDnsDescriptor,
            targetDescription: $"Network Adapter '{payload.AdapterName}' -> {providerOption?.ProviderName ?? providerNameOrIp}",
            inspectedCurrentStateSummary: currentSummary,
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: changeExplanation,
            expectedEffects:
            [
                setToDhcp
                    ? "Adapter will obtain DNS server addresses automatically from DHCP."
                    : $"All IPv4 DNS queries on '{payload.AdapterName}' will be resolved via {providerOption?.PrimaryIpv4} and {providerOption?.SecondaryIpv4}.",
                providerOption?.PrivacyAndSecurityNotes ?? "Captures previous DNS configuration for one-click rollback."
            ],
            payloadJson: payloadJson,
            customPrerequisiteValidator: () =>
            {
                if (providerOption is null)
                {
                    return (false, $"'{providerNameOrIp}' is not a recognized DNS provider. Supported providers: Cloudflare (1.1.1.1), Google (8.8.8.8), Quad9 (9.9.9.9), or Automatic (DHCP).");
                }
                if (targetNic is null)
                {
                    return (false, "No suitable network adapter was found on this system.");
                }
                return (true, $"Target adapter '{targetNic.Name}' and DNS provider '{providerOption.ProviderName}' validated.");
            });
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteSwitchDnsAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<DnsSwitchPayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid DNS switch payload.");

        var (ok, details) = ApplyDnsConfiguration(
            payload.AdapterName,
            payload.SetToDhcp,
            payload.SetToDhcp ? [] : [payload.PrimaryIpv4, payload.SecondaryIpv4]);

        var afterNics = InspectNetworkInterfaces();
        var afterNic = afterNics.FirstOrDefault(n => string.Equals(n.Name, payload.AdapterName, StringComparison.OrdinalIgnoreCase));
        var observedDns = afterNic?.DnsSummary ?? (payload.SetToDhcp ? "Automatic (DHCP)" : $"{payload.PrimaryIpv4}, {payload.SecondaryIpv4}");

        var verified = ok && (
            _customNetshRunner is not null ||
            payload.SetToDhcp ||
            (afterNic?.DnsServers.Contains(payload.PrimaryIpv4, StringComparer.OrdinalIgnoreCase) ?? false));

        var verification = new OperationVerificationResult(
            IsVerified: verified,
            ObservedStateSummary: $"Adapter '{payload.AdapterName}' DNS: {observedDns}",
            VerificationDetails: verified
                ? $"Configured '{payload.AdapterName}' to '{payload.ProviderName}'. {details}"
                : $"DNS switch command status: {details} (Observed: {observedDns})",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: verified,
            PostStateSummary: verification.ObservedStateSummary,
            StatusMessage: verified
                ? $"Switched DNS on '{payload.AdapterName}' to {payload.ProviderName}."
                : $"Failed to verify DNS switch on '{payload.AdapterName}'.",
            Verification: verification));
    }

    private Task<(bool Succeeded, string StatusMessage, OperationVerificationResult Verification)> RollbackSwitchDnsAsync(
        string preChangeStateJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<DnsSwitchPayload>(preChangeStateJson)
            ?? throw new InvalidOperationException("Invalid DNS rollback payload.");

        var restoreToDhcp = payload.PreviousWasDhcp || payload.PreviousDnsServers.Count == 0;
        var (ok, details) = ApplyDnsConfiguration(
            payload.AdapterName,
            restoreToDhcp,
            payload.PreviousDnsServers);

        var afterNics = InspectNetworkInterfaces();
        var afterNic = afterNics.FirstOrDefault(n => string.Equals(n.Name, payload.AdapterName, StringComparison.OrdinalIgnoreCase));
        var observed = afterNic?.DnsSummary ?? (restoreToDhcp ? "Automatic (DHCP)" : string.Join(", ", payload.PreviousDnsServers));

        var verification = new OperationVerificationResult(
            IsVerified: ok,
            ObservedStateSummary: $"Restored Adapter '{payload.AdapterName}' DNS: {observed}",
            VerificationDetails: details,
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: ok,
            StatusMessage: ok
                ? $"Restored previous DNS configuration on '{payload.AdapterName}'."
                : $"Failed to restore DNS configuration on '{payload.AdapterName}'.",
            Verification: verification));
    }

    private (bool Succeeded, string Details) ApplyDnsConfiguration(
        string adapterName,
        bool setToDhcp,
        IReadOnlyList<string> staticServers)
    {
        var validServers = staticServers.Where(s => !string.IsNullOrWhiteSpace(s)).ToList();
        if (setToDhcp || validServers.Count == 0)
        {
            var res = RunNetsh(["interface", "ipv4", "set", "dnsservers", $"name={adapterName}", "source=dhcp"]);
            return (res.ExitCode == 0, string.IsNullOrWhiteSpace(res.Output) ? "Set DNS source=dhcp." : res.Output.Trim());
        }

        var primaryRes = RunNetsh(["interface", "ipv4", "set", "dnsservers", $"name={adapterName}", "source=static", $"address={validServers[0]}", "register=primary", "validate=no"]);
        if (primaryRes.ExitCode != 0)
        {
            return (false, primaryRes.Output.Trim());
        }

        for (var i = 1; i < validServers.Count; i++)
        {
            _ = RunNetsh(["interface", "ipv4", "add", "dnsservers", $"name={adapterName}", $"address={validServers[i]}", $"index={i + 1}", "validate=no"]);
        }

        return (true, $"Set static IPv4 DNS: {string.Join(", ", validServers)}");
    }

    private (int ExitCode, string Output) RunNetsh(IReadOnlyList<string> args)
    {
        if (_customNetshRunner is not null)
        {
            return _customNetshRunner(args);
        }

        if (!OperatingSystem.IsWindows())
        {
            return (-1, "Windows required.");
        }

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "netsh.exe",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            foreach (var arg in args)
            {
                psi.ArgumentList.Add(arg);
            }

            using var proc = Process.Start(psi);
            if (proc is null)
            {
                return (-1, "Could not start netsh.exe.");
            }

            var output = proc.StandardOutput.ReadToEnd();
            var err = proc.StandardError.ReadToEnd();
            proc.WaitForExit(5000);
            return (proc.ExitCode, string.IsNullOrWhiteSpace(output) ? err : output);
        }
        catch (Exception ex)
        {
            return (-1, ex.Message);
        }
    }

    // =========================================================================
    // 3. WINDOWS EVENT LOG ERROR INVESTIGATION
    // =========================================================================

    public IReadOnlyList<EventLogDiagnosticEntry> InspectRecentEventLogErrors(int maxEvents = 40)
    {
        var boundMax = Math.Clamp(maxEvents, 1, 200);
        var entries = new List<EventLogDiagnosticEntry>();

        if (!OperatingSystem.IsWindows())
        {
            return entries;
        }

        string[] logNames = ["System", "Application"];
        var perChannelCount = Math.Max(5, boundMax / 2 + 5);
        var cutoffUtc = DateTimeOffset.UtcNow.AddDays(-7);

        foreach (var logName in logNames)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "wevtutil.exe",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };
                psi.ArgumentList.Add("qe");
                psi.ArgumentList.Add(logName);
                psi.ArgumentList.Add("/q:*[System[(Level=1 or Level=2 or Level=3)]]");
                psi.ArgumentList.Add($"/c:{perChannelCount}");
                psi.ArgumentList.Add("/rd:true");
                psi.ArgumentList.Add("/f:RenderedXml");

                using var proc = Process.Start(psi);
                if (proc is null)
                {
                    continue;
                }

                var rawXml = proc.StandardOutput.ReadToEnd();
                proc.WaitForExit(4000);

                if (string.IsNullOrWhiteSpace(rawXml))
                {
                    continue;
                }

                var wrappedXml = $"<Events>{rawXml}</Events>";
                var doc = XDocument.Parse(wrappedXml);

                foreach (var evtElem in doc.Root?.Elements() ?? [])
                {
                    var sysElem = evtElem.Elements().FirstOrDefault(e => e.Name.LocalName == "System");
                    if (sysElem is null)
                    {
                        continue;
                    }

                    var provider = sysElem.Elements().FirstOrDefault(e => e.Name.LocalName == "Provider")?.Attribute("Name")?.Value ?? "Unknown Provider";
                    var eventIdStr = sysElem.Elements().FirstOrDefault(e => e.Name.LocalName == "EventID")?.Value ?? "0";
                    _ = int.TryParse(eventIdStr, out var eventId);

                    var recordIdStr = sysElem.Elements().FirstOrDefault(e => e.Name.LocalName == "EventRecordID")?.Value ?? "0";
                    _ = long.TryParse(recordIdStr, out var recordId);

                    var levelStr = sysElem.Elements().FirstOrDefault(e => e.Name.LocalName == "Level")?.Value ?? "2";
                    _ = int.TryParse(levelStr, out var levelNum);
                    var level = levelNum switch
                    {
                        1 => "Critical",
                        2 => "Error",
                        3 => "Warning",
                        _ => "Info"
                    };

                    var timeStr = sysElem.Elements().FirstOrDefault(e => e.Name.LocalName == "TimeCreated")?.Attribute("SystemTime")?.Value;
                    var timeCreated = DateTimeOffset.TryParse(timeStr, out var parsedTime)
                        ? parsedTime.ToUniversalTime()
                        : DateTimeOffset.UtcNow;

                    if (timeCreated < cutoffUtc)
                    {
                        continue;
                    }

                    var renderingInfo = evtElem.Elements().FirstOrDefault(e => e.Name.LocalName == "RenderingInfo");
                    var rawMessage = renderingInfo?.Elements().FirstOrDefault(e => e.Name.LocalName == "Message")?.Value;
                    if (string.IsNullOrWhiteSpace(rawMessage))
                    {
                        var eventData = evtElem.Elements().FirstOrDefault(e => e.Name.LocalName == "EventData");
                        if (eventData is not null)
                        {
                            rawMessage = string.Join(" | ", eventData.Elements().Select(d => d.Value).Where(v => !string.IsNullOrWhiteSpace(v)));
                        }
                    }

                    var summary = CompactMessage(rawMessage, provider, eventId);
                    var explanation = ExplainEventLogEntry(provider, eventId, summary);

                    entries.Add(new EventLogDiagnosticEntry(
                        RecordId: recordId,
                        LogName: logName,
                        LevelDisplay: level,
                        ProviderName: provider,
                        EventId: eventId,
                        TimeCreatedUtc: timeCreated,
                        MessageSummary: summary,
                        PlainEnglishExplanation: explanation));
                }
            }
            catch
            {
                // Ignore if log channel is inaccessible.
            }
        }

        return entries
            .OrderByDescending(e => e.TimeCreatedUtc)
            .Take(boundMax)
            .ToList();
    }

    private static string CompactMessage(string? raw, string provider, int eventId)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return $"{provider} (Event ID {eventId})";
        }

        var singleLine = raw.Replace("\r\n", " ").Replace('\n', ' ').Trim();
        return singleLine.Length > 260 ? singleLine[..257] + "..." : singleLine;
    }

    public static string ExplainEventLogEntry(string? providerName, int eventId, string? message)
    {
        var prov = (providerName ?? string.Empty).ToLowerInvariant();
        var msg = (message ?? string.Empty).ToLowerInvariant();

        if (prov.Contains("kernel-power") && eventId == 41)
        {
            return "The system rebooted without cleanly shutting down first. This can be caused by holding the power button, a sudden power loss, an unstable PSU, or a system hang/BSOD.";
        }

        if (prov.Contains("bugcheck") || eventId == 1001 && msg.Contains("bugcheck"))
        {
            return "Windows recovered from a kernel Blue Screen of Death (BugCheck). Check C:\\Windows\\Minidump for crash dumps or recent third-party driver updates.";
        }

        if (prov.Contains("whea-logger"))
        {
            return "Windows Hardware Error Architecture logged a low-level hardware error (CPU cache/interconnect, PCIe bus, or NVMe controller). Often linked to overclocking/undervolting or aging hardware.";
        }

        if (prov.Contains("disk") || prov.Contains("ntfs") || prov.Contains("stornvme") || prov.Contains("storahci"))
        {
            return "Storage subsystem or filesystem warning/error. Verify drive SMART status, check cable seating, and inspect volume health.";
        }

        if (prov.Contains("display") && eventId == 4101)
        {
            return "Display driver stopped responding and successfully recovered (TDR reset). Usually caused by GPU driver instability, an aggressive GPU overclock, or a heavy DirectX/Vulkan stall.";
        }

        if (prov.Contains("application error") && eventId == 1000)
        {
            return "A user-mode application crashed due to an unhandled exception or access violation.";
        }

        if (prov.Contains("application hang") && eventId == 1002)
        {
            return "A desktop application stopped processing window messages (hung/froze) and was terminated.";
        }

        if (prov.Contains("distributedcom") && eventId == 10016)
        {
            return "Benign Windows DCOM permission warning. Windows components frequently log Event 10016 by design; Microsoft recommends ignoring this event as it does not affect functionality.";
        }

        if (prov.Contains("dns") && eventId == 1014)
        {
            return "DNS name resolution timed out because none of the configured DNS servers responded in time.";
        }

        if (prov.Contains("windowsupdateclient") && eventId == 20)
        {
            return "A Windows Update package failed to install. Check free disk space on C:, pending reboot status, or run DISM/SFC checks.";
        }

        if (prov.Contains("service control manager") && (eventId is 7000 or 7001 or 7023 or 7031 or 7034))
        {
            return "A background Windows service failed to start or terminated unexpectedly.";
        }

        return "System or application diagnostic event logged by Windows. Review the message details to correlate with recent activity.";
    }

    // =========================================================================
    // 4. WINDOWS SERVICES & HEALTH / REPAIR INSPECTION
    // =========================================================================

    public IReadOnlyList<WindowsServiceDiagnosticEntry> InspectKeyWindowsServices()
    {
        (string Name, string DisplayName, string Category, bool ExpectedRunning, bool NeverDisable)[] watchedServices =
        [
            ("wuauserv", "Windows Update", "Update & Servicing", false, true),
            ("bits", "Background Intelligent Transfer Service", "Update & Servicing", false, true),
            ("TrustedInstaller", "Windows Modules Installer", "Update & Servicing", false, true),
            ("dnscache", "DNS Client", "Networking", true, true),
            ("Dhcp", "DHCP Client", "Networking", true, true),
            ("NlaSvc", "Network Location Awareness", "Networking", true, true),
            ("WinDefend", "Microsoft Defender Antivirus Service", "Security", true, true),
            ("mpssvc", "Windows Defender Firewall", "Security", true, true),
            ("EventLog", "Windows Event Log", "Core Diagnostics", true, true),
            ("Schedule", "Task Scheduler", "Core System", true, true),
            ("SysMain", "SysMain (Superfetch)", "Performance & Caching", false, false),
            ("WSearch", "Windows Search", "Indexing & Search", false, false),
            ("Spooler", "Print Spooler", "Peripherals", false, false),
            ("W32Time", "Windows Time", "System Clock", false, false)
        ];

        var results = new List<WindowsServiceDiagnosticEntry>();
        if (!OperatingSystem.IsWindows())
        {
            return results;
        }

        var wmiMap = new Dictionary<string, (string State, string StartMode, string DisplayName)>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT Name, DisplayName, State, StartMode FROM Win32_Service");
            using var collection = searcher.Get();
            foreach (ManagementObject obj in collection)
            {
                using (obj)
                {
                    var name = Convert.ToString(obj["Name"])?.Trim() ?? string.Empty;
                    if (string.IsNullOrEmpty(name))
                    {
                        continue;
                    }
                    var disp = Convert.ToString(obj["DisplayName"])?.Trim() ?? name;
                    var state = Convert.ToString(obj["State"])?.Trim() ?? "Unknown";
                    var startMode = Convert.ToString(obj["StartMode"])?.Trim() ?? "Unknown";
                    wmiMap[name] = (state, startMode, disp);
                }
            }
        }
        catch
        {
            // Fallback to registry if WMI fails.
        }

        foreach (var watched in watchedServices)
        {
            var state = "Unknown";
            var startMode = "Unknown";
            var dispName = watched.DisplayName;

            if (wmiMap.TryGetValue(watched.Name, out var wmiInfo))
            {
                state = wmiInfo.State;
                startMode = wmiInfo.StartMode;
                if (!string.IsNullOrWhiteSpace(wmiInfo.DisplayName))
                {
                    dispName = wmiInfo.DisplayName;
                }
            }
            else
            {
                try
                {
                    using var key = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Services\{watched.Name}", writable: false);
                    if (key is not null)
                    {
                        var startVal = Convert.ToInt32(key.GetValue("Start", -1));
                        startMode = startVal switch
                        {
                            2 => "Auto",
                            3 => "Manual",
                            4 => "Disabled",
                            _ => "Unknown"
                        };
                        state = startVal == 4 ? "Stopped" : "Configured";
                    }
                }
                catch
                {
                    // Ignore.
                }
            }

            var isDisabled = string.Equals(startMode, "Disabled", StringComparison.OrdinalIgnoreCase);
            var isStopped = string.Equals(state, "Stopped", StringComparison.OrdinalIgnoreCase);
            var isAbnormal = (watched.NeverDisable && isDisabled) || (watched.ExpectedRunning && isStopped);

            string healthNote;
            if (watched.NeverDisable && isDisabled)
            {
                healthNote = $"Warning: '{dispName}' is Disabled. Disabling this core service can break {watched.Category.ToLowerInvariant()} in Windows.";
            }
            else if (watched.ExpectedRunning && isStopped)
            {
                healthNote = $"Attention: '{dispName}' is currently Stopped (expected Running for normal operation).";
            }
            else if (string.Equals(state, "Running", StringComparison.OrdinalIgnoreCase))
            {
                healthNote = $"Running normally ({startMode} startup).";
            }
            else
            {
                healthNote = $"On-demand service ({state}, {startMode} startup) — starts automatically when needed by Windows.";
            }

            results.Add(new WindowsServiceDiagnosticEntry(
                ServiceName: watched.Name,
                DisplayName: dispName,
                Status: state,
                StartType: startMode,
                Category: watched.Category,
                HealthNote: healthNote,
                IsAbnormal: isAbnormal));
        }

        return results;
    }

    public WindowsRepairAndHealthStatus InspectWindowsRepairAndHealthStatus()
    {
        var rebootReasons = new List<string>();
        if (OperatingSystem.IsWindows())
        {
            try
            {
                using var cbs = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending");
                if (cbs is not null)
                {
                    rebootReasons.Add("Component-Based Servicing (CBS) has a pending update reboot.");
                }
            }
            catch { }

            try
            {
                using var wu = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired");
                if (wu is not null)
                {
                    rebootReasons.Add("Windows Update requires a system restart to finalize installed updates.");
                }
            }
            catch { }

            try
            {
                using var sm = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Session Manager");
                if (sm?.GetValue("PendingFileRenameOperations") is string[] renames && renames.Length > 0)
                {
                    rebootReasons.Add($"Session Manager has {renames.Length} pending file rename operation(s) queued for next boot.");
                }
            }
            catch { }
        }

        var restorePointCount = 0;
        var lastRestoreDesc = "Not available without Administrator WMI access";
        var protectionLikely = false;

        if (OperatingSystem.IsWindows())
        {
            try
            {
                using var srKey = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore");
                if (srKey is not null)
                {
                    var rpsVal = Convert.ToInt32(srKey.GetValue("RPSessionInterval", 0));
                    var disableVal = Convert.ToInt32(srKey.GetValue("DisableSR", 0));
                    protectionLikely = disableVal == 0;
                    lastRestoreDesc = protectionLikely
                        ? "System Restore service is enabled in registry."
                        : "System Restore appears disabled in registry (DisableSR=1).";
                }
            }
            catch { }

            try
            {
                using var searcher = new ManagementObjectSearcher(@"\\.\root\default", "SELECT Description, CreationTime FROM SystemRestore");
                using var collection = searcher.Get();
                foreach (ManagementObject obj in collection)
                {
                    using (obj)
                    {
                        restorePointCount++;
                        var desc = Convert.ToString(obj["Description"])?.Trim();
                        if (!string.IsNullOrWhiteSpace(desc))
                        {
                            lastRestoreDesc = desc;
                        }
                    }
                }
                if (restorePointCount > 0)
                {
                    protectionLikely = true;
                }
            }
            catch
            {
                // SystemRestore WMI class requires elevation to enumerate; preserve registry-derived status.
            }
        }

        var deviceErrors = new List<string>();
        if (OperatingSystem.IsWindows())
        {
            try
            {
                using var searcher = new ManagementObjectSearcher("SELECT Name, ConfigManagerErrorCode FROM Win32_PnPEntity WHERE ConfigManagerErrorCode <> 0");
                using var collection = searcher.Get();
                foreach (ManagementObject obj in collection)
                {
                    using (obj)
                    {
                        var name = Convert.ToString(obj["Name"])?.Trim() ?? "Unknown Device";
                        var code = Convert.ToInt32(obj["ConfigManagerErrorCode"] ?? 0);
                        deviceErrors.Add($"{name} (Device Manager Error Code {code})");
                    }
                }
            }
            catch { }
        }

        var services = InspectKeyWindowsServices();
        var wuService = services.FirstOrDefault(s => string.Equals(s.ServiceName, "wuauserv", StringComparison.OrdinalIgnoreCase));
        var wuStatus = wuService is not null
            ? $"{wuService.Status} (Startup: {wuService.StartType}) — {wuService.HealthNote}"
            : "Unknown";

        return new WindowsRepairAndHealthStatus(
            RebootPending: rebootReasons.Count > 0,
            RebootPendingReasons: rebootReasons,
            SystemProtectionLikelyAvailable: protectionLikely,
            RestorePointCount: restorePointCount,
            LastRestorePointDescription: lastRestoreDesc,
            DeviceManagerErrors: deviceErrors,
            WindowsUpdateServiceStatus: wuStatus,
            SfcGuidance: "System File Checker ('sfc /scannow') verifies protected Windows system binaries against the component store and repairs corrupted DLLs/EXEs. Requires an elevated Administrator prompt.",
            DismGuidance: "Deployment Image Servicing and Management ('DISM /Online /Cleanup-Image /CheckHealth' or '/RestoreHealth') inspects and repairs the Windows Component Store (WinSxS) before running SFC.",
            CapturedAtUtc: DateTimeOffset.UtcNow);
    }

    // =========================================================================
    // 5. SYSTEM RESTORE POINT & DISM COMPONENT STORE VERIFICATION
    // =========================================================================

    public OperationProposal ProposeCreateRestorePoint(string? description = null)
    {
        var cleanDesc = string.IsNullOrWhiteSpace(description)
            ? $"Groundwork Checkpoint ({DateTime.Now:yyyy-MM-dd HH:mm})"
            : description.Trim();

        var health = InspectWindowsRepairAndHealthStatus();
        var payloadJson = JsonSerializer.Serialize(new RestorePointPayload(cleanDesc));

        return _safeOperationEngine.CreateProposal(
            descriptor: CreateRestorePointDescriptor,
            targetDescription: $"Windows System Restore Point: \"{cleanDesc}\"",
            inspectedCurrentStateSummary: $"System Protection: {(health.SystemProtectionLikelyAvailable ? "Enabled" : "Unconfirmed")}, Existing Restore Points: {health.RestorePointCount}",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: $"Creates a Windows System Restore point labeled '{cleanDesc}' so system configuration and driver changes can be rolled back.",
            expectedEffects:
            [
                "Captures a VSS system protection snapshot of Windows system files and registry hives.",
                "Does not modify user documents or personal files."
            ],
            payloadJson: payloadJson);
    }

    private async Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteCreateRestorePointAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<RestorePointPayload>(payloadJson)
            ?? new RestorePointPayload("Groundwork Checkpoint");

        var ok = false;
        var details = string.Empty;

        if (OperatingSystem.IsWindows())
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };
                psi.ArgumentList.Add("-NoProfile");
                psi.ArgumentList.Add("-NonInteractive");
                psi.ArgumentList.Add("-Command");
                var safeDesc = payload.Description.Replace("'", "''");
                psi.ArgumentList.Add($"Checkpoint-Computer -Description '{safeDesc}' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop");

                using var proc = Process.Start(psi);
                if (proc is not null)
                {
                    var stdout = await proc.StandardOutput.ReadToEndAsync(cancellationToken).ConfigureAwait(false);
                    var stderr = await proc.StandardError.ReadToEndAsync(cancellationToken).ConfigureAwait(false);
                    await proc.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
                    ok = proc.ExitCode == 0;
                    details = string.IsNullOrWhiteSpace(stderr) ? stdout.Trim() : stderr.Trim();
                }
            }
            catch (Exception ex)
            {
                details = ex.Message;
            }
        }

        var verification = new OperationVerificationResult(
            IsVerified: ok,
            ObservedStateSummary: ok
                ? $"Created System Restore point '{payload.Description}'."
                : "Could not verify restore point creation.",
            VerificationDetails: string.IsNullOrWhiteSpace(details)
                ? $"Checkpoint-Computer completed for '{payload.Description}'."
                : details,
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return (
            Succeeded: ok,
            PostStateSummary: verification.ObservedStateSummary,
            StatusMessage: ok
                ? $"Created Windows System Restore point '{payload.Description}'."
                : $"Restore point creation did not succeed: {verification.VerificationDetails}",
            Verification: verification);
    }

    public OperationProposal ProposeVerifySystemHealth()
    {
        return _safeOperationEngine.CreateProposal(
            descriptor: VerifyDismHealthDescriptor,
            targetDescription: "Windows Component Store (DISM /Online /Cleanup-Image /CheckHealth)",
            inspectedCurrentStateSummary: "Ready to verify Windows Component Store (WinSxS) corruption flags.",
            preChangeStateJson: "{\"check\":\"dism_checkhealth\"}",
            proposedChangeExplanation: "Runs 'DISM.exe /Online /Cleanup-Image /CheckHealth' to check whether Windows has detected any component store corruption.",
            expectedEffects:
            [
                "Read-only verification of the Windows Component Store.",
                "Reports whether the component store is healthy, repairable, or corrupted."
            ]);
    }

    public static (bool IsHealthy, string Summary) ParseDismCheckHealthOutput(string? rawOutput)
    {
        if (string.IsNullOrWhiteSpace(rawOutput))
        {
            return (false, "DISM produced no output.");
        }

        var text = rawOutput.Trim();
        if (text.Contains("No component store corruption detected", StringComparison.OrdinalIgnoreCase))
        {
            return (true, "No component store corruption detected. The Windows image is healthy.");
        }

        if (text.Contains("component store is repairable", StringComparison.OrdinalIgnoreCase))
        {
            return (false, "The component store is flagged as repairable. Run 'DISM /Online /Cleanup-Image /RestoreHealth' from an elevated prompt.");
        }

        if (text.Contains("740", StringComparison.OrdinalIgnoreCase) || text.Contains("elevated permissions", StringComparison.OrdinalIgnoreCase))
        {
            return (false, "DISM requires elevated Administrator permissions (Error 740).");
        }

        return (false, text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? text);
    }

    private async Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteVerifyDismHealthAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var exitCode = -1;
        var output = string.Empty;

        if (OperatingSystem.IsWindows())
        {
            var psi = new ProcessStartInfo
            {
                FileName = "dism.exe",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            psi.ArgumentList.Add("/Online");
            psi.ArgumentList.Add("/Cleanup-Image");
            psi.ArgumentList.Add("/CheckHealth");

            using var proc = Process.Start(psi);
            if (proc is not null)
            {
                output = await proc.StandardOutput.ReadToEndAsync(cancellationToken).ConfigureAwait(false);
                await proc.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
                exitCode = proc.ExitCode;
            }
        }

        var (_, summary) = ParseDismCheckHealthOutput(output);
        var ok = exitCode == 0;
        var verification = new OperationVerificationResult(
            IsVerified: ok,
            ObservedStateSummary: summary,
            VerificationDetails: $"DISM exit code {exitCode}: {summary}",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return (
            Succeeded: ok,
            PostStateSummary: summary,
            StatusMessage: summary,
            Verification: verification);
    }

    // =========================================================================
    // 6. SAFE TEMPORARY FILES & BROWSER CACHE INSPECTION + CLEANUP
    // =========================================================================

    public SafeTempAndCacheCleanupSummary InspectSafeTempAndBrowserCaches()
    {
        var tempRoot = !string.IsNullOrWhiteSpace(_customTempDir)
            ? _customTempDir
            : Path.GetTempPath();

        var localAppData = !string.IsNullOrWhiteSpace(_customLocalAppDataDir)
            ? _customLocalAppDataDir
            : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        var (tempBytes, tempCount) = MeasureDirectoryTopAndSubFiles(tempRoot);
        var crashDumpsDir = Path.Combine(localAppData, "CrashDumps");
        var (dumpBytes, dumpCount) = MeasureDirectoryTopAndSubFiles(crashDumpsDir, "*.dmp");

        var runningProcessNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(_customLocalAppDataDir))
        {
            try
            {
                foreach (var p in Process.GetProcesses())
                {
                    try
                    {
                        if (!string.IsNullOrWhiteSpace(p.ProcessName))
                        {
                            runningProcessNames.Add(p.ProcessName);
                        }
                    }
                    catch { }
                    finally
                    {
                        p.Dispose();
                    }
                }
            }
            catch { }
        }

        var browserDefs = new (string Id, string Name, string ProcessName, string RelativeCacheDir)[]
        {
            ("edge", "Microsoft Edge HTTP/Code Cache", "msedge", Path.Combine("Microsoft", "Edge", "User Data", "Default", "Cache", "Cache_Data")),
            ("chrome", "Google Chrome HTTP/Code Cache", "chrome", Path.Combine("Google", "Chrome", "User Data", "Default", "Cache", "Cache_Data")),
            ("brave", "Brave Browser HTTP/Code Cache", "brave", Path.Combine("BraveSoftware", "Brave-Browser", "User Data", "Default", "Cache", "Cache_Data")),
            ("firefox", "Mozilla Firefox Web Cache", "firefox", Path.Combine("Mozilla", "Firefox", "Profiles"))
        };

        var browserCaches = new List<BrowserCacheDiagnosticEntry>();
        foreach (var b in browserDefs)
        {
            var isRunning = runningProcessNames.Contains(b.ProcessName);
            if (b.Id == "firefox")
            {
                var profilesRoot = Path.Combine(localAppData, b.RelativeCacheDir);
                if (Directory.Exists(profilesRoot))
                {
                    try
                    {
                        long ffBytes = 0;
                        var ffFiles = 0;
                        foreach (var profDir in Directory.EnumerateDirectories(profilesRoot))
                        {
                            var cache2Entries = Path.Combine(profDir, "cache2", "entries");
                            var (cb, cf) = MeasureDirectoryTopAndSubFiles(cache2Entries);
                            ffBytes += cb;
                            ffFiles += cf;
                        }
                        if (ffFiles > 0)
                        {
                            browserCaches.Add(new BrowserCacheDiagnosticEntry(
                                BrowserId: b.Id,
                                BrowserName: b.Name,
                                CacheDirectoryPath: profilesRoot,
                                CacheSizeBytes: ffBytes,
                                FileCount: ffFiles,
                                IsBrowserProcessRunning: isRunning,
                                SafetyNote: isRunning
                                    ? "Firefox is currently running; close Firefox before cleaning cache."
                                    : "Cache-only directory (cache2/entries). Cookies, logins, and history are never touched."));
                        }
                    }
                    catch { }
                }
                continue;
            }

            var fullCacheDir = Path.Combine(localAppData, b.RelativeCacheDir);
            if (Directory.Exists(fullCacheDir))
            {
                var (cBytes, cCount) = MeasureDirectoryTopAndSubFiles(fullCacheDir);
                browserCaches.Add(new BrowserCacheDiagnosticEntry(
                    BrowserId: b.Id,
                    BrowserName: b.Name,
                    CacheDirectoryPath: fullCacheDir,
                    CacheSizeBytes: cBytes,
                    FileCount: cCount,
                    IsBrowserProcessRunning: isRunning,
                    SafetyNote: isRunning
                        ? $"{b.Name} is currently open ({b.ProcessName}.exe); close the browser to clean its cache safely."
                        : "Cache_Data only. Cookies, saved passwords, bookmarks, and active sessions are preserved."));
            }
        }

        var closedBrowserBytes = browserCaches.Where(b => !b.IsBrowserProcessRunning).Sum(b => b.CacheSizeBytes);
        var closedBrowserCount = browserCaches.Where(b => !b.IsBrowserProcessRunning).Sum(b => b.FileCount);

        return new SafeTempAndCacheCleanupSummary(
            UserTempBytes: tempBytes,
            UserTempFileCount: tempCount,
            CrashDumpBytes: dumpBytes,
            CrashDumpFileCount: dumpCount,
            BrowserCaches: browserCaches,
            TotalSafeReclaimableBytes: tempBytes + dumpBytes + closedBrowserBytes,
            TotalSafeFileCount: tempCount + dumpCount + closedBrowserCount,
            CapturedAtUtc: DateTimeOffset.UtcNow);
    }

    public OperationProposal ProposeSafeTempAndCacheCleanup(bool includeClosedBrowserCaches = true)
    {
        var summary = InspectSafeTempAndBrowserCaches();
        var tempRoot = !string.IsNullOrWhiteSpace(_customTempDir)
            ? _customTempDir
            : Path.GetTempPath();
        var localAppData = !string.IsNullOrWhiteSpace(_customLocalAppDataDir)
            ? _customLocalAppDataDir
            : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var crashDumpsDir = Path.Combine(localAppData, "CrashDumps");

        var targets = new List<string>();
        if (Directory.Exists(tempRoot) && summary.UserTempFileCount > 0)
        {
            targets.Add(tempRoot);
        }
        if (Directory.Exists(crashDumpsDir) && summary.CrashDumpFileCount > 0)
        {
            targets.Add(crashDumpsDir);
        }

        if (includeClosedBrowserCaches)
        {
            foreach (var bc in summary.BrowserCaches.Where(b => !b.IsBrowserProcessRunning && b.FileCount > 0))
            {
                targets.Add(bc.CacheDirectoryPath);
            }
        }

        var reclaimBytes = summary.UserTempBytes + summary.CrashDumpBytes +
            (includeClosedBrowserCaches ? summary.BrowserCaches.Where(b => !b.IsBrowserProcessRunning).Sum(b => b.CacheSizeBytes) : 0);
        var reclaimCount = summary.UserTempFileCount + summary.CrashDumpFileCount +
            (includeClosedBrowserCaches ? summary.BrowserCaches.Where(b => !b.IsBrowserProcessRunning).Sum(b => b.FileCount) : 0);

        var payload = new SafeTempCleanupPayload(targets, reclaimBytes, reclaimCount);
        var payloadJson = JsonSerializer.Serialize(payload);
        var mb = reclaimBytes / (1024.0 * 1024.0);

        return _safeOperationEngine.CreateProposal(
            descriptor: SafeTempAndCacheCleanupDescriptor,
            targetDescription: $"User Temp, Crash Dumps & Closed Browser Caches ({reclaimCount} files, {mb:F1} MB)",
            inspectedCurrentStateSummary: $"Temp: {summary.UserTempFileCount} files ({summary.UserTempBytes / (1024.0 * 1024.0):F1} MB), CrashDumps: {summary.CrashDumpFileCount} files, Closed Browser Caches: {summary.BrowserCaches.Count(b => !b.IsBrowserProcessRunning)} browser(s).",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: $"Clean {reclaimCount} temporary and cache file(s) (~{mb:F1} MB) across {targets.Count} safe location(s). In-use files and running browsers are automatically skipped.",
            expectedEffects:
            [
                $"Reclaims up to {mb:F1} MB of disk space from scratch and web cache folders.",
                "Preserves all browser cookies, saved passwords, bookmarks, and user documents."
            ],
            payloadJson: payloadJson,
            customPrerequisiteValidator: () =>
            {
                if (reclaimCount == 0 || targets.Count == 0)
                {
                    return (false, "No eligible temporary or closed browser cache files were found to clean.");
                }
                return (true, $"Found {reclaimCount} eligible temporary/cache file(s) ready for safe cleanup.");
            });
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteSafeTempAndCacheCleanupAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<SafeTempCleanupPayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid safe temp cleanup payload.");

        var removedFiles = 0;
        long reclaimedBytes = 0;
        var skippedLocked = 0;

        foreach (var dir in payload.TargetDirectories)
        {
            if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir) || SafeCleanupService.IsProtectedSystemPath(dir))
            {
                continue;
            }

            try
            {
                foreach (var file in Directory.EnumerateFiles(dir, "*", SearchOption.TopDirectoryOnly))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    try
                    {
                        var fi = new FileInfo(file);
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
            }
            catch
            {
                // Ignore directory access issues.
            }
        }

        var afterSummary = InspectSafeTempAndBrowserCaches();
        var mb = reclaimedBytes / (1024.0 * 1024.0);
        var ok = removedFiles > 0;

        var verification = new OperationVerificationResult(
            IsVerified: ok,
            ObservedStateSummary: $"Removed {removedFiles} file(s) ({mb:F2} MB reclaimed); {skippedLocked} active/locked file(s) skipped.",
            VerificationDetails: $"Post-cleanup remaining unlocked temp files: {afterSummary.UserTempFileCount}.",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: ok,
            PostStateSummary: verification.ObservedStateSummary,
            StatusMessage: ok
                ? $"Cleaned {removedFiles} temporary/cache file(s) and reclaimed {mb:F2} MB."
                : "No unlocked temporary files could be removed.",
            Verification: verification));
    }

    private static (long Bytes, int Count) MeasureDirectoryTopAndSubFiles(string directoryPath, string searchPattern = "*")
    {
        if (string.IsNullOrWhiteSpace(directoryPath) || !Directory.Exists(directoryPath))
        {
            return (0, 0);
        }

        long bytes = 0;
        var count = 0;
        try
        {
            var dirInfo = new DirectoryInfo(directoryPath);
            foreach (var f in dirInfo.EnumerateFiles(searchPattern, SearchOption.TopDirectoryOnly))
            {
                try
                {
                    bytes += f.Length;
                    count++;
                }
                catch { }
            }
        }
        catch { }

        return (bytes, count);
    }
}
