using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Groundwork.Desktop.Dialogs;
using Groundwork.Desktop.Services;
using Groundwork.Desktop.Views;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Graphics.Imaging;

namespace Groundwork.Desktop;

public sealed partial class MainWindow : Window
{
    public static new MainWindow Current { get; private set; } = null!;

    private bool _isNavigatingProgrammatically;

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr LoadImage(IntPtr hInst, string lpszName, uint uType, int cxDesired, int cyDesired, uint fuLoad);

    [DllImport("comctl32.dll", ExactSpelling = true)]
    private static extern bool SetWindowSubclass(IntPtr hWnd, SubclassProc pfnSubclass, UIntPtr uIdSubclass, UIntPtr dwRefData);

    [DllImport("comctl32.dll", ExactSpelling = true)]
    private static extern IntPtr DefSubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

    private delegate IntPtr SubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam, UIntPtr uIdSubclass, UIntPtr dwRefData);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int x; public int y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }

    private const uint WM_GETMINMAXINFO = 0x0024;
    private SubclassProc? _subclassProc;

    private IntPtr WindowSubclass(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam, UIntPtr uIdSubclass, UIntPtr dwRefData)
    {
        if (uMsg == WM_GETMINMAXINFO)
        {
            var mmi = Marshal.PtrToStructure<MINMAXINFO>(lParam);
            mmi.ptMinTrackSize.x = 960;
            mmi.ptMinTrackSize.y = 600;
            Marshal.StructureToPtr(mmi, lParam, true);
        }
        return DefSubclassProc(hWnd, uMsg, wParam, lParam);
    }

    public MainWindow()
    {
        Current = this;
        AppServices.Instance.MainWindow = this;

        this.InitializeComponent();

        SetAppIconAndTitle();

        AppServices.Instance.StatusChanged += status =>
        {
            DispatcherQueue.TryEnqueue(() => FooterStatusText.Text = status);
        };

        ApplyTheme(AppServices.Instance.Settings.ThemeMode);

        InitializeStartup();
    }

    private void SetAppIconAndTitle()
    {
        this.Title = "Groundwork — Windows System Management & Diagnostics Toolkit";
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        if (hwnd != IntPtr.Zero)
        {
            _subclassProc = WindowSubclass;
            SetWindowSubclass(hwnd, _subclassProc, UIntPtr.Zero, UIntPtr.Zero);

            try
            {
                string iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "icon.ico");
                if (File.Exists(iconPath))
                {
                    IntPtr hIcon = LoadImage(IntPtr.Zero, iconPath, 1, 32, 32, 0x00000010);
                    if (hIcon != IntPtr.Zero)
                    {
                        SendMessage(hwnd, 0x0080, (IntPtr)1, hIcon);
                        SendMessage(hwnd, 0x0080, (IntPtr)0, hIcon);
                    }
                }
            }
            catch { }
        }
    }

    public void ApplyTheme(string? theme)
    {
        if (string.Equals(theme, "Dark", StringComparison.OrdinalIgnoreCase))
        {
            RootGrid.RequestedTheme = ElementTheme.Dark;
        }
        else
        {
            RootGrid.RequestedTheme = ElementTheme.Light;
        }
    }

    private void InitializeStartup()
    {
        string[] cmdArgs = Environment.GetCommandLineArgs();
        string? startTab = cmdArgs.FirstOrDefault(a => a.StartsWith("--tab=", StringComparison.OrdinalIgnoreCase))?[6..];
        string? autoScanPath = cmdArgs.FirstOrDefault(a => a.StartsWith("--scan=", StringComparison.OrdinalIgnoreCase))?[7..];
        string? autoOrganizePath = cmdArgs.FirstOrDefault(a => a.StartsWith("--organize=", StringComparison.OrdinalIgnoreCase))?[11..];
        string? captureUiDir = cmdArgs.FirstOrDefault(a => a.StartsWith("--capture-ui=", StringComparison.OrdinalIgnoreCase))?[13..];

        if (!string.IsNullOrEmpty(captureUiDir))
        {
            DispatcherQueue.TryEnqueue(async () => await RunUiVerificationCaptureAsync(captureUiDir));
            return;
        }

        if (!string.IsNullOrEmpty(autoScanPath))
        {
            NavigateToTab("Storage", "analyzer");
            DispatcherQueue.TryEnqueue(async () =>
            {
                if (RootFrame.Content is StoragePage sp)
                {
                    await sp.RunScanAsync(autoScanPath);
                }
            });
        }
        else if (!string.IsNullOrEmpty(autoOrganizePath))
        {
            NavigateToTab("Storage", "organizer");
            DispatcherQueue.TryEnqueue(() =>
            {
                if (RootFrame.Content is StoragePage sp)
                {
                    sp.SetOrganizerTarget(autoOrganizePath);
                    sp.OnPreviewOrganizeClick(this, new RoutedEventArgs());
                }
            });
        }
        else if (!string.IsNullOrEmpty(startTab))
        {
            NavigateToTab(startTab);
        }
        else
        {
            NavigateToTab("Dashboard");
        }
    }

    public void NavigateToTabFromCli(string tag)
    {
        NavigateToTab(tag);
    }

    public void NavigateToTab(string tag, string? subView = null)
    {
        string normalized = tag.Trim();

        Type pageType = typeof(DashboardPage);
        string navTag = "Dashboard";
        object? navParam = subView;

        switch (normalized.ToLowerInvariant())
        {
            case "dashboard" or "overview" or "home":
                pageType = typeof(DashboardPage);
                navTag = "Dashboard";
                break;
            case "storage" or "analyze":
                pageType = typeof(StoragePage);
                navTag = "Storage";
                navParam ??= "analyzer";
                break;
            case "cleanup" or "maintenance" or "cleaner":
                pageType = typeof(StoragePage);
                navTag = "Storage";
                navParam ??= "cleaner";
                break;
            case "organize" or "organizer":
                pageType = typeof(StoragePage);
                navTag = "Storage";
                navParam ??= "organizer";
                break;
            case "optimize" or "performance" or "boot":
                pageType = typeof(OptimizePage);
                navTag = "Optimize";
                break;
            case "diagnostics":
                pageType = typeof(DiagnosticsPage);
                navTag = "Diagnostics";
                break;
            case "hardware":
                pageType = typeof(DiagnosticsPage);
                navTag = "Diagnostics";
                navParam ??= "hardware";
                break;
            case "troubleshoot" or "network":
                pageType = typeof(DiagnosticsPage);
                navTag = "Diagnostics";
                navParam ??= "network";
                break;
            case "repair" or "logs":
                pageType = typeof(DiagnosticsPage);
                navTag = "Diagnostics";
                navParam ??= "repair";
                break;
            case "apps" or "applications":
                pageType = typeof(ApplicationsPage);
                navTag = "Apps";
                break;
            case "assistant" or "agent":
                pageType = typeof(AssistantPage);
                navTag = "Assistant";
                break;
            case "settings":
                pageType = typeof(SettingsPage);
                navTag = "Settings";
                break;
        }

        _isNavigatingProgrammatically = true;
        try
        {
            var targetNav = TopCommandNav.MenuItems.OfType<NavigationViewItem>()
                .Concat(TopCommandNav.FooterMenuItems.OfType<NavigationViewItem>())
                .FirstOrDefault(i => string.Equals(i.Tag as string, navTag, StringComparison.OrdinalIgnoreCase));

            if (targetNav != null && !ReferenceEquals(TopCommandNav.SelectedItem, targetNav))
            {
                TopCommandNav.SelectedItem = targetNav;
            }
        }
        finally
        {
            _isNavigatingProgrammatically = false;
        }

        if (RootFrame.CurrentSourcePageType != pageType || navParam != null)
        {
            RootFrame.Navigate(pageType, navParam);
        }
    }

    private void OnNavigationSelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (_isNavigatingProgrammatically) return;

        if (args.SelectedItemContainer is NavigationViewItem item && item.Tag is string tag)
        {
            NavigateToTab(tag);
        }
    }

    private async void OnOpenHistoryHeaderClick(object sender, RoutedEventArgs e)
    {
        if (this.Content?.XamlRoot != null)
        {
            var dialog = new RollbackLedgerDialog { XamlRoot = this.Content.XamlRoot };
            await dialog.ShowAsync();
        }
    }

    private void OnRootGridKeyDown(object sender, KeyRoutedEventArgs e)
    {
        var ctrl = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(Windows.System.VirtualKey.Control);
        bool isCtrlDown = (ctrl & Windows.UI.Core.CoreVirtualKeyStates.Down) == Windows.UI.Core.CoreVirtualKeyStates.Down;

        if (isCtrlDown)
        {
            switch (e.Key)
            {
                case Windows.System.VirtualKey.Number1: NavigateToTab("Dashboard"); break;
                case Windows.System.VirtualKey.Number2: NavigateToTab("Storage"); break;
                case Windows.System.VirtualKey.Number3: NavigateToTab("Optimize"); break;
                case Windows.System.VirtualKey.Number4: NavigateToTab("Diagnostics"); break;
                case Windows.System.VirtualKey.Number5: NavigateToTab("Apps"); break;
                case Windows.System.VirtualKey.Number6: NavigateToTab("Assistant"); break;
            }
        }
    }

    // ==========================================
    // UI VERIFICATION CAPTURE AUTOMATION
    // ==========================================
    private async Task CaptureCurrentViewToPngAsync(string filePath)
    {
        if (this.Content is not UIElement rootElement) return;
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);

        var rtb = new RenderTargetBitmap();
        await rtb.RenderAsync(rootElement);
        if (rtb.PixelWidth <= 0 || rtb.PixelHeight <= 0) return;

        var pixelBuffer = await rtb.GetPixelsAsync();
        byte[] pixels = System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.ToArray(pixelBuffer);

        using var fileStream = new FileStream(filePath, FileMode.Create, FileAccess.Write);
        using var raStream = fileStream.AsRandomAccessStream();
        var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, raStream);
        encoder.SetPixelData(
            BitmapPixelFormat.Bgra8,
            BitmapAlphaMode.Premultiplied,
            (uint)rtb.PixelWidth,
            (uint)rtb.PixelHeight,
            96.0,
            96.0,
            pixels);
        await encoder.FlushAsync();
    }

    private async Task RunUiVerificationCaptureAsync(string rawOutDir)
    {
        string outDir = rawOutDir.Trim().Trim('"');
        try
        {
            Directory.CreateDirectory(outDir);
            File.AppendAllText(Path.Combine(outDir, "capture_log.txt"), $"Starting Groundwork v2.0 UI capture at {DateTime.Now:O}\n");
            await Task.Delay(1500);

            // 1. Overview Dashboard
            NavigateToTab("Dashboard");
            if (RootFrame.Content is DashboardPage dp) await dp.LoadDashboardAsync(force: true);
            await Task.Delay(800);
            await CaptureCurrentViewToPngAsync(Path.Combine(outDir, "01_overview.png"));
            File.AppendAllText(Path.Combine(outDir, "capture_log.txt"), "Captured 01_overview.png\n");

            // 2. Storage Analyzer
            NavigateToTab("Storage", "analyzer");
            string workspaceDir = AppContext.BaseDirectory;
            if (RootFrame.Content is StoragePage sp) await sp.RunScanAsync(workspaceDir);
            await Task.Delay(800);
            await CaptureCurrentViewToPngAsync(Path.Combine(outDir, "02_storage_analyzer.png"));
            File.AppendAllText(Path.Combine(outDir, "capture_log.txt"), "Captured 02_storage_analyzer.png\n");

            // 3. Hardware & Specs
            NavigateToTab("Diagnostics", "hardware");
            if (RootFrame.Content is DiagnosticsPage diagPage) await diagPage.LoadHardwareSpecsAsync(force: true);
            await Task.Delay(800);
            await CaptureCurrentViewToPngAsync(Path.Combine(outDir, "03_hardware_specs.png"));
            File.AppendAllText(Path.Combine(outDir, "capture_log.txt"), "Captured 03_hardware_specs.png\n");

            // 4. Optimize
            NavigateToTab("Optimize", "startup");
            if (RootFrame.Content is OptimizePage op) await op.LoadOptimizeStateAsync();
            await Task.Delay(800);
            await CaptureCurrentViewToPngAsync(Path.Combine(outDir, "04_optimize.png"));
            File.AppendAllText(Path.Combine(outDir, "capture_log.txt"), "Captured 04_optimize.png\n");

            // 5. Troubleshoot / Network
            NavigateToTab("Diagnostics", "network");
            if (RootFrame.Content is DiagnosticsPage diagPage2) await diagPage2.LoadNetworkStateAsync();
            await Task.Delay(800);
            await CaptureCurrentViewToPngAsync(Path.Combine(outDir, "05_troubleshoot.png"));
            File.AppendAllText(Path.Combine(outDir, "capture_log.txt"), "Captured 05_troubleshoot.png\n");

            // 6. Storage Cleanup
            NavigateToTab("Storage", "cleaner");
            if (RootFrame.Content is StoragePage sp2) await sp2.ScanJunkAsync();
            await Task.Delay(800);
            await CaptureCurrentViewToPngAsync(Path.Combine(outDir, "06_storage_cleanup.png"));
            File.AppendAllText(Path.Combine(outDir, "capture_log.txt"), "Captured 06_storage_cleanup.png\n");

            // 7. Organize
            NavigateToTab("Storage", "organizer");
            if (RootFrame.Content is StoragePage sp3)
            {
                sp3.SetOrganizerTarget(AppContext.BaseDirectory);
                sp3.OnPreviewOrganizeClick(this, new RoutedEventArgs());
            }
            await Task.Delay(600);
            await CaptureCurrentViewToPngAsync(Path.Combine(outDir, "07_organize_history.png"));
            File.AppendAllText(Path.Combine(outDir, "capture_log.txt"), "Captured 07_organize_history.png\n");

            // 8. Installed Apps
            NavigateToTab("Apps");
            if (RootFrame.Content is ApplicationsPage ap) await ap.LoadAppsAsync();
            await Task.Delay(800);
            await CaptureCurrentViewToPngAsync(Path.Combine(outDir, "08_installed_apps.png"));
            File.AppendAllText(Path.Combine(outDir, "capture_log.txt"), "Captured 08_installed_apps.png\n");

            // 9. AI Assistant Standby
            NavigateToTab("Assistant");
            await Task.Delay(600);
            await CaptureCurrentViewToPngAsync(Path.Combine(outDir, "09_agent_standby.png"));
            File.AppendAllText(Path.Combine(outDir, "capture_log.txt"), "Captured 09_agent_standby.png\n");

            // 10. AI Assistant Active
            if (RootFrame.Content is AssistantPage ap2)
            {
                ap2.SetQuery("Switch my DNS to Cloudflare.");
                // Fire query
                ap2.OnSendQueryClick(this, new RoutedEventArgs());
                await Task.Delay(1200);
            }
            await CaptureCurrentViewToPngAsync(Path.Combine(outDir, "10_agent_investigation.png"));
            File.AppendAllText(Path.Combine(outDir, "capture_log.txt"), "Captured 10_agent_investigation.png\n");

            // 11. Settings
            NavigateToTab("Settings");
            await Task.Delay(600);
            await CaptureCurrentViewToPngAsync(Path.Combine(outDir, "11_settings.png"));
            File.AppendAllText(Path.Combine(outDir, "capture_log.txt"), "Captured 11_settings.png\n");
        }
        catch (Exception ex)
        {
            try
            {
                File.AppendAllText(Path.Combine(outDir, "capture_log.txt"), $"ERROR: {ex}\n");
            }
            catch { }
        }
        finally
        {
            this.Close();
        }
    }
}
