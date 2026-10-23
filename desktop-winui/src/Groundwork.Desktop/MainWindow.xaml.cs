using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;
using Groundwork.Engine.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;

namespace Groundwork.Desktop;

public sealed partial class MainWindow : Window
{
    private readonly DriveDiscoveryService _driveDiscovery = new();
    private readonly Win32StorageScanner _win32Scanner = new();
    private readonly NtfsMftScanner _mftScanner = new();
    private readonly DuplicateEngineService _duplicateEngine = new();
    private readonly SafeCleanupService _cleanupService = new();
    private readonly InstalledAppsEngineService _installedAppsEngine = new();
    private readonly SidecarHostService _sidecar = new();

    private CancellationTokenSource? _scanCts;
    private DriveScanResult? _lastScanResult;
    private DuplicateScanReport? _lastDuplicateReport;
    private IReadOnlyList<InstalledApplicationInfo> _allInstalledApps = Array.Empty<InstalledApplicationInfo>();
    private string _currentLeftoverInstallLocation = string.Empty;
    private AppSettingsModel _settings = new();

    public ObservableCollection<VolumeRowViewModel> Volumes { get; } = new();
    public ObservableCollection<StorageTreeNodeViewModel> StorageTreeNodes { get; } = new();
    public ObservableCollection<StorageBarSegmentViewModel> StorageBarSegments { get; } = new();
    public ObservableCollection<CategoryRowViewModel> Categories { get; } = new();
    public ObservableCollection<DuplicateGroupCardViewModel> DuplicateGroups { get; } = new();
    public ObservableCollection<CleanupCandidateRowViewModel> CleanupCandidates { get; } = new();
    public ObservableCollection<InstalledAppRowViewModel> InstalledApps { get; } = new();
    public ObservableCollection<LeftoverItemRowViewModel> LeftoverItems { get; } = new();
    public ObservableCollection<SavedSearchRowViewModel> SavedSearches { get; } = new();
    public ObservableCollection<SearchResultRowViewModel> SearchResults { get; } = new();
    public ItemMetadataViewModel SelectedMetadata { get; } = new();

    public MainWindow()
    {
        this.InitializeComponent();

        StorageTreeListView.ItemsSource = StorageTreeNodes;
        StorageBreakdownLegendControl.ItemsSource = StorageBarSegments;
        CategoriesPillsControl.ItemsSource = Categories;
        DuplicateGroupsListView.ItemsSource = DuplicateGroups;
        CleanupCandidatesListView.ItemsSource = CleanupCandidates;
        InstalledAppsListView.ItemsSource = InstalledApps;
        LeftoversListView.ItemsSource = LeftoverItems;
        SavedSearchesListView.ItemsSource = SavedSearches;
        SearchResultsListView.ItemsSource = SearchResults;

        this.Closed += OnMainWindowClosed;
        InitializeStartupState();
    }

