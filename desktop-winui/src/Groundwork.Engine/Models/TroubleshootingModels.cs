using System;
using System.Collections.Generic;

namespace Groundwork.Engine.Models;

public sealed record ProcessResourceItem(
    int ProcessId,
    string ProcessName,
    string WindowTitle,
    long WorkingSetBytes,
    long PrivateMemoryBytes,
    double TotalProcessorTimeSeconds,
    int ThreadCount,
    bool IsResponding)
{
    public string WorkingSetDisplay => $"{WorkingSetBytes / (1024.0 * 1024.0):F1} MB";
    public string PrivateMemoryDisplay => $"{PrivateMemoryBytes / (1024.0 * 1024.0):F1} MB";
    public string CpuTimeDisplay => $"{TotalProcessorTimeSeconds:F1} s";
    public string StatusDisplay => IsResponding ? "Running" : "Not Responding";
}

public sealed record ProcessResourceSnapshot(
    IReadOnlyList<ProcessResourceItem> TopMemoryProcesses,
    IReadOnlyList<ProcessResourceItem> TopCpuProcesses,
    int TotalProcessCount,
    long TotalWorkingSetBytes,
    DateTimeOffset CapturedAtUtc);

public sealed record NetworkInterfaceDiagnostic(
    string Name,
    string Description,
    string InterfaceType,
    string OperationalStatus,
    long SpeedBitsPerSecond,
    IReadOnlyList<string> IpAddresses,
    IReadOnlyList<string> GatewayAddresses,
    IReadOnlyList<string> DnsServers,
    bool IsDhcpEnabled)
{
    public string SpeedDisplay => SpeedBitsPerSecond >= 1_000_000_000
        ? $"{SpeedBitsPerSecond / 1_000_000_000.0:F1} Gbps"
        : (SpeedBitsPerSecond >= 1_000_000 ? $"{SpeedBitsPerSecond / 1_000_000.0:F0} Mbps" : "N/A");
    public string IpSummary => IpAddresses.Count > 0 ? string.Join(", ", IpAddresses) : "None";
    public string GatewaySummary => GatewayAddresses.Count > 0 ? string.Join(", ", GatewayAddresses) : "None";
    public string DnsSummary => DnsServers.Count > 0 ? string.Join(", ", DnsServers) : "Automatic / None";
}

public sealed record PingDiagnosticResult(
    string TargetHost,
    bool Succeeded,
    string ResolvedAddress,
    long RoundtripTimeMs,
    string StatusMessage)
{
    public string LatencyDisplay => Succeeded ? $"{RoundtripTimeMs} ms" : "Timeout / Unreachable";
}

public sealed record DnsLookupDiagnosticResult(
    string HostName,
    bool Succeeded,
    IReadOnlyList<string> ResolvedAddresses,
    long ElapsedMs,
    string StatusMessage)
{
    public string AddressesDisplay => ResolvedAddresses.Count > 0 ? string.Join(", ", ResolvedAddresses) : "Unresolved";
}

public sealed record DnsProviderOption(
    string ProviderName,
    string PrimaryIpv4,
    string SecondaryIpv4,
    string PrimaryIpv6,
    string SecondaryIpv6,
    string Description,
    string PrivacyAndSecurityNotes);

public sealed record NetworkTroubleshootingReport(
    IReadOnlyList<NetworkInterfaceDiagnostic> ActiveInterfaces,
    PingDiagnosticResult GatewayPing,
    PingDiagnosticResult ExternalPing,
    DnsLookupDiagnosticResult DnsCheck,
    IReadOnlyList<DnsProviderOption> KnownDnsProviders,
    string SummaryDiagnosis,
    DateTimeOffset CapturedAtUtc);

public sealed record EventLogDiagnosticEntry(
    long RecordId,
    string LogName,
    string LevelDisplay,
    string ProviderName,
    int EventId,
    DateTimeOffset TimeCreatedUtc,
    string MessageSummary,
    string PlainEnglishExplanation)
{
    public string TimeDisplay => TimeCreatedUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
}

public sealed record WindowsServiceDiagnosticEntry(
    string ServiceName,
    string DisplayName,
    string Status,
    string StartType,
    string Category,
    string HealthNote,
    bool IsAbnormal);

public sealed record WindowsRepairAndHealthStatus(
    bool RebootPending,
    IReadOnlyList<string> RebootPendingReasons,
    bool SystemProtectionLikelyAvailable,
    int RestorePointCount,
    string LastRestorePointDescription,
    IReadOnlyList<string> DeviceManagerErrors,
    string WindowsUpdateServiceStatus,
    string SfcGuidance,
    string DismGuidance,
    DateTimeOffset CapturedAtUtc);

public sealed record FileOrganizeCandidateItem(
    string SourceFilePath,
    string FileName,
    string CategoryFolder,
    string DestinationFilePath,
    long SizeBytes)
{
    public string SizeDisplay => SizeBytes >= 1024 * 1024
        ? $"{SizeBytes / (1024.0 * 1024.0):F2} MB"
        : $"{Math.Max(1, SizeBytes / 1024)} KB";
}

public sealed record FileOrganizePlan(
    string RootFolderPath,
    IReadOnlyList<FileOrganizeCandidateItem> Candidates,
    long TotalBytes,
    IReadOnlyDictionary<string, int> CategoryCounts,
    DateTimeOffset CreatedAtUtc);

public sealed record BrowserCacheDiagnosticEntry(
    string BrowserId,
    string BrowserName,
    string CacheDirectoryPath,
    long CacheSizeBytes,
    int FileCount,
    bool IsBrowserProcessRunning,
    string SafetyNote)
{
    public string SizeDisplay => CacheSizeBytes >= 1024 * 1024
        ? $"{CacheSizeBytes / (1024.0 * 1024.0):F1} MB"
        : $"{Math.Max(0, CacheSizeBytes / 1024)} KB";
}

public sealed record SafeTempAndCacheCleanupSummary(
    long UserTempBytes,
    int UserTempFileCount,
    long CrashDumpBytes,
    int CrashDumpFileCount,
    IReadOnlyList<BrowserCacheDiagnosticEntry> BrowserCaches,
    long TotalSafeReclaimableBytes,
    int TotalSafeFileCount,
    DateTimeOffset CapturedAtUtc);
