using System;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Groundwork.Desktop.Services;
using Groundwork.Engine.Models;
using Groundwork.Engine.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using Windows.ApplicationModel.DataTransfer;

namespace Groundwork.Desktop.Views;

public sealed partial class DiagnosticsPage : Page
{
    private HardwareSystemReport? _cachedHardware;
    private InvestigationReport? _currentInvestigation;

    public ObservableCollection<PhysicalDiskSpecsInfo> PhysicalDisks { get; } = new();
    public ObservableCollection<InvestigationFindingRowViewModel> ConfirmedFindings { get; } = new();
    public ObservableCollection<EventLogRowViewModel> EventLogs { get; } = new();

    public DiagnosticsPage()
    {
        this.InitializeComponent();
        this.NavigationCacheMode = NavigationCacheMode.Required;

        PhysicalDisksListView.ItemsSource = PhysicalDisks;
        ConfirmedFindingsListView.ItemsSource = ConfirmedFindings;
        EventLogsListView.ItemsSource = EventLogs;
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        if (e.Parameter is string targetSegment && !string.IsNullOrEmpty(targetSegment))
        {
            ShowSegment(targetSegment);
        }
        else
        {
            await LoadHardwareSpecsAsync();
        }
    }

    public void ShowSegment(string segment)
    {
        SubViewHardware.Visibility = Visibility.Collapsed;
        SubViewNetwork.Visibility = Visibility.Collapsed;
        SubViewRepair.Visibility = Visibility.Collapsed;

        TabHardwareBtn.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];
        TabNetworkBtn.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];
        TabRepairBtn.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];

        switch (segment.ToLowerInvariant())
        {
            case "network" or "troubleshoot" or "internet":
                SubViewNetwork.Visibility = Visibility.Visible;
                TabNetworkBtn.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
                _ = LoadNetworkStateAsync();
                break;
            case "repair" or "logs" or "services":
                SubViewRepair.Visibility = Visibility.Visible;
                TabRepairBtn.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
                _ = LoadEventLogsAsync();
                break;
            default:
                SubViewHardware.Visibility = Visibility.Visible;
                TabHardwareBtn.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
                _ = LoadHardwareSpecsAsync();
                break;
        }
    }

    // ==========================================
    // 1. HARDWARE SPECS
    // ==========================================
    public async Task LoadHardwareSpecsAsync(bool force = false)
    {
        if (_cachedHardware != null && !force) return;

        AppServices.Instance.NotifyStatus("Inspecting hardware and motherboard telemetry...");
        await Task.Run(() =>
        {
            var report = AppServices.Instance.HardwareEngine.GetHardwareReport(maskSensitiveData: false);
            _cachedHardware = report;
            AppServices.Instance.LastHardwareReport = report;

            DispatcherQueue.TryEnqueue(() =>
            {
                HardwareOsSummaryText.Text = $"{report.Os.Caption} (Build {report.Os.BuildNumber}) • Architecture: {report.Os.Architecture}";

                // CPU
                CpuModelText.Text = report.Cpu.Name;
                CpuCoresText.Text = $"{report.Cpu.PhysicalCores} Physical Cores • {report.Cpu.LogicalProcessors} Logical Threads ({report.Cpu.MaxClockSpeedMHz} MHz)";

                // Motherboard
                MoboModelText.Text = $"{report.Motherboard.Manufacturer} {report.Motherboard.Product}";
                BiosVersionText.Text = $"BIOS: {report.Motherboard.BiosVersion} ({report.Motherboard.BiosReleaseDate}) • SecureBoot: {(report.Motherboard.IsSecureBootEnabled == true ? "Active" : "Disabled")}";

                // RAM & DIMM Slots
                MemorySummaryText.Text = $"{ByteFormatter.FormatBytes((long)report.Memory.TotalPhysicalBytes)} Total Physical RAM ({report.Memory.PopulatedSlots} of {report.Memory.TotalSlots} slots populated)";
                var dimmSb = new StringBuilder();
                int slotIdx = 1;
                foreach (var mod in report.Memory.Modules)
                {
                    dimmSb.Append($"Slot {slotIdx++}: {mod.FormattedCapacity} {mod.SpeedMHz}MHz ({mod.Manufacturer})  ");
                }
                DimmSlotsDetailText.Text = dimmSb.Length > 0 ? dimmSb.ToString() : "All physical slots populated.";

                // GPU
                var gpu = report.Gpus.FirstOrDefault();
                if (gpu != null)
                {
                    GpuSummaryText.Text = gpu.Name;
                    GpuDriverText.Text = $"Driver: {gpu.DriverVersion} ({gpu.DriverDate}) • VRAM: {gpu.FormattedDedicatedMemory}";
                }

                // Disks
                PhysicalDisks.Clear();
                foreach (var d in report.Disks)
                {
                    PhysicalDisks.Add(d);
                }

                AppServices.Instance.NotifyStatus("Hardware telemetry verified.");
            });
        });
    }

    private void OnCopySpecsSummaryClick(object sender, RoutedEventArgs e)
    {
        if (_cachedHardware == null) return;
        var sb = new StringBuilder();
        sb.AppendLine($"OS: {_cachedHardware.Os.Caption} (Build {_cachedHardware.Os.BuildNumber})");
        sb.AppendLine($"Processor: {_cachedHardware.Cpu.Name} ({_cachedHardware.Cpu.PhysicalCores} Cores, {_cachedHardware.Cpu.LogicalProcessors} Threads)");
        sb.AppendLine($"Motherboard: {_cachedHardware.Motherboard.Manufacturer} {_cachedHardware.Motherboard.Product}");
        sb.AppendLine($"BIOS: {_cachedHardware.Motherboard.BiosVersion} ({_cachedHardware.Motherboard.BiosReleaseDate})");
        sb.AppendLine($"Memory: {ByteFormatter.FormatBytes((long)_cachedHardware.Memory.TotalPhysicalBytes)} ({_cachedHardware.Memory.PopulatedSlots} slots used)");
        foreach (var gpu in _cachedHardware.Gpus)
        {
            sb.AppendLine($"GPU: {gpu.Name} (Driver {gpu.DriverVersion})");
        }

        var dp = new DataPackage();
        dp.SetText(sb.ToString());
        Clipboard.SetContent(dp);
        AppServices.Instance.NotifyStatus("Hardware summary copied to clipboard.");
    }

    private async void OnRefreshHardwareClick(object sender, RoutedEventArgs e)
    {
        await LoadHardwareSpecsAsync(force: true);
    }

    // ==========================================
    // 2. NETWORK & INVESTIGATIONS
    // ==========================================
    public async Task LoadNetworkStateAsync()
    {
        await Task.Run(() =>
        {
            var adapters = AppServices.Instance.TroubleshootingService.InspectNetworkInterfaces();
            var active = adapters.FirstOrDefault(a => a.OperationalStatus == "Up");

            DispatcherQueue.TryEnqueue(() =>
            {
                if (active != null)
                {
                    NetworkNameText.Text = $"{active.Name} ({active.Description})";
                    string primaryIp = active.IpAddresses.FirstOrDefault(ip => !ip.Contains(':')) ?? active.IpAddresses.FirstOrDefault() ?? "127.0.0.1";
                    string gateway = active.GatewayAddresses.FirstOrDefault(gw => !gw.Contains(':')) ?? active.GatewayAddresses.FirstOrDefault() ?? "N/A";
                    NetworkIpDisplay.Text = $"IPv4: {primaryIp} • Default Gateway: {gateway} • Status: Connected";
                    string dns = active.DnsServers.Count > 0 ? string.Join(", ", active.DnsServers.Take(2)) : "System Default";
                    NetworkDnsDisplay.Text = $"DNS Servers: {dns}";
                }
                else
                {
                    NetworkNameText.Text = "No active interface";
                    NetworkIpDisplay.Text = "Status: Disconnected";
                }
            });
        });
    }

    private async void OnTestNetworkClick(object sender, RoutedEventArgs e)
    {
        AppServices.Instance.NotifyStatus("Testing ICMP ping & DNS resolution...");
        try
        {
            var ping = await AppServices.Instance.TroubleshootingService.PingHostAsync("1.1.1.1");
            var dns = await AppServices.Instance.TroubleshootingService.LookupDnsAsync("www.microsoft.com");
            string msg = $"Ping to 1.1.1.1: {(ping.Succeeded ? ping.LatencyDisplay : ping.StatusMessage)}\n" +
                         $"DNS Lookup (microsoft.com): {(dns.Succeeded ? dns.AddressesDisplay : dns.StatusMessage)}";
            await AppServices.Instance.ShowDialogAsync("Network Connectivity Test", msg);
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Network Test Error", ex.Message);
        }
    }

    private async void OnFlushDnsClick(object sender, RoutedEventArgs e)
    {
        try
        {
            var proposal = AppServices.Instance.TroubleshootingService.ProposeFlushDnsCache();
            var result = await AppServices.Instance.SafeOperationEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
            AppServices.Instance.NotifyOperationHistoryChanged();
            AppServices.Instance.NotifyStatus(result.StatusMessage);
            await AppServices.Instance.ShowDialogAsync("DNS Cache", result.StatusMessage);
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Flush DNS Error", ex.Message);
        }
    }

    // Guided Investigations
    private async void OnInvestigatePerformanceClick(object sender, RoutedEventArgs e) => await RunInvestigationAsync(InvestigationType.Performance, "System feels slower than usual");
    private async void OnInvestigateNetworkClick(object sender, RoutedEventArgs e) => await RunInvestigationAsync(InvestigationType.Network, "Internet connection drops or high latency");
    private async void OnInvestigateStorageClick(object sender, RoutedEventArgs e) => await RunInvestigationAsync(InvestigationType.Storage, "Low storage space on system volume");
    private async void OnInvestigateHealthClick(object sender, RoutedEventArgs e) => await RunInvestigationAsync(InvestigationType.WindowsHealth, "Check Windows servicing integrity and pending reboot");

    public async Task RunInvestigationAsync(InvestigationType type, string symptom)
    {
        AppServices.Instance.NotifyStatus($"Running guided {type} investigation...");
        try
        {
            var report = await Task.Run(() => AppServices.Instance.InvestigationEngine.RunInvestigationAsync(type, symptom));
            _currentInvestigation = report;
            AppServices.Instance.LastInvestigationReport = report;

            ConfirmedFindings.Clear();
            foreach (var f in report.ConfirmedObservations)
            {
                ConfirmedFindings.Add(new InvestigationFindingRowViewModel
                {
                    Title = f.Title,
                    Detail = f.Detail,
                    Severity = f.Severity.ToString(),
                    EvidenceAndConfidence = $"Evidence: {f.EvidenceSource}"
                });
            }

            InvestigationTitleText.Text = $"{type} Investigation: {report.ConfirmedObservations.Count} Findings Discovered";
            InvestigationResultsCard.Visibility = Visibility.Visible;
            AppServices.Instance.NotifyStatus($"Investigation complete: {report.ConfirmedObservations.Count} observations confirmed.");
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Investigation Error", ex.Message);
        }
    }

    private void OnCopyInvestigationReportClick(object sender, RoutedEventArgs e)
    {
        if (_currentInvestigation == null) return;
        var md = InvestigationEngineService.ExportToMarkdown(_currentInvestigation);
        var dp = new DataPackage();
        dp.SetText(md);
        Clipboard.SetContent(dp);
        AppServices.Instance.NotifyStatus("Investigation markdown report copied to clipboard.");
    }

    // ==========================================
    // 3. REPAIR & EVENT LOGS
    // ==========================================
    public async Task LoadEventLogsAsync()
    {
        await Task.Run(() =>
        {
            var logs = AppServices.Instance.TroubleshootingService.InspectRecentEventLogErrors(25);
            DispatcherQueue.TryEnqueue(() =>
            {
                EventLogs.Clear();
                foreach (var log in logs)
                {
                    EventLogs.Add(new EventLogRowViewModel
                    {
                        LogName = log.LogName,
                        LevelDisplay = log.LevelDisplay,
                        ProviderName = log.ProviderName,
                        EventId = log.EventId,
                        MessageSummary = log.MessageSummary,
                        PlainEnglishExplanation = log.PlainEnglishExplanation,
                        TimeDisplay = log.TimeDisplay
                    });
                }
            });
        });
    }

    private async void OnRefreshEventLogsClick(object sender, RoutedEventArgs e)
    {
        await LoadEventLogsAsync();
    }

    private async void OnVerifySystemIntegrityClick(object sender, RoutedEventArgs e)
    {
        AppServices.Instance.NotifyStatus("Verifying Windows Component Store health (DISM)...");
        try
        {
            var proposal = AppServices.Instance.TroubleshootingService.ProposeVerifySystemHealth();
            var result = await AppServices.Instance.SafeOperationEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
            AppServices.Instance.NotifyOperationHistoryChanged();
            await AppServices.Instance.ShowDialogAsync("DISM Component Store Health", result.StatusMessage);
            AppServices.Instance.NotifyStatus("DISM health verification completed.");
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Repair Verification Error", ex.Message);
        }
    }

    private void OnTabHardwareClick(object sender, RoutedEventArgs e) => ShowSegment("hardware");
    private void OnTabNetworkClick(object sender, RoutedEventArgs e) => ShowSegment("network");
    private void OnTabRepairClick(object sender, RoutedEventArgs e) => ShowSegment("repair");
}
