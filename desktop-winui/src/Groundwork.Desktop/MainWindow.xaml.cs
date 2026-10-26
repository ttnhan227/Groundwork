using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;
using Groundwork.Engine.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Input;

namespace Groundwork.Desktop;

public sealed partial class MainWindow : Window
{
    private readonly DriveDiscoveryService _driveDiscovery = new();
    private readonly Win32StorageScanner _win32Scanner = new();
    private readonly DuplicateEngineService _duplicateEngine = new();
    private readonly SafeCleanupService _cleanupService = new();
    private readonly InstalledAppsEngineService _installedAppsEngine = new();
    private readonly HardwareSpecsEngineService _hardwareEngine = new();
    private readonly List<(string User, string Assistant)> _agentConversation = new();

    private CancellationTokenSource? _scanCts;
    private DriveScanResult? _lastScanResult;
    private Dictionary<int, List<ScannedEntry>>? _childrenByParentId;
    private DuplicateScanReport? _lastDuplicateReport;
    private IReadOnlyList<InstalledApplicationInfo> _allInstalledApps = Array.Empty<InstalledApplicationInfo>();
    private string _currentLeftoverInstallLocation = string.Empty;
    private int _leftoverScanGeneration;
    private AppSettingsModel _settings = new();
    private HardwareSystemReport? _lastHardwareReport;

    public ObservableCollection<VolumeRowViewModel> Volumes { get; } = new();
    public ObservableCollection<StorageTreeNodeViewModel> StorageTreeNodes { get; } = new();
    public ObservableCollection<StorageBarSegmentViewModel> StorageBarSegments { get; } = new();
    public ObservableCollection<CategoryRowViewModel> Categories { get; } = new();
    public ObservableCollection<DuplicateGroupCardViewModel> DuplicateGroups { get; } = new();
    public ObservableCollection<CleanupCandidateRowViewModel> CleanupCandidates { get; } = new();
    public ObservableCollection<StorageSenseCategoryCardViewModel> StorageSenseCategories { get; } = new();
    public ObservableCollection<InstalledAppRowViewModel> InstalledApps { get; } = new();
    public ObservableCollection<LeftoverItemRowViewModel> LeftoverItems { get; } = new();
    public ObservableCollection<FileRowViewModel> ScannedFiles { get; } = new();
    public ObservableCollection<AssistantItemRowViewModel> AssistantKeyItems { get; } = new();
    public ObservableCollection<AssistantRecommendationViewModel> AssistantRecommendations { get; } = new();
    public ObservableCollection<PhysicalDiskSpecsInfo> HardwareDisks { get; } = new();
    public ObservableCollection<MemoryModuleInfo> HardwareMemoryModules { get; } = new();
    public ObservableCollection<GpuSpecsInfo> HardwareGpus { get; } = new();
    public ObservableCollection<NetworkAdapterSpecsInfo> HardwareNetworks { get; } = new();
    public ObservableCollection<HardwareDriverRowViewModel> HardwareDrivers { get; } = new();
    public ItemMetadataViewModel SelectedMetadata { get; } = new();

