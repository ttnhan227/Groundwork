using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Desktop.Services;
using Groundwork.Engine.Models;
using Groundwork.Engine.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using Windows.Storage.Pickers;

namespace Groundwork.Desktop.Views;

public sealed partial class StoragePage : Page
{
    private CancellationTokenSource? _scanCts;
    private CancellationTokenSource? _junkScanCts;
    private FileOrganizePlan? _currentOrganizationPlan;
    private Dictionary<int, List<ScannedEntry>> _childrenByParent = new();
    private DriveScanResult? _lastDriveScanResult;
    private bool _showingLargestFilesMode;

    public ObservableCollection<StorageTreeNodeViewModel> TreeNodes { get; } = new();
    public ObservableCollection<FileRowViewModel> LargestFiles { get; } = new();
    public ObservableCollection<StorageBarSegmentViewModel> BarSegments { get; } = new();
    public ObservableCollection<StorageSenseCategoryCardViewModel> ActiveJunkCategories { get; } = new();
    public ObservableCollection<ManualSpaceHogCardViewModel> ManualSpaceHogs { get; } = new();
    public ObservableCollection<OrganizationPlanItemViewModel> OrganizationPlanItems { get; } = new();
    public ObservableCollection<DuplicateGroupCardViewModel> DuplicateGroups { get; } = new();

    public StoragePage()
    {
        this.InitializeComponent();
        this.NavigationCacheMode = NavigationCacheMode.Required;

        FolderTreeListView.ItemsSource = TreeNodes;
        LargestFilesListView.ItemsSource = LargestFiles;
        BreakdownLegendControl.ItemsSource = BarSegments;
        CleanerActiveCategoriesControl.ItemsSource = ActiveJunkCategories;
        ManualSpaceHogsControl.ItemsSource = ManualSpaceHogs;
        OrganizerPlanListView.ItemsSource = OrganizationPlanItems;
        DuplicatesListView.ItemsSource = DuplicateGroups;

        PopulateDrives();
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        if (e.Parameter is string targetSegment && !string.IsNullOrEmpty(targetSegment))
        {
            ShowSegment(targetSegment);
        }
    }

    public void ShowSegment(string segment)
    {
        SubViewAnalyzer.Visibility = Visibility.Collapsed;
        SubViewCleaner.Visibility = Visibility.Collapsed;
        SubViewOrganizer.Visibility = Visibility.Collapsed;
        SubViewDuplicates.Visibility = Visibility.Collapsed;

        TabCleanerBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabStyle"];
        TabOrganizerBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabStyle"];
        TabDuplicatesBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabStyle"];

        switch (segment.ToLowerInvariant())
        {
            case "cleaner" or "junk" or "cleanup":
                StorageSegmentedBar.Visibility = Visibility.Visible;
                SubViewCleaner.Visibility = Visibility.Visible;
                TabCleanerBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabActiveStyle"];
                _ = ScanJunkAsync();
                break;
            case "organizer" or "organize":
                StorageSegmentedBar.Visibility = Visibility.Visible;
                SubViewOrganizer.Visibility = Visibility.Visible;
                TabOrganizerBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabActiveStyle"];
                if (string.IsNullOrEmpty(OrganizerFolderBox.Text))
                {
                    OrganizerFolderBox.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
                }
                break;
            case "duplicates" or "duplicate":
                StorageSegmentedBar.Visibility = Visibility.Visible;
                SubViewDuplicates.Visibility = Visibility.Visible;
                TabDuplicatesBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabActiveStyle"];
                if (string.IsNullOrEmpty(DuplicatesFolderBox.Text))
                {
                    DuplicatesFolderBox.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
                }
                break;
            default:
                StorageSegmentedBar.Visibility = Visibility.Collapsed;
                SubViewAnalyzer.Visibility = Visibility.Visible;
                break;
        }
    }

    private void PopulateDrives()
    {
        try
        {
            var drives = DriveInfo.GetDrives().Where(d => d.IsReady && d.DriveType == DriveType.Fixed).ToList();
            DrivesSelectorCombo.Items.Clear();
            foreach (var d in drives)
            {
                long free = d.AvailableFreeSpace;
                long total = d.TotalSize;
                string label = $"{d.Name} ({ByteFormatter.FormatBytes(free)} free of {ByteFormatter.FormatBytes(total)})";
                var item = new ComboBoxItem { Content = label, Tag = d.Name };
                DrivesSelectorCombo.Items.Add(item);
            }
            if (DrivesSelectorCombo.Items.Count > 0)
            {
                DrivesSelectorCombo.SelectedIndex = 0;
            }
        }
        catch { }
    }

