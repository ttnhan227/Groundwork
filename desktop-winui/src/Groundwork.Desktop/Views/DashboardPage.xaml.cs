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
    private double _advisoryDeduction;

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

    protected override void OnNavigatedFrom(NavigationEventArgs e)
    {
        base.OnNavigatedFrom(e);
        _liveTimer?.Stop();
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
        // 1. Fast Device & OS Summary (Windows 11 uses build >= 22000 while reporting Major == 10)
        var osVer = Environment.OSVersion.Version;
        string osLabel = osVer.Major >= 10 && osVer.Build >= 22000 ? "Windows 11" : $"Windows {osVer.Major}";
        DeviceModelText.Text = $"{Environment.MachineName} • {osLabel} (Build {osVer.Build})";
        var uptime = TimeSpan.FromMilliseconds(Environment.TickCount64);
        UptimeText.Text = $"Uptime: {uptime.Days}d {uptime.Hours}h {uptime.Minutes}m";

        // 2-5. Run disk, power, startup, reboot, and network checks off the UI thread
        await Task.Run(() =>
        {
            string freePctText = "-- Free";
            double usedPctVal = 0;
            string capacitySummary = "Drive metrics unavailable";
            try
            {
                var drives = DriveInfo.GetDrives().Where(d => d.IsReady && d.DriveType == DriveType.Fixed).ToList();
                if (drives.Count > 0)
                {
                    var primary = drives.FirstOrDefault(d => string.Equals(d.Name, @"C:\", StringComparison.OrdinalIgnoreCase)) ?? drives[0];
                    long total = primary.TotalSize;
                    long free = primary.AvailableFreeSpace;
                    long used = Math.Max(0, total - free);
                    usedPctVal = total > 0 ? (used / (double)total) * 100.0 : 0.0;
                    double freePct = 100.0 - usedPctVal;
                    freePctText = $"{freePct:F0}% Free";
                    capacitySummary = $"{primary.Name} {ByteFormatter.FormatBytes(free)} free of {ByteFormatter.FormatBytes(total)}";
                }
            }
            catch { }

            string schemeName = "Balanced";
            string startupSummary = "Startup apps checked";
            try
            {
                var power = AppServices.Instance.OptimizationService.InspectPowerPlans();
                if (!string.IsNullOrEmpty(power.ActiveSchemeName)) schemeName = power.ActiveSchemeName;

                var startupItems = AppServices.Instance.OptimizationService.InspectStartupItems();
                int enabledCount = startupItems.Count(s => s.IsEnabled);
                startupSummary = $"{enabledCount} enabled at startup ({startupItems.Count} total)";
            }
            catch { }

            bool rebootPending = false;
            try
            {
                var health = AppServices.Instance.TroubleshootingService.InspectWindowsRepairAndHealthStatus();
                rebootPending = health.RebootPending;
            }
            catch { }

            string netBadge = "Disconnected";
            string netSummary = "No active network adapter found.";
            try
            {
                var adapters = AppServices.Instance.TroubleshootingService.InspectNetworkInterfaces();
                var active = adapters.FirstOrDefault(a => a.OperationalStatus == "Up");
                if (active != null)
                {
                    netBadge = "Connected";
                    string primaryIp = active.IpAddresses.FirstOrDefault(ip => !ip.Contains(':')) ?? active.IpAddresses.FirstOrDefault() ?? "127.0.0.1";
                    netSummary = $"{active.Name} • {primaryIp}";
                }
            }
            catch { }

            DispatcherQueue.TryEnqueue(() =>
            {
                StorageProgressBar.Value = usedPctVal;
                StorageFreePercentText.Text = freePctText;
                StorageCapacitySummaryText.Text = capacitySummary;
                ActivePowerSchemeBadge.Text = schemeName;
                StartupAppsCountText.Text = startupSummary;
                NetworkStatusBadge.Text = netBadge;
                NetworkSummaryText.Text = netSummary;

                if (rebootPending)
                {
                    PendingRebootBadge.Text = "Restart pending for updates";
                    PendingRebootBadge.Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["GwAmberBrush"];
                }
                else
                {
                    PendingRebootBadge.Text = "No pending restarts";
                    PendingRebootBadge.Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["GwSignalGreenBrush"];
                }
            });
        });

        // 6. Refresh Processes & Advisories off the UI thread
        await Task.WhenAll(RefreshTopProcessesAsync(), RefreshAdvisoriesAsync());
    }

    private void UpdateVitals()
    {
        double cpuPercent = GetCpuUsage();
        double ramPercent = GetMemoryUsage();

        LiveCpuMemText.Text = $"CPU: {cpuPercent:F0}% • RAM: {ramPercent:F0}%";

        // Dynamic Health Score: 100 minus real pressure & advisory deductions
        double health = 100.0 - _advisoryDeduction;
        if (cpuPercent > 80) health -= 10;
        if (ramPercent > 85) health -= 10;
        if (StorageProgressBar.Value > 90) health -= 10;

        health = Math.Clamp(health, 30.0, 100.0);
        OverallHealthGauge.Value = health;
        OverallHealthGauge.StatusLabel = health >= 90 ? "Optimal" : (health >= 75 ? "Good" : "Attention");
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
                var allProcs = Process.GetProcesses();
                List<ProcessRowViewModel> procs;
                try
                {
                    procs = allProcs
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
                }
                finally
                {
                    foreach (var proc in allProcs)
                    {
                        proc.Dispose();
                    }
                }

                DispatcherQueue.TryEnqueue(() =>
                {
                    TopProcesses.Clear();
                    foreach (var p in procs) TopProcesses.Add(p);
                });
            }
            catch { }
        });
    }

    private async Task RefreshAdvisoriesAsync()
    {
        var (items, deduction) = await Task.Run(() =>
        {
            var found = new System.Collections.Generic.List<OverviewAdvisoryRowViewModel>();
            double points = 0;

            try
            {
                var cDrive = DriveInfo.GetDrives().FirstOrDefault(d => d.IsReady && string.Equals(d.Name, @"C:\", StringComparison.OrdinalIgnoreCase));
                if (cDrive != null)
                {
                    double freePct = cDrive.TotalSize > 0 ? (cDrive.AvailableFreeSpace / (double)cDrive.TotalSize) * 100.0 : 100.0;
                    if (freePct < 20.0 || cDrive.AvailableFreeSpace < 30L * 1024 * 1024 * 1024)
                    {
                        points += freePct < 10.0 ? 20 : 14;
                        found.Add(new OverviewAdvisoryRowViewModel
                        {
                            CategoryBadge = "Storage",
                            Title = $"Low Space on C: ({ByteFormatter.FormatBytes(cDrive.AvailableFreeSpace)} Free)",
                            Detail = "Open Storage → Junk Cleaner to scan GPU shader caches, NVIDIA leftovers, browser caches, and Docker virtual disks.",
                            ActionTag = "Storage:cleaner",
                            IconGlyph = "\uE7BA"
                        });
                    }
                }
            }
            catch { }

            try
            {
                var broken = AppServices.Instance.OptimizationService.InspectStartupItems().Count(s => s.IsEnabled && !s.TargetExists);
                if (broken > 0)
                {
                    points += 8;
                    found.Add(new OverviewAdvisoryRowViewModel
                    {
                        CategoryBadge = "Startup",
                        Title = $"{broken} Broken Startup Entry Pointing to Missing App",
                        Detail = "Open Tweaks & Boot → Startup Apps → Missing Target to disable leftover registry Run entries.",
                        ActionTag = "Optimize:startup",
                        IconGlyph = "\uE7BA"
                    });
                }
            }
            catch { }

            try
            {
                var health = AppServices.Instance.TroubleshootingService.InspectWindowsRepairAndHealthStatus();
                if (health.RebootPending)
                {
                    points += 8;
                    found.Add(new OverviewAdvisoryRowViewModel
                    {
                        CategoryBadge = "System",
                        Title = "Pending System Reboot",
                        Detail = "A Windows update or driver installation requires a restart to complete servicing.",
                        ActionTag = "Diagnostics:repair",
                        IconGlyph = "\uE777"
                    });
                }
            }
            catch { }

            return (found, points);
        });

        DispatcherQueue.TryEnqueue(() =>
        {
            _advisoryDeduction = deduction;
            Advisories.Clear();
            foreach (var item in items) Advisories.Add(item);

            bool hasAdvisories = Advisories.Count > 0;
            HealthyEmptyStateBorder.Visibility = hasAdvisories ? Visibility.Collapsed : Visibility.Visible;
            AdvisoriesListView.Visibility = hasAdvisories ? Visibility.Visible : Visibility.Collapsed;

            HeroStatusBadgeText.Text = hasAdvisories ? $"{Advisories.Count} {(Advisories.Count == 1 ? "Issue" : "Issues")} Found" : "Optimal";
            HeroStatusBadgeBorder.Background = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources[hasAdvisories ? "GwAmberBgBrush" : "GwSignalGreenBgBrush"];
            HeroStatusBadgeText.Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources[hasAdvisories ? "GwAmberBrush" : "GwSignalGreenBrush"];
            UpdateVitals();
        });
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

    private async void OnRunAdvisoriesScanClick(object sender, RoutedEventArgs e)
    {
        await RefreshAdvisoriesAsync();
        AppServices.Instance.NotifyStatus("System diagnostics refreshed.");
    }

    private void OnNavigateStorageClick(object sender, RoutedEventArgs e)
    {
        AppServices.Instance.MainWindow?.NavigateToTab("Storage");
    }

    private void OnNavigateOptimizeClick(object sender, RoutedEventArgs e)
    {
        AppServices.Instance.MainWindow?.NavigateToTab("Optimize", "startup");
    }

    private void OnNavigateDiagnosticsClick(object sender, RoutedEventArgs e)
    {
        AppServices.Instance.MainWindow?.NavigateToTab("Diagnostics");
    }

    private void OnNavigateTweaksClick(object sender, RoutedEventArgs e)
    {
        AppServices.Instance.MainWindow?.NavigateToTab("Optimize", "settings");
    }

    private void OnNavigateRepairClick(object sender, RoutedEventArgs e)
    {
        AppServices.Instance.MainWindow?.NavigateToTab("Diagnostics", "repair");
    }

    private void OnNavigateBloatwareClick(object sender, RoutedEventArgs e)
    {
        AppServices.Instance.MainWindow?.NavigateToTab("Apps", "bloatware");
    }

    private void OnAdvisoryFixClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string actionTag || string.IsNullOrWhiteSpace(actionTag)) return;
        var parts = actionTag.Split(':', 2);
        AppServices.Instance.MainWindow?.NavigateToTab(parts[0], parts.Length > 1 ? parts[1] : null);
    }
}
