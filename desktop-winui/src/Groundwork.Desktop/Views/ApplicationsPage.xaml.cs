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
    private InstalledAppRowViewModel? _selectedApp;

    public ObservableCollection<InstalledAppRowViewModel> FilteredApps { get; } = new();
    public ObservableCollection<LeftoverItemRowViewModel> Leftovers { get; } = new();

    public ApplicationsPage()
    {
        this.InitializeComponent();
        this.NavigationCacheMode = NavigationCacheMode.Required;

        InstalledAppsListView.ItemsSource = FilteredApps;
        LeftoversListView.ItemsSource = Leftovers;
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
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

        foreach (var app in matches.OrderBy(a => a.Name))
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
                RawModel = app
            });
        }
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
        if (_selectedApp == null || string.IsNullOrEmpty(_selectedApp.UninstallString))
        {
            await AppServices.Instance.ShowDialogAsync("Cannot Uninstall", "No registered uninstall string available for this application.");
            return;
        }

        bool confirm = await AppServices.Instance.ShowConfirmDialogAsync(
            "Launch Uninstallation",
            $"Launch native uninstaller for {_selectedApp.Name}?",
            "Launch",
            "Cancel");

        if (!confirm) return;

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c {_selectedApp.UninstallString}",
                UseShellExecute = true
            });
            AppServices.Instance.NotifyStatus($"Launched uninstallation for {_selectedApp.Name}.");
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Launch Error", ex.Message);
        }
    }

    private async void OnScanLeftoversClick(object sender, RoutedEventArgs e)
    {
        if (_selectedApp == null) return;
        AppServices.Instance.NotifyStatus($"Scanning leftover traces for {_selectedApp.Name}...");

        try
        {
            Leftovers.Clear();
            var raw = _selectedApp.RawModel;
            if (raw != null)
            {
                var report = await Task.Run(() => AppServices.Instance.InstalledAppsEngine.ScanAppLeftovers(
                    raw.Id,
                    raw.Name,
                    raw.Publisher,
                    raw.InstallLocation));

                foreach (var t in report.FileSystemLeftovers)
                {
                    Leftovers.Add(new LeftoverItemRowViewModel
                    {
                        Name = t.Name,
                        FullPath = t.FullPath,
                        FormattedSize = ByteFormatter.FormatBytes(t.SizeBytes),
                        Confidence = t.Confidence
                    });
                }
            }
            AppServices.Instance.NotifyStatus($"Discovered {Leftovers.Count} potential leftover traces.");
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Leftover Scan Error", ex.Message);
        }
    }

    private async void OnRefreshAppsClick(object sender, RoutedEventArgs e)
    {
        await LoadAppsAsync(force: true);
    }
}
