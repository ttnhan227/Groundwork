using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Groundwork.Desktop.Services;
using Groundwork.Engine.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace Groundwork.Desktop.Views;

public sealed partial class ApplicationsPage : Page
{
    private IReadOnlyList<InstalledApplicationInfo> _rawApps = Array.Empty<InstalledApplicationInfo>();
    private IReadOnlyList<AppxPackageEntry> _rawAppxPackages = Array.Empty<AppxPackageEntry>();
    private InstalledAppRowViewModel? _selectedApp;
    private bool _sortBySize = true;
    private string _bloatFilter = "bloat";
    private System.Threading.CancellationTokenSource? _bloatLoadCts;
    private System.Threading.CancellationTokenSource? _toolsLoadCts;

    public ObservableCollection<InstalledAppRowViewModel> FilteredApps { get; } = new();
    public ObservableCollection<LeftoverItemRowViewModel> Leftovers { get; } = new();
    public ObservableCollection<AppxPackageRowViewModel> BloatwareRows { get; } = new();
    public ObservableCollection<EssentialToolRowViewModel> EssentialToolsRows { get; } = new();

    public ApplicationsPage()
    {
        this.InitializeComponent();
        this.NavigationCacheMode = NavigationCacheMode.Required;

        InstalledAppsListView.ItemsSource = FilteredApps;
        LeftoversListView.ItemsSource = Leftovers;
        BloatwareListView.ItemsSource = BloatwareRows;
        EssentialToolsListView.ItemsSource = EssentialToolsRows;
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        if (e.Parameter is string segment && !string.IsNullOrEmpty(segment))
        {
            ShowSegment(segment);
        }
        if (_rawApps.Count == 0)
        {
            await LoadAppsAsync();
        }
    }

    public async Task LoadAppsAsync(bool force = false)
    {
        if (_rawApps.Count > 0 && !force) return;

        AppServices.Instance.NotifyStatus("Discovering installed Windows software...");
        await Task.Run(() =>
        {
            var apps = AppServices.Instance.InstalledAppsEngine.EnumerateInstalledApps();
            _rawApps = apps;
            AppServices.Instance.AllInstalledApps = apps;

            DispatcherQueue.TryEnqueue(() =>
            {
                ApplyFilter();
                UpdateSummaryStats(apps);
                AppServices.Instance.NotifyStatus($"Discovered {apps.Count} installed applications.");
            });
        });
    }

    private void UpdateSummaryStats(IReadOnlyList<InstalledApplicationInfo> apps)
    {
        TotalAppsStatText.Text = $"{apps.Count} Apps";
        long totalBytes = apps.Sum(a => a.EstimatedSizeBytes ?? 0);
        TotalSpaceStatText.Text = ByteFormatter.FormatBytes(totalBytes);

        var largest = apps.OrderByDescending(a => a.EstimatedSizeBytes ?? 0).FirstOrDefault();
        if (largest != null)
        {
            LargestAppStatText.Text = $"{largest.Name} ({ByteFormatter.FormatBytes(largest.EstimatedSizeBytes)})";
        }
        else
        {
            LargestAppStatText.Text = "None";
        }

        AppsSummaryCountText.Text = $"{apps.Count} installed programs discovered ({ByteFormatter.FormatBytes(totalBytes)} estimated storage).";
    }

    private void ApplyFilter()
    {
        string query = AppSearchBox.Text.Trim();
        FilteredApps.Clear();

        var matches = _rawApps.AsEnumerable();
        if (!string.IsNullOrEmpty(query))
        {
            matches = matches.Where(a =>
                a.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                a.Publisher.Contains(query, StringComparison.OrdinalIgnoreCase));
        }

        var sorted = _sortBySize
            ? matches.OrderByDescending(a => a.EstimatedSizeBytes ?? 0).ThenBy(a => a.Name)
            : matches.OrderBy(a => a.Name);

        foreach (var app in sorted)
        {
            FilteredApps.Add(new InstalledAppRowViewModel
            {
                Id = app.Id,
                Name = app.Name,
                Publisher = !string.IsNullOrEmpty(app.Publisher) ? app.Publisher : "Third-Party Application",
                Version = app.Version,
                InstallLocation = app.InstallLocation,
                FormattedSize = ByteFormatter.FormatBytes(app.EstimatedSizeBytes),
                UninstallString = app.UninstallString,
                CanUninstall = app.CanUninstall,
                IconPngPath = app.IconPngPath,
                RawModel = app
            });
        }
    }

