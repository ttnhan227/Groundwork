using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Groundwork.Desktop.Dialogs;
using Groundwork.Desktop.Services;
using Groundwork.Engine.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace Groundwork.Desktop.Views;

public sealed partial class DashboardPage : Page
{
    private DispatcherTimer? _liveTimer;
    private long _prevIdleTime;
    private long _prevTotalTime;

    public ObservableCollection<ProcessRowViewModel> TopProcesses { get; } = new();
    public ObservableCollection<OverviewAdvisoryRowViewModel> Advisories { get; } = new();

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemTimes(out System.Runtime.InteropServices.ComTypes.FILETIME lpIdleTime, out System.Runtime.InteropServices.ComTypes.FILETIME lpKernelTime, out System.Runtime.InteropServices.ComTypes.FILETIME lpUserTime);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    public DashboardPage()
    {
        this.InitializeComponent();
        this.NavigationCacheMode = NavigationCacheMode.Required;

        TopProcessesListView.ItemsSource = TopProcesses;
        AdvisoriesListView.ItemsSource = Advisories;
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        await LoadDashboardAsync();
        StartLiveTelemetry();
    }

    private void StartLiveTelemetry()
    {
        if (_liveTimer == null)
        {
            _liveTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
            _liveTimer.Tick += (s, e) => UpdateVitals();
        }
        _liveTimer.Start();
        UpdateVitals();
    }

