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
    private FileOrganizePlan? _currentOrganizationPlan;

    public ObservableCollection<StorageTreeNodeViewModel> TreeNodes { get; } = new();
    public ObservableCollection<StorageBarSegmentViewModel> BarSegments { get; } = new();
    public ObservableCollection<StorageSenseCategoryCardViewModel> ActiveJunkCategories { get; } = new();
    public ObservableCollection<OrganizationPlanItemViewModel> OrganizationPlanItems { get; } = new();
    public ObservableCollection<DuplicateGroupCardViewModel> DuplicateGroups { get; } = new();

    public StoragePage()
    {
        this.InitializeComponent();
        this.NavigationCacheMode = NavigationCacheMode.Required;

        FolderTreeListView.ItemsSource = TreeNodes;
        BreakdownLegendControl.ItemsSource = BarSegments;
        CleanerActiveCategoriesControl.ItemsSource = ActiveJunkCategories;
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

        TabAnalyzerBtn.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];
        TabCleanerBtn.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];
        TabOrganizerBtn.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];
        TabDuplicatesBtn.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];

        switch (segment.ToLowerInvariant())
        {
            case "cleaner" or "junk" or "cleanup":
                SubViewCleaner.Visibility = Visibility.Visible;
                TabCleanerBtn.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
                _ = ScanJunkAsync();
                break;
            case "organizer" or "organize":
                SubViewOrganizer.Visibility = Visibility.Visible;
                TabOrganizerBtn.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
                if (string.IsNullOrEmpty(OrganizerFolderBox.Text))
                {
                    OrganizerFolderBox.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
                }
                break;
            case "duplicates" or "duplicate":
                SubViewDuplicates.Visibility = Visibility.Visible;
                TabDuplicatesBtn.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
                break;
            default:
                SubViewAnalyzer.Visibility = Visibility.Visible;
                TabAnalyzerBtn.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
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
        BarSegments.Clear();

        AnalyzerEmptyState.Visibility = Visibility.Collapsed;
        FolderTreeListView.Visibility = Visibility.Visible;

        StorageSummaryHeader.Text = $"{result.RootPath} — {ByteFormatter.FormatBytes(result.TotalLogicalBytes)} Total";
        StorageScannedCountText.Text = $"{result.TotalFiles:N0} files • {result.TotalFolders:N0} folders ({result.ElapsedMilliseconds} ms)";

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

        // Top directories
        int id = 0;
        foreach (var dir in (result.LargestFolders ?? Array.Empty<ScannedEntry>()).Take(30))
        {
            double pctOfDrive = (dir.LogicalBytes / (double)totalBytes) * 100.0;
            TreeNodes.Add(new StorageTreeNodeViewModel
            {
                Id = ++id,
                Name = dir.Name,
                FullPath = dir.FullPath,
                IsDirectory = true,
                SizeBytes = dir.LogicalBytes,
                FormattedSize = ByteFormatter.FormatBytes(dir.LogicalBytes),
                PercentOfParentLabel = $"{pctOfDrive:F1}% of drive",
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

    private void OnCancelScanClick(object sender, RoutedEventArgs e)
    {
        _scanCts?.Cancel();
    }

    private void OnFolderExpanderClick(object sender, RoutedEventArgs e)
    {
        // Toggle expansion
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
        ActiveJunkCategories.Clear();
        CleanerReclaimableSummaryText.Text = "Scanning temporary caches and system logs...";

        await Task.Run(() =>
        {
            var summary = AppServices.Instance.TroubleshootingService.InspectSafeTempAndBrowserCaches();
            var recycleBin = SafeCleanupService.GetRecycleBinMetrics();

            long totalReclaimable = summary.TotalSafeReclaimableBytes + recycleBin.TotalBytes;
            int cleanCount = 0;

            DispatcherQueue.TryEnqueue(() =>
            {
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

                CleanCategoriesSummaryText.Text = $"✓ {Math.Max(1, cleanCount)} Clean Categories — No Action Needed";
            });
        });
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

        long totalBytes = selectedCategories.Sum(c => c.SizeBytes);
        bool confirm = await AppServices.Instance.ShowConfirmDialogAsync(
            "Confirm Storage Cleanup",
            $"Are you sure you want to clean {ByteFormatter.FormatBytes(totalBytes)} across {selectedCategories.Count} categories?\n\nThis will safely remove expired cache files and recycle bin items.",
            "Clean Files",
            "Cancel");

        if (!confirm) return;

        ExecuteCleanBtn.IsEnabled = false;
        try
        {
            long cleanedBytes = 0;
            if (selectedCategories.Any(c => c.CategoryId is "temp" or "dumps" or "browser"))
            {
                var proposal = AppServices.Instance.TroubleshootingService.ProposeSafeTempAndCacheCleanup(includeClosedBrowserCaches: true);
                var result = await AppServices.Instance.SafeOperationEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
                cleanedBytes += totalBytes - (selectedCategories.FirstOrDefault(c => c.CategoryId == "recyclebin")?.SizeBytes ?? 0);
            }

            if (selectedCategories.Any(c => c.CategoryId == "recyclebin"))
            {
                SafeCleanupService.EmptyRecycleBin();
                cleanedBytes += selectedCategories.FirstOrDefault(c => c.CategoryId == "recyclebin")?.SizeBytes ?? 0;
            }

            AppServices.Instance.NotifyOperationHistoryChanged();
            await AppServices.Instance.ShowDialogAsync("Cleanup Complete", $"Successfully cleaned {ByteFormatter.FormatBytes(cleanedBytes)}.");
            await ScanJunkAsync();
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

        bool confirm = await AppServices.Instance.ShowConfirmDialogAsync(
            "Execute File Organization",
            $"Organize {_currentOrganizationPlan.Candidates.Count} files in {OrganizerFolderBox.Text} into categorized subfolders?\n\nThis operation is 100% reversible with 1-click Undo in Audit History.",
            "Organize Now",
            "Cancel");

        if (!confirm) return;

        ExecuteOrganizeBtn.IsEnabled = false;
        try
        {
            var proposal = AppServices.Instance.FileOrganizerService.ProposeOrganizeFolder(_currentOrganizationPlan.RootFolderPath);
            var result = await AppServices.Instance.SafeOperationEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
            AppServices.Instance.NotifyOperationHistoryChanged();
            await AppServices.Instance.ShowDialogAsync("Organization Complete", $"{result.StatusMessage}\nYou can undo this anytime from Audit History.");
            OrganizationPlanItems.Clear();
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
    private async void OnScanDuplicatesClick(object sender, RoutedEventArgs e)
    {
        string? targetPath = (DrivesSelectorCombo.SelectedItem as ComboBoxItem)?.Tag as string;
        if (string.IsNullOrEmpty(targetPath)) targetPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");

        AppServices.Instance.NotifyStatus("Running 3-stage SHA-256 duplicate scan...");
        try
        {
            var report = await Task.Run(() => AppServices.Instance.DuplicateEngine.ScanDirectoryForDuplicatesAsync(targetPath));
            DuplicateGroups.Clear();

            foreach (var g in report.Groups)
            {
                DuplicateGroups.Add(new DuplicateGroupCardViewModel
                {
                    Sha256 = g.Sha256,
                    SummaryText = $"{g.Files.Count} Identical Files ({Path.GetFileName(g.Files.FirstOrDefault()?.FullPath ?? "")})",
                    FormattedWaste = $"{ByteFormatter.FormatBytes(g.PotentialWasteBytes)} reclaimable",
                    PotentialWasteBytes = g.PotentialWasteBytes
                });
            }

            AppServices.Instance.NotifyStatus($"Duplicate scan complete: {report.Groups.Count} duplicate groups found.");
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Duplicate Scan Error", ex.Message);
        }
    }

    // Segment Switch Handlers
    private void OnTabAnalyzerClick(object sender, RoutedEventArgs e) => ShowSegment("analyzer");
    private void OnTabCleanerClick(object sender, RoutedEventArgs e) => ShowSegment("cleaner");
    private void OnTabOrganizerClick(object sender, RoutedEventArgs e) => ShowSegment("organizer");
    private void OnTabDuplicatesClick(object sender, RoutedEventArgs e) => ShowSegment("duplicates");
}