    private void OnSortBySizeClick(object sender, RoutedEventArgs e)
    {
        _sortBySize = true;
        SortBySizeBtn.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
        SortByNameBtn.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];
        ApplyFilter();
    }

    private void OnSortByNameClick(object sender, RoutedEventArgs e)
    {
        _sortBySize = false;
        SortBySizeBtn.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];
        SortByNameBtn.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
        ApplyFilter();
    }

    private void OnAppSearchTextChanged(object sender, TextChangedEventArgs e)
    {
        ApplyFilter();
    }

    private void OnAppSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selectedApp = InstalledAppsListView.SelectedItem as InstalledAppRowViewModel;
        if (_selectedApp != null)
        {
            NoAppSelectedDashboard.Visibility = Visibility.Collapsed;
            SelectedAppDetailsPanel.Visibility = Visibility.Visible;

            SelectedAppNameText.Text = _selectedApp.Name;
            SelectedAppPublisherText.Text = $"{_selectedApp.Publisher} • v{_selectedApp.Version}";
            SelectedAppLocationText.Text = !string.IsNullOrEmpty(_selectedApp.InstallLocation) ? _selectedApp.InstallLocation : "System Registry Managed";
            SelectedAppSizeText.Text = _selectedApp.FormattedSize;
            Leftovers.Clear();
        }
        else
        {
            NoAppSelectedDashboard.Visibility = Visibility.Visible;
            SelectedAppDetailsPanel.Visibility = Visibility.Collapsed;
        }
    }

    private async void OnUninstallAppClick(object sender, RoutedEventArgs e)
    {
        if (_selectedApp?.RawModel == null)
        {
            return;
        }

        try
        {
            var wizard = new Dialogs.GuidedUninstallDialog(_selectedApp.RawModel) { XamlRoot = this.XamlRoot };
            await wizard.ShowAsync();
            if (wizard.DidModifySystem)
            {
                await LoadAppsAsync(force: true);
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Uninstall Wizard Error", ex.Message);
        }
    }

    private LeftoverScanDepth GetSelectedInlineScanDepth()
    {
        if (InlineScanDepthCombo?.SelectedItem is ComboBoxItem item && item.Tag is string tag &&
            Enum.TryParse<LeftoverScanDepth>(tag, out var depth))
        {
            return depth;
        }
        return LeftoverScanDepth.Moderate;
    }

    private async void OnScanLeftoversClick(object sender, RoutedEventArgs e)
    {
        if (_selectedApp == null) return;
        var depth = GetSelectedInlineScanDepth();
        AppServices.Instance.NotifyStatus($"Running {depth} leftover trace scan for {_selectedApp.Name}...");

        try
        {
            Leftovers.Clear();
            NoTracesHintText.Visibility = Visibility.Collapsed;
            var raw = _selectedApp.RawModel;
            if (raw != null)
            {
                var report = await Task.Run(() => AppServices.Instance.InstalledAppsEngine.ScanAppLeftovers(
                    raw.Id,
                    raw.Name,
                    raw.Publisher,
                    raw.InstallLocation,
                    scanDepth: depth,
                    uninstallString: raw.UninstallString));

                foreach (var t in report.FileSystemLeftovers)
                {
                    Leftovers.Add(new LeftoverItemRowViewModel
                    {
                        Name = t.Name,
                        FullPath = t.FullPath,
                        LocationGroup = t.LocationGroup,
                        FormattedSize = ByteFormatter.FormatBytes(t.SizeBytes),
                        SizeBytes = t.SizeBytes,
                        Confidence = t.Confidence,
                        Evidence = t.Evidence,
                        IsRegistry = false,
                        IsSelected = string.Equals(t.Confidence, "high", StringComparison.OrdinalIgnoreCase)
                    });
                }

                bool isElevated = AppServices.Instance.RepairAndDebloatService.IsCurrentSessionElevated;
                foreach (var reg in report.RegistryLeftovers.Where(r => Groundwork.Engine.Services.WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(r.KeyPath)))
                {
                    bool isHigh = string.Equals(reg.Confidence, "high", StringComparison.OrdinalIgnoreCase);
                    bool isHklm = reg.KeyPath.StartsWith(@"HKLM\", StringComparison.OrdinalIgnoreCase);
                    Leftovers.Add(new LeftoverItemRowViewModel
                    {
                        Name = reg.KeyPath.Split('\\').LastOrDefault() ?? reg.KeyPath,
                        FullPath = reg.KeyPath,
                        LocationGroup = reg.LocationGroup,
                        FormattedSize = isHklm ? "Reg (Admin)" : "Registry",
                        SizeBytes = 0,
                        Confidence = reg.Confidence,
                        Evidence = reg.Evidence,
                        IsRegistry = true,
                        IsSelected = isHigh && (!isHklm || isElevated)
                    });
                }
            }
            CleanLeftoversBtn.IsEnabled = Leftovers.Count > 0;
            NoTracesHintText.Visibility = Leftovers.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            if (Leftovers.Count == 0)
            {
                NoTracesHintText.Text = $"Zero leftover traces detected in {depth} mode.";
            }
            AppServices.Instance.NotifyStatus($"Discovered {Leftovers.Count} leftover trace(s) ({depth} mode).");
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Leftover Scan Error", ex.Message);
        }
    }

    private void OnOpenLeftoverClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string path && !string.IsNullOrEmpty(path))
        {
            try
            {
                if (File.Exists(path)) Process.Start("explorer.exe", $"/select,\"{path}\"");
                else if (Directory.Exists(path)) Process.Start("explorer.exe", $"\"{path}\"");
            }
            catch { }
        }
    }

    private async void OnCleanLeftoversClick(object sender, RoutedEventArgs e)
    {
        var selectedFiles = Leftovers.Where(l => l.IsSelected && !l.IsRegistry && !string.IsNullOrWhiteSpace(l.FullPath)).ToList();
        var selectedReg = Leftovers.Where(l => l.IsSelected && l.IsRegistry && !string.IsNullOrWhiteSpace(l.FullPath)).ToList();
        if (selectedFiles.Count == 0 && selectedReg.Count == 0)
        {
            await AppServices.Instance.ShowDialogAsync("Nothing Selected", "Select at least one leftover item or registry trace to clean.");
            return;
        }

        try
        {
            bool modified = false;
            if (selectedFiles.Count > 0)
            {
                var roots = Groundwork.Engine.Services.InstalledAppsEngineService.GetAllowedCleanupRootsForApp(
                    _selectedApp?.InstallLocation ?? string.Empty,
                    selectedFiles.Select(s => Path.GetDirectoryName(s.FullPath) ?? string.Empty).Where(r => !string.IsNullOrEmpty(r)));
                var fsProposal = AppServices.Instance.StorageHotspotService.ProposeRecycleItems(
                    selectedFiles.Select(s => s.FullPath),
                    roots,
                    $"{_selectedApp?.Name ?? "App"} Leftovers");
                var fsRec = await AppServices.Instance.ExecuteWithGateAsync(this.XamlRoot, fsProposal, "Cleanup Notice", "Moving leftover files to Recycle Bin...", "Files Recycled");
                modified |= fsRec != null;
            }

            if (selectedReg.Count > 0)
            {
                var regProposal = AppServices.Instance.RepairAndDebloatService.ProposeCleanLeftoverRegistryKeys(
                    selectedReg.Select(r => r.FullPath).ToList());
                var regRec = await AppServices.Instance.ExecuteWithGateAsync(this.XamlRoot, regProposal, "Registry Cleanup Notice", "Cleaning selected registry traces...", "Registry Cleaned");
                modified |= regRec != null;
            }

            if (modified)
            {
                OnScanLeftoversClick(sender, e);
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Leftover Cleanup Error", ex.Message);
        }
    }

    private async void OnRefreshAppsClick(object sender, RoutedEventArgs e)
    {
        await LoadAppsAsync(force: true);
    }

    public void ShowSegment(string segment)
    {
        SubViewInstalledApps.Visibility = Visibility.Collapsed;
        SubViewBloatware.Visibility = Visibility.Collapsed;
        SubViewEssentialTools.Visibility = Visibility.Collapsed;

        TabInstalledAppsBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabStyle"];
        TabBloatwareBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabStyle"];
        TabEssentialToolsBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabStyle"];

        switch (segment.ToLowerInvariant())
        {
            case "bloatware" or "bloat" or "uwp":
                SubViewBloatware.Visibility = Visibility.Visible;
                TabBloatwareBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabActiveStyle"];
                if (_rawAppxPackages.Count == 0) _ = LoadBloatwareAsync();
                break;
            case "essentials" or "tools" or "winget":
                SubViewEssentialTools.Visibility = Visibility.Visible;
                TabEssentialToolsBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabActiveStyle"];
                _ = LoadEssentialToolsAsync();
                break;
            default:
                SubViewInstalledApps.Visibility = Visibility.Visible;
                TabInstalledAppsBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabActiveStyle"];
                break;
        }
    }

    private void OnTabInstalledAppsClick(object sender, RoutedEventArgs e) => ShowSegment("installed");
    private void OnTabBloatwareClick(object sender, RoutedEventArgs e) => ShowSegment("bloatware");
    private void OnTabEssentialToolsClick(object sender, RoutedEventArgs e) => ShowSegment("essentials");

    public async Task LoadBloatwareAsync()
    {
        var nextCts = new System.Threading.CancellationTokenSource();
        var prevCts = System.Threading.Interlocked.Exchange(ref _bloatLoadCts, nextCts);
        prevCts?.Cancel();
        prevCts?.Dispose();
        var ct = nextCts.Token;

        AppServices.Instance.NotifyStatus("Scanning Microsoft Store (Appx) packages...");
        try
        {
            var packages = await AppServices.Instance.RepairAndDebloatService.InspectAppxPackagesAsync(ct);
            if (ct.IsCancellationRequested) return;
            _rawAppxPackages = packages;
            DispatcherQueue.TryEnqueue(() =>
            {
                if (!ct.IsCancellationRequested) ApplyBloatwareFilter();
            });
            AppServices.Instance.NotifyStatus($"Scanned {packages.Count} Microsoft Store packages.");
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            AppServices.Instance.NotifyStatus($"Appx scan error: {ex.Message}");
        }
    }

    private void ApplyBloatwareFilter()
    {
        BloatwareRows.Clear();
        var query = BloatSearchBox?.Text?.Trim() ?? string.Empty;
        var filtered = _rawAppxPackages.Where(p =>
        {
            var matchesMode = _bloatFilter switch
            {
                "bloat" => p.IsSuggestedBloat,
                "removable" => !p.IsProtectedSystemPackage,
                _ => true
            };
            if (!matchesMode) return false;
            if (string.IsNullOrEmpty(query)) return true;
            return p.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                   p.PlainDescription.Contains(query, StringComparison.OrdinalIgnoreCase);
        });

        foreach (var p in filtered)
        {
            BloatwareRows.Add(new AppxPackageRowViewModel
            {
                Name = p.Name,
                PackageFullName = p.PackageFullName,
                Publisher = p.Publisher,
                Version = p.Version,
                Classification = p.Classification,
                PlainDescription = p.PlainDescription,
                IsProtectedSystemPackage = p.IsProtectedSystemPackage,
                IsSuggestedBloat = p.IsSuggestedBloat,
                IsSelected = p.IsSuggestedBloat && !p.IsProtectedSystemPackage
            });
        }

        var suggestedCount = _rawAppxPackages.Count(p => p.IsSuggestedBloat);
        BloatwareSummaryText.Text = $"{suggestedCount} recognized preinstalled bloatware app(s) found ({_rawAppxPackages.Count} total Store packages scanned). Core Windows Store components stay locked.";
        BloatEmptyBanner.Visibility = BloatwareRows.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnSelectBloatwareClick(object sender, RoutedEventArgs e)
    {
        var refreshed = BloatwareRows.Select(r => new AppxPackageRowViewModel
        {
            Name = r.Name,
            PackageFullName = r.PackageFullName,
            Publisher = r.Publisher,
            Version = r.Version,
            Classification = r.Classification,
            PlainDescription = r.PlainDescription,
            IsProtectedSystemPackage = r.IsProtectedSystemPackage,
            IsSuggestedBloat = r.IsSuggestedBloat,
            IsSelected = r.IsSuggestedBloat && r.CanRemove
        }).ToList();

        BloatwareRows.Clear();
        foreach (var r in refreshed) BloatwareRows.Add(r);
    }

    private async void OnRemoveSelectedAppxClick(object sender, RoutedEventArgs e)
    {
        var selectedNames = BloatwareRows.Where(r => r.IsSelected && r.CanRemove).Select(r => r.PackageFullName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var selectedPkgs = _rawAppxPackages.Where(p => selectedNames.Contains(p.PackageFullName)).ToList();
        if (selectedPkgs.Count == 0)
        {
            await AppServices.Instance.ShowDialogAsync("Nothing Selected", "Check one or more removable Store apps first.");
            return;
        }

        try
        {
            var proposal = AppServices.Instance.RepairAndDebloatService.ProposeRemoveAppxPackagesBatch(selectedPkgs);
            var record = await AppServices.Instance.ExecuteWithGateAsync(this.XamlRoot, proposal, "Protected Package Notice", $"Removing {selectedPkgs.Count} Store package(s)...", "Store Cleanup");
            if (record != null)
            {
                await LoadBloatwareAsync();
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Batch Remove Error", ex.Message);
        }
    }

    private void OnBloatFilterClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string mode) return;
        _bloatFilter = mode;
        BloatFilterSuggestedBtn.Style = (Style)Application.Current.Resources[mode == "bloat" ? "GwPrimaryButtonStyle" : "GwSecondaryButtonStyle"];
        BloatFilterRemovableBtn.Style = (Style)Application.Current.Resources[mode == "removable" ? "GwPrimaryButtonStyle" : "GwSecondaryButtonStyle"];
        BloatFilterAllBtn.Style = (Style)Application.Current.Resources[mode == "all" ? "GwPrimaryButtonStyle" : "GwSecondaryButtonStyle"];
        ApplyBloatwareFilter();
    }

    private void OnBloatSearchChanged(object sender, TextChangedEventArgs e) => ApplyBloatwareFilter();

    private async void OnRefreshBloatwareClick(object sender, RoutedEventArgs e) => await LoadBloatwareAsync();

    private async void OnRemoveAppxClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string fullName) return;
        var pkg = _rawAppxPackages.FirstOrDefault(p => string.Equals(p.PackageFullName, fullName, StringComparison.OrdinalIgnoreCase));
        if (pkg is null) return;

        try
        {
            var proposal = AppServices.Instance.RepairAndDebloatService.ProposeRemoveAppxPackage(pkg.PackageFullName, pkg.Name);
            var record = await AppServices.Instance.ExecuteWithGateAsync(this.XamlRoot, proposal, "Protected System Package", $"Removing {pkg.Name}...", "Store Package");
            if (record != null)
            {
                await LoadBloatwareAsync();
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Remove Store App Error", ex.Message);
        }
    }

    public async Task LoadEssentialToolsAsync()
    {
        var nextCts = new System.Threading.CancellationTokenSource();
        var prevCts = System.Threading.Interlocked.Exchange(ref _toolsLoadCts, nextCts);
        prevCts?.Cancel();
        prevCts?.Dispose();
        var ct = nextCts.Token;

        try
        {
            await Task.Run(() =>
            {
                ct.ThrowIfCancellationRequested();
                var tools = AppServices.Instance.RepairAndDebloatService.InspectEssentialTools();
                DispatcherQueue.TryEnqueue(() =>
                {
                    if (ct.IsCancellationRequested) return;
                    EssentialToolsRows.Clear();
                    foreach (var t in tools)
                    {
                        EssentialToolsRows.Add(new EssentialToolRowViewModel
                        {
                            WingetId = t.WingetId,
                            DisplayName = t.DisplayName,
                            Category = t.Category,
                            Description = t.Description,
                            IsDetectedInstalled = t.IsDetectedInstalled,
                            IsSelected = !t.IsDetectedInstalled,
                            InstalledVersionDisplay = t.InstalledVersionDisplay
                        });
                    }
                });
            }, ct);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private void OnSelectMissingToolsClick(object sender, RoutedEventArgs e)
    {
        var refreshed = EssentialToolsRows.Select(r => new EssentialToolRowViewModel
        {
            WingetId = r.WingetId,
            DisplayName = r.DisplayName,
            Category = r.Category,
            Description = r.Description,
            IsDetectedInstalled = r.IsDetectedInstalled,
            IsSelected = !r.IsDetectedInstalled,
            InstalledVersionDisplay = r.InstalledVersionDisplay
        }).ToList();

        EssentialToolsRows.Clear();
        foreach (var r in refreshed) EssentialToolsRows.Add(r);
    }

    private async void OnInstallSelectedToolsClick(object sender, RoutedEventArgs e)
    {
        var selectedIds = EssentialToolsRows.Where(r => r.IsSelected).Select(r => r.WingetId).ToList();
        if (selectedIds.Count == 0)
        {
            await AppServices.Instance.ShowDialogAsync("Nothing Selected", "Check one or more tools to install via winget.");
            return;
        }

        try
        {
            var proposal = AppServices.Instance.RepairAndDebloatService.ProposeInstallEssentialToolsBatch(selectedIds);
            var record = await AppServices.Instance.ExecuteWithGateAsync(this.XamlRoot, proposal, "Batch Setup Notice", $"Installing {selectedIds.Count} package(s) via winget...", "Batch Setup Complete");
            if (record != null)
            {
                await LoadEssentialToolsAsync();
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Batch Install Error", ex.Message);
        }
    }

    private async void OnRefreshEssentialToolsClick(object sender, RoutedEventArgs e) => await LoadEssentialToolsAsync();

    private async void OnInstallEssentialToolClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string wingetId) return;
        try
        {
            var proposal = AppServices.Instance.RepairAndDebloatService.ProposeInstallEssentialTool(wingetId);
            var record = await AppServices.Instance.ExecuteWithGateAsync(this.XamlRoot, proposal, "Install Notice", $"Installing {wingetId} via winget...", "Package Setup");
            if (record != null)
            {
                await LoadEssentialToolsAsync();
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Install Error", ex.Message);
        }
    }
}