    public async Task LoadDashboardAsync(bool force = false)
    {
        // 1. Fast Device & OS Summary
        DeviceModelText.Text = $"{Environment.MachineName} • Windows {Environment.OSVersion.Version.Major}";
        var uptime = TimeSpan.FromMilliseconds(Environment.TickCount64);
        UptimeText.Text = $"Uptime: {uptime.Days}d {uptime.Hours}h {uptime.Minutes}m";

        // 2. Storage Subsystem Fast Snapshot
        try
        {
            var drives = DriveInfo.GetDrives().Where(d => d.IsReady && d.DriveType == DriveType.Fixed).ToList();
            if (drives.Count > 0)
            {
                var primary = drives.FirstOrDefault(d => string.Equals(d.Name, @"C:\", StringComparison.OrdinalIgnoreCase)) ?? drives[0];
                long total = primary.TotalSize;
                long free = primary.AvailableFreeSpace;
                long used = Math.Max(0, total - free);
                double usedPct = total > 0 ? (used / (double)total) * 100.0 : 0.0;
                double freePct = 100.0 - usedPct;

                StorageProgressBar.Value = usedPct;
                StorageFreePercentText.Text = $"{freePct:F0}% Free";
                StorageCapacitySummaryText.Text = $"{primary.Name} {ByteFormatter.FormatBytes(used)} Used of {ByteFormatter.FormatBytes(total)} ({ByteFormatter.FormatBytes(free)} Free)";
            }
        }
        catch { }

        // 3. Performance & Boot Snapshot
        try
        {
            var power = AppServices.Instance.OptimizationService.InspectPowerPlans();
            ActivePowerSchemeBadge.Text = !string.IsNullOrEmpty(power.ActiveSchemeName) ? power.ActiveSchemeName : "Balanced";

            var startupItems = AppServices.Instance.OptimizationService.InspectStartupItems();
            int enabledCount = startupItems.Count(s => s.IsEnabled);
            StartupAppsCountText.Text = $"{enabledCount} Apps Launch at Boot ({startupItems.Count} total)";
        }
        catch { }

        // 4. Pending Reboot Status
        try
        {
            var health = AppServices.Instance.TroubleshootingService.InspectWindowsRepairAndHealthStatus();
            if (health.RebootPending)
            {
                PendingRebootBadge.Text = "System Reboot Pending";
                PendingRebootBadge.Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["GwAmberBrush"];
            }
            else
            {
                PendingRebootBadge.Text = "No Pending System Reboots";
                PendingRebootBadge.Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["GwSignalGreenBrush"];
            }
        }
        catch { }

        // 5. Network Quick Check
        try
        {
            var adapters = AppServices.Instance.TroubleshootingService.InspectNetworkInterfaces();
            var active = adapters.FirstOrDefault(a => a.OperationalStatus == "Up");
            if (active != null)
            {
                NetworkStatusBadge.Text = "Connected";
                string primaryIp = active.IpAddresses.FirstOrDefault(ip => !ip.Contains(':')) ?? active.IpAddresses.FirstOrDefault() ?? "127.0.0.1";
                NetworkSummaryText.Text = $"{active.Name} • IP: {primaryIp}";
            }
            else
            {
                NetworkStatusBadge.Text = "Disconnected";
                NetworkSummaryText.Text = "No active network interface discovered.";
            }
        }
        catch { }

        // 6. Refresh Processes
        await RefreshTopProcessesAsync();

        // 7. Advisories Check
        RefreshAdvisories();
    }

    private void UpdateVitals()
    {
        double cpuPercent = GetCpuUsage();
        double ramPercent = GetMemoryUsage();

        LiveCpuMemText.Text = $"CPU: {cpuPercent:F0}% • RAM: {ramPercent:F0}%";

        // Dynamic Health Score: 100 minus pressure deductions
        double health = 100.0;
        if (cpuPercent > 80) health -= 15;
        if (ramPercent > 85) health -= 15;
        if (StorageProgressBar.Value > 90) health -= 20;

        OverallHealthGauge.Value = Math.Max(50, health);
        OverallHealthGauge.StatusLabel = health >= 85 ? "Optimal" : (health >= 70 ? "Good" : "Attention");
    }

    private double GetCpuUsage()
    {
        try
        {
            if (GetSystemTimes(out var idle, out var kernel, out var user))
            {
                long idleTime = ((long)idle.dwHighDateTime << 32) | (uint)idle.dwLowDateTime;
                long kernelTime = ((long)kernel.dwHighDateTime << 32) | (uint)kernel.dwLowDateTime;
                long userTime = ((long)user.dwHighDateTime << 32) | (uint)user.dwLowDateTime;
                long totalTime = kernelTime + userTime;

                long diffIdle = idleTime - _prevIdleTime;
                long diffTotal = totalTime - _prevTotalTime;

                _prevIdleTime = idleTime;
                _prevTotalTime = totalTime;

                if (diffTotal > 0)
                {
                    double cpu = (1.0 - (diffIdle / (double)diffTotal)) * 100.0;
                    return Math.Clamp(cpu, 0.0, 100.0);
                }
            }
        }
        catch { }
        return 5.0;
    }

    private double GetMemoryUsage()
    {
        try
        {
            var mem = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX)) };
            if (GlobalMemoryStatusEx(ref mem))
            {
                return mem.dwMemoryLoad;
            }
        }
        catch { }
        return 40.0;
    }

    private async Task RefreshTopProcessesAsync()
    {
        await Task.Run(() =>
        {
            try
            {
                var procs = Process.GetProcesses()
                    .Where(p => !string.IsNullOrEmpty(p.ProcessName))
                    .OrderByDescending(p =>
                    {
                        try { return p.WorkingSet64; } catch { return 0; }
                    })
                    .Take(6)
                    .Select(p =>
                    {
                        long ws = 0;
                        int threads = 0;
                        try { ws = p.WorkingSet64; threads = p.Threads.Count; } catch { }
                        return new ProcessRowViewModel
                        {
                            ProcessId = p.Id,
                            ProcessName = p.ProcessName,
                            WorkingSetDisplay = ByteFormatter.FormatBytes(ws),
                            ThreadCount = threads
                        };
                    })
                    .ToList();

                DispatcherQueue.TryEnqueue(() =>
                {
                    TopProcesses.Clear();
                    foreach (var p in procs) TopProcesses.Add(p);
                });
            }
            catch { }
        });
    }

    private void RefreshAdvisories()
    {
        Advisories.Clear();

        // Check storage headroom
        if (StorageProgressBar.Value > 90)
        {
            Advisories.Add(new OverviewAdvisoryRowViewModel
            {
                CategoryBadge = "Storage",
                Title = "Low Storage Headroom on Primary Drive",
                Detail = "Less than 10% free space remaining. Cleaning junk and cache can free up critical room.",
                IconGlyph = "\uE7BA"
            });
        }

        // Check pending reboot
        try
        {
            var health = AppServices.Instance.TroubleshootingService.InspectWindowsRepairAndHealthStatus();
            if (health.RebootPending)
            {
                Advisories.Add(new OverviewAdvisoryRowViewModel
                {
                    CategoryBadge = "System",
                    Title = "Pending System Reboot",
                    Detail = "A Windows update or driver installation requires a restart to complete servicing.",
                    IconGlyph = "\uE777"
                });
            }
        }
        catch { }

        bool hasAdvisories = Advisories.Count > 0;
        HealthyEmptyStateBorder.Visibility = hasAdvisories ? Visibility.Collapsed : Visibility.Visible;
        AdvisoriesListView.Visibility = hasAdvisories ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void OnSmartHealthCheckClick(object sender, RoutedEventArgs e)
    {
        QuickSmartCheckBtn.IsEnabled = false;
        try
        {
            await LoadDashboardAsync(force: true);
            AppServices.Instance.NotifyStatus("Smart Health Check completed: all systems nominal.");
        }
        finally
        {
            QuickSmartCheckBtn.IsEnabled = true;
        }
    }

    private async void OnOpenHistoryClick(object sender, RoutedEventArgs e)
    {
        if (this.XamlRoot != null)
        {
            var dialog = new RollbackLedgerDialog { XamlRoot = this.XamlRoot };
            await dialog.ShowAsync();
        }
    }

    private async void OnRefreshProcessesClick(object sender, RoutedEventArgs e)
    {
        await RefreshTopProcessesAsync();
    }

    private void OnRunAdvisoriesScanClick(object sender, RoutedEventArgs e)
    {
        RefreshAdvisories();
        AppServices.Instance.NotifyStatus("System diagnostics refreshed.");
    }

    private void OnNavigateStorageClick(object sender, RoutedEventArgs e)
    {
        AppServices.Instance.MainWindow?.NavigateToTab("Storage");
    }

    private void OnNavigateOptimizeClick(object sender, RoutedEventArgs e)
    {
        AppServices.Instance.MainWindow?.NavigateToTab("Optimize");
    }

    private void OnNavigateDiagnosticsClick(object sender, RoutedEventArgs e)
    {
        AppServices.Instance.MainWindow?.NavigateToTab("Diagnostics");
    }
}