    private void OnDriveSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        // Selected volume changed
    }

    private async void OnScanCurrentTargetClick(object sender, RoutedEventArgs e)
    {
        string? targetPath = (DrivesSelectorCombo.SelectedItem as ComboBoxItem)?.Tag as string;
        if (string.IsNullOrEmpty(targetPath)) targetPath = @"C:\";
        await RunScanAsync(targetPath);
    }

    public async Task RunScanAsync(string path)
    {
        _scanCts?.Cancel();
        _scanCts = new CancellationTokenSource();

        ScanDriveBtn.IsEnabled = false;
        CancelScanBtn.Visibility = Visibility.Visible;
        StorageSummaryHeader.Text = $"Scanning {path}...";
        AppServices.Instance.NotifyStatus($"Scanning storage volume {path}...");

        try
        {
            var progress = new Progress<ScanProgressReport>(report =>
            {
                StorageScannedCountText.Text = $"{report.FilesScanned:N0} files • {ByteFormatter.FormatBytes(report.TotalLogicalBytes)} discovered";
            });

            var result = await AppServices.Instance.Win32Scanner.ScanAsync(path, progress, cancellationToken: _scanCts.Token);
            AppServices.Instance.LastScanResult = result;

            PopulateScanResults(result);
            AppServices.Instance.NotifyStatus($"Storage scan complete for {path}: {result.TotalFiles:N0} files indexed.");
        }
        catch (OperationCanceledException)
        {
            StorageSummaryHeader.Text = "Scan Cancelled.";
            AppServices.Instance.NotifyStatus("Storage scan cancelled by user.");
        }
        catch (Exception ex)
        {
            StorageSummaryHeader.Text = "Scan Failed.";
            await AppServices.Instance.ShowDialogAsync("Scan Error", ex.Message);
        }
        finally
        {
            ScanDriveBtn.IsEnabled = true;
            CancelScanBtn.Visibility = Visibility.Collapsed;
        }
    }

    private void PopulateScanResults(DriveScanResult result)
    {
        TreeNodes.Clear();
        LargestFiles.Clear();
        BarSegments.Clear();
        _lastDriveScanResult = result;
        _childrenByParent = (result.AllFolders ?? Array.Empty<ScannedEntry>())
            .Where(f => f.ParentId >= 0 && f.LogicalBytes > 0)
            .GroupBy(f => f.ParentId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(e => e.LogicalBytes).ToList());

        AnalyzerEmptyState.Visibility = Visibility.Collapsed;
        ApplyAnalyzerModeVisibility();

        foreach (var lf in result.LargestFiles ?? Array.Empty<ScannedEntry>())
        {
            LargestFiles.Add(new FileRowViewModel(
                lf.Name,
                lf.FullPath,
                lf.Category,
                ByteFormatter.FormatBytes(lf.LogicalBytes),
                ByteFormatter.FormatBytes(lf.AllocatedBytes),
                lf.LogicalBytes));
        }

        string protectedNote = string.Empty;
        try
        {
            var rootPrefix = Path.GetPathRoot(result.RootPath);
            if (!string.IsNullOrEmpty(rootPrefix) &&
                string.Equals(result.RootPath.TrimEnd('\\'), rootPrefix.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            {
                var di = new DriveInfo(rootPrefix);
                if (di.IsReady)
                {
                    long used = Math.Max(0, di.TotalSize - di.AvailableFreeSpace);
                    long delta = used - result.TotalLogicalBytes;
                    if (delta > 2L * 1024 * 1024 * 1024)
                    {
                        protectedNote = $" • +{ByteFormatter.FormatBytes(delta)} protected/system";
                    }
                }
            }
        }
        catch { }

        StorageSummaryHeader.Text = $"{result.RootPath} — {ByteFormatter.FormatBytes(result.TotalLogicalBytes)} Indexed";
        StorageScannedCountText.Text = $"{result.TotalFiles:N0} files • {result.TotalFolders:N0} folders ({result.ElapsedMilliseconds:F0} ms){protectedNote}";

        // Top categories
        long totalBytes = Math.Max(1, result.TotalLogicalBytes);
        foreach (var cat in result.CategoryBreakdown.OrderByDescending(c => c.TotalBytes).Take(5))
        {
            BarSegments.Add(new StorageBarSegmentViewModel
            {
                Name = cat.Label,
                FormattedSize = ByteFormatter.FormatBytes(cat.TotalBytes),
                Percent = cat.SharePercent
            });
        }

        // Top-level directories (expandable down the full scanned hierarchy)
        var topLevelDirs = (result.TopLevelSpaceMap != null && result.TopLevelSpaceMap.Count > 0)
            ? result.TopLevelSpaceMap.Where(d => d.LogicalBytes > 0).OrderByDescending(d => d.LogicalBytes).Take(40)
            : (result.LargestFolders ?? Array.Empty<ScannedEntry>()).Take(30);

        foreach (var dir in topLevelDirs)
        {
            double pctOfDrive = (dir.LogicalBytes / (double)totalBytes) * 100.0;
            TreeNodes.Add(new StorageTreeNodeViewModel
            {
                Id = dir.Id,
                ParentId = dir.ParentId,
                Name = dir.Name,
                FullPath = dir.FullPath,
                IsDirectory = true,
                SizeBytes = dir.LogicalBytes,
                RecursiveFileCount = dir.RecursiveFileCount,
                RecursiveFolderCount = dir.RecursiveFolderCount,
                FormattedSize = ByteFormatter.FormatBytes(dir.LogicalBytes),
                PercentOfParentLabel = $"{pctOfDrive:F1}% of scan",
                DepthLevel = 0,
                Glyph = "\uE8B7"
            });
        }
    }

    private async void OnBrowseCustomFolderClick(object sender, RoutedEventArgs e)
    {
        var picker = new FolderPicker();
        var hwnd = AppServices.Instance.WindowHandle;
        if (hwnd != IntPtr.Zero) WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        picker.SuggestedStartLocation = PickerLocationId.ComputerFolder;
        picker.FileTypeFilter.Add("*");

        var folder = await picker.PickSingleFolderAsync();
        if (folder != null)
        {
            var item = new ComboBoxItem { Content = folder.Path, Tag = folder.Path };
            DrivesSelectorCombo.Items.Insert(0, item);
            DrivesSelectorCombo.SelectedIndex = 0;
            await RunScanAsync(folder.Path);
        }
    }

    private void ApplyAnalyzerModeVisibility()
    {
        bool hasScan = _lastDriveScanResult != null;
        FolderTreeListView.Visibility = hasScan && !_showingLargestFilesMode ? Visibility.Visible : Visibility.Collapsed;
        LargestFilesListView.Visibility = hasScan && _showingLargestFilesMode ? Visibility.Visible : Visibility.Collapsed;
        ModeFoldersBtn.Style = (Style)Application.Current.Resources[_showingLargestFilesMode ? "GwSecondaryButtonStyle" : "GwPrimaryButtonStyle"];
        ModeLargestFilesBtn.Style = (Style)Application.Current.Resources[_showingLargestFilesMode ? "GwPrimaryButtonStyle" : "GwSecondaryButtonStyle"];
    }

    private void OnShowFoldersModeClick(object sender, RoutedEventArgs e)
    {
        _showingLargestFilesMode = false;
        ApplyAnalyzerModeVisibility();
    }

    private void OnShowLargestFilesModeClick(object sender, RoutedEventArgs e)
    {
        _showingLargestFilesMode = true;
        ApplyAnalyzerModeVisibility();
    }

    private async void OnRecycleSingleFileClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string fullPath || string.IsNullOrEmpty(fullPath))
        {
            return;
        }

        try
        {
            var root = _lastDriveScanResult?.RootPath ?? Path.GetPathRoot(fullPath) ?? Path.GetDirectoryName(fullPath) ?? string.Empty;
            var proposal = AppServices.Instance.StorageHotspotService.ProposeRecycleItems([fullPath], [root], "Space Map Large File");
            var record = await AppServices.Instance.ExecuteWithGateAsync(
                this.XamlRoot,
                proposal,
                "Prerequisite Notice",
                "Moving file to Recycle Bin...",
                "Moved to Recycle Bin");
            if (record?.Succeeded == true)
            {
                var item = LargestFiles.FirstOrDefault(f => string.Equals(f.FullPath, fullPath, StringComparison.OrdinalIgnoreCase));
                if (item != null) LargestFiles.Remove(item);
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Cannot Recycle File", ex.Message);
        }
    }

    private void OnCancelScanClick(object sender, RoutedEventArgs e)
    {
        _scanCts?.Cancel();
    }

    private void OnFolderExpanderClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.DataContext is not StorageTreeNodeViewModel node || !node.IsDirectory)
        {
            return;
        }

        int nodeIdx = TreeNodes.IndexOf(node);
        if (nodeIdx < 0)
        {
            return;
        }

        if (node.IsExpanded)
        {
            int removeIdx = nodeIdx + 1;
            while (removeIdx < TreeNodes.Count && TreeNodes[removeIdx].DepthLevel > node.DepthLevel)
            {
                TreeNodes.RemoveAt(removeIdx);
            }
            node.IsExpanded = false;
            return;
        }

        long parentBytes = Math.Max(1, node.SizeBytes);
        int insertIdx = nodeIdx + 1;

        if (_childrenByParent.TryGetValue(node.Id, out var subDirs))
        {
            foreach (var child in subDirs.Take(40))
            {
                double pct = (child.LogicalBytes / (double)parentBytes) * 100.0;
                TreeNodes.Insert(insertIdx++, new StorageTreeNodeViewModel
                {
                    Id = child.Id,
                    ParentId = child.ParentId,
                    Name = child.Name,
                    FullPath = child.FullPath,
                    IsDirectory = true,
                    SizeBytes = child.LogicalBytes,
                    RecursiveFileCount = child.RecursiveFileCount,
                    RecursiveFolderCount = child.RecursiveFolderCount,
                    FormattedSize = ByteFormatter.FormatBytes(child.LogicalBytes),
                    PercentOfParentLabel = $"{pct:F1}% of parent",
                    DepthLevel = node.DepthLevel + 1,
                    Glyph = "\uE8B7"
                });
            }
        }

        // Also surface top direct files inside this directory (>= 1 MB, up to 15)
        try
        {
            if (Directory.Exists(node.FullPath))
            {
                var directFiles = new DirectoryInfo(node.FullPath)
                    .EnumerateFiles("*", SearchOption.TopDirectoryOnly)
                    .Select(fi =>
                    {
                        try { return (Name: fi.Name, FullName: fi.FullName, Length: fi.Length); }
                        catch { return (Name: string.Empty, FullName: string.Empty, Length: 0L); }
                    })
                    .Where(x => x.Length >= 1024 * 1024 && !string.IsNullOrEmpty(x.Name))
                    .OrderByDescending(x => x.Length)
                    .Take(15);

                foreach (var f in directFiles)
                {
                    double pct = (f.Length / (double)parentBytes) * 100.0;
                    TreeNodes.Insert(insertIdx++, new StorageTreeNodeViewModel
                    {
                        Id = 0,
                        ParentId = node.Id,
                        Name = f.Name,
                        FullPath = f.FullName,
                        IsDirectory = false,
                        SizeBytes = f.Length,
                        FormattedSize = ByteFormatter.FormatBytes(f.Length),
                        PercentOfParentLabel = $"{pct:F1}% of folder",
                        DepthLevel = node.DepthLevel + 1,
                        Glyph = "\uE8A5"
                    });
                }
            }
        }
        catch { }

        node.IsExpanded = true;
    }

    private void OnRevealInExplorerClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string fullPath && !string.IsNullOrEmpty(fullPath))
        {
            try
            {
                if (File.Exists(fullPath))
                {
                    Process.Start("explorer.exe", $"/select,\"{fullPath}\"");
                }
                else if (Directory.Exists(fullPath))
                {
                    Process.Start("explorer.exe", $"\"{fullPath}\"");
                }
            }
            catch { }
        }
    }

    private IReadOnlyList<CleanupRuleGroup> _lastRuleGroups = Array.Empty<CleanupRuleGroup>();

    // ==========================================
    // SUB-VIEW 2: CLEANER IMPLEMENTATION
    // ==========================================
    public async Task ScanJunkAsync()
    {
        var nextCts = new CancellationTokenSource();
        var prevCts = Interlocked.Exchange(ref _junkScanCts, nextCts);
        prevCts?.Cancel();
        prevCts?.Dispose();
        var ct = nextCts.Token;

        ActiveJunkCategories.Clear();
        CleanerReclaimableSummaryText.Text = "Scanning temporary caches, GPU/dev caches, and system logs...";

        try
        {
            await Task.Run(async () =>
            {
                ct.ThrowIfCancellationRequested();
                var summary = AppServices.Instance.TroubleshootingService.InspectSafeTempAndBrowserCaches();
                ct.ThrowIfCancellationRequested();
                var recycleBin = SafeCleanupService.GetRecycleBinMetrics();
                var spaceHogs = await AppServices.Instance.StorageHotspotService.InspectSpaceHogsAsync(minReportThresholdBytes: 10L * 1024 * 1024, cancellationToken: ct);
                ct.ThrowIfCancellationRequested();

                long totalReclaimable = summary.TotalSafeReclaimableBytes + recycleBin.TotalBytes + spaceHogs.SafeReclaimableBytes;
                int cleanCount = 0;

                var manualHogs = spaceHogs.Entries
                    .Where(h => !h.CanSafeCleanDirectly && h.SizeBytes >= 512L * 1024 * 1024)
                    .Take(8)
                    .ToList();

                DispatcherQueue.TryEnqueue(() =>
                {
                    if (ct.IsCancellationRequested) return;
                    ActiveJunkCategories.Clear();
                    ManualSpaceHogs.Clear();
                    CleanerReclaimableSummaryText.Text = $"Discovered {ByteFormatter.FormatBytes(totalReclaimable)} in safe reclaimable caches.";

                if (summary.UserTempBytes > 0)
                {
                    ActiveJunkCategories.Add(new StorageSenseCategoryCardViewModel
                    {
                        CategoryId = "temp",
                        Title = "User & System Temp Files",
                        Description = $"{summary.UserTempFileCount:N0} temporary application cache files and scratch data.",
                        FormattedSize = ByteFormatter.FormatBytes(summary.UserTempBytes),
                        SizeBytes = summary.UserTempBytes,
                        IsSelected = true
                    });
                }
                else cleanCount++;

                if (summary.CrashDumpBytes > 0)
                {
                    ActiveJunkCategories.Add(new StorageSenseCategoryCardViewModel
                    {
                        CategoryId = "dumps",
                        Title = "Windows Crash & Error Dumps",
                        Description = $"{summary.CrashDumpFileCount:N0} error logs and memory dump traces.",
                        FormattedSize = ByteFormatter.FormatBytes(summary.CrashDumpBytes),
                        SizeBytes = summary.CrashDumpBytes,
                        IsSelected = true
                    });
                }
                else cleanCount++;

                long browserBytes = summary.BrowserCaches.Sum(b => b.CacheSizeBytes);
                if (browserBytes > 0)
                {
                    ActiveJunkCategories.Add(new StorageSenseCategoryCardViewModel
                    {
                        CategoryId = "browser",
                        Title = "Browser Web Caches",
                        Description = $"Cached web images and offline scripts ({string.Join(", ", summary.BrowserCaches.Select(b => b.BrowserName))}).",
                        FormattedSize = ByteFormatter.FormatBytes(browserBytes),
                        SizeBytes = browserBytes,
                        IsSelected = true
                    });
                }
                else cleanCount++;

                if (recycleBin.TotalBytes > 0)
                {
                    ActiveJunkCategories.Add(new StorageSenseCategoryCardViewModel
                    {
                        CategoryId = "recyclebin",
                        Title = "Windows Recycle Bin",
                        Description = $"{recycleBin.ItemCount:N0} deleted files awaiting permanent purging.",
                        FormattedSize = ByteFormatter.FormatBytes(recycleBin.TotalBytes),
                        SizeBytes = recycleBin.TotalBytes,
                        IsSelected = true
                    });
                }
                else cleanCount++;

                foreach (var hog in spaceHogs.Entries.Where(h => h.CanSafeCleanDirectly))
                {
                    ActiveJunkCategories.Add(new StorageSenseCategoryCardViewModel
                    {
                        CategoryId = "hog:" + hog.Id,
                        Title = $"{hog.Title} [{hog.Category}]",
                        Description = $"{hog.ItemCount:N0} files • {hog.SafetyGuidance}",
                        FormattedSize = ByteFormatter.FormatBytes(hog.SizeBytes),
                        SizeBytes = hog.SizeBytes,
                        IsSelected = !string.Equals(hog.Category, "Developer Cache", StringComparison.OrdinalIgnoreCase)
                    });
                }

                foreach (var m in manualHogs)
                {
                    string copyCmd = m.Id == "docker_wsl_disk" ? "docker system prune -a" : string.Empty;
                    ManualSpaceHogs.Add(new ManualSpaceHogCardViewModel
                    {
                        Id = m.Id,
                        Title = m.Title,
                        Category = m.Category,
                        LocationPath = m.LocationPath,
                        FormattedSize = ByteFormatter.FormatBytes(m.SizeBytes),
                        Guidance = m.SafetyGuidance,
                        CopyCommand = copyCmd
                    });
                }
                ManualSpaceHogsSection.Visibility = ManualSpaceHogs.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

                if (manualHogs.Count > 0)
                {
                    CleanCategoriesSummaryText.Text = $"✓ Protected space hogs listed separately above ({manualHogs.Count} item(s)) — never auto-deleted.";
                }
                else
                {
                    CleanCategoriesSummaryText.Text = $"✓ {Math.Max(1, cleanCount)} Clean Categories — No Action Needed";
                }
                });
            }, ct);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private void OnCopySpaceHogCommandClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string cmd && !string.IsNullOrWhiteSpace(cmd))
        {
            var dp = new Windows.ApplicationModel.DataTransfer.DataPackage();
            dp.SetText(cmd);
            Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dp);
            AppServices.Instance.NotifyStatus($"Copied command to clipboard: {cmd}");
        }
    }

    private async void OnScanJunkClick(object sender, RoutedEventArgs e)
    {
        await ScanJunkAsync();
    }

    private async void OnExecuteCleanClick(object sender, RoutedEventArgs e)
    {
        var selectedCategories = ActiveJunkCategories.Where(c => c.IsSelected).ToList();
        if (selectedCategories.Count == 0)
        {
            await AppServices.Instance.ShowDialogAsync("No Selection", "Please check at least one category to clean.");
            return;
        }

        ExecuteCleanBtn.IsEnabled = false;
        try
        {
            var proposals = new List<OperationProposal>();
            if (selectedCategories.Any(c => c.CategoryId is "temp" or "dumps" or "browser"))
            {
                proposals.Add(AppServices.Instance.TroubleshootingService.ProposeSafeTempAndCacheCleanup(includeClosedBrowserCaches: true));
            }

            var hogIds = selectedCategories
                .Where(c => c.CategoryId.StartsWith("hog:", StringComparison.Ordinal))
                .Select(c => c.CategoryId["hog:".Length..])
                .ToList();
            if (hogIds.Count > 0)
            {
                proposals.Add(await AppServices.Instance.StorageHotspotService.ProposeCleanSafeSpaceHogsAsync(hogIds));
            }

            if (selectedCategories.Any(c => c.CategoryId == "recyclebin"))
            {
                proposals.Add(AppServices.Instance.StorageHotspotService.ProposeEmptyRecycleBin());
            }

            var batch = await AppServices.Instance.ExecuteBatchWithGateAsync(this.XamlRoot, proposals, "Cleanup Notice");
            if (batch.SucceededCount > 0 || batch.FailedCount > 0)
            {
                string summary = $"Successfully reclaimed {ByteFormatter.FormatBytes(batch.TotalBytesReclaimed)} across {batch.SucceededCount} operation(s).";
                if (batch.FailedCount > 0)
                {
                    summary += $"\n{batch.FailedCount} operation(s) failed or could not remove locked files.";
                }
                await AppServices.Instance.ShowDialogAsync("Cleanup Complete", summary);
                await ScanJunkAsync();
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Cleanup Error", ex.Message);
        }
        finally
        {
            ExecuteCleanBtn.IsEnabled = true;
        }
    }

    // ==========================================
    // SUB-VIEW 3: SMART FILE ORGANIZER
    // ==========================================
    public void SetOrganizerTarget(string folderPath)
    {
        OrganizerFolderBox.Text = folderPath;
    }

    private void OnPresetDownloadsClick(object sender, RoutedEventArgs e)
    {
        OrganizerFolderBox.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        OnPreviewOrganizeClick(sender, e);
    }

    private void OnPresetDesktopClick(object sender, RoutedEventArgs e)
    {
        OrganizerFolderBox.Text = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
        OnPreviewOrganizeClick(sender, e);
    }

    private void OnPresetDocumentsClick(object sender, RoutedEventArgs e)
    {
        OrganizerFolderBox.Text = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        OnPreviewOrganizeClick(sender, e);
    }

    private async void OnBrowseOrganizerFolderClick(object sender, RoutedEventArgs e)
    {
        var picker = new FolderPicker();
        var hwnd = AppServices.Instance.WindowHandle;
        if (hwnd != IntPtr.Zero) WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        picker.SuggestedStartLocation = PickerLocationId.ComputerFolder;
        picker.FileTypeFilter.Add("*");

        var folder = await picker.PickSingleFolderAsync();
        if (folder != null)
        {
            OrganizerFolderBox.Text = folder.Path;
            OnPreviewOrganizeClick(sender, e);
        }
    }

    public void OnPreviewOrganizeClick(object sender, RoutedEventArgs e)
    {
        string path = OrganizerFolderBox.Text.Trim();
        if (string.IsNullOrEmpty(path) || !Directory.Exists(path))
        {
            return;
        }

        try
        {
            var plan = AppServices.Instance.FileOrganizerService.PreviewFolderOrganization(path);
            _currentOrganizationPlan = plan;
            OrganizationPlanItems.Clear();

            foreach (var item in plan.Candidates)
            {
                OrganizationPlanItems.Add(new OrganizationPlanItemViewModel
                {
                    OriginalName = item.FileName,
                    SourcePath = item.SourceFilePath,
                    TargetRelativeFolder = item.CategoryFolder,
                    FormattedSize = item.SizeDisplay
                });
            }

            ExecuteOrganizeBtn.IsEnabled = plan.Candidates.Count > 0;
            AppServices.Instance.NotifyStatus($"Generated organization plan: {plan.Candidates.Count} files categorized.");
        }
        catch (Exception ex)
        {
            AppServices.Instance.NotifyStatus($"Preview failed: {ex.Message}");
        }
    }

    private async void OnExecuteOrganizeClick(object sender, RoutedEventArgs e)
    {
        if (_currentOrganizationPlan == null || _currentOrganizationPlan.Candidates.Count == 0) return;

        ExecuteOrganizeBtn.IsEnabled = false;
        try
        {
            var proposal = AppServices.Instance.FileOrganizerService.ProposeOrganizeFolder(_currentOrganizationPlan.RootFolderPath);
            var result = await AppServices.Instance.ExecuteWithGateAsync(
                this.XamlRoot,
                proposal,
                "Prerequisite Notice",
                $"Organizing files in {_currentOrganizationPlan.RootFolderPath}...");
            if (result != null && result.Succeeded)
            {
                await AppServices.Instance.ShowDialogAsync("Organization Complete", $"{result.StatusMessage}\nYou can undo this anytime from Audit History.");
                OrganizationPlanItems.Clear();
            }
            else if (result != null)
            {
                await AppServices.Instance.ShowDialogAsync("Organization Error", result.StatusMessage);
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Organization Error", ex.Message);
        }
        finally
        {
            ExecuteOrganizeBtn.IsEnabled = false;
        }
    }

    // ==========================================
    // SUB-VIEW 4: DUPLICATE FINDER
    // ==========================================
    private void OnDupPresetDownloadsClick(object sender, RoutedEventArgs e)
    {
        DuplicatesFolderBox.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        OnScanDuplicatesClick(sender, e);
    }

    private void OnDupPresetDocumentsClick(object sender, RoutedEventArgs e)
    {
        DuplicatesFolderBox.Text = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        OnScanDuplicatesClick(sender, e);
    }

    private async void OnBrowseDuplicatesFolderClick(object sender, RoutedEventArgs e)
    {
        var picker = new FolderPicker();
        var hwnd = AppServices.Instance.WindowHandle;
        if (hwnd != IntPtr.Zero) WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        picker.SuggestedStartLocation = PickerLocationId.ComputerFolder;
        picker.FileTypeFilter.Add("*");

        var folder = await picker.PickSingleFolderAsync();
        if (folder != null)
        {
            DuplicatesFolderBox.Text = folder.Path;
            OnScanDuplicatesClick(sender, e);
        }
    }

    private async void OnScanDuplicatesClick(object sender, RoutedEventArgs e)
    {
        string targetPath = DuplicatesFolderBox.Text.Trim();
        if (string.IsNullOrEmpty(targetPath))
        {
            targetPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            DuplicatesFolderBox.Text = targetPath;
        }
        if (!Directory.Exists(targetPath))
        {
            await AppServices.Instance.ShowDialogAsync("Folder Not Found", $"Directory does not exist: {targetPath}");
            return;
        }

        AppServices.Instance.NotifyStatus($"Scanning {targetPath} for SHA-256 duplicates...");
        try
        {
            var report = await Task.Run(() => AppServices.Instance.DuplicateEngine.ScanDirectoryForDuplicatesAsync(targetPath));
            DuplicateGroups.Clear();

            foreach (var g in report.Groups)
            {
                var card = new DuplicateGroupCardViewModel
                {
                    Sha256 = g.Sha256,
                    SummaryText = $"{g.Files.Count} Identical Files ({Path.GetFileName(g.Files.FirstOrDefault()?.FullPath ?? "")})",
                    FormattedWaste = $"{ByteFormatter.FormatBytes(g.PotentialWasteBytes)} reclaimable",
                    PotentialWasteBytes = g.PotentialWasteBytes
                };

                for (int i = 0; i < g.Files.Count; i++)
                {
                    var f = g.Files[i];
                    bool isPrimary = i == 0;
                    card.Files.Add(new DuplicateItemRowViewModel
                    {
                        FullPath = f.FullPath,
                        Name = f.Name,
                        FormattedSize = ByteFormatter.FormatBytes(f.SizeBytes),
                        IsHardLinkAlias = f.IsHardLinkAlias,
                        IsSelected = !isPrimary && !f.IsHardLinkAlias,
                        StatusBadge = isPrimary ? "Keep (Primary)" : (f.IsHardLinkAlias ? "Hard Link (0 B)" : "Duplicate")
                    });
                }

                DuplicateGroups.Add(card);
            }

            RecycleDuplicatesBtn.IsEnabled = DuplicateGroups.Any(g => g.Files.Any(f => f.IsSelected));
            DuplicatesSummaryText.Text = report.Groups.Count > 0
                ? $"Found {report.Groups.Count} duplicate group(s) wasting {ByteFormatter.FormatBytes(report.TotalPotentialWasteBytes)} in {targetPath}."
                : $"No duplicate files found in {targetPath}.";
            AppServices.Instance.NotifyStatus($"Duplicate scan complete: {report.Groups.Count} duplicate groups found.");
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Duplicate Scan Error", ex.Message);
        }
    }

    private async void OnRecycleDuplicatesClick(object sender, RoutedEventArgs e)
    {
        var selectedPaths = DuplicateGroups
            .SelectMany(g => g.Files)
            .Where(f => f.IsSelected && !f.IsHardLinkAlias)
            .Select(f => f.FullPath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (selectedPaths.Count == 0)
        {
            await AppServices.Instance.ShowDialogAsync("Nothing Selected", "Check at least one duplicate copy to move to the Recycle Bin.");
            return;
        }

        string root = DuplicatesFolderBox.Text.Trim();
        if (string.IsNullOrEmpty(root))
        {
            root = Path.GetDirectoryName(selectedPaths[0]) ?? string.Empty;
        }

        try
        {
            var proposal = AppServices.Instance.StorageHotspotService.ProposeRecycleItems(selectedPaths, [root], "Duplicate Files");
            var record = await AppServices.Instance.ExecuteWithGateAsync(
                this.XamlRoot,
                proposal,
                "Prerequisite Notice",
                "Moving duplicate files to Recycle Bin...",
                "Duplicates Recycled");
            if (record?.Succeeded == true)
            {
                OnScanDuplicatesClick(sender, e);
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Duplicate Cleanup Error", ex.Message);
        }
    }

    // Segment Switch Handlers
    private void OnTabAnalyzerClick(object sender, RoutedEventArgs e) => ShowSegment("analyzer");
    private void OnTabCleanerClick(object sender, RoutedEventArgs e) => ShowSegment("cleaner");
    private void OnTabOrganizerClick(object sender, RoutedEventArgs e) => ShowSegment("organizer");
    private void OnTabDuplicatesClick(object sender, RoutedEventArgs e) => ShowSegment("duplicates");
}