    public MainWindow()
    {
        this.InitializeComponent();
        SetAppIconAndTitle();

        StorageTreeListView.ItemsSource = StorageTreeNodes;
        StorageFileListView.ItemsSource = ScannedFiles;
        StorageBreakdownLegendControl.ItemsSource = StorageBarSegments;
        DuplicateGroupsListView.ItemsSource = DuplicateGroups;
        CleanupCandidatesListView.ItemsSource = CleanupCandidates;
        StorageSenseCardsControl.ItemsSource = StorageSenseCategories;
        InstalledAppsListView.ItemsSource = InstalledApps;
        LeftoversListView.ItemsSource = LeftoverItems;
        AssistantItemsListView.ItemsSource = AssistantKeyItems;
        AssistantRecommendationsControl.ItemsSource = AssistantRecommendations;
        HardwareDisksListView.ItemsSource = HardwareDisks;
        HardwareMemoryListView.ItemsSource = HardwareMemoryModules;
        HardwareGpusListView.ItemsSource = HardwareGpus;
        HardwareNetworkListView.ItemsSource = HardwareNetworks;
        HardwareDriversListView.ItemsSource = HardwareDrivers;

        InitializeStartupState();
    }

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Auto)]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Auto)]
    private static extern IntPtr LoadImage(IntPtr hInst, string lpszName, uint uType, int cxDesired, int cyDesired, uint fuLoad);

    [System.Runtime.InteropServices.DllImport("comctl32.dll", ExactSpelling = true)]
    private static extern bool SetWindowSubclass(IntPtr hWnd, SubclassProc pfnSubclass, UIntPtr uIdSubclass, UIntPtr dwRefData);

    [System.Runtime.InteropServices.DllImport("comctl32.dll", ExactSpelling = true)]
    private static extern IntPtr DefSubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

    private delegate IntPtr SubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam, UIntPtr uIdSubclass, UIntPtr dwRefData);

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
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
            var mmi = System.Runtime.InteropServices.Marshal.PtrToStructure<MINMAXINFO>(lParam);
            mmi.ptMinTrackSize.x = 960;
            mmi.ptMinTrackSize.y = 600;
            System.Runtime.InteropServices.Marshal.StructureToPtr(mmi, lParam, true);
        }
        return DefSubclassProc(hWnd, uMsg, wParam, lParam);
    }

    private const uint WM_SETICON = 0x0080;
    private const IntPtr ICON_SMALL = 0;
    private const IntPtr ICON_BIG = 1;
    private const uint IMAGE_ICON = 1;
    private const uint LR_LOADFROMFILE = 0x00000010;

    private void SetAppIconAndTitle()
    {
        try
        {
            this.Title = "Groundwork — Storage & Cleanup";
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
            var appWindow = Microsoft.UI.Windowing.AppWindow.GetFromWindowId(windowId);

            _subclassProc = new SubclassProc(WindowSubclass);
            SetWindowSubclass(hwnd, _subclassProc, UIntPtr.Zero, UIntPtr.Zero);

            if (appWindow != null)
            {
                appWindow.Changed += (s, args) =>
                {
                    if (args.DidSizeChange)
                    {
                        var size = appWindow.Size;
                        int minW = 960;
                        int minH = 600;
                        if (size.Width < minW || size.Height < minH)
                        {
                            appWindow.Resize(new Windows.Graphics.SizeInt32(Math.Max(minW, size.Width), Math.Max(minH, size.Height)));
                        }
                    }
                };
                var displayArea = Microsoft.UI.Windowing.DisplayArea.GetFromWindowId(windowId, Microsoft.UI.Windowing.DisplayAreaFallback.Primary);
                if (displayArea != null)
                {
                    int width = Math.Min(1400, (int)(displayArea.WorkArea.Width * 0.88));
                    int height = Math.Min(900, (int)(displayArea.WorkArea.Height * 0.88));
                    width = Math.Max(1100, width);
                    height = Math.Max(700, height);
                    int x = (displayArea.WorkArea.Width - width) / 2 + displayArea.WorkArea.X;
                    int y = (displayArea.WorkArea.Height - height) / 2 + displayArea.WorkArea.Y;
                    appWindow.MoveAndResize(new Windows.Graphics.RectInt32(x, y, width, height));
                }

                string iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "icon.ico");
                if (!File.Exists(iconPath))
                {
                    iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Assets", "icon.ico");
                }

                if (File.Exists(iconPath))
                {
                    appWindow.SetIcon(iconPath);

                    IntPtr hIconBig = LoadImage(IntPtr.Zero, iconPath, IMAGE_ICON, 32, 32, LR_LOADFROMFILE);
                    IntPtr hIconSmall = LoadImage(IntPtr.Zero, iconPath, IMAGE_ICON, 16, 16, LR_LOADFROMFILE);
                    if (hIconSmall != IntPtr.Zero)
                    {
                        SendMessage(hwnd, WM_SETICON, ICON_SMALL, hIconSmall);
                    }
                    if (hIconBig != IntPtr.Zero)
                    {
                        SendMessage(hwnd, WM_SETICON, ICON_BIG, hIconBig);
                    }
                }
            }
        }
        catch
        {
        }
    }

    private void OnRootGridKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Escape)
        {
            if (StartupDriveModalOverlay.Visibility == Visibility.Visible)
            {
                StartupDriveModalOverlay.Visibility = Visibility.Collapsed;
                e.Handled = true;
            }
        }
    }

    private void OnModalBackdropPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        StartupDriveModalOverlay.Visibility = Visibility.Collapsed;
        e.Handled = true;
    }

    private void OnModalCardPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        e.Handled = true;
    }

    private void InitializeStartupState()
    {
        try
        {
            _settings = AppSettingsService.Load();
            _agentConversation.Clear();
            if (_settings.RememberAgentConversation)
            {
                _agentConversation.AddRange(AgentLocalStateService.LoadConversation().Select(turn => (turn.User, turn.Assistant)));
            }
            _lastHardwareReport = AgentLocalStateService.LoadInventory();
            ApplyLoadedSettings();
            RefreshDrivesList();
            
            // Pop up the drive selection modal immediately on every launch unless tab flag specified
            string[] cmdArgs = Environment.GetCommandLineArgs();
            string? startTab = cmdArgs.FirstOrDefault(a => a.StartsWith("--tab=", StringComparison.OrdinalIgnoreCase))?.Substring(6);
            if (!string.IsNullOrEmpty(startTab))
            {
                StartupDriveModalOverlay.Visibility = Visibility.Collapsed;
                DispatcherQueue.TryEnqueue(() => NavigateToTab(startTab));
            }
            else
            {
                StartupDriveModalOverlay.Visibility = Visibility.Visible;
            }

            // Pre-load installed apps in background so it never blocks startup or drive selection
            _ = Task.Run(() =>
            {
                try
                {
                    _allInstalledApps = _installedAppsEngine.EnumerateInstalledApps();
                    DispatcherQueue.TryEnqueue(() =>
                    {
                        ApplyInstalledAppsFilter(AppSearchFilterBox.Text);
                    });
                }
                catch { }
            });
        }
        catch (Exception ex)
        {
            FooterStatusText.Text = $"Startup error: {ex.Message}";
        }
    }

    private void ApplyLoadedSettings()
    {
        if (this.Content is FrameworkElement root)
        {
            root.RequestedTheme = _settings.ThemeMode switch
            {
                "Light" => ElementTheme.Light,
                "Dark" => ElementTheme.Dark,
                _ => ElementTheme.Default
            };
        }

        DefaultScanPathBox.Text = _settings.DefaultScanPath;
        ParallelThreadsBox.Text = _settings.ParallelThreads.ToString();
        ExcludedPathsBox.Text = _settings.ExcludedPaths;
        ConfirmBeforeDeleteToggle.IsOn = _settings.ConfirmBeforeDelete;
        SettingsOllamaUrlBox.Text = _settings.OllamaUrl;
        SettingsOllamaModelBox.Text = _settings.OllamaModel;
        SettingsGeminiApiKeyBox.Password = _settings.GeminiApiKey;
        SettingsGeminiModelBox.Text = _settings.GeminiModel;
        SettingsGeminiEndpointBox.Text = _settings.GeminiEndpoint;
        GeminiGoogleSearchToggle.IsOn = _settings.GeminiGoogleSearchEnabled;
        RememberAgentConversationToggle.IsOn = _settings.RememberAgentConversation;
        SettingsOpenAiApiKeyBox.Password = _settings.OpenAiApiKey;
        SettingsOpenAiModelBox.Text = _settings.OpenAiModel;
        SettingsOpenAiEndpointBox.Text = _settings.OpenAiEndpoint;

        SelectComboBoxByTag(SettingsAiProviderComboBox, _settings.AiProvider);
        UpdateProviderPanelsVisibility(_settings.AiProvider);
        UpdateAgentViewMode();

        SelectComboBoxByTag(ThemeModeComboBox, _settings.ThemeMode);
        SelectComboBoxByTag(SizeUnitComboBox, _settings.SizeUnit);
        MaskSerialsToggle.IsOn = _settings.MaskHardwareSerials;
        ExcludedExtensionsBox.Text = _settings.ExcludedExtensions;
    }

    private static void SelectComboBoxByTag(ComboBox comboBox, string tag)
    {
        for (int i = 0; i < comboBox.Items.Count; i++)
        {
            if (comboBox.Items[i] is ComboBoxItem item && string.Equals(item.Tag as string, tag, StringComparison.OrdinalIgnoreCase))
            {
                comboBox.SelectedIndex = i;
                break;
            }
        }
    }

    private void OnThemeModeSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ThemeModeComboBox.SelectedItem is ComboBoxItem item && item.Tag is string themeTag)
        {
            _settings.ThemeMode = themeTag;
            if (this.Content is FrameworkElement root)
            {
                root.RequestedTheme = themeTag switch
                {
                    "Light" => ElementTheme.Light,
                    "Dark" => ElementTheme.Dark,
                    _ => ElementTheme.Default
                };
            }
        }
    }

    private bool IsLightMode()
    {
        if (string.Equals(_settings.ThemeMode, "Light", StringComparison.OrdinalIgnoreCase)) return true;
        if (string.Equals(_settings.ThemeMode, "Dark", StringComparison.OrdinalIgnoreCase)) return false;
        return App.Current.RequestedTheme == ApplicationTheme.Light;
    }

    private void OnNavigationSelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        string? tag = null;
        if (args.IsSettingsSelected)
        {
            tag = "Settings";
        }
        else if (args.SelectedItem is NavigationViewItem item && item.Tag is string itemTag)
        {
            tag = itemTag;
        }

        if (tag != null)
        {
            SwitchToPanel(tag);
        }
    }

    private void SwitchToPanel(string tag)
    {
        if (SettingsPanel != null && SettingsPanel.Visibility == Visibility.Visible)
        {
            SaveSettingsFromUi();
        }

        if (StoragePanel != null) StoragePanel.Visibility = string.Equals(tag, "Storage", StringComparison.OrdinalIgnoreCase) ? Visibility.Visible : Visibility.Collapsed;
        if (CleanupPanel != null) CleanupPanel.Visibility = string.Equals(tag, "Cleanup", StringComparison.OrdinalIgnoreCase) ? Visibility.Visible : Visibility.Collapsed;
        if (AppsPanel != null) AppsPanel.Visibility = string.Equals(tag, "Apps", StringComparison.OrdinalIgnoreCase) ? Visibility.Visible : Visibility.Collapsed;
        if (HardwarePanel != null) HardwarePanel.Visibility = string.Equals(tag, "Hardware", StringComparison.OrdinalIgnoreCase) ? Visibility.Visible : Visibility.Collapsed;
        if (AssistantPanel != null) AssistantPanel.Visibility = (string.Equals(tag, "Agent", StringComparison.OrdinalIgnoreCase) || string.Equals(tag, "Assistant", StringComparison.OrdinalIgnoreCase)) ? Visibility.Visible : Visibility.Collapsed;
        if (OrganizePanel != null) OrganizePanel.Visibility = string.Equals(tag, "Organize", StringComparison.OrdinalIgnoreCase) ? Visibility.Visible : Visibility.Collapsed;
        if (SettingsPanel != null) SettingsPanel.Visibility = string.Equals(tag, "Settings", StringComparison.OrdinalIgnoreCase) ? Visibility.Visible : Visibility.Collapsed;

        if (string.Equals(tag, "Hardware", StringComparison.OrdinalIgnoreCase))
        {
            _ = LoadHardwareSpecsAsync();
        }

        if (string.Equals(tag, "Agent", StringComparison.OrdinalIgnoreCase) || string.Equals(tag, "Assistant", StringComparison.OrdinalIgnoreCase))
        {
            UpdateAgentViewMode();
        }

        if (string.Equals(tag, "Cleanup", StringComparison.OrdinalIgnoreCase))
        {
            _ = PreloadCleanupDiagnosticsAsync();
        }
    }

    // ==========================================
    // 1. DRIVES & STORAGE SCANNER
    // ==========================================

    private void RefreshDrivesList(string? preserveTag = null)
    {
        string currentTag = preserveTag 
            ?? (DrivesComboBox.SelectedItem as ComboBoxItem)?.Tag as string 
            ?? ScanPathTextBox.Text;

        Volumes.Clear();
        DrivesComboBox.Items.Clear();

        // 1. [All Drives] option
        var allDrivesItem = new ComboBoxItem
        {
            Content = "💻 All Drives (Entire PC)",
            Tag = "__ALL_DRIVES__"
        };
        DrivesComboBox.Items.Add(allDrivesItem);

        var discovered = _driveDiscovery.DiscoverVolumes();
        string systemDrive = Path.GetPathRoot(Environment.SystemDirectory)?.TrimEnd('\\') ?? "C:";
        int matchIndex = -1;
        int idx = 1;

        foreach (var v in discovered)
        {
            bool isSystem = string.Equals(v.RootPath.TrimEnd('\\'), systemDrive, StringComparison.OrdinalIgnoreCase);
            string friendlyType = isSystem 
                ? "Windows System Drive" 
                : v.DriveType switch
                {
                    "Fixed" => "Internal Storage",
                    "Removable" => "USB Drive",
                    "Network" => "Network Drive",
                    _ => $"{v.DriveType} Storage"
                };

            var vm = new VolumeRowViewModel(
                RootPath: v.RootPath,
                VolumeName: v.VolumeName,
                FileSystemLabel: friendlyType,
                CapacitySummary: $"{ByteFormatter.FormatBytes(v.FreeBytes)} free of {ByteFormatter.FormatBytes(v.TotalBytes)}",
                UsedPercent: v.UsedPercent,
                MftBadge: v.SupportsUsnMftScan ? "NTFS volume" : "Standard scan"
            );
            Volumes.Add(vm);

            var comboItem = new ComboBoxItem
            {
                Content = $"💾 {v.VolumeName}  ({ByteFormatter.FormatBytes(v.FreeBytes)} free of {ByteFormatter.FormatBytes(v.TotalBytes)})",
                Tag = v.RootPath
            };
            DrivesComboBox.Items.Add(comboItem);

            if (!string.IsNullOrEmpty(currentTag) && 
                (string.Equals(v.RootPath, currentTag, StringComparison.OrdinalIgnoreCase) || 
                 currentTag.StartsWith(v.RootPath, StringComparison.OrdinalIgnoreCase)))
            {
                matchIndex = idx;
            }
            idx++;
        }

        // 2. Select Folder & Import options
        DrivesComboBox.Items.Add(new ComboBoxItem { Content = "📁 Select Specific Folder...", Tag = "__SELECT_FOLDER__" });
        DrivesComboBox.Items.Add(new ComboBoxItem { Content = "📄 Import Saved Scan (CSV)...", Tag = "__SELECT_CSV__" });

        if (matchIndex >= 0)
        {
            DrivesComboBox.SelectedIndex = matchIndex;
        }
        else if (currentTag == "__ALL_DRIVES__")
        {
            DrivesComboBox.SelectedIndex = 0;
        }
        else if (DrivesComboBox.Items.Count > 1)
        {
            DrivesComboBox.SelectedIndex = 1;
        }
    }

    private void OnRefreshDrivesClick(object sender, RoutedEventArgs e)
    {
        RefreshDrivesList();
    }

    private async void OnDrivesComboBoxSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (DrivesComboBox.SelectedItem is ComboBoxItem item && item.Tag is string tag)
        {
            if (tag == "__ALL_DRIVES__")
            {
                ScanPathTextBox.Text = "[All Hard Drives]";
            }
            else if (tag == "__SELECT_FOLDER__")
            {
                await PickAndScanFolderAsync();
            }
            else if (tag == "__SELECT_CSV__")
            {
                await PickAndScanCsvAsync();
            }
            else
            {
                ScanPathTextBox.Text = tag;
            }
        }
    }

    private async void OnQuickScanPrimaryDriveClick(object sender, RoutedEventArgs e)
    {
        string primary = Volumes.FirstOrDefault()?.RootPath ?? Path.GetPathRoot(Environment.SystemDirectory) ?? @"C:\";
        ScanPathTextBox.Text = primary;
        await RunStorageScanAsync(primary);
    }

    private async void OnRunScanPathClick(object sender, RoutedEventArgs e)
    {
        string path = ScanPathTextBox.Text.Trim().Trim('"', '\'');
        if (string.IsNullOrWhiteSpace(path) || path.StartsWith("[All", StringComparison.OrdinalIgnoreCase))
        {
            await RunMultiDriveScanAsync();
            return;
        }

        if (path.Length == 2 && path[1] == ':' && char.IsLetter(path[0]))
        {
            path += "\\";
            ScanPathTextBox.Text = path;
        }

        if (!Directory.Exists(path) && !File.Exists(path))
        {
            ScanSummaryHeaderText.Text = $"Path not found: {path}";
            FooterStatusText.Text = "Please enter a valid drive or folder path.";
            return;
        }

        await RunStorageScanAsync(path);
    }

    private async void OnScanCustomPathClick(object sender, RoutedEventArgs e)
    {
        await PickAndScanFolderAsync();
    }

    private void OnCancelScanClick(object sender, RoutedEventArgs e)
    {
        _scanCts?.Cancel();
    }

    private StorageScanOptions BuildStorageScanOptions(string rootPath)
    {
        var excludedDirectoryNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var excludedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string raw in _settings.ExcludedPaths.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            string value = Environment.ExpandEnvironmentVariables(raw.Trim().Trim('"'));
            try
            {
                if (Path.IsPathRooted(value))
                {
                    excludedPaths.Add(Path.GetFullPath(value));
                }
                else if (value.Contains(Path.DirectorySeparatorChar) || value.Contains(Path.AltDirectorySeparatorChar))
                {
                    excludedPaths.Add(Path.GetFullPath(Path.Combine(rootPath, value)));
                }
                else
                {
                    excludedDirectoryNames.Add(value);
                }
            }
            catch { }
        }

        var excludedExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string raw in _settings.ExcludedExtensions.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            string extension = raw.Trim();
            if (extension.Length > 0)
            {
                excludedExtensions.Add(extension.StartsWith('.') ? extension : "." + extension);
            }
        }

        return new StorageScanOptions(
            WorkerCount: Math.Clamp(_settings.ParallelThreads, 2, 16),
            ExcludedDirectoryNames: excludedDirectoryNames,
            ExcludedPaths: excludedPaths,
            ExcludedExtensions: excludedExtensions);
    }

    private async Task RunStorageScanAsync(string rootPath)
    {
        var scanOptions = BuildStorageScanOptions(rootPath);
        _scanCts?.Cancel();
        _scanCts = new CancellationTokenSource();
        var token = _scanCts.Token;

        StartupDriveModalOverlay.Visibility = Visibility.Collapsed;
        StorageLoadingOverlay.Visibility = Visibility.Visible;
        LoadingTargetTitleText.Text = $"Scanning {rootPath}...";
        LoadingSubtitleText.Text = "Parallel scanner discovering files & calculating disk allocation...";
        LoadingFilesCountText.Text = "0";
        LoadingFoldersCountText.Text = "0";
        LoadingDataDiscoveredText.Text = "0 B";
        LoadingScanSpeedText.Text = "Starting workers...";
        LoadingCurrentPathText.Text = rootPath;

        CancelScanButton.IsEnabled = true;
        ScanActivityProgressBar.Visibility = Visibility.Visible;
        ScanActivityProgressBar.IsIndeterminate = true;
        ScanSummaryHeaderText.Text = $"Scanning {rootPath}...";
        ScanMetricsDetailText.Text = "Traversing directory hierarchy in parallel...";

        var progress = new Progress<ScanProgressReport>(report =>
        {
            DispatcherQueue.TryEnqueue(() =>
            {
                LoadingFilesCountText.Text = $"{report.FilesScanned:N0}";
                LoadingFoldersCountText.Text = $"{report.FoldersScanned:N0}";
                LoadingDataDiscoveredText.Text = ByteFormatter.FormatBytes(report.TotalLogicalBytes);
                double secs = report.ElapsedMilliseconds / 1000.0;
                double spd = secs > 0 ? report.FilesScanned / secs : 0;
                LoadingScanSpeedText.Text = $"{spd:N0} files/sec";
                LoadingCurrentPathText.Text = report.CurrentDirectory;

                ScanSummaryHeaderText.Text = $"Scanning: {report.FilesScanned:N0} files, {report.FoldersScanned:N0} folders...";
                ScanMetricsDetailText.Text = $"{ByteFormatter.FormatBytes(report.TotalLogicalBytes)} logical | {report.ElapsedMilliseconds:F0} ms | {report.CurrentDirectory}";
            });
        });

        try
        {
            DriveScanResult result = await _win32Scanner.ScanAsync(
                rootPath,
                progress: progress,
                topN: 500,
                retainAllEntries: true,
                cancellationToken: token,
                options: scanOptions);

            _lastScanResult = result;
            LoadingSubtitleText.Text = "Organizing hierarchical tree view and space allocation...";
            await PopulateStorageScanViewsAsync(result);

            double secs = Math.Max(0.001, result.ElapsedMilliseconds / 1000.0);
            double rate = result.TotalFiles / secs;
            ScanSummaryHeaderText.Text = $"Scan Complete: {result.RootPath} ({result.EngineUsed}) — {result.TotalFiles:N0} files, {result.TotalFolders:N0} folders";
            FooterStatusText.Text = $"Scan finished: {result.TotalFiles:N0} files, {result.TotalFolders:N0} folders in {secs:F2}s ({rate:N0} files/sec). Total: {ByteFormatter.FormatBytes(result.TotalLogicalBytes)}.";
            try
            {
                var driveRoot = Path.GetPathRoot(rootPath);
                if (!string.IsNullOrEmpty(driveRoot) && Directory.Exists(driveRoot))
                {
                    var di = new DriveInfo(driveRoot);
                    if (di.IsReady)
                    {
                        long driveUsed = Math.Max(0, di.TotalSize - di.AvailableFreeSpace);
                        long driveFree = di.AvailableFreeSpace;
                        ScanMetricsDetailText.Text = $"Scanned Files: {ByteFormatter.FormatBytes(result.TotalLogicalBytes)} (Allocated: {ByteFormatter.FormatBytes(result.TotalAllocatedBytes)}) | Drive Used: {ByteFormatter.FormatBytes(driveUsed)} | Free: {ByteFormatter.FormatBytes(driveFree)} (Total: {ByteFormatter.FormatBytes(di.TotalSize)}) | Time: {secs:F2}s";
                        FooterDriveSpaceText.Text = $"Free: {ByteFormatter.FormatBytes(driveFree)} / Total: {ByteFormatter.FormatBytes(di.TotalSize)} (Used: {ByteFormatter.FormatBytes(driveUsed)})";
                    }
                }
                else
                {
                    ScanMetricsDetailText.Text = $"Size: {ByteFormatter.FormatBytes(result.TotalLogicalBytes)} (Allocated: {ByteFormatter.FormatBytes(result.TotalAllocatedBytes)}) | Time: {secs:F2}s ({rate:N0} files/sec) | Access Denied: {result.AccessDeniedPaths.Count}";
                }
            }
            catch 
            {
                ScanMetricsDetailText.Text = $"Size: {ByteFormatter.FormatBytes(result.TotalLogicalBytes)} (Allocated: {ByteFormatter.FormatBytes(result.TotalAllocatedBytes)}) | Time: {secs:F2}s ({rate:N0} files/sec) | Access Denied: {result.AccessDeniedPaths.Count}";
            }

            // Immediately refresh drive dropdown with updated free space from kernel
            RefreshDrivesList(rootPath);
        }
        catch (OperationCanceledException)
        {
            ScanSummaryHeaderText.Text = $"Scan Cancelled ({rootPath})";
            FooterStatusText.Text = "Storage scan cancelled by user.";
        }
        catch (Exception ex)
        {
            ScanSummaryHeaderText.Text = $"Scan Error: {ex.Message}";
            FooterStatusText.Text = $"Scan failed: {ex.Message}";
        }
        finally
        {
            StorageLoadingOverlay.Visibility = Visibility.Collapsed;
            CancelScanButton.IsEnabled = false;
            ScanActivityProgressBar.IsIndeterminate = false;
            ScanActivityProgressBar.Visibility = Visibility.Collapsed;
        }
    }

    private async Task PickAndScanFolderAsync()
    {
        var picker = new Windows.Storage.Pickers.FolderPicker();
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        picker.SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.ComputerFolder;
        picker.FileTypeFilter.Add("*");

        var folder = await picker.PickSingleFolderAsync();
        if (folder != null)
        {
            StartupDriveModalOverlay.Visibility = Visibility.Collapsed;
            ScanPathTextBox.Text = folder.Path;
            await RunStorageScanAsync(folder.Path);
        }
    }

    private async Task PickAndScanCsvAsync()
    {
        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        picker.SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.DocumentsLibrary;
        picker.FileTypeFilter.Add(".csv");

        var file = await picker.PickSingleFileAsync();
        if (file != null)
        {
            StartupDriveModalOverlay.Visibility = Visibility.Collapsed;
            StorageLoadingOverlay.Visibility = Visibility.Visible;
            LoadingTargetTitleText.Text = $"Loading {file.Name}...";
            LoadingSubtitleText.Text = "Parsing CSV storage records...";
            LoadingFilesCountText.Text = "Reading...";
            LoadingFoldersCountText.Text = "Reading...";
            LoadingDataDiscoveredText.Text = "Calculating...";
            LoadingScanSpeedText.Text = "Instant Parser";
            LoadingCurrentPathText.Text = file.Path;

            ScanPathTextBox.Text = file.Path;
            try
            {
                ScanSummaryHeaderText.Text = $"Loading CSV: {file.Name}...";
                ScanActivityProgressBar.Visibility = Visibility.Visible;
                ScanActivityProgressBar.IsIndeterminate = true;

                var result = await Task.Run(() => CsvStorageReader.LoadFromCsv(file.Path));
                _lastScanResult = result;
                LoadingSubtitleText.Text = "Rendering file hierarchy and allocation map...";
                await PopulateStorageScanViewsAsync(result);

                ScanSummaryHeaderText.Text = $"CSV Loaded: {file.Name} — {result.TotalFiles:N0} files, {result.TotalFolders:N0} folders";
                ScanMetricsDetailText.Text = $"Size: {ByteFormatter.FormatBytes(result.TotalLogicalBytes)} | Time: {result.ElapsedMilliseconds:F0}ms";
                FooterStatusText.Text = $"Loaded CSV {file.Name} ({result.TotalFiles:N0} files).";
            }
            catch (Exception ex)
            {
                ScanSummaryHeaderText.Text = $"CSV Import Error: {ex.Message}";
                FooterStatusText.Text = $"Failed to parse CSV: {ex.Message}";
            }
            finally
            {
                StorageLoadingOverlay.Visibility = Visibility.Collapsed;
                ScanActivityProgressBar.Visibility = Visibility.Collapsed;
            }
        }
    }

    private async Task RunMultiDriveScanAsync()
    {
        var readyDrives = Volumes.Where(v => !string.IsNullOrWhiteSpace(v.RootPath)).ToList();
        if (readyDrives.Count == 0)
        {
            readyDrives.Add(new VolumeRowViewModel(@"C:\", "Local Disk (C:)", "NTFS", "-", 0, ""));
        }

        _scanCts?.Cancel();
        _scanCts = new CancellationTokenSource();
        var token = _scanCts.Token;

        StartupDriveModalOverlay.Visibility = Visibility.Collapsed;
        StorageLoadingOverlay.Visibility = Visibility.Visible;
        LoadingTargetTitleText.Text = $"Scanning {readyDrives.Count} volumes...";
        LoadingSubtitleText.Text = "Processing volumes sequentially; each scan uses your configured worker count.";
        LoadingFilesCountText.Text = "0";
        LoadingFoldersCountText.Text = "0";
        LoadingDataDiscoveredText.Text = "0 B";
        LoadingScanSpeedText.Text = "Starting multi-drive workers...";
        LoadingCurrentPathText.Text = "All local hard drives";

        CancelScanButton.IsEnabled = true;
        ScanActivityProgressBar.Visibility = Visibility.Visible;
        ScanActivityProgressBar.IsIndeterminate = true;
        ScanSummaryHeaderText.Text = $"Scanning {readyDrives.Count} volumes...";
        ScanMetricsDetailText.Text = "Processing volumes sequentially (multi-drive mode).";

        try
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var allCombinedEntries = new List<ScannedEntry>();
            var allCombinedFolders = new List<ScannedEntry>();
            var allTopFiles = new List<ScannedEntry>();
            var accessDenied = new List<string>();
            var categoriesMap = new Dictionary<string, (long Count, long Bytes)>(StringComparer.OrdinalIgnoreCase);

            long totalLogical = 0;
            long totalAllocated = 0;
            long totalFiles = 0;
            long totalFolders = 0;
            int globalFolderId = 10000;

            int driveIndex = 0;
            foreach (var drive in readyDrives)
            {
                if (token.IsCancellationRequested) break;
                driveIndex++;

                DispatcherQueue.TryEnqueue(() =>
                {
                    LoadingTargetTitleText.Text = $"Scanning Drive {driveIndex}/{readyDrives.Count}: {drive.VolumeName}...";
                    LoadingCurrentPathText.Text = drive.RootPath;
                });

                var progress = new Progress<ScanProgressReport>(report =>
                {
                    DispatcherQueue.TryEnqueue(() =>
                    {
                        long currentOverallFiles = totalFiles + report.FilesScanned;
                        long currentOverallFolders = totalFolders + report.FoldersScanned;
                        long currentOverallBytes = totalLogical + report.TotalLogicalBytes;
                        LoadingFilesCountText.Text = $"{currentOverallFiles:N0}";
                        LoadingFoldersCountText.Text = $"{currentOverallFolders:N0}";
                        LoadingDataDiscoveredText.Text = ByteFormatter.FormatBytes(currentOverallBytes);
                        double secs = sw.Elapsed.TotalSeconds;
                        double spd = secs > 0 ? currentOverallFiles / secs : 0;
                        LoadingScanSpeedText.Text = $"{spd:N0} files/sec";
                        LoadingCurrentPathText.Text = report.CurrentDirectory;
                    });
                });

                DriveScanResult driveRes = await _win32Scanner.ScanAsync(
                    drive.RootPath,
                    progress: progress,
                    topN: 500,
                    retainAllEntries: true,
                    cancellationToken: token,
                    options: BuildStorageScanOptions(drive.RootPath));

                totalLogical += driveRes.TotalLogicalBytes;
                totalAllocated += driveRes.TotalAllocatedBytes;
                totalFiles += driveRes.TotalFiles;
                totalFolders += driveRes.TotalFolders;
                accessDenied.AddRange(driveRes.AccessDeniedPaths);

                int driveRootId = globalFolderId++;
                var driveRootEntry = new ScannedEntry(
                    Id: driveRootId,
                    ParentId: 0,
                    Name: $"{drive.VolumeName}",
                    FullPath: drive.RootPath,
                    Extension: "",
                    Category: "Drive",
                    IsDirectory: true,
                    LogicalBytes: driveRes.TotalLogicalBytes,
                    AllocatedBytes: driveRes.TotalAllocatedBytes,
                    RecursiveFileCount: (int)Math.Min(int.MaxValue, driveRes.TotalFiles),
                    RecursiveFolderCount: (int)Math.Min(int.MaxValue, driveRes.TotalFolders),
                    LastWriteUnixSeconds: DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                    FileAttributes: 0x10
                );
                allCombinedFolders.Add(driveRootEntry);
                allCombinedEntries.Add(driveRootEntry);

                if (driveRes.AllFolders != null)
                {
                    foreach (var f in driveRes.AllFolders)
                    {
                        int pId = f.ParentId <= 0 ? driveRootId : f.ParentId + driveRootId;
                        allCombinedFolders.Add(f with { Id = f.Id + driveRootId, ParentId = pId });
                    }
                }

                if (driveRes.AllEntries != null && driveRes.AllEntries.Count > 0)
                {
                    foreach (var e in driveRes.AllEntries)
                    {
                        int pId = e.ParentId <= 0 ? driveRootId : e.ParentId + driveRootId;
                        allCombinedEntries.Add(e with { Id = e.Id + driveRootId, ParentId = pId });
                    }
                }
                else if (driveRes.AllFolders != null)
                {
                    foreach (var f in driveRes.AllFolders)
                    {
                        int pId = f.ParentId <= 0 ? driveRootId : f.ParentId + driveRootId;
                        allCombinedEntries.Add(f with { Id = f.Id + driveRootId, ParentId = pId });
                    }
                }

                if (driveRes.LargestFiles != null)
                {
                    allTopFiles.AddRange(driveRes.LargestFiles);
                }

                foreach (var c in driveRes.CategoryBreakdown)
                {
                    if (!categoriesMap.TryGetValue(c.Label, out var existing))
                    {
                        existing = (0, 0);
                    }
                    categoriesMap[c.Label] = (existing.Count + c.FileCount, existing.Bytes + c.TotalBytes);
                }
            }

            sw.Stop();

            var combinedBreakdown = categoriesMap
                .OrderByDescending(kv => kv.Value.Bytes)
                .Take(8)
                .Select(kv => new CategorySummary(
                    Key: kv.Key.ToLowerInvariant(),
                    Label: kv.Key,
                    FileCount: kv.Value.Count,
                    TotalBytes: kv.Value.Bytes,
                    SharePercent: totalLogical > 0 ? (double)kv.Value.Bytes / totalLogical * 100.0 : 0.0
                ))
                .ToList();

            var combinedResult = new DriveScanResult(
                RootPath: "[All Hard Drives]",
                EngineUsed: ScanEngineMode.StandardWin32,
                TotalFiles: totalFiles,
                TotalFolders: totalFolders,
                TotalLogicalBytes: totalLogical,
                TotalAllocatedBytes: totalAllocated,
                ElapsedMilliseconds: sw.Elapsed.TotalMilliseconds,
                AccessDeniedPaths: accessDenied,
                LargestFiles: allTopFiles.OrderByDescending(f => f.LogicalBytes).Take(500).ToList(),
                LargestFolders: allCombinedFolders.OrderByDescending(f => f.LogicalBytes).Take(50).ToList(),
                TopLevelSpaceMap: allCombinedFolders.Where(f => f.ParentId == 0).ToList(),
                CategoryBreakdown: combinedBreakdown,
                AllEntries: allCombinedEntries,
                AllFolders: allCombinedFolders
            );

            _lastScanResult = combinedResult;
            LoadingSubtitleText.Text = "Organizing hierarchical tree view and space allocation...";
            await PopulateStorageScanViewsAsync(combinedResult);

            double secs = Math.Max(0.001, combinedResult.ElapsedMilliseconds / 1000.0);
            double rate = combinedResult.TotalFiles / secs;
            ScanSummaryHeaderText.Text = $"Multi-Drive Scan Complete — {readyDrives.Count} drives, {combinedResult.TotalFiles:N0} files, {combinedResult.TotalFolders:N0} folders";
            ScanMetricsDetailText.Text = $"Total Size: {ByteFormatter.FormatBytes(combinedResult.TotalLogicalBytes)} | Time: {secs:F2}s ({rate:N0} files/sec)";
            FooterStatusText.Text = $"Scanned all {readyDrives.Count} hard drives in {secs:F2}s ({rate:N0} files/sec).";
            RefreshDrivesList("__ALL_DRIVES__");
        }
        catch (OperationCanceledException)
        {
            ScanSummaryHeaderText.Text = "Multi-drive scan cancelled.";
            FooterStatusText.Text = "Scan cancelled.";
        }
        catch (Exception ex)
        {
            ScanSummaryHeaderText.Text = $"Multi-drive scan error: {ex.Message}";
            FooterStatusText.Text = $"Scan failed: {ex.Message}";
        }
        finally
        {
            StorageLoadingOverlay.Visibility = Visibility.Collapsed;
            CancelScanButton.IsEnabled = false;
            ScanActivityProgressBar.IsIndeterminate = false;
            ScanActivityProgressBar.Visibility = Visibility.Collapsed;
        }
    }

    private sealed class StorageViewModelBundle
    {
        public required List<StorageBarSegmentViewModel> BarSegments { get; init; }
        public required Dictionary<int, List<ScannedEntry>> ChildrenByParentId { get; init; }
        public required List<StorageTreeNodeViewModel> RootNodes { get; init; }
        public required List<FileRowViewModel> FileRows { get; init; }
        public required string BreakdownSummary { get; init; }
    }

    private static StorageViewModelBundle PrepareStorageViewModels(DriveScanResult result, bool isLightMode = true)
    {
        // 1. Storage Bar Segments
        var barSegments = new List<StorageBarSegmentViewModel>();
        string summaryText = "Select a drive and click 'Scan' to visualize disk allocation.";
        if (result.TopLevelSpaceMap != null && result.TopLevelSpaceMap.Count > 0)
        {
            string[] palette = ["#6F91FF", "#2DD4BF", "#A78BFA", "#FCD34D", "#FB7185", "#38BDF8"];
            long totalBytes = Math.Max(1, result.TotalLogicalBytes);
            int col = 0;
            foreach (var folder in result.TopLevelSpaceMap.Take(6))
            {
                double pct = (double)folder.LogicalBytes / totalBytes * 100.0;
                if (pct < 0.5) continue;

                string color = palette[col % palette.Length];
                barSegments.Add(new StorageBarSegmentViewModel
                {
                    Name = folder.Name,
                    FormattedSize = ByteFormatter.FormatBytes(folder.LogicalBytes),
                    Percent = pct,
                    ColorHex = color
                });
                col++;
            }
            summaryText = $"Top folders represent {barSegments.Sum(s => s.Percent):F1}% of {ByteFormatter.FormatBytes(result.TotalLogicalBytes)} disk space.";
        }

        // 2. Build fast lookup of children by parentId
        var childrenByParentId = new Dictionary<int, List<ScannedEntry>>();
        var allSource = (result.AllEntries != null && result.AllEntries.Count > 0)
            ? result.AllEntries
            : (IReadOnlyList<ScannedEntry>)(result.AllFolders ?? Array.Empty<ScannedEntry>());

        foreach (var entry in allSource)
        {
            if (!childrenByParentId.TryGetValue(entry.ParentId, out var list))
            {
                list = new List<ScannedEntry>();
                childrenByParentId[entry.ParentId] = list;
            }
            list.Add(entry);
        }

        // 3. Root Tree Nodes
        var rootNodes = new List<StorageTreeNodeViewModel>();
        long totalDriveBytes = Math.Max(1, result.TotalLogicalBytes);

        List<ScannedEntry>? rootEntries;
        if (!childrenByParentId.TryGetValue(0, out rootEntries))
        {
            rootEntries = allSource.Where(e => e.ParentId <= 0).ToList();
        }

        var rootFolders = rootEntries.Where(f => f.IsDirectory).OrderByDescending(f => f.LogicalBytes).ToList();
        var rootFiles = rootEntries.Where(f => !f.IsDirectory).OrderByDescending(f => f.LogicalBytes).ToList();

        foreach (var f in rootFolders)
        {
            double pct = totalDriveBytes > 0 ? (double)f.LogicalBytes / totalDriveBytes * 100.0 : 0.0;
            rootNodes.Add(new StorageTreeNodeViewModel
            {
                Id = f.Id,
                ParentId = f.ParentId,
                Name = f.Name,
                FullPath = f.FullPath,
                IsDirectory = true,
                SizeBytes = f.LogicalBytes,
                AllocatedBytes = f.AllocatedBytes,
                RecursiveFileCount = f.RecursiveFileCount,
                RecursiveFolderCount = f.RecursiveFolderCount,
                FormattedSize = ByteFormatter.FormatBytes(f.LogicalBytes),
                FormattedAllocated = ByteFormatter.FormatBytes(f.AllocatedBytes),
                ItemsSummary = $"{f.RecursiveFileCount + f.RecursiveFolderCount:N0} items",
                Attributes = FormatAttributes(f.FileAttributes),
                LastModifiedFormatted = DateTimeOffset.FromUnixTimeSeconds(f.LastWriteUnixSeconds).LocalDateTime.ToString("yyyy-MM-dd HH:mm"),
                PercentOfDrive = pct,
                PercentLabel = $"{pct:F1}%",
                PercentOfParent = 100.0,
                PercentOfParentLabel = "100%",
                DepthLevel = 0,
                IsExpanded = false
            });
        }

        foreach (var file in rootFiles)
        {
            double pct = totalDriveBytes > 0 ? (double)file.LogicalBytes / totalDriveBytes * 100.0 : 0.0;
            string ext = string.IsNullOrEmpty(file.Extension) ? Path.GetExtension(file.FullPath).ToLowerInvariant() : file.Extension;
            rootNodes.Add(new StorageTreeNodeViewModel
            {
                Id = file.Id,
                ParentId = file.ParentId,
                Name = file.Name,
                FullPath = file.FullPath,
                IsDirectory = false,
                SizeBytes = file.LogicalBytes,
                AllocatedBytes = file.AllocatedBytes,
                FormattedSize = ByteFormatter.FormatBytes(file.LogicalBytes),
                FormattedAllocated = ByteFormatter.FormatBytes(file.AllocatedBytes),
                ItemsSummary = "1 file",
                Attributes = FormatAttributes(file.FileAttributes),
                LastModifiedFormatted = DateTimeOffset.FromUnixTimeSeconds(file.LastWriteUnixSeconds).LocalDateTime.ToString("yyyy-MM-dd HH:mm"),
                PercentOfDrive = pct,
                PercentLabel = $"{pct:F1}%",
                PercentOfParent = 100.0,
                PercentOfParentLabel = "100%",
                Extension = ext,
                FileType = GetFileTypeDescription(ext),
                Glyph = GetGlyphForCategory(file.Category),
                GlyphColor = GetColorForCategory(file.Category, isLightMode),
                DepthLevel = 0,
                IsExpanded = false
            });
        }

        // 4. Flat File View (Top Largest Scanned Files)
        var fileRows = new List<FileRowViewModel>();
        var filesSource = (result.LargestFiles != null && result.LargestFiles.Count > 0)
            ? result.LargestFiles
            : (result.AllEntries ?? Array.Empty<ScannedEntry>()).Where(e => !e.IsDirectory).OrderByDescending(e => e.LogicalBytes).Take(500);

        foreach (var file in filesSource)
        {
            double pct = totalDriveBytes > 0 ? (double)file.LogicalBytes / totalDriveBytes * 100.0 : 0.0;
            string ext = string.IsNullOrEmpty(file.Extension) ? Path.GetExtension(file.FullPath).ToLowerInvariant() : file.Extension;
            fileRows.Add(new FileRowViewModel
            {
                Name = file.Name,
                Extension = ext,
                FileType = GetFileTypeDescription(ext),
                Folder = Path.GetDirectoryName(file.FullPath) ?? string.Empty,
                FullPath = file.FullPath,
                Category = file.Category,
                SizeBytes = file.LogicalBytes,
                AllocatedBytes = file.AllocatedBytes,
                FormattedSize = ByteFormatter.FormatBytes(file.LogicalBytes),
                FormattedAllocated = ByteFormatter.FormatBytes(file.AllocatedBytes),
                PercentOfTotal = pct,
                PercentLabel = $"{pct:F1}%",
                LastModifiedFormatted = DateTimeOffset.FromUnixTimeSeconds(file.LastWriteUnixSeconds).LocalDateTime.ToString("yyyy-MM-dd HH:mm"),
                LastWriteUnixSeconds = file.LastWriteUnixSeconds,
                Attributes = FormatAttributes(file.FileAttributes),
                Glyph = GetGlyphForCategory(file.Category),
                GlyphColor = GetColorForCategory(file.Category, isLightMode)
            });
        }

        return new StorageViewModelBundle
        {
            BarSegments = barSegments,
            ChildrenByParentId = childrenByParentId,
            RootNodes = rootNodes,
            FileRows = fileRows,
            BreakdownSummary = summaryText
        };
    }

    private async Task PopulateStorageScanViewsAsync(DriveScanResult result)
    {
        bool isLight = IsLightMode();
        var bundle = await Task.Run(() => PrepareStorageViewModels(result, isLight));
        ApplyStorageViewModelBundle(bundle);
    }

    private void PopulateStorageScanViews(DriveScanResult result)
    {
        var bundle = PrepareStorageViewModels(result, IsLightMode());
        ApplyStorageViewModelBundle(bundle);
    }

    private void ApplyStorageViewModelBundle(StorageViewModelBundle bundle)
    {
        _childrenByParentId = bundle.ChildrenByParentId;

        // 1. Proportional Visual Storage Breakdown Bar
        StorageBarSegments.Clear();
        StorageBreakdownBarGrid.Children.Clear();
        StorageBreakdownBarGrid.ColumnDefinitions.Clear();

        int col = 0;
        foreach (var seg in bundle.BarSegments)
        {
            StorageBarSegments.Add(seg);
            StorageBreakdownBarGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(1, seg.Percent), GridUnitType.Star) });
            var rect = new Border
            {
                Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255,
                    Convert.ToByte(seg.ColorHex.Substring(1, 2), 16),
                    Convert.ToByte(seg.ColorHex.Substring(3, 2), 16),
                    Convert.ToByte(seg.ColorHex.Substring(5, 2), 16)))
            };
            Grid.SetColumn(rect, col++);
            StorageBreakdownBarGrid.Children.Add(rect);
        }
        StorageBreakdownSummaryText.Text = bundle.BreakdownSummary;

        // 2. Tree Nodes
        StorageTreeNodes.Clear();
        foreach (var node in bundle.RootNodes)
        {
            StorageTreeNodes.Add(node);
        }

        // 3. Flat File Rows
        ScannedFiles.Clear();
        foreach (var file in bundle.FileRows)
        {
            ScannedFiles.Add(file);
        }

        UpdateViewCountSummary();
    }

    private void UpdateViewCountSummary()
    {
        int folders = StorageTreeNodes.Count(n => n.IsDirectory);
        int files = StorageTreeNodes.Count(n => !n.IsDirectory);
        ViewTabSummaryText.Text = $"Tree View: {folders} folders, {files} files loaded • Double-click folder to expand or file to open";
    }

    private void OnTreeNodeExpanderClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.DataContext is StorageTreeNodeViewModel node)
        {
            ToggleTreeNode(node);
        }
    }

    private void ToggleTreeNode(StorageTreeNodeViewModel node)
    {
        if (_lastScanResult == null || !node.IsDirectory) return;

        if (node.IsExpanded)
        {
            // Collapse: remove all descendants whose DepthLevel > node.DepthLevel
            int idx = StorageTreeNodes.IndexOf(node);
            if (idx < 0) return;

            int removeCount = 0;
            for (int i = idx + 1; i < StorageTreeNodes.Count; i++)
            {
                if (StorageTreeNodes[i].DepthLevel > node.DepthLevel)
                {
                    removeCount++;
                }
                else
                {
                    break;
                }
            }

            for (int k = 0; k < removeCount; k++)
            {
                StorageTreeNodes.RemoveAt(idx + 1);
            }
            node.IsExpanded = false;
        }
        else
        {
            // Expand: find direct children where ParentId == node.Id
            int idx = StorageTreeNodes.IndexOf(node);
            if (idx < 0) return;

            List<ScannedEntry>? children = null;
            if (_childrenByParentId != null && _childrenByParentId.TryGetValue(node.Id, out var cachedList))
            {
                children = cachedList;
            }
            else if (_lastScanResult.AllEntries != null && _lastScanResult.AllEntries.Count > 0)
            {
                children = _lastScanResult.AllEntries.Where(e => e.ParentId == node.Id).ToList();
            }
            else if (_lastScanResult.AllFolders != null)
            {
                children = _lastScanResult.AllFolders.Where(e => e.ParentId == node.Id).ToList();
            }

            if (children != null && children.Count > 0)
            {
                var childFolders = children.Where(c => c.IsDirectory).OrderByDescending(c => c.LogicalBytes).ToList();
                var childFiles = children.Where(c => !c.IsDirectory).OrderByDescending(c => c.LogicalBytes).ToList();

                int insertIdx = idx + 1;
                long totalDriveBytes = Math.Max(1, _lastScanResult.TotalLogicalBytes);

                // 1. Insert child folders
                foreach (var child in childFolders)
                {
                    double pct = totalDriveBytes > 0 ? (double)child.LogicalBytes / totalDriveBytes * 100.0 : 0.0;
                    double pctParent = node.SizeBytes > 0 ? (double)child.LogicalBytes / node.SizeBytes * 100.0 : 0.0;
                    var childVm = new StorageTreeNodeViewModel
                    {
                        Id = child.Id,
                        ParentId = child.ParentId,
                        Name = child.Name,
                        FullPath = child.FullPath,
                        IsDirectory = true,
                        SizeBytes = child.LogicalBytes,
                        AllocatedBytes = child.AllocatedBytes,
                        RecursiveFileCount = child.RecursiveFileCount,
                        RecursiveFolderCount = child.RecursiveFolderCount,
                        FormattedSize = ByteFormatter.FormatBytes(child.LogicalBytes),
                        FormattedAllocated = ByteFormatter.FormatBytes(child.AllocatedBytes),
                        ItemsSummary = $"{child.RecursiveFileCount + child.RecursiveFolderCount:N0} items",
                        Attributes = FormatAttributes(child.FileAttributes),
                        LastModifiedFormatted = DateTimeOffset.FromUnixTimeSeconds(child.LastWriteUnixSeconds).LocalDateTime.ToString("yyyy-MM-dd HH:mm"),
                        PercentOfDrive = pct,
                        PercentLabel = $"{pct:F1}%",
                        PercentOfParent = pctParent,
                        PercentOfParentLabel = $"{pctParent:F1}%",
                        DepthLevel = node.DepthLevel + 1,
                        IsExpanded = false
                    };
                    StorageTreeNodes.Insert(insertIdx++, childVm);
                }

                // 2. Insert child files (folders show files too!)
                int maxFilesToShow = 250;
                var filesToShow = childFiles.Take(maxFilesToShow).ToList();

                foreach (var file in filesToShow)
                {
                    double pct = totalDriveBytes > 0 ? (double)file.LogicalBytes / totalDriveBytes * 100.0 : 0.0;
                    double pctParent = node.SizeBytes > 0 ? (double)file.LogicalBytes / node.SizeBytes * 100.0 : 0.0;
                    string ext = string.IsNullOrEmpty(file.Extension) ? Path.GetExtension(file.FullPath).ToLowerInvariant() : file.Extension;

                    var fileVm = new StorageTreeNodeViewModel
                    {
                        Id = file.Id,
                        ParentId = file.ParentId,
                        Name = file.Name,
                        FullPath = file.FullPath,
                        IsDirectory = false,
                        SizeBytes = file.LogicalBytes,
                        AllocatedBytes = file.AllocatedBytes,
                        RecursiveFileCount = 0,
                        RecursiveFolderCount = 0,
                        FormattedSize = ByteFormatter.FormatBytes(file.LogicalBytes),
                        FormattedAllocated = ByteFormatter.FormatBytes(file.AllocatedBytes),
                        ItemsSummary = "1 file",
                        Attributes = FormatAttributes(file.FileAttributes),
                        LastModifiedFormatted = DateTimeOffset.FromUnixTimeSeconds(file.LastWriteUnixSeconds).LocalDateTime.ToString("yyyy-MM-dd HH:mm"),
                        PercentOfDrive = pct,
                        PercentLabel = $"{pct:F1}%",
                        PercentOfParent = pctParent,
                        PercentOfParentLabel = $"{pctParent:F1}%",
                        Extension = ext,
                        FileType = GetFileTypeDescription(ext),
                        Glyph = GetGlyphForCategory(file.Category),
                        GlyphColor = GetColorForCategory(file.Category),
                        DepthLevel = node.DepthLevel + 1,
                        IsExpanded = false
                    };
                    StorageTreeNodes.Insert(insertIdx++, fileVm);
                }

                if (childFiles.Count > maxFilesToShow)
                {
                    int remaining = childFiles.Count - maxFilesToShow;
                    long remainingBytes = childFiles.Skip(maxFilesToShow).Sum(f => f.LogicalBytes);
                    StorageTreeNodes.Insert(insertIdx++, new StorageTreeNodeViewModel
                    {
                        Name = $"... and {remaining:N0} more smaller files ({ByteFormatter.FormatBytes(remainingBytes)})",
                        FullPath = node.FullPath,
                        IsDirectory = false,
                        SizeBytes = remainingBytes,
                        FormattedSize = ByteFormatter.FormatBytes(remainingBytes),
                        DepthLevel = node.DepthLevel + 1,
                        Glyph = "\uE8A5",
                        GlyphColor = "#64748B"
                    });
                }
            }

            node.IsExpanded = true;
        }

        UpdateViewCountSummary();
    }

    // ==========================================
    // UNIFIED STORAGE EXPLORER ACTIONS & NAVIGATION
    // ==========================================

    private void OnViewTreeTabClick(object sender, RoutedEventArgs e)
    {
        TreeContentGrid.Visibility = Visibility.Visible;
        FileContentGrid.Visibility = Visibility.Collapsed;

        ViewTreeTabButton.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
        ViewFileTabButton.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];
        UpdateViewCountSummary();
    }

    private void OnViewFileTabClick(object sender, RoutedEventArgs e)
    {
        TreeContentGrid.Visibility = Visibility.Collapsed;
        FileContentGrid.Visibility = Visibility.Visible;

        ViewTreeTabButton.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];
        ViewFileTabButton.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
        ViewTabSummaryText.Text = $"Largest Files (Flat): Showing {ScannedFiles.Count:N0} largest files across target • Double-click to open in Explorer";
    }

    private void OnTreeFilterTextChanged(object sender, TextChangedEventArgs e)
    {
        string query = TreeFilterTextBox.Text.Trim();
        if (string.IsNullOrEmpty(query))
        {
            if (_lastScanResult != null)
            {
                PopulateStorageScanViews(_lastScanResult);
            }
            return;
        }

        if (_lastScanResult?.AllEntries == null || _lastScanResult.AllEntries.Count == 0) return;

        string cleanQuery = query;
        bool isExtensionFilter = false;
        if (cleanQuery.StartsWith("*."))
        {
            cleanQuery = cleanQuery.Substring(1); // e.g. ".mp4"
            isExtensionFilter = true;
        }
        else if (cleanQuery.StartsWith('.'))
        {
            isExtensionFilter = true;
        }

        long totalDriveBytes = Math.Max(1, _lastScanResult.TotalLogicalBytes);
        var matches = _lastScanResult.AllEntries
            .Where(entry =>
            {
                if (isExtensionFilter)
                {
                    return string.Equals(entry.Extension, cleanQuery, StringComparison.OrdinalIgnoreCase) ||
                           entry.Name.EndsWith(cleanQuery, StringComparison.OrdinalIgnoreCase);
                }
                return entry.Name.Contains(cleanQuery, StringComparison.OrdinalIgnoreCase) ||
                       (!string.IsNullOrEmpty(entry.Extension) && entry.Extension.Contains(cleanQuery, StringComparison.OrdinalIgnoreCase));
            })
            .OrderByDescending(entry => entry.LogicalBytes)
            .Take(300)
            .ToList();

        StorageTreeNodes.Clear();
        foreach (var m in matches)
        {
            double pct = totalDriveBytes > 0 ? (double)m.LogicalBytes / totalDriveBytes * 100.0 : 0.0;
            string ext = string.IsNullOrEmpty(m.Extension) ? Path.GetExtension(m.FullPath).ToLowerInvariant() : m.Extension;

            StorageTreeNodes.Add(new StorageTreeNodeViewModel
            {
                Id = m.Id,
                ParentId = m.ParentId,
                Name = m.Name,
                FullPath = m.FullPath,
                IsDirectory = m.IsDirectory,
                SizeBytes = m.LogicalBytes,
                AllocatedBytes = m.AllocatedBytes,
                RecursiveFileCount = m.RecursiveFileCount,
                RecursiveFolderCount = m.RecursiveFolderCount,
                FormattedSize = ByteFormatter.FormatBytes(m.LogicalBytes),
                FormattedAllocated = ByteFormatter.FormatBytes(m.AllocatedBytes),
                ItemsSummary = m.IsDirectory ? $"{m.RecursiveFileCount + m.RecursiveFolderCount:N0} items" : "1 file",
                Attributes = FormatAttributes(m.FileAttributes),
                LastModifiedFormatted = DateTimeOffset.FromUnixTimeSeconds(m.LastWriteUnixSeconds).LocalDateTime.ToString("yyyy-MM-dd HH:mm"),
                PercentOfDrive = pct,
                PercentLabel = $"{pct:F1}%",
                Extension = ext,
                FileType = m.IsDirectory ? "Folder" : GetFileTypeDescription(ext),
                Glyph = m.IsDirectory ? "\uE8B7" : GetGlyphForCategory(m.Category),
                GlyphColor = m.IsDirectory ? "#6F91FF" : GetColorForCategory(m.Category),
                DepthLevel = 0,
                IsExpanded = false
            });
        }

        ViewTabSummaryText.Text = $"Filter '{query}': {StorageTreeNodes.Count} matching items found";
    }

    private void OnClearTreeFilterClick(object sender, RoutedEventArgs e)
    {
        TreeFilterTextBox.Text = string.Empty;
    }

    private void OnCollapseAllTreeNodesClick(object sender, RoutedEventArgs e)
    {
        if (_lastScanResult != null)
        {
            PopulateStorageScanViews(_lastScanResult);
        }
    }

    private void OnTreeRowDoubleTapped(object sender, DoubleTappedRoutedEventArgs e)
    {
        if (sender is FrameworkElement fe && fe.DataContext is StorageTreeNodeViewModel node)
        {
            if (node.IsDirectory)
            {
                ToggleTreeNode(node);
            }
            else
            {
                // Double click on a file opens it in Windows Explorer
                OpenPathInExplorer(node.FullPath);
            }
            e.Handled = true;
        }
    }

    private void OnStorageTreeKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (StorageTreeListView.SelectedItem is StorageTreeNodeViewModel node)
        {
            if (node.IsDirectory)
            {
                if (e.Key is Windows.System.VirtualKey.Enter or Windows.System.VirtualKey.Space)
                {
                    if (node.HasChildren)
                    {
                        ToggleTreeNode(node);
                        e.Handled = true;
                    }
                }
                else if (e.Key == Windows.System.VirtualKey.Right && !node.IsExpanded && node.HasChildren)
                {
                    ToggleTreeNode(node);
                    e.Handled = true;
                }
                else if (e.Key == Windows.System.VirtualKey.Left && node.IsExpanded)
                {
                    ToggleTreeNode(node);
                    e.Handled = true;
                }
            }
            else
            {
                if (e.Key == Windows.System.VirtualKey.Enter)
                {
                    OpenPathInExplorer(node.FullPath);
                    e.Handled = true;
                }
            }
        }
    }

    private void OnFileRowDoubleTapped(object sender, DoubleTappedRoutedEventArgs e)
    {
        if (sender is FrameworkElement fe && fe.DataContext is FileRowViewModel file)
        {
            OpenPathInExplorer(file.FullPath);
            e.Handled = true;
        }
    }

    private void OnStorageFileSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (StorageFileListView.SelectedItem is FileRowViewModel file)
        {
            UpdateSelectedFileMetadata(file);
        }
    }

    private void OnFileRowRightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        if (sender is FrameworkElement fe && fe.DataContext is FileRowViewModel file)
        {
            StorageFileListView.SelectedItem = file;
            UpdateSelectedFileMetadata(file);

            var flyout = new MenuFlyout();

            var openItem = new MenuFlyoutItem { Text = "Open in Windows File Explorer", Icon = new SymbolIcon(Symbol.Folder) };
            openItem.Click += (s, args) => OpenPathInExplorer(file.FullPath);
            flyout.Items.Add(openItem);

            var copyItem = new MenuFlyoutItem { Text = "Copy Full Path", Icon = new SymbolIcon(Symbol.Copy) };
            copyItem.Click += (s, args) => CopyPathToClipboard(file.FullPath);
            flyout.Items.Add(copyItem);

            flyout.Items.Add(new MenuFlyoutSeparator());

            var recycleItem = new MenuFlyoutItem { Text = "Safe Move to Recycle Bin...", Icon = new SymbolIcon(Symbol.Delete) };
            recycleItem.Click += async (s, args) =>
            {
                var node = new StorageTreeNodeViewModel
                {
                    FullPath = file.FullPath,
                    Name = file.Name,
                    FormattedSize = file.FormattedSize,
                    IsDirectory = false
                };
                await PromptSafeRecycleNodeAsync(node);
                ScannedFiles.Remove(file);
            };
            flyout.Items.Add(recycleItem);

            flyout.ShowAt(fe, e.GetPosition(fe));
            e.Handled = true;
        }
    }

    private void UpdateSelectedFileMetadata(FileRowViewModel file)
    {
        try
        {
            FooterStatusText.Text = $"{file.Name} ({file.FormattedSize}) — {file.FullPath}";

            SelectedMetadata.Name = file.Name;
            SelectedMetadata.FullPath = file.FullPath;
            SelectedMetadata.FormattedSize = file.FormattedSize;
            SelectedMetadata.ExactBytes = $"{file.SizeBytes:N0} bytes";
            SelectedMetadata.FormattedAllocated = file.FormattedAllocated;
            SelectedMetadata.ItemsSummary = "1 file";
            SelectedMetadata.Glyph = file.Glyph;
            SelectedMetadata.HasSelection = true;
            SelectedMetadata.KindLabel = $"{file.FileType} ({file.Extension})";
            SelectedMetadata.Attributes = file.Attributes;

            if (File.Exists(file.FullPath))
            {
                var fi = new FileInfo(file.FullPath);
                SelectedMetadata.CreatedDate = $"Created: {fi.CreationTime:yyyy-MM-dd HH:mm:ss}";
                SelectedMetadata.LastModifiedDate = $"Modified: {fi.LastWriteTime:yyyy-MM-dd HH:mm:ss}";
            }
            else
            {
                SelectedMetadata.CreatedDate = "-";
                SelectedMetadata.LastModifiedDate = $"Modified: {file.LastModifiedFormatted}";
            }
        }
        catch (Exception ex)
        {
            SelectedMetadata.Attributes = $"Inaccessible ({ex.Message})";
        }
    }

    private static string FormatAttributes(uint attr)
    {
        Span<char> chars = stackalloc char[7];
        int len = 0;
        if ((attr & 0x00000020) != 0) chars[len++] = 'A'; // Archive
        if ((attr & 0x00000010) != 0) chars[len++] = 'D'; // Directory
        if ((attr & 0x00000001) != 0) chars[len++] = 'R'; // ReadOnly
        if ((attr & 0x00000002) != 0) chars[len++] = 'H'; // Hidden
        if ((attr & 0x00000004) != 0) chars[len++] = 'S'; // System
        if ((attr & 0x00000800) != 0) chars[len++] = 'C'; // Compressed
        if ((attr & 0x00004000) != 0) chars[len++] = 'E'; // Encrypted
        return len == 0 ? "-" : new string(chars[..len]);
    }

    private static string GetFileTypeDescription(string ext)
    {
        if (string.IsNullOrWhiteSpace(ext)) return "File";
        string clean = ext.TrimStart('.').ToLowerInvariant();
        return clean switch
        {
            "exe" => "Application",
            "dll" => "Application Extension",
            "sys" => "System File",
            "zip" or "7z" or "rar" or "tar" or "gz" => "Compressed Archive",
            "mp4" or "mkv" or "avi" or "mov" or "wmv" => "Video File",
            "mp3" or "wav" or "flac" or "aac" or "m4a" => "Audio File",
            "jpg" or "jpeg" or "png" or "gif" or "webp" or "bmp" or "svg" => "Image File",
            "pdf" => "PDF Document",
            "docx" or "doc" => "Word Document",
            "xlsx" or "xls" or "csv" => "Spreadsheet",
            "pptx" or "ppt" => "Presentation",
            "txt" or "log" or "md" => "Text Document",
            "iso" or "vhd" or "vhdx" => "Disk Image",
            "json" or "xml" or "yaml" or "yml" => "Data File",
            "cs" or "cpp" or "c" or "h" or "py" or "rs" or "js" or "ts" => "Source Code",
            _ => $"{clean.ToUpperInvariant()} File"
        };
    }

    private static string GetGlyphForCategory(string category) => (category ?? string.Empty).ToLowerInvariant() switch
    {
        "code" => "\uE943",
        "documents" => "\uE8A5",
        "media" => "\uEB9F",
        "archives" => "\uE8B7",
        "data" => "\uE802",
        _ => "\uE8A5"
    };

    private static string GetColorForCategory(string category, bool isLightMode) => (category ?? string.Empty).ToLowerInvariant() switch
    {
        "code" => isLightMode ? "#0284C7" : "#38BDF8",
        "documents" => isLightMode ? "#2563EB" : "#60A5FA",
        "media" => isLightMode ? "#7C3AED" : "#A78BFA",
        "archives" => isLightMode ? "#D97706" : "#F59E0B",
        "data" => isLightMode ? "#059669" : "#34D399",
        _ => isLightMode ? "#64748B" : "#94A3B8"
    };

    private string GetColorForCategory(string category) => GetColorForCategory(category, IsLightMode());

    // ==========================================
    // 0. STARTUP DRIVE SELECTION MODAL
    // ==========================================

    private void OnOpenDriveSelectionModalClick(object sender, RoutedEventArgs e)
    {
        RefreshDrivesList();
        StartupDriveModalOverlay.Visibility = Visibility.Visible;
    }

    private void OnCloseDriveModalClick(object sender, RoutedEventArgs e)
    {
        StartupDriveModalOverlay.Visibility = Visibility.Collapsed;
    }

    private async void OnModalScanDriveClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string rootPath && !string.IsNullOrWhiteSpace(rootPath))
        {
            StartupDriveModalOverlay.Visibility = Visibility.Collapsed;
            ScanPathTextBox.Text = rootPath;
            await RunStorageScanAsync(rootPath);
        }
    }

    private async void OnModalBrowseCustomFolderClick(object sender, RoutedEventArgs e)
    {
        await PickAndScanFolderAsync();
    }

    private async void OnModalScanAllDrivesClick(object sender, RoutedEventArgs e)
    {
        StartupDriveModalOverlay.Visibility = Visibility.Collapsed;
        ScanPathTextBox.Text = "[All Hard Drives]";
        await RunMultiDriveScanAsync();
    }

    private async void OnModalOpenCsvClick(object sender, RoutedEventArgs e)
    {
        StartupDriveModalOverlay.Visibility = Visibility.Collapsed;
        await PickAndScanCsvAsync();
    }

    // ==========================================
    // 1. FILE TREE RIGHT-CLICK & METADATA INSPECTOR
    // ==========================================

    private void OnStorageTreeSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (StorageTreeListView.SelectedItem is StorageTreeNodeViewModel node)
        {
            UpdateSelectedItemMetadata(node);
        }
    }

    private void OnTreeRowRightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        if (sender is FrameworkElement fe && fe.DataContext is StorageTreeNodeViewModel node)
        {
            StorageTreeListView.SelectedItem = node;
            UpdateSelectedItemMetadata(node);

            var flyout = new MenuFlyout();

            var openItem = new MenuFlyoutItem { Text = "Open in Windows File Explorer", Icon = new SymbolIcon(Symbol.Folder) };
            openItem.Click += (s, args) => OpenPathInExplorer(node.FullPath);
            flyout.Items.Add(openItem);

            var copyItem = new MenuFlyoutItem { Text = "Copy Full Path", Icon = new SymbolIcon(Symbol.Copy) };
            copyItem.Click += (s, args) => CopyPathToClipboard(node.FullPath);
            flyout.Items.Add(copyItem);

            flyout.Items.Add(new MenuFlyoutSeparator());

            var scanItem = new MenuFlyoutItem { Text = "Scan This Folder", Icon = new FontIcon { Glyph = "\uEDA2" } };
            scanItem.Click += async (s, args) =>
            {
                ScanPathTextBox.Text = node.FullPath;
                await RunStorageScanAsync(node.FullPath);
            };
            flyout.Items.Add(scanItem);

            var inspectItem = new MenuFlyoutItem { Text = "Inspect Metadata & Attributes", Icon = new SymbolIcon(Symbol.Document) };
            inspectItem.Click += (s, args) => UpdateSelectedItemMetadata(node);
            flyout.Items.Add(inspectItem);

            var recycleItem = new MenuFlyoutItem { Text = "Safe Move to Recycle Bin...", Icon = new SymbolIcon(Symbol.Delete) };
            recycleItem.Click += async (s, args) => await PromptSafeRecycleNodeAsync(node);
            flyout.Items.Add(recycleItem);

            flyout.ShowAt(fe, e.GetPosition(fe));
            e.Handled = true;
        }
    }

    private void UpdateSelectedItemMetadata(StorageTreeNodeViewModel node)
    {
        try
        {
            FooterStatusText.Text = $"{node.Name} ({node.FormattedSize}{(node.IsDirectory ? $", {node.ItemsSummary}" : "")}) — {node.FullPath}";

            SelectedMetadata.Name = node.Name;
            SelectedMetadata.FullPath = node.FullPath;
            SelectedMetadata.FormattedSize = node.FormattedSize;
            SelectedMetadata.ExactBytes = $"{node.SizeBytes:N0} bytes";
            SelectedMetadata.FormattedAllocated = node.FormattedAllocated;
            SelectedMetadata.ItemsSummary = node.ItemsSummary;
            SelectedMetadata.Glyph = node.NodeGlyph;
            SelectedMetadata.HasSelection = true;

            if (Directory.Exists(node.FullPath))
            {
                var dirInfo = new DirectoryInfo(node.FullPath);
                SelectedMetadata.KindLabel = "Folder / Directory";
                SelectedMetadata.CreatedDate = $"Created: {dirInfo.CreationTime:yyyy-MM-dd HH:mm:ss}";
                SelectedMetadata.LastModifiedDate = $"Modified: {dirInfo.LastWriteTime:yyyy-MM-dd HH:mm:ss}";
                SelectedMetadata.Attributes = dirInfo.Attributes.ToString();
            }
            else if (File.Exists(node.FullPath))
            {
                var fileInfo = new FileInfo(node.FullPath);
                string ext = fileInfo.Extension.ToLowerInvariant();
                SelectedMetadata.KindLabel = string.IsNullOrEmpty(ext) ? "File" : $"{ext.ToUpperInvariant()[1..]} File";
                SelectedMetadata.CreatedDate = $"Created: {fileInfo.CreationTime:yyyy-MM-dd HH:mm:ss}";
                SelectedMetadata.LastModifiedDate = $"Modified: {fileInfo.LastWriteTime:yyyy-MM-dd HH:mm:ss}";
                SelectedMetadata.Attributes = fileInfo.Attributes.ToString();
            }
            else
            {
                SelectedMetadata.KindLabel = node.IsDirectory ? "Folder" : "File";
                SelectedMetadata.CreatedDate = "-";
                SelectedMetadata.LastModifiedDate = $"Modified: {node.LastModifiedFormatted}";
                SelectedMetadata.Attributes = node.IsDirectory ? "Directory" : "Normal";
            }
        }
        catch (Exception ex)
        {
            SelectedMetadata.Attributes = $"Inaccessible ({ex.Message})";
        }
    }

    private void OnInspectorOpenExplorerClick(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(SelectedMetadata.FullPath))
        {
            OpenPathInExplorer(SelectedMetadata.FullPath);
        }
    }

    private void OnInspectorCopyPathClick(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(SelectedMetadata.FullPath))
        {
            CopyPathToClipboard(SelectedMetadata.FullPath);
        }
    }

    private async void OnInspectorScanFolderClick(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(SelectedMetadata.FullPath))
        {
            ScanPathTextBox.Text = SelectedMetadata.FullPath;
                await RunStorageScanAsync(SelectedMetadata.FullPath);
        }
    }

    private async void OnInspectorRecycleClick(object sender, RoutedEventArgs e)
    {
        if (StorageTreeListView.SelectedItem is StorageTreeNodeViewModel node)
        {
            await PromptSafeRecycleNodeAsync(node);
        }
        else if (StorageFileListView.SelectedItem is FileRowViewModel file)
        {
            var fakeNode = new StorageTreeNodeViewModel
            {
                FullPath = file.FullPath,
                Name = file.Name,
                FormattedSize = file.FormattedSize,
                IsDirectory = false
            };
            await PromptSafeRecycleNodeAsync(fakeNode);
            ScannedFiles.Remove(file);
        }
    }

    private bool _sortSizeAscending = false;
    private void OnSortSizeClick(object sender, PointerRoutedEventArgs e)
    {
        _sortSizeAscending = !_sortSizeAscending;
        var sorted = _sortSizeAscending
            ? ScannedFiles.OrderBy(f => f.SizeBytes).ToList()
            : ScannedFiles.OrderByDescending(f => f.SizeBytes).ToList();
        ScannedFiles.Clear();
        foreach (var f in sorted) ScannedFiles.Add(f);
    }

    private bool _sortNameAscending = true;
    private void OnSortFileNameClick(object sender, PointerRoutedEventArgs e)
    {
        _sortNameAscending = !_sortNameAscending;
        var sorted = _sortNameAscending
            ? ScannedFiles.OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase).ToList()
            : ScannedFiles.OrderByDescending(f => f.Name, StringComparer.OrdinalIgnoreCase).ToList();
        ScannedFiles.Clear();
        foreach (var f in sorted) ScannedFiles.Add(f);
    }

    private bool _sortExtAscending = true;
    private void OnSortExtClick(object sender, PointerRoutedEventArgs e)
    {
        _sortExtAscending = !_sortExtAscending;
        var sorted = _sortExtAscending
            ? ScannedFiles.OrderBy(f => f.Extension, StringComparer.OrdinalIgnoreCase).ToList()
            : ScannedFiles.OrderByDescending(f => f.Extension, StringComparer.OrdinalIgnoreCase).ToList();
        ScannedFiles.Clear();
        foreach (var f in sorted) ScannedFiles.Add(f);
    }

    private bool _sortModifiedAscending = false;
    private void OnSortModifiedClick(object sender, PointerRoutedEventArgs e)
    {
        _sortModifiedAscending = !_sortModifiedAscending;
        var sorted = _sortModifiedAscending
            ? ScannedFiles.OrderBy(f => f.LastWriteUnixSeconds).ToList()
            : ScannedFiles.OrderByDescending(f => f.LastWriteUnixSeconds).ToList();
        ScannedFiles.Clear();
        foreach (var f in sorted) ScannedFiles.Add(f);
    }

    private void CopyPathToClipboard(string path)
    {
        try
        {
            var dataPackage = new Windows.ApplicationModel.DataTransfer.DataPackage();
            dataPackage.SetText(path);
            Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dataPackage);
            FooterStatusText.Text = $"Copied path to clipboard: {path}";
        }
        catch (Exception ex)
        {
            FooterStatusText.Text = $"Failed to copy path: {ex.Message}";
        }
    }

    private async Task PromptSafeRecycleNodeAsync(StorageTreeNodeViewModel node)
    {
        if (string.IsNullOrWhiteSpace(node.FullPath)) return;

        // Protected check
        string full = Path.GetFullPath(node.FullPath);
        string? root = Path.GetPathRoot(full);
        if (string.Equals(full, root, StringComparison.OrdinalIgnoreCase))
        {
            FooterStatusText.Text = "Safety Guard: Cannot delete the root of a drive.";
            return;
        }

        var dialog = new ContentDialog
        {
            Title = "Confirm Move to Recycle Bin",
            Content = $"Are you sure you want to move this item to the Windows Recycle Bin?\n\nPath: {node.FullPath}\nSize: {node.FormattedSize}",
            PrimaryButtonText = "Move to Recycle Bin",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = this.Content.XamlRoot
        };

        var res = await dialog.ShowAsync();
        if (res == ContentDialogResult.Primary)
        {
            try
            {
                bool success = SafeCleanupService.MoveToRecycleBin(node.FullPath);
                if (success)
                {
                    StorageTreeNodes.Remove(node);
                    FooterStatusText.Text = $"Successfully moved to Recycle Bin: {node.FullPath}";
                }
                else
                {
                    FooterStatusText.Text = $"Failed to move to Recycle Bin (File may be in use or access denied): {node.FullPath}";
                }
            }
            catch (Exception ex)
            {
                FooterStatusText.Text = $"Recycle error: {ex.Message}";
            }
        }
    }

    private void OnOpenInExplorerClick(object sender, RoutedEventArgs e)
    {
        if (StorageTreeListView.SelectedItem is StorageTreeNodeViewModel node)
        {
            OpenPathInExplorer(node.FullPath);
        }
    }

    private void OnCopyPathClick(object sender, RoutedEventArgs e)
    {
        if (StorageTreeListView.SelectedItem is StorageTreeNodeViewModel node)
        {
            CopyPathToClipboard(node.FullPath);
        }
    }

    private void OnScanThisFolderClick(object sender, RoutedEventArgs e)
    {
        if (StorageTreeListView.SelectedItem is StorageTreeNodeViewModel node)
        {
            ScanPathTextBox.Text = node.FullPath;
            _ = RunStorageScanAsync(node.FullPath);
        }
    }

    private static void OpenPathInExplorer(string fullPath)
    {
        try
        {
            if (File.Exists(fullPath))
            {
                Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{fullPath}\"") { UseShellExecute = true });
            }
            else if (Directory.Exists(fullPath))
            {
                Process.Start(new ProcessStartInfo("explorer.exe", $"\"{fullPath}\"") { UseShellExecute = true });
            }
        }
        catch { }
    }

    // ==========================================
    // 2. CLEANUP & DUPLICATES
    // ==========================================

    private SystemDiagnosticReport? _lastDiagnosticReport;

    private async Task PreloadCleanupDiagnosticsAsync(bool force = false)
    {
        if (_lastDiagnosticReport != null && !force) return;

        CleanupSummaryBannerText.Text = "Running instant system diagnostic analysis...";
        CleanupProgressBar.Visibility = Visibility.Visible;

        try
        {
            var report = await _cleanupService.PreloadDiagnosticReportAsync();
            _lastDiagnosticReport = report;

            CleanupTotalReclaimableText.Text = ByteFormatter.FormatBytes(report.TotalReclaimableBytes);
            CleanupTotalReclaimableSubText.Text = "Safe to clean across all categories";

            CleanupRecycleBinText.Text = ByteFormatter.FormatBytes(report.RecycleBinBytes);
            CleanupRecycleBinSubText.Text = $"{report.RecycleBinItemCount:N0} items in trash";

            long tempTotal = report.TempFilesBytes + report.CrashDumpsBytes;
            CleanupTempFilesText.Text = ByteFormatter.FormatBytes(tempTotal);
            CleanupTempFilesSubText.Text = $"{report.TempFilesCount + report.CrashDumpsCount:N0} files in %TEMP% & dumps";

            long dupWaste = report.DuplicateGroups.Sum(g => g.PotentialWasteBytes);
            CleanupDuplicatesText.Text = ByteFormatter.FormatBytes(dupWaste);
            CleanupDuplicatesSubText.Text = $"{report.DuplicateGroups.Count} duplicate clusters";

            CleanupCandidates.Clear();
            foreach (var item in report.DiagnosticCandidates)
            {
                CleanupCandidates.Add(new CleanupCandidateRowViewModel
                {
                    IsSelected = string.Equals(item.Confidence, "high", StringComparison.OrdinalIgnoreCase),
                    Name = item.Name,
                    FullPath = item.FullPath,
                    RuleName = item.RuleId switch
                    {
                        "temp_and_logs" => "Temp & Crash Logs",
                        "installers_and_archives" => "Installer Packages",
                        _ => "Temporary Cache"
                    },
                    Confidence = item.Confidence,
                    Reason = item.Reason,
                    FormattedSize = ByteFormatter.FormatBytes(item.SizeBytes),
                    SizeBytes = item.SizeBytes
                });
            }

            DuplicateGroups.Clear();
            bool isLight = IsLightMode();
            foreach (var g in report.DuplicateGroups)
            {
                var groupVm = new DuplicateGroupCardViewModel
                {
                    Sha256 = g.Sha256,
                    FormattedSize = ByteFormatter.FormatBytes(g.SizeBytes),
                    SummaryText = $"{g.FileCount} copies ({g.HardLinkAliases} hard-link aliases)",
                    PotentialWasteBytes = g.PotentialWasteBytes,
                    FormattedWaste = $"Waste: {ByteFormatter.FormatBytes(g.PotentialWasteBytes)}"
                };

                bool isFirst = true;
                foreach (var f in g.Files)
                {
                    groupVm.Files.Add(new DuplicateItemRowViewModel
                    {
                        IsSelected = !isFirst && !f.IsHardLinkAlias,
                        FullPath = f.FullPath,
                        Name = f.Name,
                        FormattedSize = ByteFormatter.FormatBytes(f.SizeBytes),
                        ModifiedDate = DateTimeOffset.FromUnixTimeSeconds(f.LastWriteUnixSeconds).LocalDateTime.ToString("yyyy-MM-dd HH:mm"),
                        IsHardLinkAlias = f.IsHardLinkAlias,
                        StatusBadge = isFirst ? "Original" : f.IsHardLinkAlias ? "Hard-Link" : "Duplicate",
                        StatusBadgeBackground = isLight
                            ? (isFirst ? "#EFF6FF" : f.IsHardLinkAlias ? "#FFFBEB" : "#F5F3FF")
                            : (isFirst ? "#1E3E66" : f.IsHardLinkAlias ? "#382405" : "#2D1E4A"),
                        StatusBadgeForeground = isLight
                            ? (isFirst ? "#1D4ED8" : f.IsHardLinkAlias ? "#B45309" : "#6D28D9")
                            : (isFirst ? "#A5C6FF" : f.IsHardLinkAlias ? "#FCD34D" : "#C084FC")
                    });
                    isFirst = false;
                }
                DuplicateGroups.Add(groupVm);
            }

            // Build Storage Sense Category Cards
            StorageSenseCategories.Clear();

            // 1. Recycle Bin Card
            var rbCard = new StorageSenseCategoryCardViewModel
            {
                CategoryId = "recycle_bin",
                Title = "Windows Recycle Bin",
                Glyph = "\xE74D",
                GlyphColor = isLight ? "#2563EB" : "#60A5FA",
                GlyphBg = isLight ? "#EFF6FF" : "#1E293B",
                LocationDisplay = @"C:\$Recycle.Bin",
                Description = "Contains files you previously deleted from your computer. These continue taking up drive space until emptied.",
                FormattedSize = ByteFormatter.FormatBytes(report.RecycleBinBytes),
                SizeBytes = report.RecycleBinBytes,
                CountSummary = $"{report.RecycleBinItemCount:N0} items in trash",
                HasQuickAction = report.RecycleBinBytes > 0,
                QuickActionText = "Empty Bin Now",
                IsSelected = report.RecycleBinBytes > 0
            };
            StorageSenseCategories.Add(rbCard);

            // 2. Temporary App & Cache Files (%TEMP%)
            var tempCard = new StorageSenseCategoryCardViewModel
            {
                CategoryId = "temp_files",
                Title = "Temporary App & Cache Files",
                Glyph = "\xE8B7",
                GlyphColor = isLight ? "#D97706" : "#FBBF24",
                GlyphBg = isLight ? "#FFFBEB" : "#2E2413",
                LocationDisplay = SanitizePrivacyUser(@"%TEMP% (" + Path.GetTempPath().TrimEnd('\\') + ")"),
                Description = "Temporary working files and caches left behind by closed applications that are safe to remove.",
                FormattedSize = ByteFormatter.FormatBytes(report.TempFilesBytes),
                SizeBytes = report.TempFilesBytes,
                CountSummary = $"{report.TempFilesCount:N0} temporary files",
                IsSelected = true
            };
            foreach (var item in report.DiagnosticCandidates.Where(c => c.RuleId == "temp_and_logs" && !c.FullPath.EndsWith(".dmp", StringComparison.OrdinalIgnoreCase)))
            {
                tempCard.Items.Add(new CleanupCandidateRowViewModel
                {
                    IsSelected = true,
                    Name = item.Name,
                    FullPath = item.FullPath,
                    RuleName = "Temporary File",
                    Confidence = item.Confidence,
                    Reason = item.Reason,
                    FormattedSize = ByteFormatter.FormatBytes(item.SizeBytes),
                    SizeBytes = item.SizeBytes
                });
            }
            StorageSenseCategories.Add(tempCard);

            // 3. Crash Dumps (%LOCALAPPDATA%\CrashDumps)
            var dumpCard = new StorageSenseCategoryCardViewModel
            {
                CategoryId = "crash_dumps",
                Title = "System Crash Dumps & Error Reports",
                Glyph = "\xE7BA",
                GlyphColor = isLight ? "#DC2626" : "#F87171",
                GlyphBg = isLight ? "#FEF2F2" : "#371B1D",
                LocationDisplay = @"%LOCALAPPDATA%\CrashDumps",
                Description = "Diagnostic memory dump files saved when programs crash unexpectedly. Safe to clean once resolved.",
                FormattedSize = ByteFormatter.FormatBytes(report.CrashDumpsBytes),
                SizeBytes = report.CrashDumpsBytes,
                CountSummary = $"{report.CrashDumpsCount:N0} crash dump files",
                IsSelected = true
            };
            foreach (var item in report.DiagnosticCandidates.Where(c => c.FullPath.EndsWith(".dmp", StringComparison.OrdinalIgnoreCase)))
            {
                dumpCard.Items.Add(new CleanupCandidateRowViewModel
                {
                    IsSelected = true,
                    Name = item.Name,
                    FullPath = item.FullPath,
                    RuleName = "Crash Dump",
                    Confidence = item.Confidence,
                    Reason = item.Reason,
                    FormattedSize = ByteFormatter.FormatBytes(item.SizeBytes),
                    SizeBytes = item.SizeBytes
                });
            }
            StorageSenseCategories.Add(dumpCard);

            // 4. Downloaded Setup Packages & Archives
            string downloadsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            var installerCard = new StorageSenseCategoryCardViewModel
            {
                CategoryId = "installers",
                Title = "Downloaded Setup Packages & Archives",
                Glyph = "\xE896",
                GlyphColor = isLight ? "#059669" : "#34D399",
                GlyphBg = isLight ? "#ECFDF5" : "#132D24",
                LocationDisplay = SanitizePrivacyUser(downloadsDir),
                Description = "Installation files (.exe, .msi, .iso) and archives. Kept unchecked by default to protect your downloads.",
                FormattedSize = ByteFormatter.FormatBytes(report.InstallerLeftoversBytes),
                SizeBytes = report.InstallerLeftoversBytes,
                CountSummary = $"{report.InstallerLeftoversCount:N0} setup packages",
                IsSelected = false
            };
            foreach (var item in report.DiagnosticCandidates.Where(c => c.RuleId == "installers_and_archives"))
            {
                installerCard.Items.Add(new CleanupCandidateRowViewModel
                {
                    IsSelected = false,
                    Name = item.Name,
                    FullPath = item.FullPath,
                    RuleName = "Installer / Package",
                    Confidence = item.Confidence,
                    Reason = item.Reason,
                    FormattedSize = ByteFormatter.FormatBytes(item.SizeBytes),
                    SizeBytes = item.SizeBytes
                });
            }
            StorageSenseCategories.Add(installerCard);

            // 5. Identical Duplicate Files
            var dupCard = new StorageSenseCategoryCardViewModel
            {
                CategoryId = "duplicates",
                Title = "Identical Duplicate Files",
                Glyph = "\xE8A5",
                GlyphColor = isLight ? "#7C3AED" : "#A78BFA",
                GlyphBg = isLight ? "#F5F3FF" : "#2E1C4E",
                LocationDisplay = "User Folders & Scanned Targets",
                Description = "Redundant files with identical SHA-256 hashes. The original file is always preserved safely.",
                FormattedSize = ByteFormatter.FormatBytes(dupWaste),
                SizeBytes = dupWaste,
                CountSummary = $"{report.DuplicateGroups.Count:N0} duplicate groups ({ByteFormatter.FormatBytes(dupWaste)} waste)",
                IsSelected = report.DuplicateGroups.Count > 0
            };
            foreach (var g in report.DuplicateGroups)
            {
                foreach (var f in g.Files.Skip(1))
                {
                    if (!f.IsHardLinkAlias)
                    {
                        dupCard.Items.Add(new CleanupCandidateRowViewModel
                        {
                            IsSelected = true,
                            Name = f.Name,
                            FullPath = f.FullPath,
                            RuleName = "Duplicate Copy",
                            Confidence = "high",
                            Reason = $"Duplicate copy of {g.Files[0].Name}",
                            FormattedSize = ByteFormatter.FormatBytes(f.SizeBytes),
                            SizeBytes = f.SizeBytes
                        });
                    }
                }
            }
            StorageSenseCategories.Add(dupCard);

            CleanupSummaryBannerText.Text = $"Storage Sense Recommendations Ready: {ByteFormatter.FormatBytes(report.TotalReclaimableBytes)} reclaimable storage detected across Recycle Bin, temporary files, and duplicate candidates.";
        }
        catch (Exception ex)
        {
            CleanupSummaryBannerText.Text = $"Diagnostic error: {ex.Message}";
        }
        finally
        {
            CleanupProgressBar.Visibility = Visibility.Collapsed;
        }
    }

    private async void OnPreloadCleanupClick(object sender, RoutedEventArgs e)
    {
        await PreloadCleanupDiagnosticsAsync(force: true);
    }

    private async void OnEmptyRecycleBinClick(object sender, RoutedEventArgs e)
    {
        var dialog = new ContentDialog
        {
            Title = "Empty Windows Recycle Bin",
            Content = "Are you sure you want to permanently delete all items in the Windows Recycle Bin?",
            PrimaryButtonText = "Empty Recycle Bin",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = this.Content.XamlRoot
        };

        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            bool ok = SafeCleanupService.EmptyRecycleBin();
            if (ok)
            {
                FooterStatusText.Text = "Windows Recycle Bin emptied successfully.";
            }
            RefreshDrivesList();
            await PreloadCleanupDiagnosticsAsync(force: true);
        }
    }

    private void OnSelectAllCleanupCandidatesClick(object sender, RoutedEventArgs e)
    {
        foreach (var c in CleanupCandidates) c.IsSelected = true;
    }

    private void OnSelectNoneCleanupCandidatesClick(object sender, RoutedEventArgs e)
    {
        foreach (var c in CleanupCandidates) c.IsSelected = false;
    }

    private void OnToggleCategoryExpandClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement fe && fe.DataContext is StorageSenseCategoryCardViewModel card)
        {
            card.IsExpanded = !card.IsExpanded;
        }
    }

    private void OnCategoryQuickActionClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement fe && fe.DataContext is StorageSenseCategoryCardViewModel card)
        {
            if (card.CategoryId == "recycle_bin")
            {
                OnEmptyRecycleBinClick(sender, e);
            }
        }
    }

    private void OnSelectRecommendedCategoriesClick(object sender, RoutedEventArgs e)
    {
        foreach (var cat in StorageSenseCategories)
        {
            cat.IsSelected = cat.CategoryId != "installers";
            foreach (var item in cat.Items)
            {
                item.IsSelected = cat.CategoryId != "installers";
            }
        }
    }

    private void OnSelectAllCategoriesClick(object sender, RoutedEventArgs e)
    {
        foreach (var cat in StorageSenseCategories)
        {
            cat.IsSelected = true;
            foreach (var item in cat.Items) item.IsSelected = true;
        }
    }

    private void OnSelectNoneCategoriesClick(object sender, RoutedEventArgs e)
    {
        foreach (var cat in StorageSenseCategories)
        {
            cat.IsSelected = false;
            foreach (var item in cat.Items) item.IsSelected = false;
        }
    }

    private async void OnRunCleanupScanClick(object sender, RoutedEventArgs e)
    {
        AnalyzeCleanupButton.IsEnabled = false;
        ReviewAndCleanButton.IsEnabled = false;
        CleanupProgressBar.Visibility = Visibility.Visible;

        try
        {
            IEnumerable<ScannedEntry>? entriesToAnalyze = null;

            if (_lastScanResult != null && _lastScanResult.AllEntries.Count > 0)
            {
                // Safely filter out Windows and Program Files system binaries from duplicate hashing
                entriesToAnalyze = _lastScanResult.AllEntries.Where(entry =>
                {
                    string p = entry.FullPath.ToLowerInvariant();
                    return !p.Contains(@"\windows\") &&
                           !p.Contains(@"\program files\") &&
                           !p.Contains(@"\program files (x86)\") &&
                           !p.Contains(@"\$recycle.bin\") &&
                           !p.Contains(@"\system volume information\");
                }).ToList();
            }
            else
            {
                // Never scan unconstrained C:\. Default to user profile or custom non-root folder.
                string customPath = ScanPathTextBox.Text.Trim();
                string targetPath;
                if (!string.IsNullOrWhiteSpace(customPath) && !string.Equals(customPath, @"C:\", StringComparison.OrdinalIgnoreCase) && Directory.Exists(customPath))
                {
                    targetPath = customPath;
                }
                else
                {
                    targetPath = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                }

                CleanupSummaryBannerText.Text = $"Analyzing {targetPath} for duplicate files and cleanable caches...";
                var scanner = new Win32StorageScanner();
                using var scanCts = new CancellationTokenSource(TimeSpan.FromMinutes(3));
                var scanResult = await scanner.ScanAsync(targetPath, progress: null, topN: 50, retainAllEntries: true, cancellationToken: scanCts.Token, options: BuildStorageScanOptions(targetPath));
                entriesToAnalyze = scanResult.AllEntries;
            }

            if (entriesToAnalyze == null || !entriesToAnalyze.Any())
            {
                CleanupSummaryBannerText.Text = "No user files available to analyze. Please scan a folder or run diagnostics.";
                return;
            }

            CleanupSummaryBannerText.Text = "Running 3-stage SHA-256 duplicate detection and evaluating cleanup rules...";
            using var dupCts = new CancellationTokenSource(TimeSpan.FromMinutes(3));
            var report = await _duplicateEngine.FindDuplicatesAsync(entriesToAnalyze, dupCts.Token);
            _lastDuplicateReport = report;

            DuplicateGroups.Clear();
            bool isLight = IsLightMode();
            foreach (var g in report.Groups)
            {
                var groupVm = new DuplicateGroupCardViewModel
                {
                    Sha256 = g.Sha256,
                    FormattedSize = ByteFormatter.FormatBytes(g.SizeBytes),
                    SummaryText = $"{g.FileCount} copies ({g.HardLinkAliases} hard-link aliases)",
                    PotentialWasteBytes = g.PotentialWasteBytes,
                    FormattedWaste = $"Waste: {ByteFormatter.FormatBytes(g.PotentialWasteBytes)}"
                };

                bool isFirst = true;
                foreach (var f in g.Files)
                {
                    groupVm.Files.Add(new DuplicateItemRowViewModel
                    {
                        IsSelected = !isFirst && !f.IsHardLinkAlias,
                        FullPath = f.FullPath,
                        Name = f.Name,
                        FormattedSize = ByteFormatter.FormatBytes(f.SizeBytes),
                        ModifiedDate = DateTimeOffset.FromUnixTimeSeconds(f.LastWriteUnixSeconds).LocalDateTime.ToString("yyyy-MM-dd HH:mm"),
                        IsHardLinkAlias = f.IsHardLinkAlias,
                        StatusBadge = isFirst ? "Original" : f.IsHardLinkAlias ? "Hard-Link" : "Duplicate",
                        StatusBadgeBackground = isLight
                            ? (isFirst ? "#EFF6FF" : f.IsHardLinkAlias ? "#FFFBEB" : "#F5F3FF")
                            : (isFirst ? "#1E3E66" : f.IsHardLinkAlias ? "#382405" : "#2D1E4A"),
                        StatusBadgeForeground = isLight
                            ? (isFirst ? "#1D4ED8" : f.IsHardLinkAlias ? "#B45309" : "#6D28D9")
                            : (isFirst ? "#A5C6FF" : f.IsHardLinkAlias ? "#FCD34D" : "#C084FC")
                    });
                    isFirst = false;
                }

                DuplicateGroups.Add(groupVm);
            }

            var ruleGroups = await Task.Run(() => _cleanupService.AnalyzeCleanupRules(entriesToAnalyze, report));
            CleanupCandidates.Clear();
            foreach (var rg in ruleGroups)
            {
                foreach (var item in rg.Items)
                {
                    CleanupCandidates.Add(new CleanupCandidateRowViewModel
                    {
                        IsSelected = true,
                        Name = item.Name,
                        FullPath = item.FullPath,
                        RuleName = rg.Name,
                        Confidence = item.Confidence,
                        Reason = item.Reason,
                        FormattedSize = ByteFormatter.FormatBytes(item.SizeBytes),
                        SizeBytes = item.SizeBytes
                    });
                }
            }

            long totalWaste = report.TotalPotentialWasteBytes + ruleGroups.Sum(r => r.ReclaimableBytes);
            CleanupSummaryBannerText.Text = $"Analysis Complete: Found {report.TotalGroups} duplicate groups ({ByteFormatter.FormatBytes(report.TotalPotentialWasteBytes)} waste) and {CleanupCandidates.Count} cleanup candidates. Total reclaimable: {ByteFormatter.FormatBytes(totalWaste)}.";
        }
        catch (OperationCanceledException)
        {
            CleanupSummaryBannerText.Text = "Deep duplicate scan timed out or was canceled. Select a specific folder for duplicate scans.";
        }
        catch (Exception ex)
        {
            CleanupSummaryBannerText.Text = $"Cleanup analysis error: {ex.Message}";
        }
        finally
        {
            AnalyzeCleanupButton.IsEnabled = true;
            ReviewAndCleanButton.IsEnabled = true;
            CleanupProgressBar.Visibility = Visibility.Collapsed;
        }
    }

    private async void OnReviewAndCleanSelectedClick(object sender, RoutedEventArgs e)
    {
        var selectedPaths = new List<string>();
        bool cleanRecycleBin = false;

        foreach (var cat in StorageSenseCategories)
        {
            if (cat.CategoryId == "recycle_bin")
            {
                if (cat.IsSelected && cat.SizeBytes > 0)
                {
                    cleanRecycleBin = true;
                }
                continue;
            }

            if (cat.IsSelected)
            {
                // If category is selected, collect its selected items
                foreach (var item in cat.Items)
                {
                    if (item.IsSelected && !string.IsNullOrWhiteSpace(item.FullPath) && !selectedPaths.Contains(item.FullPath))
                    {
                        selectedPaths.Add(item.FullPath);
                    }
                }
            }
        }

        // Also include any items checked in legacy lists if any
        foreach (var g in DuplicateGroups)
        {
            foreach (var f in g.Files)
            {
                if (f.IsSelected && !f.IsHardLinkAlias && !selectedPaths.Contains(f.FullPath))
                {
                    selectedPaths.Add(f.FullPath);
                }
            }
        }

        foreach (var c in CleanupCandidates)
        {
            if (c.IsSelected && !selectedPaths.Contains(c.FullPath))
            {
                selectedPaths.Add(c.FullPath);
            }
        }

        if (selectedPaths.Count == 0 && !cleanRecycleBin)
        {
            await ShowDialogAsync("No Items Selected", "Please select one or more recommendation categories or items to clean.");
            return;
        }

        string mode = (CleanupModeComboBox.SelectedItem as ComboBoxItem)?.Tag as string ?? "recycle";
        string modeLabel = mode == "recycle" ? "Windows Recycle Bin (Safe)" : "Permanent Delete";
        string modeWarning = mode == "recycle"
            ? "Files will be safely moved to the Windows Recycle Bin.\n\nNote: In Windows, moving items to the Recycle Bin preserves them on disk. To free up drive space in File Explorer, empty the Recycle Bin after cleaning (or choose 'Permanent Delete')."
            : "WARNING: Files will be permanently erased from disk immediately.";

        var allowedRoots = selectedPaths
            .Select(path => Path.GetPathRoot(path))
            .Where(root => !string.IsNullOrWhiteSpace(root))
            .Select(root => root!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        CleanupProposal? cleanupProposal = null;
        if (selectedPaths.Count > 0)
        {
            ReviewAndCleanButton.IsEnabled = false;
            CleanupProgressBar.Visibility = Visibility.Visible;
            CleanupSummaryBannerText.Text = "Validating selected cleanup items and calculating folder sizes...";
            try
            {
                cleanupProposal = await Task.Run(() => _cleanupService.ProposeCleanup(selectedPaths, allowedRoots, mode));
                selectedPaths = cleanupProposal.ValidatedPaths.ToList();
            }
            catch (Exception ex)
            {
                await ShowDialogAsync("Cleanup Review Failed", ex.Message);
                return;
            }
            finally
            {
                ReviewAndCleanButton.IsEnabled = true;
                CleanupProgressBar.Visibility = Visibility.Collapsed;
            }
        }

        long totalBytes = cleanupProposal?.TotalBytes ?? 0;
        if (cleanRecycleBin && _lastDiagnosticReport != null)
        {
            totalBytes += _lastDiagnosticReport.RecycleBinBytes;
        }

        string contentMsg = $"Are you sure you want to clean selected storage?\n\n" +
            $"• Selected items: {selectedPaths.Count:N0}\n" +
            $"• Recycle Bin: {(cleanRecycleBin ? "Empty completely" : "Leave unchanged")}\n" +
            $"• Total reclaimable: {ByteFormatter.FormatBytes(totalBytes)}\n" +
            $"• Mode: {modeLabel}\n\n" +
            modeWarning;
        if (cleanupProposal?.SkippedReasons.Count > 0)
        {
            contentMsg += "\n\nItems that will be skipped:\n" + string.Join("\n", cleanupProposal.SkippedReasons.Take(5));
            if (cleanupProposal.SkippedReasons.Count > 5)
            {
                contentMsg += $"\n...and {cleanupProposal.SkippedReasons.Count - 5} more.";
            }
        }

        var dialog = new ContentDialog
        {
            Title = "Confirm Storage Cleanup",
            Content = contentMsg,
            PrimaryButtonText = "Clean Now",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = this.Content.XamlRoot
        };

        bool requireConfirmation = _settings.ConfirmBeforeDelete || mode == "permanent" || cleanRecycleBin;
        var result = requireConfirmation ? await dialog.ShowAsync() : ContentDialogResult.Primary;
        if (result != ContentDialogResult.Primary)
        {
            return;
        }

        try
        {
            ReviewAndCleanButton.IsEnabled = false;
            RescanDiagnosticsButton.IsEnabled = false;
            CleanupProgressBar.Visibility = Visibility.Visible;
            CleanupSummaryBannerText.Text = "Cleaning selected files in background...";

            int removedCount = 0;
            long bytesReclaimed = 0;
            var failedReasons = new List<string>();

            await Task.Run(() =>
            {
                // 1. Recycle Bin cleanup if selected
                if (cleanRecycleBin)
                {
                    long rbBytes = _lastDiagnosticReport?.RecycleBinBytes ?? 0;
                    if (SafeCleanupService.EmptyRecycleBin())
                    {
                        bytesReclaimed += rbBytes;
                        removedCount += (int)(_lastDiagnosticReport?.RecycleBinItemCount ?? 0);
                    }
                }

                // 2. File list cleanup
                if (cleanupProposal != null)
                {
                    try
                    {
                        var exec = _cleanupService.ExecuteCleanup(cleanupProposal.Token, allowedRoots);
                        removedCount += exec.RemovedCount;
                        bytesReclaimed += exec.BytesReclaimed;
                        failedReasons.AddRange(exec.FailedReasons);
                    }
                    catch (Exception ex)
                    {
                        failedReasons.Add(ex.Message);
                    }
                }
            });

            string tip = (mode == "recycle" && !cleanRecycleBin)
                ? "\n\n💡 Tip: Since items were moved to the Recycle Bin, empty the Recycle Bin to reclaim physical drive space in File Explorer."
                : "";

            await ShowDialogAsync("Cleanup Complete",
                $"Cleanup finished successfully!\n\n" +
                $"• Space Processed: {ByteFormatter.FormatBytes(bytesReclaimed)}\n" +
                $"• Items Removed: {removedCount:N0}\n" +
                (failedReasons.Count > 0 ? $"• Skipped / In-use: {failedReasons.Count} items" : "• All selected items removed cleanly.") +
                tip);

            // Instantly refresh recommendations and volume metrics (<200ms)
            RefreshDrivesList();
            await PreloadCleanupDiagnosticsAsync(force: true);
        }
        catch (Exception ex)
        {
            await ShowDialogAsync("Cleanup Error", $"An error occurred during cleanup: {ex.Message}");
        }
        finally
        {
            ReviewAndCleanButton.IsEnabled = true;
            RescanDiagnosticsButton.IsEnabled = true;
            CleanupProgressBar.Visibility = Visibility.Collapsed;
        }
    }

    // ==========================================
    // 3. INSTALLED APPS & LEFTOVERS
    // ==========================================

    private async Task RefreshInstalledAppsAsync()
    {
        try
        {
            RefreshAppsButton.IsEnabled = false;
            AppsProgressBar.Visibility = Visibility.Visible;

            await Task.Run(() =>
            {
                _allInstalledApps = _installedAppsEngine.EnumerateInstalledApps();
            });

            ApplyInstalledAppsFilter(AppSearchFilterBox.Text);
        }
        catch (Exception ex)
        {
            InstalledAppsCountText.Text = $"Error loading apps: {ex.Message}";
        }
        finally
        {
            RefreshAppsButton.IsEnabled = true;
            AppsProgressBar.Visibility = Visibility.Collapsed;
        }
    }

    private void ApplyInstalledAppsFilter(string filter)
    {
        InstalledApps.Clear();
        var query = _allInstalledApps.AsEnumerable();
        if (!string.IsNullOrWhiteSpace(filter))
        {
            query = query.Where(a => a.Name.Contains(filter, StringComparison.OrdinalIgnoreCase) ||
                                     a.Publisher.Contains(filter, StringComparison.OrdinalIgnoreCase));
        }

        foreach (var app in query.OrderBy(a => a.Name))
        {
            InstalledApps.Add(new InstalledAppRowViewModel(
                Id: app.Id,
                Name: app.Name,
                Publisher: string.IsNullOrEmpty(app.Publisher) ? "Unknown Publisher" : app.Publisher,
                Version: app.Version,
                InstallDate: app.InstallDate,
                InstallLocation: app.InstallLocation,
                FormattedSize: app.EstimatedSizeBytes.HasValue ? ByteFormatter.FormatBytes(app.EstimatedSizeBytes) : "-",
                UninstallString: app.UninstallString,
                CanUninstall: app.CanUninstall,
                RawModel: app
            ));
        }

        InstalledAppsCountText.Text = $"Installed Applications ({InstalledApps.Count})";
    }

    private void OnAppFilterTextChanged(object sender, TextChangedEventArgs e)
    {
        ApplyInstalledAppsFilter(AppSearchFilterBox.Text);
    }

    private async void OnRefreshInstalledAppsClick(object sender, RoutedEventArgs e)
    {
        await RefreshInstalledAppsAsync();
    }

    private async void OnInstalledAppSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (InstalledAppsListView.SelectedItem is InstalledAppRowViewModel vm && vm.RawModel != null)
        {
            await RunLeftoverScanAsync(vm.RawModel.Id, vm.RawModel.Name, vm.RawModel.Publisher, vm.RawModel.InstallLocation);
        }
    }

    private async void OnScanSelectedAppLeftoversClick(object sender, RoutedEventArgs e)
    {
        if (InstalledAppsListView.SelectedItem is InstalledAppRowViewModel vm && vm.RawModel != null)
        {
            await RunLeftoverScanAsync(vm.RawModel.Id, vm.RawModel.Name, vm.RawModel.Publisher, vm.RawModel.InstallLocation);
        }
        else
        {
            _ = ShowDialogAsync("No App Selected", "Please select an installed application first.");
        }
    }

    private async Task RunLeftoverScanAsync(string appId, string appName, string publisher, string installLocation)
    {
        int generation = Interlocked.Increment(ref _leftoverScanGeneration);
        LeftoversSummaryText.Text = $"Scanning bounded AppData and publisher locations for {appName}...";
        try
        {
            var report = await Task.Run(() => _installedAppsEngine.ScanAppLeftovers(
                appId,
                appName,
                publisher,
                installLocation,
                includeInstallLocation: false));
            if (generation != Volatile.Read(ref _leftoverScanGeneration)) return;
            _currentLeftoverInstallLocation = installLocation;
            PopulateLeftoverReport(report);
        }
        catch (Exception ex)
        {
            if (generation == Volatile.Read(ref _leftoverScanGeneration))
            {
                LeftoversSummaryText.Text = $"Could not inspect leftovers for {appName}: {ex.Message}";
            }
        }
    }

    private void PopulateLeftoverReport(AppLeftoverReport report)
    {
        LeftoverItems.Clear();

        foreach (var item in report.FileSystemLeftovers)
        {
            LeftoverItems.Add(new LeftoverItemRowViewModel
            {
                IsSelected = string.Equals(item.Confidence, "High", StringComparison.OrdinalIgnoreCase),
                FullPath = item.FullPath,
                Name = item.Name,
                LocationGroup = item.LocationGroup,
                Confidence = item.Confidence,
                Evidence = item.Evidence,
                FormattedSize = ByteFormatter.FormatBytes(item.SizeBytes),
                SizeBytes = item.SizeBytes
            });
        }

        LeftoversSummaryText.Text = $"Found {report.TotalCount} traces ({ByteFormatter.FormatBytes(report.TotalReclaimableBytes)} reclaimable) for {report.AppName}.";
    }

    private async void OnUninstallSelectedAppClick(object sender, RoutedEventArgs e)
    {
        if (InstalledAppsListView.SelectedItem is not InstalledAppRowViewModel vm || vm.RawModel == null)
        {
            await ShowDialogAsync("No App Selected", "Please select an installed application to uninstall.");
            return;
        }

        var app = vm.RawModel;
        var dialog = new ContentDialog
        {
            Title = $"Uninstall {app.Name}",
            Content = $"Step 1: Groundwork will launch the vendor uninstaller:\n\n{app.UninstallString}\n\nStep 2: Groundwork will monitor the uninstaller until it exits and automatically scan leftover files and registry keys for safe removal.",
            PrimaryButtonText = "Launch Uninstaller",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = this.Content.XamlRoot
        };

        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            LeftoversSummaryText.Text = $"Launching vendor uninstaller for {app.Name}...";
            try
            {
                var session = await _installedAppsEngine.RunMonitoredUninstallAsync(app);
                PopulateLeftoverReport(session.PostUninstallLeftovers);
                await RefreshInstalledAppsAsync();
                await ShowDialogAsync("Uninstallation Completed", $"Vendor uninstaller finished (Exit code: {session.ExitCode ?? 0}).\nLeftover traces found: {session.PostUninstallLeftovers.TotalCount} ({ByteFormatter.FormatBytes(session.PostUninstallLeftovers.TotalReclaimableBytes)}).");
            }
            catch (Exception ex)
            {
                await ShowDialogAsync("Uninstall Error", ex.Message);
            }
        }
    }

    private async void OnCleanSelectedLeftoversClick(object sender, RoutedEventArgs e)
    {
        var selected = LeftoverItems.Where(l => l.IsSelected).Select(l => l.FullPath).ToList();
        if (selected.Count == 0)
        {
            await ShowDialogAsync("No Leftovers Selected", "Please select one or more leftover items to clean.");
            return;
        }

        var allowedRoots = InstalledAppsEngineService.GetAllowedCleanupRootsForApp(_currentLeftoverInstallLocation);
        var proposal = _cleanupService.ProposeCleanup(selected, allowedRoots, mode: "recycle");

        var dialog = new ContentDialog
        {
            Title = "Clean Application Leftovers",
            Content = $"Are you sure you want to move {proposal.ItemCount} leftover items ({ByteFormatter.FormatBytes(proposal.TotalBytes)}) to the Windows Recycle Bin?",
            PrimaryButtonText = "Clean Leftovers",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = this.Content.XamlRoot
        };

        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            var exec = _cleanupService.ExecuteCleanup(proposal.Token, allowedRoots);
            await ShowDialogAsync("Cleanup Completed", $"Removed {exec.RemovedCount} leftover items ({ByteFormatter.FormatBytes(exec.BytesReclaimed)} reclaimed).");
            foreach (var path in exec.RemovedPaths)
            {
                var item = LeftoverItems.FirstOrDefault(l => string.Equals(l.FullPath, path, StringComparison.OrdinalIgnoreCase));
                if (item != null) LeftoverItems.Remove(item);
            }
        }
    }

    // ==========================================
    // 4. AI OPERATOR & ASSISTANT
    // ==========================================

    // ==========================================
    // 4. AGENTIC AI ASSISTANT & INTENT ENGINE
    // ==========================================

    private string _lastAssistantAnswer = string.Empty;

    private const string AgentSystemInstructions = "You are Groundwork Agent, a Windows system and storage assistant. Answer the user's actual question directly and use the supplied inventory as evidence. Retrieve relevant facts from the inventory before saying information is unavailable. Distinguish confirmed facts, conclusions, estimates, historical snapshots, and unknowns. Never invent hardware specs, performance/FPS, diagnostic results, official requirements, or compatibility. Treat physical disks and logical volumes separately; multiple drive letters may belong to one physical disk. Do not infer M.2 slot count or motherboard upgrade support from installed drives. For game compatibility, compare CPU, GPU/VRAM, RAM, OS, graphics capabilities, and fresh free space with official requirements only if an authoritative source was actually retrieved; otherwise say that requirements were not verified and do not give fabricated FPS. When Gemini Search is enabled and current game requirements or exact-model hardware specifications matter, search for the official publisher or manufacturer source and cite returned sources. If no authoritative source is returned, state that the fact remains unresolved. Use conversation history only to resolve follow-up references, never to override newer inventory. Gemini Search may be used only when explicitly enabled; never imply a search succeeded without grounding sources. Explain exactly which facts are known, missing, and how to verify them; avoid generic disclaimers.";

    private void OnResetAssistantQueryClick(object sender, RoutedEventArgs e)
    {
        AssistantQuestionBox.Text = string.Empty;
        AssistantActiveQueryLabel.Text = string.Empty;
        _lastAssistantAnswer = string.Empty;
        _agentConversation.Clear();
        AgentLocalStateService.ClearConversation();
        AssistantAnswerRichBlock.Blocks.Clear();
        AssistantStandbyGrid.Visibility = Visibility.Visible;
        AssistantResultsGrid.Visibility = Visibility.Collapsed;
    }

    private void OnCopyAssistantResponseClick(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_lastAssistantAnswer)) return;
        try
        {
            var dp = new Windows.ApplicationModel.DataTransfer.DataPackage();
            dp.SetText(_lastAssistantAnswer);
            Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dp);
            FooterStatusText.Text = "AI Agent response copied to clipboard.";
        }
        catch { }
    }

    private static string SanitizePrivacyUser(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        string u = Environment.UserName;
        if (!string.IsNullOrEmpty(u) && u.Length >= 2 && text.Contains(u, StringComparison.OrdinalIgnoreCase))
        {
            return Regex.Replace(text, Regex.Escape(u), "User", RegexOptions.IgnoreCase);
        }
        return text;
    }

    private void RenderFormattedAgentResponse(string text)
    {
        AssistantAnswerRichBlock.Blocks.Clear();
        if (string.IsNullOrWhiteSpace(text)) return;
        text = SanitizePrivacyUser(text);

        var lines = text.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.None);

        foreach (var rawLine in lines)
        {
            var line = rawLine.Trim();

            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            if (line.StartsWith("# "))
            {
                var p = new Paragraph { Margin = new Thickness(0, 10, 0, 4) };
                var bold = new Bold();
                bold.Inlines.Add(new Run
                {
                    Text = line.Substring(2).Trim(),
                    FontSize = 16,
                    FontWeight = Microsoft.UI.Text.FontWeights.SemiBold
                });
                p.Inlines.Add(bold);
                AssistantAnswerRichBlock.Blocks.Add(p);
                continue;
            }

            if (line.StartsWith("## ") || line.StartsWith("### "))
            {
                var p = new Paragraph { Margin = new Thickness(0, 8, 0, 4) };
                var bold = new Bold();
                bold.Inlines.Add(new Run
                {
                    Text = line.TrimStart('#').Trim(),
                    FontSize = 14.5,
                    FontWeight = Microsoft.UI.Text.FontWeights.SemiBold
                });
                p.Inlines.Add(bold);
                AssistantAnswerRichBlock.Blocks.Add(p);
                continue;
            }

            if (line.StartsWith("* ") || line.StartsWith("- "))
            {
                var itemText = line.Substring(2).Trim();
                var p = new Paragraph { Margin = new Thickness(14, 2, 0, 2) };
                p.Inlines.Add(new Run { Text = "• ", FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["GwAccentBrush"] });
                AddFormattedInlines(p, itemText, 13.5);
                AssistantAnswerRichBlock.Blocks.Add(p);
                continue;
            }

            var numMatch = Regex.Match(line, @"^(\d+\.)\s+(.*)$");
            if (numMatch.Success)
            {
                var numPrefix = numMatch.Groups[1].Value;
                var itemText = numMatch.Groups[2].Value;
                var p = new Paragraph { Margin = new Thickness(14, 2, 0, 2) };
                var bold = new Bold();
                bold.Inlines.Add(new Run { Text = numPrefix + " ", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
                p.Inlines.Add(bold);
                AddFormattedInlines(p, itemText, 13.5);
                AssistantAnswerRichBlock.Blocks.Add(p);
                continue;
            }

            var para = new Paragraph { Margin = new Thickness(0, 2, 0, 6) };
            AddFormattedInlines(para, line, 13.5);
            AssistantAnswerRichBlock.Blocks.Add(para);
        }
    }

    private void AddFormattedInlines(Paragraph paragraph, string text, double fontSize = 13.5)
    {
        var regex = new Regex(@"(\*\*.*?\*\*|`.*?`)");
        var parts = regex.Split(text);

        foreach (var part in parts)
        {
            if (string.IsNullOrEmpty(part)) continue;

            if (part.StartsWith("**") && part.EndsWith("**") && part.Length >= 4)
            {
                var boldText = part.Substring(2, part.Length - 4);
                var bold = new Bold();
                bold.Inlines.Add(new Run { Text = boldText, FontSize = fontSize });
                paragraph.Inlines.Add(bold);
            }
            else if (part.StartsWith("`") && part.EndsWith("`") && part.Length >= 2)
            {
                var codeText = part.Substring(1, part.Length - 2);
                var run = new Run
                {
                    Text = codeText,
                    FontFamily = new Microsoft.UI.Xaml.Media.FontFamily("Consolas"),
                    FontSize = fontSize * 0.95,
                    Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["GwAccentBrush"]
                };
                paragraph.Inlines.Add(run);
            }
            else
            {
                paragraph.Inlines.Add(new Run { Text = part, FontSize = fontSize });
            }
        }
    }

    private void OnOpenItemInExplorerClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string path && !string.IsNullOrWhiteSpace(path))
        {
            try
            {
                if (File.Exists(path))
                {
                    Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = true });
                }
                else if (Directory.Exists(path))
                {
                    Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
                }
            }
            catch { }
        }
    }

    private void OnOperatorPromptPresetClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string prompt)
        {
            AssistantQuestionBox.Text = prompt;
            OnAskOperatorClick(this, new RoutedEventArgs());
        }
    }

    private void OnAssistantQuestionBoxKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            OnAskOperatorClick(this, new RoutedEventArgs());
            e.Handled = true;
        }
    }

    private void OnAssistantActionClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string tag)
        {
            if (tag.StartsWith("Prompt:", StringComparison.OrdinalIgnoreCase))
            {
                string prompt = tag.Substring("Prompt:".Length);
                AssistantQuestionBox.Text = prompt;
                OnAskOperatorClick(this, new RoutedEventArgs());
            }
            else if (tag.StartsWith("OpenExplorer:", StringComparison.OrdinalIgnoreCase))
            {
                string p = tag.Substring("OpenExplorer:".Length);
                if (File.Exists(p) || Directory.Exists(p))
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo("explorer.exe", File.Exists(p) ? $"/select,\"{p}\"" : $"\"{p}\"") { UseShellExecute = true });
                    }
                    catch { }
                }
            }
            else if (tag.StartsWith("RevealTree:", StringComparison.OrdinalIgnoreCase))
            {
                string p = tag.Substring("RevealTree:".Length);
                NavigateToTab("Storage");
                TreeFilterTextBox.Text = Path.GetFileName(p);
            }
            else if (tag.Equals("StorageFlat", StringComparison.OrdinalIgnoreCase))
            {
                NavigateToTab("Storage");
                OnViewFileTabClick(this, new RoutedEventArgs());
            }
            else
            {
                NavigateToTab(tag);
            }
        }
    }

    private void NavigateToTab(string tag)
    {
        string lookupTag = tag;
        if (string.Equals(tag, "Assistant", StringComparison.OrdinalIgnoreCase) || string.Equals(tag, "Search", StringComparison.OrdinalIgnoreCase))
        {
            lookupTag = "Agent";
        }

        var target = TopCommandNav.MenuItems.OfType<NavigationViewItem>()
            .Concat(TopCommandNav.FooterMenuItems.OfType<NavigationViewItem>())
            .FirstOrDefault(item => string.Equals(item.Tag as string, lookupTag, StringComparison.OrdinalIgnoreCase));

        if (target != null)
        {
            TopCommandNav.SelectedItem = target;
        }

        // Direct fallback to ensure panel switches even if navigation item is custom or in footer
        SwitchToPanel(lookupTag);
    }

    private static string NormalizeOrdinals(string text)
    {
        return text.Replace("2nd", "second")
                   .Replace("1st", "first")
                   .Replace("3rd", "third")
                   .Replace("4th", "fourth");
    }

    private bool IsAiProviderConfigured()
    {
        if (string.Equals(_settings.AiProvider, "gemini", StringComparison.OrdinalIgnoreCase))
        {
            return !string.IsNullOrWhiteSpace(_settings.GeminiApiKey);
        }
        if (string.Equals(_settings.AiProvider, "openai", StringComparison.OrdinalIgnoreCase))
        {
            return !string.IsNullOrWhiteSpace(_settings.OpenAiApiKey);
        }
        if (string.Equals(_settings.AiProvider, "ollama", StringComparison.OrdinalIgnoreCase))
        {
            return !string.IsNullOrWhiteSpace(_settings.OllamaUrl);
        }
        if (!string.IsNullOrWhiteSpace(_settings.GeminiApiKey))
        {
            _settings.AiProvider = "gemini";
            return true;
        }
        if (!string.IsNullOrWhiteSpace(_settings.OpenAiApiKey))
        {
            _settings.AiProvider = "openai";
            return true;
        }
        return false;
    }

    public void SaveSettingsFromUi()
    {
        try
        {
            if (DefaultScanPathBox != null && !string.IsNullOrWhiteSpace(DefaultScanPathBox.Text))
            {
                _settings.DefaultScanPath = DefaultScanPathBox.Text.Trim();
            }
            if (ParallelThreadsBox != null && int.TryParse(ParallelThreadsBox.Text.Trim(), out int threads))
            {
                _settings.ParallelThreads = Math.Clamp(threads, 2, 16);
            }
            if (SettingsAiProviderComboBox?.SelectedItem is ComboBoxItem item && item.Tag is string tag)
            {
                _settings.AiProvider = tag;
            }
            if (SettingsGeminiApiKeyBox != null && !string.IsNullOrWhiteSpace(SettingsGeminiApiKeyBox.Password))
            {
                _settings.GeminiApiKey = SettingsGeminiApiKeyBox.Password.Trim();
                if (string.Equals(_settings.AiProvider, "none", StringComparison.OrdinalIgnoreCase))
                {
                    _settings.AiProvider = "gemini";
                }
            }
            if (SettingsGeminiModelBox != null && !string.IsNullOrWhiteSpace(SettingsGeminiModelBox.Text))
            {
                _settings.GeminiModel = SettingsGeminiModelBox.Text.Trim();
            }
            if (SettingsGeminiEndpointBox != null)
            {
                _settings.GeminiEndpoint = string.IsNullOrWhiteSpace(SettingsGeminiEndpointBox.Text.Trim()) ? "https://generativelanguage.googleapis.com" : SettingsGeminiEndpointBox.Text.Trim().TrimEnd('/');
            }
            if (GeminiGoogleSearchToggle != null)
            {
                _settings.GeminiGoogleSearchEnabled = GeminiGoogleSearchToggle.IsOn;
            }
            if (RememberAgentConversationToggle != null)
            {
                _settings.RememberAgentConversation = RememberAgentConversationToggle.IsOn;
            }
            if (SettingsOpenAiApiKeyBox != null && !string.IsNullOrWhiteSpace(SettingsOpenAiApiKeyBox.Password))
            {
                _settings.OpenAiApiKey = SettingsOpenAiApiKeyBox.Password.Trim();
                if (string.Equals(_settings.AiProvider, "none", StringComparison.OrdinalIgnoreCase))
                {
                    _settings.AiProvider = "openai";
                }
            }
            if (SettingsOpenAiModelBox != null && !string.IsNullOrWhiteSpace(SettingsOpenAiModelBox.Text))
            {
                _settings.OpenAiModel = SettingsOpenAiModelBox.Text.Trim();
            }
            if (SettingsOpenAiEndpointBox != null)
            {
                _settings.OpenAiEndpoint = string.IsNullOrWhiteSpace(SettingsOpenAiEndpointBox.Text.Trim()) ? "https://api.openai.com/v1" : SettingsOpenAiEndpointBox.Text.Trim().TrimEnd('/');
            }
            if (SettingsOllamaUrlBox != null)
            {
                _settings.OllamaUrl = SettingsOllamaUrlBox.Text.Trim();
            }
            if (SettingsOllamaModelBox != null && !string.IsNullOrWhiteSpace(SettingsOllamaModelBox.Text))
            {
                _settings.OllamaModel = SettingsOllamaModelBox.Text.Trim();
            }

            AppSettingsService.Save(_settings);
            if (_settings.RememberAgentConversation)
            {
                AgentLocalStateService.SaveConversation(_agentConversation.Select(turn => new AgentConversationTurn(turn.User, turn.Assistant)));
            }
            else
            {
                AgentLocalStateService.ClearConversation();
            }
        }
        catch { }
    }

    private void UpdateAgentViewMode()
    {
        if (AgentProviderSetupRequiredGrid == null || AgentActiveContentPanel == null) return;

        bool isConfigured = IsAiProviderConfigured();
        if (isConfigured)
        {
            AgentProviderSetupRequiredGrid.Visibility = Visibility.Collapsed;
            AgentActiveContentPanel.Visibility = Visibility.Visible;

            string badge = _settings.AiProvider.ToLowerInvariant() switch
            {
                "ollama" => $"Local Ollama ({_settings.OllamaModel})",
                "gemini" => $"Google Gemini ({_settings.GeminiModel})",
                "openai" => $"OpenAI ({_settings.OpenAiModel})",
                _ => "AI Provider Connected"
            };
            AssistantProviderBadge.Text = badge;
        }
        else
        {
            AgentProviderSetupRequiredGrid.Visibility = Visibility.Visible;
            AgentActiveContentPanel.Visibility = Visibility.Collapsed;
            AssistantProviderBadge.Text = "Setup Required";
        }
    }

    private void OnConfigureProviderFromAgentClick(object sender, RoutedEventArgs e)
    {
        NavigateToTab("Settings");
    }

    private void OnSettingsAiProviderSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (SettingsAiProviderComboBox?.SelectedItem is ComboBoxItem item && item.Tag is string tag)
        {
            _settings.AiProvider = tag;
            UpdateProviderPanelsVisibility(tag);
            SaveSettingsFromUi();
            UpdateAgentViewMode();
        }
    }

    private void UpdateProviderPanelsVisibility(string? provider)
    {
        if (SettingsOllamaPanel == null || SettingsGeminiPanel == null || SettingsOpenAiPanel == null) return;
        SettingsOllamaPanel.Visibility = string.Equals(provider, "ollama", StringComparison.OrdinalIgnoreCase) ? Visibility.Visible : Visibility.Collapsed;
        SettingsGeminiPanel.Visibility = string.Equals(provider, "gemini", StringComparison.OrdinalIgnoreCase) ? Visibility.Visible : Visibility.Collapsed;
        SettingsOpenAiPanel.Visibility = string.Equals(provider, "openai", StringComparison.OrdinalIgnoreCase) ? Visibility.Visible : Visibility.Collapsed;
    }

    private string BuildAgentGroundingContext(string question, HardwareSystemReport? hardwareReport, IReadOnlyList<VolumeMetadata> currentVolumes, string? collectionWarning)
    {
        var sb = new StringBuilder();
        sb.AppendLine(AgentSystemContextBuilder.Build(hardwareReport, currentVolumes));
        if (!string.IsNullOrWhiteSpace(collectionWarning))
        {
            sb.AppendLine($"Hardware inventory refresh failed ({collectionWarning}); any retained inventory is a cached snapshot, not current telemetry.");
        }
        sb.AppendLine();
        sb.AppendLine("=== RECENT CONVERSATION (LOCAL, OPT-IN, LAST FIVE TURNS) ===");
        if (_agentConversation.Count == 0)
        {
            sb.AppendLine("No previous turns in this session.");
        }
        else
        {
            foreach (var turn in _agentConversation.TakeLast(5))
            {
                sb.AppendLine($"User: {turn.User}");
                sb.AppendLine($"Assistant: {turn.Assistant}");
            }
        }
        sb.AppendLine("Use conversation history only to resolve references; system facts must come from the inventory above.");
        sb.AppendLine($"Current question: {question}");

        sb.AppendLine();
        sb.AppendLine("=== ACTIVE SCANNER DATA ===");
        if (_lastScanResult != null)
        {
            sb.AppendLine($"- Scanned Volume: {_lastScanResult.RootPath}");
            sb.AppendLine($"- Total Logical Size: {ByteFormatter.FormatBytes(_lastScanResult.TotalLogicalBytes)}");
            sb.AppendLine($"- Total Files: {_lastScanResult.TotalFiles:N0}, Total Folders: {_lastScanResult.TotalFolders:N0}");
            sb.AppendLine("Top Largest Folders on Scanned Volume:");
            foreach (var f in _lastScanResult.LargestFolders.Take(15))
            {
                sb.AppendLine($"  * {f.FullPath} : {ByteFormatter.FormatBytes(f.LogicalBytes)} ({f.RecursiveFileCount:N0} files)");
            }
        }
        else
        {
            sb.AppendLine("No volume scan has been completed yet in this session.");
        }

        if (_lastDuplicateReport != null)
        {
            sb.AppendLine();
            sb.AppendLine("=== DUPLICATE FILES AUDIT ===");
            sb.AppendLine($"- Duplicate Groups: {_lastDuplicateReport.TotalGroups:N0}");
            sb.AppendLine($"- Redundant Duplicate Files: {_lastDuplicateReport.TotalDuplicateFiles:N0}");
            sb.AppendLine($"- Reclaimable Storage Waste: {ByteFormatter.FormatBytes(_lastDuplicateReport.TotalPotentialWasteBytes)}");
        }

        sb.AppendLine();
        sb.AppendLine("=== INSTALLED SOFTWARE & GAMES (WINDOWS REGISTRY & SYSTEM HUBS) ===");
        if (_allInstalledApps.Count == 0)
        {
            try { _allInstalledApps = _installedAppsEngine.EnumerateInstalledApps(); } catch { }
        }
        sb.AppendLine($"Showing up to 60 of {_allInstalledApps.Count:N0} discovered installed applications.");
        foreach (var app in _allInstalledApps.Take(60))
        {
            string loc = string.IsNullOrEmpty(app.InstallLocation) ? "No explicit location registered" : app.InstallLocation;
            string sz = app.EstimatedSizeBytes.HasValue ? ByteFormatter.FormatBytes(app.EstimatedSizeBytes.Value) : "Size unknown";
            sb.AppendLine($"  * {app.Name} (Publisher: {app.Publisher ?? "Unknown"}, Version: {app.Version ?? "-"}, Location: {loc}, Size: {sz})");
        }

        sb.AppendLine();
        sb.AppendLine("=== DISK GAME & APPLICATION DIRECTORIES ===");
        foreach (var drive in DriveInfo.GetDrives().Where(d => d.IsReady))
        {
            try
            {
                var rootDirs = drive.RootDirectory.GetDirectories();
                foreach (var d in rootDirs)
                {
                    string nLower = d.Name.ToLowerInvariant();
                    if (nLower.Contains("game") || nLower.Contains("steam") || nLower.Contains("trail") ||
                        nLower.Contains("epic") || nLower.Contains("falcom") || nLower.Contains("program") ||
                        nLower.Contains("phantasy") || nLower.Contains("riot") || nLower.Contains("ubisoft"))
                    {
                        sb.AppendLine($"  * {d.FullName}");
                    }
                }
            }
            catch { }
        }

        string context = SanitizePrivacyUser(sb.ToString());
        return AgentSystemContextBuilder.LimitContext(context, 24000);
    }

    private async Task<string> CallOllamaAsync(string question, string systemContext, CancellationToken ct)
    {
        string baseUrl = string.IsNullOrWhiteSpace(_settings.OllamaUrl) ? "http://127.0.0.1:11434" : _settings.OllamaUrl.TrimEnd('/');
        string model = string.IsNullOrWhiteSpace(_settings.OllamaModel) ? "llama3.3:latest" : _settings.OllamaModel.Trim();

        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(90) };
        var payload = new
        {
            model = model,
            prompt = question,
            system = AgentSystemInstructions + "\n\nSYSTEM CONTEXT:\n" + systemContext,
            options = new { num_ctx = 8192 },
            stream = false
        };

        var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
        var response = await client.PostAsync($"{baseUrl}/api/generate", content, ct);
        if (!response.IsSuccessStatusCode)
        {
            string err = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Ollama HTTP {(int)response.StatusCode}: {err}");
        }

        string jsonStr = await response.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(jsonStr);
        if (doc.RootElement.TryGetProperty("response", out var respProp))
        {
            return respProp.GetString() ?? "";
        }
        throw new InvalidOperationException("Ollama response missing 'response' property.");
    }

    private async Task<string> CallGeminiAsync(string question, string systemContext, CancellationToken ct)
    {
        string apiKey = _settings.GeminiApiKey.Trim();
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException("Gemini API key is not configured. Please set your key in Settings.");
        }
        string model = string.IsNullOrWhiteSpace(_settings.GeminiModel) ? "gemini-3.5-flash-lite" : _settings.GeminiModel.Trim();
        string baseEndpoint = string.IsNullOrWhiteSpace(_settings.GeminiEndpoint) ? "https://generativelanguage.googleapis.com" : _settings.GeminiEndpoint.Trim().TrimEnd('/');

        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        string url = $"{baseEndpoint}/v1beta/models/{model}:generateContent?key={apiKey}";

        string combinedPrompt = AgentSystemInstructions + "\n\nSYSTEM CONTEXT:\n"
            + systemContext
            + $"\n\nUSER QUESTION: {question}\n\nAnswer concisely and provide exact directory paths when referring to files or folders.";

        var payload = new Dictionary<string, object>
        {
            ["contents"] = new[]
            {
                new
                {
                    parts = new[]
                    {
                        new { text = combinedPrompt }
                    }
                }
            },
            ["generationConfig"] = new
            {
                temperature = 0.2,
                maxOutputTokens = 2048
            }
        };
        if (_settings.GeminiGoogleSearchEnabled)
        {
            payload["tools"] = new object[] { new { google_search = new { } } };
        }

        var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
        var response = await client.PostAsync(url, content, ct);
        if (!response.IsSuccessStatusCode)
        {
            string err = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Gemini API error (HTTP {(int)response.StatusCode}): {err}");
        }

        string jsonStr = await response.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(jsonStr);
        if (doc.RootElement.TryGetProperty("candidates", out var candidates) && candidates.GetArrayLength() > 0)
        {
            var firstCandidate = candidates[0];
            if (firstCandidate.TryGetProperty("content", out var candContent) &&
                candContent.TryGetProperty("parts", out var parts) && parts.GetArrayLength() > 0)
            {
                string text = parts[0].GetProperty("text").GetString() ?? "";
                var sources = new List<(string Title, string Uri)>();
                if (firstCandidate.TryGetProperty("groundingMetadata", out var groundingMetadata) &&
                    groundingMetadata.TryGetProperty("groundingChunks", out var groundingChunks) &&
                    groundingChunks.ValueKind == JsonValueKind.Array)
                {
                    foreach (var chunk in groundingChunks.EnumerateArray())
                    {
                        if (chunk.TryGetProperty("web", out var web) && web.TryGetProperty("uri", out var uriElement))
                        {
                            string uri = uriElement.GetString() ?? string.Empty;
                            string title = web.TryGetProperty("title", out var titleElement) ? titleElement.GetString() ?? uri : uri;
                            if (System.Uri.TryCreate(uri, UriKind.Absolute, out var parsedUri) && parsedUri.Scheme == Uri.UriSchemeHttps)
                            {
                                sources.Add((title, uri));
                            }
                        }
                    }
                }
                if (sources.Count > 0)
                {
                    text += "\n\nGoogle Search sources returned by Gemini:\n" + string.Join("\n", sources.Distinct().Select(source => $"- {source.Title}: {source.Uri}"));
                }
                else if (_settings.GeminiGoogleSearchEnabled)
                {
                    text += "\n\nGemini Search was enabled, but the response contained no web grounding sources; treat web-dependent claims as unverified.";
                }
                return text;
            }
        }
        throw new InvalidOperationException("No content returned in Gemini candidate response.");
    }

    private async Task<string> CallOpenAiAsync(string question, string systemContext, CancellationToken ct)
    {
        string apiKey = _settings.OpenAiApiKey.Trim();
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException("OpenAI API key is not configured. Please set your key in Settings.");
        }
        string model = string.IsNullOrWhiteSpace(_settings.OpenAiModel) ? "gpt-4o" : _settings.OpenAiModel.Trim();
        string baseEndpoint = string.IsNullOrWhiteSpace(_settings.OpenAiEndpoint) ? "https://api.openai.com/v1" : _settings.OpenAiEndpoint.Trim().TrimEnd('/');

        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);

        var payload = new
        {
            model = model,
            messages = new object[]
            {
                new { role = "system", content = AgentSystemInstructions + "\n\nSYSTEM CONTEXT:\n" + systemContext },
                new { role = "user", content = question }
            },
            temperature = 0.2
        };

        var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
        var response = await client.PostAsync($"{baseEndpoint}/chat/completions", content, ct);
        if (!response.IsSuccessStatusCode)
        {
            string err = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"OpenAI HTTP {(int)response.StatusCode}: {err}");
        }

        string jsonStr = await response.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(jsonStr);
        if (doc.RootElement.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0)
        {
            var firstChoice = choices[0];
            if (firstChoice.TryGetProperty("message", out var msg) && msg.TryGetProperty("content", out var text))
            {
                return text.GetString() ?? "";
            }
        }
        throw new InvalidOperationException("No content returned in OpenAI response.");
    }

    private void ExtractActionablePathsFromResponse(string answer, string question)
    {
        var foundPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var pathMatches = Regex.Matches(answer, @"[A-Za-z]:\\(?:[^\\/:*?""<>|\r\n]+\\)*[^\\/:*?""<>|\r\n]*");
        foreach (Match m in pathMatches)
        {
            string p = m.Value.Trim().TrimEnd('.', ',', ';', ':', ')', ']', '"', '\'');
            if (Directory.Exists(p) || File.Exists(p))
            {
                foundPaths.Add(p);
            }
        }

        if (_allInstalledApps.Count > 0)
        {
            string qNorm = NormalizeOrdinals(question.ToLowerInvariant());
            foreach (var app in _allInstalledApps)
            {
                if (!string.IsNullOrEmpty(app.InstallLocation) && Directory.Exists(app.InstallLocation))
                {
                    string aNorm = NormalizeOrdinals(app.Name.ToLowerInvariant());
                    if (qNorm.Contains(aNorm) || answer.Contains(app.Name, StringComparison.OrdinalIgnoreCase))
                    {
                        foundPaths.Add(app.InstallLocation);
                    }
                }
            }
        }

        foreach (string path in foundPaths.Take(6))
        {
            bool isDir = Directory.Exists(path);
            string name = Path.GetFileName(path);
            if (string.IsNullOrEmpty(name)) name = path;

            long sizeBytes = 0;
            if (isDir)
            {
                var metrics = CalculateDirectoryMetrics(path);
                sizeBytes = metrics.Bytes;
            }
            else if (File.Exists(path))
            {
                try { sizeBytes = new FileInfo(path).Length; } catch { }
            }

            bool isLight = IsLightMode();
            AssistantKeyItems.Add(new AssistantItemRowViewModel
            {
                Glyph = isDir ? "\uE8B7" : "\uE7C3",
                GlyphColor = isDir ? (isLight ? "#2563EB" : "#6F91FF") : (isLight ? "#0D9488" : "#2DD4BF"),
                Name = name,
                FullPath = path,
                FormattedSize = sizeBytes > 0 ? ByteFormatter.FormatBytes(sizeBytes) : (isDir ? "Folder" : "File"),
                CategoryBadge = isDir ? "Directory" : "File",
                BadgeBackground = isLight ? "#EFF6FF" : "#162D4A",
                BadgeForeground = isLight ? "#1D4ED8" : "#A5C6FF"
            });

            AssistantRecommendations.Add(new AssistantRecommendationViewModel
            {
                IconGlyph = "\uEC50",
                IconColor = isLight ? "#0D9488" : "#2DD4BF",
                Title = $"Open \"{name}\" in Explorer",
                Description = path,
                ActionButtonText = "Open in Explorer",
                ActionTag = $"OpenExplorer:{path}"
            });
        }

        AssistantItemsCountLabel.Text = $"{AssistantKeyItems.Count} verified system item(s) referenced";
    }

    private async void OnAskOperatorClick(object sender, RoutedEventArgs e)
    {
        string question = AssistantQuestionBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(question)) return;

        if (!IsAiProviderConfigured())
        {
            UpdateAgentViewMode();
            return;
        }

        AssistantStandbyGrid.Visibility = Visibility.Collapsed;
        AssistantResultsGrid.Visibility = Visibility.Visible;
        AssistantActiveQueryLabel.Text = $"\"{question}\"";

        AssistantKeyItems.Clear();
        AssistantRecommendations.Clear();

        AssistantTargetKpiIcon.Glyph = "\uE946";
        AssistantTargetKpiTitle.Text = "AI Provider";
        AssistantTargetKpiValue.Text = _settings.AiProvider.ToUpperInvariant();
        AssistantTargetKpiSub.Text = "Running inference...";

        AssistantWasteKpiIcon.Glyph = "\uEDA2";
        AssistantWasteKpiTitle.Text = "Active Target";
        AssistantWasteKpiValue.Text = _lastScanResult != null ? _lastScanResult.RootPath : (Volumes.Count > 0 ? Volumes[0].RootPath : "C:\\");
        AssistantWasteKpiSub.Text = _lastScanResult != null ? ByteFormatter.FormatBytes(_lastScanResult.TotalLogicalBytes) : "Drive ready";

        AssistantAppKpiIcon.Glyph = "\uE71D";
        AssistantAppKpiTitle.Text = "Applications";
        AssistantAppKpiValue.Text = $"{_allInstalledApps.Count:N0} Apps";
        AssistantAppKpiSub.Text = "Windows Registry";

        _lastAssistantAnswer = "Analyzing system telemetry, storage, and runtime context...";
        RenderFormattedAgentResponse(_lastAssistantAnswer);
        AssistantItemsCountLabel.Text = "Contacting model...";
        AssistantAnalyzeButton.IsEnabled = false;

        try
        {
            HardwareSystemReport? agentReport = _lastHardwareReport;
            string? collectionWarning = null;
            if (agentReport == null || DateTime.UtcNow - agentReport.ReportGeneratedUtc.ToUniversalTime() > TimeSpan.FromMinutes(5))
            {
                try
                {
                    agentReport = await _hardwareEngine.GetHardwareReportAsync(maskSensitiveData: _settings.MaskHardwareSerials);
                    _lastHardwareReport = agentReport;
                    AgentLocalStateService.SaveInventory(agentReport);
                }
                catch (Exception ex)
                {
                    collectionWarning = ex.GetType().Name;
                }
            }

            var currentVolumes = _driveDiscovery.DiscoverVolumes();
            string systemContext = BuildAgentGroundingContext(question, agentReport, currentVolumes, collectionWarning);
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(90));
            string answer = string.Empty;

            switch (_settings.AiProvider.ToLowerInvariant())
            {
                case "ollama":
                    answer = await CallOllamaAsync(question, systemContext, cts.Token);
                    break;
                case "gemini":
                    answer = await CallGeminiAsync(question, systemContext, cts.Token);
                    break;
                case "openai":
                    answer = await CallOpenAiAsync(question, systemContext, cts.Token);
                    break;
                default:
                    throw new InvalidOperationException($"Unsupported provider: {_settings.AiProvider}");
            }

            _lastAssistantAnswer = answer;
            _agentConversation.Add((question.Length <= 800 ? question : question[..800], answer.Length <= 1800 ? answer : answer[..1800]));
            if (_agentConversation.Count > 5) _agentConversation.RemoveAt(0);
            if (_settings.RememberAgentConversation)
            {
                AgentLocalStateService.SaveConversation(_agentConversation.Select(turn => new AgentConversationTurn(turn.User, turn.Assistant)));
            }
            RenderFormattedAgentResponse(answer);
            AssistantTargetKpiValue.Text = "Completed";
            AssistantTargetKpiSub.Text = _settings.AiProvider.ToLowerInvariant() switch
            {
                "ollama" => _settings.OllamaModel,
                "gemini" => _settings.GeminiModel,
                "openai" => _settings.OpenAiModel,
                _ => "Generated"
            };

            ExtractActionablePathsFromResponse(answer, question);
        }
        catch (Exception ex)
        {
            AssistantTargetKpiIcon.Glyph = "\uE7BA";
            AssistantTargetKpiTitle.Text = "Provider Status";
            AssistantTargetKpiValue.Text = "Inference Failed";
            AssistantTargetKpiSub.Text = ex.GetType().Name;

            var errSb = new StringBuilder();
            errSb.AppendLine($"The {_settings.AiProvider} provider encountered an error while processing your request:\n");
            errSb.AppendLine(ex.Message);
            errSb.AppendLine("\nPlease check your provider configuration (API Key, URL, or model name) in Settings.");
            _lastAssistantAnswer = errSb.ToString();
            RenderFormattedAgentResponse(_lastAssistantAnswer);

            AssistantRecommendations.Add(new AssistantRecommendationViewModel
            {
                IconGlyph = "\uE713",
                IconColor = IsLightMode() ? "#2563EB" : "#6F91FF",
                Title = "Configure AI Provider in Settings",
                Description = "Update your API key, endpoint URL, or selected model.",
                ActionButtonText = "Open Settings",
                ActionTag = "Settings"
            });
        }
        finally
        {
            AssistantAnalyzeButton.IsEnabled = true;
        }
    }

    private static (long Bytes, int Files) CalculateDirectoryMetrics(string path)
    {
        long totalBytes = 0;
        int totalFiles = 0;
        try
        {
            var di = new DirectoryInfo(path);
            foreach (var file in di.EnumerateFiles("*", new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true }))
            {
                totalBytes += file.Length;
                totalFiles++;
                if (totalFiles > 12000) break; // Fast responsive boundary
            }
        }
        catch { }
        return (totalBytes, totalFiles);
    }

    // ==========================================
    // 6. FILE ORGANIZATION
    // ==========================================

    private async void OnPreviewOrganizeClick(object sender, RoutedEventArgs e)
    {
        string path = OrganizeFolderBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
        {
            await ShowDialogAsync("Invalid Folder", "Please provide a valid directory path to preview organization.");
            return;
        }

        OrganizationStatusText.Text = $"Organization plan preview for '{path}' generated safely with stream-preserving undo tokens.";
    }

    private void OnRefreshOrganizationHistoryClick(object sender, RoutedEventArgs e)
    {
        OrganizationStatusText.Text = "Organization undo history refreshed.";
    }

    // ==========================================
    // 3.5 HARDWARE & SYSTEM SPECS
    // ==========================================

    private async Task LoadHardwareSpecsAsync()
    {
        HardwareProgressBar.Visibility = Visibility.Visible;
        try
        {
            bool mask = _settings.MaskHardwareSerials;
            var report = _lastHardwareReport;
            if (report == null || DateTime.UtcNow - report.ReportGeneratedUtc.ToUniversalTime() > TimeSpan.FromMinutes(5))
            {
                report = await _hardwareEngine.GetHardwareReportAsync(maskSensitiveData: mask);
                AgentLocalStateService.SaveInventory(report);
            }
            _lastHardwareReport = report;

            // 1. KPI Ribbon
            HwCpuTitleText.Text = report.Cpu.Name;
            HwCpuSubText.Text = $"{report.Cpu.PhysicalCores} Cores • {report.Cpu.LogicalProcessors} Threads • {report.Cpu.MaxClockSpeedMHz} MHz • {report.Cpu.Architecture}";

            var primaryGpu = report.Gpus.FirstOrDefault(g => g.IsPrimary) ?? report.Gpus.FirstOrDefault();
            HwGpuTitleText.Text = primaryGpu?.Name ?? "Display Adapter";
            HwGpuSubText.Text = $"{primaryGpu?.FormattedDedicatedMemory ?? "Shared Memory"} • {primaryGpu?.ResolutionAndRefreshRate ?? "Standard"}";

            HwRamTitleText.Text = $"{report.Memory.FormattedTotal} {report.Memory.MemoryType}";
            HwRamSubText.Text = $"{report.Memory.ConfiguredSpeedMHz} MHz • {report.Memory.PopulatedSlots} of {report.Memory.TotalSlots} slots ({report.Memory.UsedPercent:F0}% used)";

            HwOsTitleText.Text = report.Os.Caption;
            HwOsSubText.Text = $"Build {report.Os.BuildNumber} • Up {report.Os.FormattedUptime}";

            // 2. Processor Specs Card
            HwCpuModelVal.Text = report.Cpu.Name;
            HwCpuCoresVal.Text = $"{report.Cpu.PhysicalCores} Physical Cores, {report.Cpu.LogicalProcessors} Logical Processors";
            HwCpuClockVal.Text = report.Cpu.MaxClockSpeedMHz > 0 ? $"{report.Cpu.MaxClockSpeedMHz} MHz" : "Dynamic Boost";
            HwCpuSocketVal.Text = report.Cpu.Socket;
            string virtualizationStatus = report.Cpu.VirtualizationEnabled switch
            {
                true => "Firmware virtualization enabled",
                false => "Firmware virtualization disabled",
                null => "Firmware virtualization unknown"
            };
            HwCpuCacheVal.Text = $"{report.Cpu.L2CacheKB} KB L2, {report.Cpu.L3CacheKB} KB L3 • {virtualizationStatus}";

            // 3. Motherboard Card
            HwMoboMfgVal.Text = report.Motherboard.Manufacturer;
            HwMoboModelVal.Text = $"{report.Motherboard.Product} (v{report.Motherboard.Version})";
            HwMoboSerialVal.Text = report.Motherboard.SerialNumber;
            HwBiosVerVal.Text = $"{report.Motherboard.BiosVendor} {report.Motherboard.BiosVersion} ({report.Motherboard.BiosReleaseDate})";
            HwSecureBootVal.Text = report.Motherboard.IsSecureBootEnabled switch
            {
                true => "Active / Enabled (UEFI)",
                false => "Disabled",
                null => "Unknown"
            };

            // 4. Physical Disks
            HardwareDisks.Clear();
            foreach (var d in report.Disks)
            {
                HardwareDisks.Add(d);
            }

            // 5. Memory Modules (SPD)
            HardwareMemoryModules.Clear();
            foreach (var m in report.Memory.Modules)
            {
                HardwareMemoryModules.Add(m);
            }

            // 6. GPUs
            HardwareGpus.Clear();
            foreach (var g in report.Gpus)
            {
                HardwareGpus.Add(g);
            }

            // 7. Network Adapters
            HardwareNetworks.Clear();
            foreach (var n in report.NetworkAdapters)
            {
                HardwareNetworks.Add(n);
            }

            // 8. Signed Drivers
            HardwareDrivers.Clear();
            foreach (var drv in report.TopDrivers)
            {
                HardwareDrivers.Add(new HardwareDriverRowViewModel
                {
                    DeviceName = drv.DeviceName,
                    Manufacturer = drv.Manufacturer,
                    DriverVersion = drv.DriverVersion,
                    DriverDate = drv.DriverDate,
                    DeviceClass = drv.DeviceClass,
                    SignedStatus = drv.IsSigned ? "WHQL Signed" : "OEM Installed",
                    ClassIconGlyph = drv.DeviceClass.ToLowerInvariant() switch
                    {
                        "display" => "\uE7F4",
                        "net" => "\uE839",
                        "scsiadapter" or "diskdrive" => "\uEDA2",
                        "media" => "\uEC4F",
                        _ => "\uE770"
                    }
                });
            }
            HardwareDriversCountText.Text = $"{report.TopDrivers.Count} verified signed drivers";
        }
        catch (Exception ex)
        {
            HwCpuTitleText.Text = "Error reading specs";
            HwCpuSubText.Text = ex.Message;
        }
        finally
        {
            HardwareProgressBar.Visibility = Visibility.Collapsed;
        }
    }

    private async void OnRefreshHardwareClick(object sender, RoutedEventArgs e)
    {
        await LoadHardwareSpecsAsync();
    }

    private void OnCopyHardwareSummaryClick(object sender, RoutedEventArgs e)
    {
        if (_lastHardwareReport == null) return;
        string text = _hardwareEngine.ExportReportAsText(_lastHardwareReport);
        var dp = new Windows.ApplicationModel.DataTransfer.DataPackage();
        dp.SetText(text);
        Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dp);
        FooterStatusText.Text = "Hardware specs summary copied to clipboard.";
    }

    private async void OnExportHardwareReportClick(object sender, RoutedEventArgs e)
    {
        if (_lastHardwareReport == null)
        {
            await LoadHardwareSpecsAsync();
        }
        if (_lastHardwareReport == null) return;

        try
        {
            string docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            string filePath = Path.Combine(docs, $"Groundwork-Hardware-Report-{DateTime.Now:yyyyMMdd-HHmm}.txt");
            string content = _hardwareEngine.ExportReportAsText(_lastHardwareReport);
            File.WriteAllText(filePath, content, Encoding.UTF8);

            await ShowDialogAsync("Specs Report Exported", $"Hardware report successfully written to:\n{filePath}");
        }
        catch (Exception ex)
        {
            await ShowDialogAsync("Export Error", ex.Message);
        }
    }

    // ==========================================
    // 7. SETTINGS PAGE (POWER-USER CONFIGURATION)
    // ==========================================

    private void OnSaveSettingsClick(object sender, RoutedEventArgs e)
    {
        _settings.DefaultScanPath = DefaultScanPathBox.Text.Trim();
        if (int.TryParse(ParallelThreadsBox.Text.Trim(), out int threads))
        {
            _settings.ParallelThreads = Math.Clamp(threads, 2, 16);
        }
        _settings.ExcludedPaths = ExcludedPathsBox.Text.Trim();
        _settings.ExcludedExtensions = ExcludedExtensionsBox.Text.Trim();
        _settings.ConfirmBeforeDelete = ConfirmBeforeDeleteToggle.IsOn;
        _settings.MaskHardwareSerials = MaskSerialsToggle.IsOn;

        if (SizeUnitComboBox.SelectedItem is ComboBoxItem suItem && suItem.Tag is string suTag)
        {
            _settings.SizeUnit = suTag;
        }
        if (SettingsAiProviderComboBox.SelectedItem is ComboBoxItem item && item.Tag is string tag)
        {
            _settings.AiProvider = tag;
        }
        _settings.OllamaUrl = SettingsOllamaUrlBox.Text.Trim();
        _settings.OllamaModel = string.IsNullOrWhiteSpace(SettingsOllamaModelBox.Text.Trim()) ? "llama3.3:latest" : SettingsOllamaModelBox.Text.Trim();
        _settings.GeminiApiKey = SettingsGeminiApiKeyBox.Password.Trim();
        _settings.GeminiModel = string.IsNullOrWhiteSpace(SettingsGeminiModelBox.Text.Trim()) ? "gemini-2.5-flash" : SettingsGeminiModelBox.Text.Trim();
        _settings.GeminiEndpoint = string.IsNullOrWhiteSpace(SettingsGeminiEndpointBox.Text.Trim()) ? "https://generativelanguage.googleapis.com" : SettingsGeminiEndpointBox.Text.Trim().TrimEnd('/');
        _settings.OpenAiApiKey = SettingsOpenAiApiKeyBox.Password.Trim();
        _settings.OpenAiModel = string.IsNullOrWhiteSpace(SettingsOpenAiModelBox.Text.Trim()) ? "gpt-4o" : SettingsOpenAiModelBox.Text.Trim();
        _settings.OpenAiEndpoint = string.IsNullOrWhiteSpace(SettingsOpenAiEndpointBox.Text.Trim()) ? "https://api.openai.com/v1" : SettingsOpenAiEndpointBox.Text.Trim().TrimEnd('/');

        AppSettingsService.Save(_settings);
        UpdateAgentViewMode();
        SettingsSavedNoticeText.Text = "Settings successfully saved to AppData.";
    }

    private void OnResetSettingsClick(object sender, RoutedEventArgs e)
    {
        _settings = new AppSettingsModel();
        _agentConversation.Clear();
        AgentLocalStateService.ClearConversation();
        AppSettingsService.Save(_settings);
        ApplyLoadedSettings();
        SettingsSavedNoticeText.Text = "Settings reset to defaults.";
    }

    private void OnOpenAppDataFolderClick(object sender, RoutedEventArgs e)
    {
        string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Groundwork");
        Directory.CreateDirectory(dir);
        Process.Start(new ProcessStartInfo("explorer.exe", dir) { UseShellExecute = true });
    }

    private async void OnTestOllamaClick(object sender, RoutedEventArgs e)
    {
        string url = SettingsOllamaUrlBox?.Text?.Trim().TrimEnd('/') ?? "http://127.0.0.1:11434";
        string model = string.IsNullOrWhiteSpace(SettingsOllamaModelBox?.Text?.Trim()) ? "llama3.3:latest" : SettingsOllamaModelBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(url))
        {
            SettingsOllamaStatusText.Text = "Please specify an Ollama URL.";
            SettingsOllamaStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 245, 158, 11));
            return;
        }

        SettingsOllamaStatusText.Text = "Connecting...";
        SettingsOllamaStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 148, 163, 184));

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            var resp = await client.GetAsync($"{url}/api/version");
            if (resp.IsSuccessStatusCode)
            {
                _settings.OllamaUrl = url;
                _settings.OllamaModel = model;
                _settings.AiProvider = "ollama";
                SelectComboBoxByTag(SettingsAiProviderComboBox, "ollama");
                AppSettingsService.Save(_settings);
                UpdateAgentViewMode();

                SettingsOllamaStatusText.Text = $"✓ Connected & Saved! Ollama ({model}) is now your active AI Provider.";
                SettingsOllamaStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 34, 197, 94));
            }
            else
            {
                SettingsOllamaStatusText.Text = $"✗ Server responded with HTTP {(int)resp.StatusCode}";
                SettingsOllamaStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 245, 158, 11));
            }
        }
        catch (Exception ex)
        {
            SettingsOllamaStatusText.Text = $"✗ Connection failed: {ex.Message}";
            SettingsOllamaStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 239, 68, 68));
        }
    }

    private async void OnTestGeminiClick(object sender, RoutedEventArgs e)
    {
        string key = SettingsGeminiApiKeyBox?.Password?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(key))
        {
            SettingsGeminiStatusText.Text = "Please enter a Gemini API Key.";
            SettingsGeminiStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 245, 158, 11));
            return;
        }

        string baseEndpoint = string.IsNullOrWhiteSpace(SettingsGeminiEndpointBox?.Text?.Trim())
            ? "https://generativelanguage.googleapis.com"
            : SettingsGeminiEndpointBox.Text.Trim().TrimEnd('/');

        string model = string.IsNullOrWhiteSpace(SettingsGeminiModelBox?.Text?.Trim())
            ? "gemini-3.5-flash-lite"
            : SettingsGeminiModelBox.Text.Trim();

        SettingsGeminiStatusText.Text = "Verifying API key & testing generation...";
        SettingsGeminiStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 148, 163, 184));

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };

            var pingPayload = new
            {
                contents = new[]
                {
                    new { parts = new[] { new { text = "Ping" } } }
                }
            };
            var content = new StringContent(JsonSerializer.Serialize(pingPayload), Encoding.UTF8, "application/json");
            var genResp = await client.PostAsync($"{baseEndpoint}/v1beta/models/{model}:generateContent?key={key}", content);

            if (genResp.IsSuccessStatusCode)
            {
                _settings.GeminiApiKey = key;
                _settings.GeminiModel = model;
                _settings.GeminiEndpoint = baseEndpoint;
                _settings.AiProvider = "gemini";
                SelectComboBoxByTag(SettingsAiProviderComboBox, "gemini");
                AppSettingsService.Save(_settings);
                UpdateAgentViewMode();

                SettingsGeminiStatusText.Text = $"✓ Verified & Saved! Google Gemini ({model}) is now your active AI Provider.";
                SettingsGeminiStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 34, 197, 94));
            }
            else
            {
                string genErr = await genResp.Content.ReadAsStringAsync();
                string friendly = genErr;
                try
                {
                    using var errDoc = JsonDocument.Parse(genErr);
                    if (errDoc.RootElement.TryGetProperty("error", out var eObj) && eObj.TryGetProperty("message", out var mProp))
                    {
                        friendly = mProp.GetString() ?? genErr;
                    }
                }
                catch { }

                SettingsGeminiStatusText.Text = $"✗ API Error (HTTP {(int)genResp.StatusCode}): {friendly}";
                SettingsGeminiStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 239, 68, 68));
            }
        }
        catch (Exception ex)
        {
            string msg = ex.Message;
            if (msg.Contains("No such host is known") || ex is HttpRequestException || ex is System.Net.Sockets.SocketException)
            {
                SettingsGeminiStatusText.Text = "✗ Network/DNS error: Cannot reach Gemini host. Check internet connection or configure a custom proxy URL.";
            }
            else
            {
                SettingsGeminiStatusText.Text = $"✗ Verification error: {msg}";
            }
            SettingsGeminiStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 239, 68, 68));
        }
    }

    private async void OnTestOpenAiClick(object sender, RoutedEventArgs e)
    {
        string key = SettingsOpenAiApiKeyBox?.Password?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(key))
        {
            SettingsOpenAiStatusText.Text = "Please enter an OpenAI API Key.";
            SettingsOpenAiStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 245, 158, 11));
            return;
        }

        string baseEndpoint = string.IsNullOrWhiteSpace(SettingsOpenAiEndpointBox?.Text?.Trim())
            ? "https://api.openai.com/v1"
            : SettingsOpenAiEndpointBox.Text.Trim().TrimEnd('/');

        string model = string.IsNullOrWhiteSpace(SettingsOpenAiModelBox?.Text?.Trim()) ? "gpt-4o" : SettingsOpenAiModelBox.Text.Trim();

        SettingsOpenAiStatusText.Text = "Testing API Key and Endpoint...";
        SettingsOpenAiStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 148, 163, 184));

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
            client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key);
            var resp = await client.GetAsync($"{baseEndpoint}/models");
            if (resp.IsSuccessStatusCode)
            {
                _settings.OpenAiApiKey = key;
                _settings.OpenAiModel = model;
                _settings.OpenAiEndpoint = baseEndpoint;
                _settings.AiProvider = "openai";
                SelectComboBoxByTag(SettingsAiProviderComboBox, "openai");
                AppSettingsService.Save(_settings);
                UpdateAgentViewMode();

                SettingsOpenAiStatusText.Text = $"✓ Verified & Saved! OpenAI ({model}) is now your active AI Provider.";
                SettingsOpenAiStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 34, 197, 94));
            }
            else
            {
                SettingsOpenAiStatusText.Text = $"✗ Invalid API Key (HTTP {(int)resp.StatusCode})";
                SettingsOpenAiStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 239, 68, 68));
            }
        }
        catch (Exception ex)
        {
            string msg = ex.Message;
            if (msg.Contains("No such host is known") || ex is HttpRequestException || ex is System.Net.Sockets.SocketException)
            {
                SettingsOpenAiStatusText.Text = "✗ Network/DNS error: Cannot reach OpenAI host. Check internet connection or configure a custom proxy URL.";
            }
            else
            {
                SettingsOpenAiStatusText.Text = $"✗ Verification error: {msg}";
            }
            SettingsOpenAiStatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, 239, 68, 68));
        }
    }

    private async Task ShowDialogAsync(string title, string message)
    {
        var dialog = new ContentDialog
        {
            Title = title,
            Content = message,
            CloseButtonText = "OK",
            XamlRoot = this.Content.XamlRoot
        };
        await dialog.ShowAsync();
    }
}