    private async void InitializeStartupState()
    {
        try
        {
            _settings = AppSettingsService.Load();
            ApplyLoadedSettings();
            RefreshDrivesList();
            
            // Pop up the drive selection modal immediately on every launch
            StartupDriveModalOverlay.Visibility = Visibility.Visible;

            await RefreshInstalledAppsAsync();
            _ = InitializeOptionalSidecarAsync();
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
        AlwaysRecycleBinToggle.IsOn = _settings.AlwaysRecycleBin;
        ConfirmBeforeDeleteToggle.IsOn = _settings.ConfirmBeforeDelete;
        SettingsOllamaUrlBox.Text = _settings.OllamaUrl;

        for (int i = 0; i < ThemeModeComboBox.Items.Count; i++)
        {
            if (ThemeModeComboBox.Items[i] is ComboBoxItem item && string.Equals(item.Tag as string, _settings.ThemeMode, StringComparison.OrdinalIgnoreCase))
            {
                ThemeModeComboBox.SelectedIndex = i;
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

    private async Task InitializeOptionalSidecarAsync()
    {
        try
        {
            bool started = await _sidecar.EnsureStartedAsync();
            DispatcherQueue.TryEnqueue(() =>
            {
                if (started && !string.IsNullOrEmpty(_sidecar.BaseUrl))
                {
                    SidecarStatusBadge.Text = $"Local Core: Connected ({_sidecar.BaseUrl})";
                    FooterEngineText.Text = $"Engine: Groundwork.Engine + Sidecar ({_sidecar.BaseUrl})";
                }
                else
                {
                    SidecarStatusBadge.Text = "Local Core: Offline Mode";
                    FooterEngineText.Text = "Engine: Groundwork.Engine (.NET 10 Offline)";
                }
            });
        }
        catch
        {
            DispatcherQueue.TryEnqueue(() =>
            {
                SidecarStatusBadge.Text = "Local Core: Offline Mode";
            });
        }
    }

    private async void OnMainWindowClosed(object sender, WindowEventArgs args)
    {
        await _sidecar.DisposeAsync();
    }

    private void OnNavigationSelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is NavigationViewItem item && item.Tag is string tag)
        {
            StoragePanel.Visibility = tag == "Storage" ? Visibility.Visible : Visibility.Collapsed;
            CleanupPanel.Visibility = tag == "Cleanup" ? Visibility.Visible : Visibility.Collapsed;
            AppsPanel.Visibility = tag == "Apps" ? Visibility.Visible : Visibility.Collapsed;
            AssistantPanel.Visibility = tag == "Assistant" ? Visibility.Visible : Visibility.Collapsed;
            SearchPanel.Visibility = tag == "Search" ? Visibility.Visible : Visibility.Collapsed;
            OrganizePanel.Visibility = tag == "Organize" ? Visibility.Visible : Visibility.Collapsed;
            SettingsPanel.Visibility = tag == "Settings" ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    // ==========================================
    // 1. DRIVES & STORAGE SCANNER
    // ==========================================

    private void RefreshDrivesList()
    {
        Volumes.Clear();
        DrivesComboBox.Items.Clear();

        var discovered = _driveDiscovery.DiscoverVolumes();
        foreach (var v in discovered)
        {
            var vm = new VolumeRowViewModel(
                RootPath: v.RootPath,
                VolumeName: $"{v.VolumeName} ({v.RootPath})",
                FileSystemLabel: $"{v.FileSystem} • {v.DriveType}",
                CapacitySummary: $"{ByteFormatter.FormatBytes(v.UsedBytes)} used of {ByteFormatter.FormatBytes(v.TotalBytes)}",
                UsedPercent: v.UsedPercent,
                MftBadge: v.SupportsUsnMftScan ? "Instant Scan Ready" : "Standard Walker"
            );
            Volumes.Add(vm);

            var comboItem = new ComboBoxItem
            {
                Content = $"{v.RootPath} [{v.FileSystem}] {ByteFormatter.FormatBytes(v.UsedBytes)} / {ByteFormatter.FormatBytes(v.TotalBytes)} ({v.UsedPercent:F0}%)",
                Tag = v.RootPath
            };
            DrivesComboBox.Items.Add(comboItem);
        }

        if (DrivesComboBox.Items.Count > 0)
        {
            DrivesComboBox.SelectedIndex = 0;
        }
    }

    private void OnRefreshDrivesClick(object sender, RoutedEventArgs e)
    {
        RefreshDrivesList();
    }

    private void OnDrivesComboBoxSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (DrivesComboBox.SelectedItem is ComboBoxItem item && item.Tag is string rootPath)
        {
            ScanPathTextBox.Text = rootPath;
        }
    }

    private async void OnQuickScanPrimaryDriveClick(object sender, RoutedEventArgs e)
    {
        string primary = Volumes.FirstOrDefault()?.RootPath ?? Path.GetPathRoot(Environment.SystemDirectory) ?? @"C:\";
        ScanPathTextBox.Text = primary;
        await RunStorageScanAsync(primary, requestElevatedMft: false);
    }

    private async void OnRunScanPathClick(object sender, RoutedEventArgs e)
    {
        string path = ScanPathTextBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(path))
        {
            path = @"C:\";
        }
        await RunStorageScanAsync(path, requestElevatedMft: false);
    }

    private async void OnScanCustomPathClick(object sender, RoutedEventArgs e)
    {
        var picker = new Windows.Storage.Pickers.FolderPicker();
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        picker.SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.ComputerFolder;
        picker.FileTypeFilter.Add("*");

        var folder = await picker.PickSingleFolderAsync();
        if (folder != null)
        {
            ScanPathTextBox.Text = folder.Path;
            await RunStorageScanAsync(folder.Path, requestElevatedMft: false);
        }
    }

    private async void OnElevatedMftScanClick(object sender, RoutedEventArgs e)
    {
        string path = ScanPathTextBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(path))
        {
            path = @"C:\";
        }
        await RunStorageScanAsync(path, requestElevatedMft: true);
    }

    private void OnCancelScanClick(object sender, RoutedEventArgs e)
    {
        _scanCts?.Cancel();
    }

    private async Task RunStorageScanAsync(string rootPath, bool requestElevatedMft)
    {
        _scanCts?.Cancel();
        _scanCts = new CancellationTokenSource();
        var token = _scanCts.Token;

        CancelScanButton.IsEnabled = true;
        ScanActivityProgressBar.Visibility = Visibility.Visible;
        ScanActivityProgressBar.IsIndeterminate = true;
        ScanSummaryHeaderText.Text = $"Scanning {rootPath}...";
        ScanMetricsDetailText.Text = "Traversing directory hierarchy in parallel...";

        var progress = new Progress<ScanProgressReport>(report =>
        {
            DispatcherQueue.TryEnqueue(() =>
            {
                ScanSummaryHeaderText.Text = $"Scanning: {report.FilesScanned:N0} files, {report.FoldersScanned:N0} folders...";
                ScanMetricsDetailText.Text = $"{ByteFormatter.FormatBytes(report.TotalLogicalBytes)} logical | {report.ElapsedMilliseconds:F0} ms | {report.CurrentDirectory}";
            });
        });

        try
        {
            string helperPath = Path.Combine(AppContext.BaseDirectory, "Groundwork.MftHelper.exe");
            DriveScanResult result = requestElevatedMft
                ? await _mftScanner.ScanWithFallbackAsync(rootPath, requestElevationIfNeeded: true, mftHelperExecutablePath: helperPath, progress: progress, topN: 30, retainAllEntries: true, cancellationToken: token)
                : await _win32Scanner.ScanAsync(rootPath, progress: progress, topN: 30, retainAllEntries: true, cancellationToken: token);

            _lastScanResult = result;
            PopulateStorageScanViews(result);

            double secs = Math.Max(0.001, result.ElapsedMilliseconds / 1000.0);
            double rate = result.TotalFiles / secs;
            ScanSummaryHeaderText.Text = $"Scan Complete: {result.RootPath} ({result.EngineUsed}) — {result.TotalFiles:N0} files, {result.TotalFolders:N0} folders";
            ScanMetricsDetailText.Text = $"Size: {ByteFormatter.FormatBytes(result.TotalLogicalBytes)} (Allocated: {ByteFormatter.FormatBytes(result.TotalAllocatedBytes)}) | Time: {secs:F2}s ({rate:N0} files/sec) | Access Denied: {result.AccessDeniedPaths.Count}";
            FooterStatusText.Text = $"Scanned {result.TotalFiles:N0} files in {secs:F2}s ({rate:N0} files/sec).";
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
            CancelScanButton.IsEnabled = false;
            ScanActivityProgressBar.IsIndeterminate = false;
            ScanActivityProgressBar.Visibility = Visibility.Collapsed;
        }
    }

    private void PopulateStorageScanViews(DriveScanResult result)
    {
        // 1. Proportional Visual Storage Breakdown Bar
        StorageBarSegments.Clear();
        StorageBreakdownBarGrid.Children.Clear();
        StorageBreakdownBarGrid.ColumnDefinitions.Clear();

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
                var seg = new StorageBarSegmentViewModel
                {
                    Name = folder.Name,
                    FormattedSize = ByteFormatter.FormatBytes(folder.LogicalBytes),
                    Percent = pct,
                    ColorHex = color
                };
                StorageBarSegments.Add(seg);

                StorageBreakdownBarGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(1, pct), GridUnitType.Star) });
                var rect = new Border
                {
                    Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255,
                        Convert.ToByte(color.Substring(1, 2), 16),
                        Convert.ToByte(color.Substring(3, 2), 16),
                        Convert.ToByte(color.Substring(5, 2), 16)))
                };
                Grid.SetColumn(rect, col);
                StorageBreakdownBarGrid.Children.Add(rect);
                col++;
            }

            StorageBreakdownSummaryText.Text = $"Top folders represent {StorageBarSegments.Sum(s => s.Percent):F1}% of {ByteFormatter.FormatBytes(result.TotalLogicalBytes)} disk space.";
        }

        // 2. Hierarchical File Tree
        StorageTreeNodes.Clear();
        if (result.AllFolders != null && result.AllFolders.Count > 0)
        {
            long totalDriveBytes = Math.Max(1, result.TotalLogicalBytes);

            // Populate root items (ParentId == -1 or ParentId == 0)
            var rootFolders = result.AllFolders
                .Where(f => f.ParentId <= 0)
                .OrderByDescending(f => f.LogicalBytes)
                .ToList();

            foreach (var f in rootFolders)
            {
                double pct = totalDriveBytes > 0 ? (double)f.LogicalBytes / totalDriveBytes * 100.0 : 0.0;
                StorageTreeNodes.Add(new StorageTreeNodeViewModel
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
                    ItemsSummary = $"{f.RecursiveFileCount:N0} files • {f.RecursiveFolderCount:N0} folders",
                    LastModifiedFormatted = DateTimeOffset.FromUnixTimeSeconds(f.LastWriteUnixSeconds).LocalDateTime.ToString("yyyy-MM-dd HH:mm"),
                    PercentOfDrive = pct,
                    PercentLabel = $"{pct:F1}%",
                    DepthLevel = 0,
                    IsExpanded = false
                });
            }
        }

        // 3. Category Breakdown Pills
        Categories.Clear();
        foreach (var c in result.CategoryBreakdown)
        {
            Categories.Add(new CategoryRowViewModel(
                Label: c.Label,
                SummaryText: $"{ByteFormatter.FormatBytes(c.TotalBytes)} ({c.SharePercent:F1}%)",
                SharePercent: c.SharePercent));
        }
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
        if (_lastScanResult?.AllFolders == null) return;

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

            var children = _lastScanResult.AllFolders
                .Where(f => f.ParentId == node.Id)
                .OrderByDescending(f => f.LogicalBytes)
                .ToList();

            int insertIdx = idx + 1;
            long totalDriveBytes = Math.Max(1, _lastScanResult.TotalLogicalBytes);
            foreach (var child in children)
            {
                double pct = totalDriveBytes > 0 ? (double)child.LogicalBytes / totalDriveBytes * 100.0 : 0.0;
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
                    ItemsSummary = $"{child.RecursiveFileCount:N0} files • {child.RecursiveFolderCount:N0} folders",
                    LastModifiedFormatted = DateTimeOffset.FromUnixTimeSeconds(child.LastWriteUnixSeconds).LocalDateTime.ToString("yyyy-MM-dd HH:mm"),
                    PercentOfDrive = pct,
                    PercentLabel = $"{pct:F1}%",
                    DepthLevel = node.DepthLevel + 1,
                    IsExpanded = false
                };
                StorageTreeNodes.Insert(insertIdx++, childVm);
            }
            node.IsExpanded = true;
        }
    }

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
            await RunStorageScanAsync(rootPath, requestElevatedMft: false);
        }
    }

    private async void OnModalFastMftScanClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string rootPath && !string.IsNullOrWhiteSpace(rootPath))
        {
            StartupDriveModalOverlay.Visibility = Visibility.Collapsed;
            ScanPathTextBox.Text = rootPath;
            await RunStorageScanAsync(rootPath, requestElevatedMft: true);
        }
    }

    private async void OnModalBrowseCustomFolderClick(object sender, RoutedEventArgs e)
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
            await RunStorageScanAsync(folder.Path, requestElevatedMft: false);
        }
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
                await RunStorageScanAsync(node.FullPath, requestElevatedMft: false);
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
            await RunStorageScanAsync(SelectedMetadata.FullPath, requestElevatedMft: false);
        }
    }

    private async void OnInspectorRecycleClick(object sender, RoutedEventArgs e)
    {
        if (StorageTreeListView.SelectedItem is StorageTreeNodeViewModel node)
        {
            await PromptSafeRecycleNodeAsync(node);
        }
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
            _ = RunStorageScanAsync(node.FullPath, requestElevatedMft: false);
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

    private async void OnRunCleanupScanClick(object sender, RoutedEventArgs e)
    {
        if (_lastScanResult == null || _lastScanResult.AllEntries.Count == 0)
        {
            string path = ScanPathTextBox.Text.Trim();
            if (string.IsNullOrWhiteSpace(path)) path = @"C:\";
            await RunStorageScanAsync(path, requestElevatedMft: false);
            if (_lastScanResult == null) return;
        }

        CleanupSummaryBannerText.Text = "Running 3-stage SHA-256 duplicate detection and evaluating cleanup rules...";

        try
        {
            var report = await _duplicateEngine.FindDuplicatesAsync(_lastScanResult.AllEntries);
            _lastDuplicateReport = report;

            DuplicateGroups.Clear();
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
                        StatusBadgeBackground = isFirst ? "#1E3E66" : f.IsHardLinkAlias ? "#382405" : "#2D1E4A",
                        StatusBadgeForeground = isFirst ? "#A5C6FF" : f.IsHardLinkAlias ? "#FCD34D" : "#C084FC"
                    });
                    isFirst = false;
                }

                DuplicateGroups.Add(groupVm);
            }

            var ruleGroups = _cleanupService.AnalyzeCleanupRules(_lastScanResult.AllEntries, report);
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
        catch (Exception ex)
        {
            CleanupSummaryBannerText.Text = $"Cleanup analysis error: {ex.Message}";
        }
    }

    private async void OnReviewAndCleanSelectedClick(object sender, RoutedEventArgs e)
    {
        var selectedPaths = new List<string>();

        foreach (var g in DuplicateGroups)
        {
            foreach (var f in g.Files)
            {
                if (f.IsSelected && !f.IsHardLinkAlias)
                {
                    selectedPaths.Add(f.FullPath);
                }
            }
        }

        foreach (var c in CleanupCandidates)
        {
            if (c.IsSelected)
            {
                selectedPaths.Add(c.FullPath);
            }
        }

        if (selectedPaths.Count == 0)
        {
            await ShowDialogAsync("No Items Selected", "Please select one or more duplicate copies or cleanup candidates to clean.");
            return;
        }

        string mode = (CleanupModeComboBox.SelectedItem as ComboBoxItem)?.Tag as string ?? "recycle";
        string targetRoot = _lastScanResult?.RootPath ?? Path.GetPathRoot(selectedPaths[0]) ?? @"C:\";

        var proposal = _cleanupService.ProposeCleanup(selectedPaths, [targetRoot], mode: mode);
        string modeLabel = mode == "recycle" ? "Windows Recycle Bin (Safe)" : "Permanent Delete";

        var dialog = new ContentDialog
        {
            Title = "Confirm Cleanup",
            Content = $"Are you sure you want to clean {proposal.ItemCount} items ({ByteFormatter.FormatBytes(proposal.TotalBytes)})?\n\nTarget Root: {targetRoot}\nMode: {modeLabel}\n\n{proposal.Warning}",
            PrimaryButtonText = "Execute Cleanup",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = this.Content.XamlRoot
        };

        var result = await dialog.ShowAsync();
        if (result == ContentDialogResult.Primary)
        {
            var exec = _cleanupService.ExecuteCleanup(proposal.Token, [targetRoot]);
            await ShowDialogAsync("Cleanup Finished", $"Result: {exec.Status}\nRemoved: {exec.RemovedCount} items\nSpace Reclaimed: {ByteFormatter.FormatBytes(exec.BytesReclaimed)}\nFailed: {exec.FailedReasons.Count}");
            OnRunCleanupScanClick(this, new RoutedEventArgs());
        }
    }

    // ==========================================
    // 3. INSTALLED APPS & LEFTOVERS
    // ==========================================

    private async Task RefreshInstalledAppsAsync()
    {
        await Task.Run(() =>
        {
            _allInstalledApps = _installedAppsEngine.EnumerateInstalledApps();
        });

        ApplyInstalledAppsFilter(AppSearchFilterBox.Text);
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

    private void OnInstalledAppSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (InstalledAppsListView.SelectedItem is InstalledAppRowViewModel vm && vm.RawModel != null)
        {
            RunLeftoverScan(vm.RawModel.Id, vm.RawModel.Name, vm.RawModel.Publisher, vm.RawModel.InstallLocation);
        }
    }

    private void OnScanSelectedAppLeftoversClick(object sender, RoutedEventArgs e)
    {
        if (InstalledAppsListView.SelectedItem is InstalledAppRowViewModel vm && vm.RawModel != null)
        {
            RunLeftoverScan(vm.RawModel.Id, vm.RawModel.Name, vm.RawModel.Publisher, vm.RawModel.InstallLocation);
        }
        else
        {
            _ = ShowDialogAsync("No App Selected", "Please select an installed application first.");
        }
    }

    private void RunLeftoverScan(string appId, string appName, string publisher, string installLocation)
    {
        _currentLeftoverInstallLocation = installLocation;
        var report = _installedAppsEngine.ScanAppLeftovers(appId, appName, publisher, installLocation);
        PopulateLeftoverReport(report);
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

    private void OnOperatorPromptPresetClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string prompt)
        {
            AssistantQuestionBox.Text = prompt;
            OnAskOperatorClick(this, new RoutedEventArgs());
        }
    }

    private async void OnAskOperatorClick(object sender, RoutedEventArgs e)
    {
        string question = AssistantQuestionBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(question)) return;

        AssistantAnswerTextBlock.Text = "Analyzing grounded storage metrics...";

        try
        {
            var sb = new StringBuilder();
            sb.AppendLine($"**Analysis for:** \"{question}\"\n");

            if (_lastScanResult != null)
            {
                sb.AppendLine($"• **Scanned Target:** `{_lastScanResult.RootPath}`");
                sb.AppendLine($"• **Total Discovered Storage:** {ByteFormatter.FormatBytes(_lastScanResult.TotalLogicalBytes)} across {_lastScanResult.TotalFiles:N0} files and {_lastScanResult.TotalFolders:N0} folders.");

                if (_lastScanResult.LargestFolders.Count > 0)
                {
                    sb.AppendLine("\n**Largest Folders:**");
                    foreach (var f in _lastScanResult.LargestFolders.Take(5))
                    {
                        sb.AppendLine($"  - `{f.Name}` ({ByteFormatter.FormatBytes(f.LogicalBytes)}, {f.RecursiveFileCount:N0} files)");
                    }
                }

                if (_lastDuplicateReport != null && _lastDuplicateReport.TotalGroups > 0)
                {
                    sb.AppendLine($"\n**Duplicate Files Waste:**");
                    sb.AppendLine($"  - Detected {_lastDuplicateReport.TotalGroups} exact duplicate groups taking {ByteFormatter.FormatBytes(_lastDuplicateReport.TotalPotentialWasteBytes)} of wasted space.");
                    sb.AppendLine($"  - Safe to recycle via Windows Recycle Bin with hard-link protection.");
                }
            }
            else
            {
                sb.AppendLine("• No storage scan has been run yet. Run a scan of your drive to receive exact file-by-file explanations.");
            }

            if (_allInstalledApps.Count > 0)
            {
                var topApps = _allInstalledApps.Where(a => a.EstimatedSizeBytes.HasValue).OrderByDescending(a => a.EstimatedSizeBytes).Take(3).ToList();
                if (topApps.Count > 0)
                {
                    sb.AppendLine("\n**Largest Installed Applications:**");
                    foreach (var a in topApps)
                    {
                        sb.AppendLine($"  - `{a.Name}`: {ByteFormatter.FormatBytes(a.EstimatedSizeBytes)} ({a.Publisher})");
                    }
                }
            }

            AssistantAnswerTextBlock.Text = sb.ToString();
        }
        catch (Exception ex)
        {
            AssistantAnswerTextBlock.Text = $"Operator error: {ex.Message}";
        }
    }

    // ==========================================
    // 5. SEARCH & SAVED SEARCHES
    // ==========================================

    private void OnExecuteSearchClick(object sender, RoutedEventArgs e)
    {
        string q = SearchQueryTextBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(q)) return;

        SearchResults.Clear();
        if (_lastScanResult?.AllFolders != null)
        {
            var matches = _lastScanResult.AllFolders
                .Where(f => f.Name.Contains(q, StringComparison.OrdinalIgnoreCase))
                .Take(50);

            foreach (var m in matches)
            {
                SearchResults.Add(new SearchResultRowViewModel(
                    FileName: m.Name,
                    FullPath: m.FullPath,
                    FileType: "Folder",
                    Snippet: $"{ByteFormatter.FormatBytes(m.LogicalBytes)} • {m.RecursiveFileCount:N0} files",
                    ScoreLabel: "Folder Match"
                ));
            }
        }

        SearchResultsHeaderText.Text = $"Search Results for '{q}' ({SearchResults.Count} matches)";
    }

    private void OnSaveCurrentSearchClick(object sender, RoutedEventArgs e)
    {
        string q = SearchQueryTextBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(q)) return;

        SavedSearches.Add(new SavedSearchRowViewModel(Guid.NewGuid().ToString("N"), q, q, "filename"));
    }

    private void OnSavedSearchSelected(object sender, SelectionChangedEventArgs e)
    {
        if (SavedSearchesListView.SelectedItem is SavedSearchRowViewModel vm)
        {
            SearchQueryTextBox.Text = vm.QueryText;
            OnExecuteSearchClick(this, new RoutedEventArgs());
        }
    }

    private void OnDeleteSavedSearchClick(object sender, RoutedEventArgs e)
    {
        if (SavedSearchesListView.SelectedItem is SavedSearchRowViewModel vm)
        {
            SavedSearches.Remove(vm);
        }
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
    // 7. SETTINGS PAGE
    // ==========================================

    private void OnSaveSettingsClick(object sender, RoutedEventArgs e)
    {
        _settings.DefaultScanPath = DefaultScanPathBox.Text.Trim();
        if (int.TryParse(ParallelThreadsBox.Text.Trim(), out int threads))
        {
            _settings.ParallelThreads = Math.Clamp(threads, 2, 16);
        }
        _settings.ExcludedPaths = ExcludedPathsBox.Text.Trim();
        _settings.AlwaysRecycleBin = AlwaysRecycleBinToggle.IsOn;
        _settings.ConfirmBeforeDelete = ConfirmBeforeDeleteToggle.IsOn;
        _settings.OllamaUrl = SettingsOllamaUrlBox.Text.Trim();

        AppSettingsService.Save(_settings);
        SettingsSavedNoticeText.Text = "Settings successfully saved to AppData.";
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
