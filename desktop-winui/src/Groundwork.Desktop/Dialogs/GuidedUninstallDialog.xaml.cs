using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Desktop.Services;
using Groundwork.Engine.Models;
using Groundwork.Engine.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace Groundwork.Desktop.Dialogs;

public sealed class UninstallTraceRowViewModel : INotifyPropertyChanged
{
    private bool _isSelected;

    public string Title { get; set; } = string.Empty;
    public string TargetPath { get; set; } = string.Empty;
    public string Evidence { get; set; } = string.Empty;
    public string KindBadge { get; set; } = string.Empty;
    public string SizeOrScopeText { get; set; } = string.Empty;
    public bool IsHighConfidence { get; set; }
    public bool RequiresAdmin { get; set; }
    public bool IsRegistry { get; set; }

    public bool IsSelected
    {
        get => _isSelected;
        set
        {
            if (_isSelected != value)
            {
                _isSelected = value;
                OnPropertyChanged();
            }
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}

public sealed partial class GuidedUninstallDialog : ContentDialog
{
    private enum WizardStage { Confirm, Monitoring, ScanMode, Scanning, Registry, Files, Complete }

    private readonly InstalledApplicationInfo _app;
    private readonly CancellationTokenSource _monitorCts = new();
    private readonly ManualResetEventSlim _manualContinueSignal = new(false);

    private WizardStage _stage = WizardStage.Confirm;
    private LeftoverScanDepth _selectedDepth = LeftoverScanDepth.Moderate;
    private AppLeftoverReport? _lastReport;

    private int _registryDeletedCount;
    private int _filesRecycledCount;
    private long _reclaimedBytes;
    private readonly List<string> _summaryNotes = new();

    public ObservableCollection<UninstallTraceRowViewModel> RegistryItems { get; } = new();
    public ObservableCollection<UninstallTraceRowViewModel> FileItems { get; } = new();
    public bool DidModifySystem { get; private set; }

    public GuidedUninstallDialog(InstalledApplicationInfo app)
    {
        _app = app;
        this.InitializeComponent();

        RegistryTraceListView.ItemsSource = RegistryItems;
        FilesTraceListView.ItemsSource = FileItems;

        ConfirmAppNameText.Text = app.Name;
        ConfirmUninstallCmdText.Text = !string.IsNullOrWhiteSpace(app.UninstallString)
            ? $"Command: {app.UninstallString}"
            : "No built-in uninstaller command registered — select 'Skip built-in uninstaller' to scan leftovers directly.";
        AppMetaText.Text = $"{(!string.IsNullOrWhiteSpace(app.Publisher) ? app.Publisher : "Third-Party")} • v{app.Version}" +
                             (!string.IsNullOrWhiteSpace(app.InstallLocation) ? $" • {app.InstallLocation}" : string.Empty);

        if (!app.CanUninstall || string.IsNullOrWhiteSpace(app.UninstallString))
        {
            SkipBuiltInCheckBox.IsChecked = true;
        }

        UpdateStageChrome(WizardStage.Confirm);
    }

    private void UpdateStageChrome(WizardStage stage)
    {
        _stage = stage;
        StageConfirmPanel.Visibility = Visibility.Collapsed;
        StageProgressPanel.Visibility = Visibility.Collapsed;
        StageScanModePanel.Visibility = Visibility.Collapsed;
        StageRegistryPanel.Visibility = Visibility.Collapsed;
        StageFilesPanel.Visibility = Visibility.Collapsed;
        StageDonePanel.Visibility = Visibility.Collapsed;
        SecondaryActionBtn.Visibility = Visibility.Collapsed;
        CancelActionBtn.Visibility = Visibility.Visible;
        PrimaryActionBtn.IsEnabled = true;

        int activeStep = stage switch
        {
            WizardStage.Confirm or WizardStage.Monitoring => 1,
            WizardStage.ScanMode or WizardStage.Scanning => 2,
            WizardStage.Registry => 3,
            WizardStage.Files => 4,
            WizardStage.Complete => 5,
            _ => 1
        };
        HeaderModeBadge.Text = $"Step {activeStep} of 5";

        var stepBadges = new[]
        {
            (StepBadge1, StepText1),
            (StepBadge2, StepText2),
            (StepBadge3, StepText3),
            (StepBadge4, StepText4),
            (StepBadge5, StepText5)
        };

        var accentBg = (Brush)Application.Current.Resources["GwAccentBgBrush"];
        var accentFg = (Brush)Application.Current.Resources["GwAccentBrush"];
        var greenBg = (Brush)Application.Current.Resources["GwSignalGreenBgBrush"];
        var greenFg = (Brush)Application.Current.Resources["GwSignalGreenBrush"];
        var subtleBg = (Brush)Application.Current.Resources["GwSubtleSurfaceBrush"];
        var borderDefault = (Brush)Application.Current.Resources["GwCardBorderBrush"];
        var mutedFg = (Brush)Application.Current.Resources["GwTextMutedBrush"];

        for (int i = 0; i < stepBadges.Length; i++)
        {
            int stepNum = i + 1;
            var (badge, label) = stepBadges[i];
            if (stepNum < activeStep)
            {
                badge.Background = greenBg;
                badge.BorderBrush = borderDefault;
                label.Foreground = greenFg;
                label.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
            }
            else if (stepNum == activeStep)
            {
                badge.Background = accentBg;
                badge.BorderBrush = accentFg;
                label.Foreground = accentFg;
                label.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
            }
            else
            {
                badge.Background = subtleBg;
                badge.BorderBrush = borderDefault;
                label.Foreground = mutedFg;
                label.FontWeight = Microsoft.UI.Text.FontWeights.Medium;
            }
        }

        switch (stage)
        {
            case WizardStage.Confirm:
                StageConfirmPanel.Visibility = Visibility.Visible;
                PrimaryActionBtn.Content = SkipBuiltInCheckBox.IsChecked == true ? "Choose Scan Mode →" : "Start Uninstaller →";
                CancelActionBtn.Content = "Cancel";
                FooterHintText.Text = "Runs the official app uninstaller first, before scanning leftovers.";
                break;

            case WizardStage.Monitoring:
                StageProgressPanel.Visibility = Visibility.Visible;
                PrimaryActionBtn.Content = "Uninstaller Finished →";
                CancelActionBtn.Content = "Cancel";
                FooterHintText.Text = "Waiting for official uninstaller process to exit (or click Continue once setup closes).";
                break;

            case WizardStage.ScanMode:
                StageScanModePanel.Visibility = Visibility.Visible;
                PrimaryActionBtn.Content = $"Scan ({_selectedDepth}) →";
                SecondaryActionBtn.Visibility = Visibility.Visible;
                SecondaryActionBtn.Content = "Exit Without Scan";
                CancelActionBtn.Visibility = Visibility.Collapsed;
                FooterHintText.Text = "Choose Safe, Moderate, or Advanced (Deep Sweep) for post-uninstall leftover detection.";
                break;

            case WizardStage.Scanning:
                StageProgressPanel.Visibility = Visibility.Visible;
                PrimaryActionBtn.IsEnabled = false;
                PrimaryActionBtn.Content = "Working...";
                CancelActionBtn.Content = "Cancel";
                break;

            case WizardStage.Registry:
                StageRegistryPanel.Visibility = Visibility.Visible;
                SecondaryActionBtn.Visibility = Visibility.Visible;
                SecondaryActionBtn.Content = FileItems.Count > 0 ? "Skip Registry →" : "Skip Cleanup";
                PrimaryActionBtn.Content = FileItems.Count > 0 ? "Delete Selected & Next →" : "Delete Selected & Finish";
                CancelActionBtn.Content = "Cancel";
                FooterHintText.Text = $"Found {RegistryItems.Count} registry trace(s) in {_selectedDepth} mode.";
                break;

            case WizardStage.Files:
                StageFilesPanel.Visibility = Visibility.Visible;
                SecondaryActionBtn.Visibility = Visibility.Visible;
                SecondaryActionBtn.Content = "Skip Files";
                PrimaryActionBtn.Content = "Recycle Selected & Finish";
                CancelActionBtn.Content = "Cancel";
                FooterHintText.Text = $"Found {FileItems.Count} file/folder trace(s) • {ByteFormatter.FormatBytes(_lastReport?.TotalReclaimableBytes ?? 0)} reclaimable.";
                break;

            case WizardStage.Complete:
                StageDonePanel.Visibility = Visibility.Visible;
                CancelActionBtn.Visibility = Visibility.Collapsed;
                SecondaryActionBtn.Visibility = Visibility.Collapsed;
                PrimaryActionBtn.Content = "Done";
                FooterHintText.Text = "Uninstall workflow complete.";
                break;
        }
    }

    private void OnScanModeSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ScanModeRadioGroup?.SelectedItem is RadioButton rb && rb.Tag is string tag &&
            Enum.TryParse<LeftoverScanDepth>(tag, out var parsed))
        {
            _selectedDepth = parsed;
            if (_stage == WizardStage.ScanMode)
            {
                PrimaryActionBtn.Content = $"Scan ({_selectedDepth}) →";
            }
        }
    }

    private async void OnPrimaryActionClick(object sender, RoutedEventArgs e)
    {
        switch (_stage)
        {
            case WizardStage.Confirm:
                if (SkipBuiltInCheckBox.IsChecked == true)
                {
                    UpdateStageChrome(WizardStage.ScanMode);
                }
                else
                {
                    await RunOfficialUninstallerAsync();
                }
                break;

            case WizardStage.Monitoring:
                _manualContinueSignal.Set();
                break;

            case WizardStage.ScanMode:
                await ExecuteLeftoverScanAsync();
                break;

            case WizardStage.Registry:
                await ExecuteSelectedRegistryCleanupAsync();
                break;

            case WizardStage.Files:
                await ExecuteSelectedFileCleanupAsync();
                break;

            case WizardStage.Complete:
                this.Hide();
                break;
        }
    }

    private void OnSecondaryActionClick(object sender, RoutedEventArgs e)
    {
        switch (_stage)
        {
            case WizardStage.ScanMode:
                this.Hide();
                break;

            case WizardStage.Registry:
                _summaryNotes.Add("Registry traces skipped by user.");
                if (FileItems.Count > 0)
                {
                    UpdateStageChrome(WizardStage.Files);
                }
                else
                {
                    ShowCompleteSummary();
                }
                break;

            case WizardStage.Files:
                _summaryNotes.Add("File/folder leftovers skipped by user.");
                ShowCompleteSummary();
                break;
        }
    }

    private void OnCancelActionClick(object sender, RoutedEventArgs e)
    {
        _monitorCts.Cancel();
        _manualContinueSignal.Set();
        this.Hide();
    }

    private async Task RunOfficialUninstallerAsync()
    {
        UpdateStageChrome(WizardStage.Monitoring);
        ProgressTitleText.Text = $"Running official uninstaller for {_app.Name}...";
        ProgressDetailText.Text = "Finish the application's uninstaller window that just opened. Groundwork will automatically advance to Leftover Scanning Modes once it finishes.";

        try
        {
            var sw = Stopwatch.StartNew();
            Process? proc;
            try
            {
                proc = InstalledAppsEngineService.LaunchUninstallerProcess(_app.UninstallString);
            }
            catch (Exception ex)
            {
                _summaryNotes.Add($"Built-in uninstaller could not start ({ex.Message}). Switched to manual leftover scan.");
                UpdateStageChrome(WizardStage.ScanMode);
                return;
            }

            if (proc is not null)
            {
                using (proc)
                {
                    var waitProcTask = proc.WaitForExitAsync(_monitorCts.Token);
                    var manualTask = Task.Run(() => _manualContinueSignal.Wait(_monitorCts.Token));
                    await Task.WhenAny(waitProcTask, manualTask);
                }
            }

            sw.Stop();
            DidModifySystem = true;

            // Fast stub launcher (< 2.5s) where app is still installed -> wait cleanly for user confirmation
            if (!_manualContinueSignal.IsSet && !_monitorCts.IsCancellationRequested && sw.ElapsedMilliseconds < 2500)
            {
                bool stillInstalled = await Task.Run(() =>
                    AppServices.Instance.InstalledAppsEngine.EnumerateInstalledApps()
                        .Any(a => string.Equals(a.Id, _app.Id, StringComparison.OrdinalIgnoreCase)));

                if (stillInstalled)
                {
                    ProgressTitleText.Text = "Waiting for Setup Uninstaller Window...";
                    ProgressDetailText.Text = "The uninstaller stub opened a separate setup wizard. Finish uninstalling there, then click 'Uninstaller Finished →' below to pick your Scanning Mode.";
                    await Task.Run(() => _manualContinueSignal.Wait(_monitorCts.Token));
                }
            }

            if (_monitorCts.IsCancellationRequested)
            {
                return;
            }

            // Proceed cleanly to Revo-style Step 2: Scanning Mode Selection
            UpdateStageChrome(WizardStage.ScanMode);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private async Task ExecuteLeftoverScanAsync()
    {
        UpdateStageChrome(WizardStage.Scanning);
        ProgressTitleText.Text = $"Scanning in {_selectedDepth} Mode...";
        ProgressDetailText.Text = _selectedDepth == LeftoverScanDepth.Advanced
            ? $"Performing full system sweep (folders, Common Files, Shortcuts, Documents, CrashDumps, Prefetch, Registry Software/App Paths/Uninstall/Services/Run/MuiCache) for {_app.Name}..."
            : $"Scanning standard application folders and registry traces for {_app.Name}...";
        FooterHintText.Text = $"Searching system locations ({_selectedDepth} mode)...";

        var report = await Task.Run(() => AppServices.Instance.InstalledAppsEngine.ScanAppLeftovers(
            appId: _app.Id,
            appName: _app.Name,
            publisher: _app.Publisher,
            installLocation: _app.InstallLocation,
            scanDepth: _selectedDepth,
            uninstallString: _app.UninstallString));

        _lastReport = report;
        RegistryItems.Clear();
        FileItems.Clear();

        bool isElevated = AppServices.Instance.RepairAndDebloatService.IsCurrentSessionElevated;
        foreach (var reg in report.RegistryLeftovers.Where(r => WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(r.KeyPath)))
        {
            bool isHigh = string.Equals(reg.Confidence, "high", StringComparison.OrdinalIgnoreCase);
            bool isHklm = reg.KeyPath.StartsWith(@"HKLM\", StringComparison.OrdinalIgnoreCase);
            RegistryItems.Add(new UninstallTraceRowViewModel
            {
                Title = reg.KeyPath.Split('\\').LastOrDefault() ?? reg.KeyPath,
                TargetPath = reg.KeyPath,
                Evidence = reg.Evidence,
                KindBadge = reg.EntryKind == "RegistryValue" ? $"{reg.LocationGroup} (Value)" : reg.LocationGroup,
                SizeOrScopeText = isHklm ? (isHigh ? "Matched • Admin" : "Review • Admin") : (isHigh ? "Matched" : "Review"),
                IsHighConfidence = isHigh,
                RequiresAdmin = isHklm,
                IsRegistry = true,
                IsSelected = isHigh && (!isHklm || isElevated)
            });
        }

        foreach (var fs in report.FileSystemLeftovers)
        {
            bool isHigh = string.Equals(fs.Confidence, "high", StringComparison.OrdinalIgnoreCase);
            FileItems.Add(new UninstallTraceRowViewModel
            {
                Title = fs.Name,
                TargetPath = fs.FullPath,
                Evidence = fs.Evidence,
                KindBadge = fs.LocationGroup,
                SizeOrScopeText = ByteFormatter.FormatBytes(fs.SizeBytes),
                IsHighConfidence = isHigh,
                RequiresAdmin = false,
                IsRegistry = false,
                IsSelected = isHigh
            });
        }

        if (RegistryItems.Count > 0)
        {
            RegistryHeaderTitle.Text = $"Found {RegistryItems.Count} Registry Leftover(s) ({_selectedDepth} Scan)";
            RegistryHeaderSubtitle.Text = $"Inspected {report.InspectedLocationCount:N0} locations. Pre-checked entries are high-confidence matches; Admin items require Groundwork running as Administrator.";
            UpdateStageChrome(WizardStage.Registry);
        }
        else if (FileItems.Count > 0)
        {
            FilesHeaderTitle.Text = $"Found {FileItems.Count} Leftover File / Folder Trace(s) ({_selectedDepth} Scan)";
            FilesHeaderSubtitle.Text = $"Inspected {report.InspectedLocationCount:N0} locations. Total reclaimable: {ByteFormatter.FormatBytes(report.TotalReclaimableBytes)}.";
            UpdateStageChrome(WizardStage.Files);
        }
        else
        {
            ShowCompleteSummary();
        }
    }

    private async Task ExecuteSelectedRegistryCleanupAsync()
    {
        var selectedKeys = RegistryItems.Where(r => r.IsSelected).Select(r => r.TargetPath).ToList();
        if (selectedKeys.Count > 0)
        {
            var proposal = AppServices.Instance.RepairAndDebloatService.ProposeCleanLeftoverRegistryKeys(selectedKeys);
            if (!proposal.PrerequisitesMet)
            {
                FooterHintText.Text = proposal.PrerequisiteFailureReason;
                RegistryHeaderSubtitle.Text = $"Blocked: {proposal.PrerequisiteFailureReason}";
                return;
            }

            UpdateStageChrome(WizardStage.Scanning);
            ProgressTitleText.Text = "Deleting selected Registry leftovers...";
            ProgressDetailText.Text = $"Removing {selectedKeys.Count} selected registry key(s)/value(s) via SafeOperationEngine...";
            var record = await Task.Run(() => AppServices.Instance.SafeOperationEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken));
            _registryDeletedCount = selectedKeys.Count;
            _summaryNotes.Add(record.StatusMessage);
            DidModifySystem = true;
            AppServices.Instance.NotifyOperationHistoryChanged();
        }
        else
        {
            _summaryNotes.Add("No registry items selected for deletion.");
        }

        if (FileItems.Count > 0)
        {
            FilesHeaderTitle.Text = $"Found {FileItems.Count} Leftover File / Folder Trace(s) ({_selectedDepth} Scan)";
            FilesHeaderSubtitle.Text = $"Total reclaimable: {ByteFormatter.FormatBytes(_lastReport?.TotalReclaimableBytes ?? 0)}. Checked items move to the Recycle Bin.";
            UpdateStageChrome(WizardStage.Files);
        }
        else
        {
            ShowCompleteSummary();
        }
    }

    private async Task ExecuteSelectedFileCleanupAsync()
    {
        var selectedFiles = FileItems.Where(f => f.IsSelected).ToList();
        if (selectedFiles.Count > 0)
        {
            var fsPaths = selectedFiles.Select(f => f.TargetPath).ToList();
            var roots = InstalledAppsEngineService.GetAllowedCleanupRootsForApp(
                _app.InstallLocation,
                fsPaths.Select(Path.GetDirectoryName).Where(d => !string.IsNullOrEmpty(d))!);

            var proposal = AppServices.Instance.StorageHotspotService.ProposeRecycleItems(fsPaths, roots, $"{_app.Name} Leftovers");
            if (!proposal.PrerequisitesMet)
            {
                FooterHintText.Text = proposal.PrerequisiteFailureReason;
                FilesHeaderSubtitle.Text = $"Blocked: {proposal.PrerequisiteFailureReason}";
                return;
            }

            UpdateStageChrome(WizardStage.Scanning);
            ProgressTitleText.Text = "Recycling leftover files & folders...";
            ProgressDetailText.Text = $"Moving {selectedFiles.Count} item(s) safely to the Windows Recycle Bin...";
            var record = await Task.Run(() => AppServices.Instance.SafeOperationEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken));

            _filesRecycledCount = selectedFiles.Count;
            _reclaimedBytes = selectedFiles.Sum(f =>
                _lastReport?.FileSystemLeftovers.FirstOrDefault(x => x.FullPath.Equals(f.TargetPath, StringComparison.OrdinalIgnoreCase))?.SizeBytes ?? 0);
            _summaryNotes.Add(record.StatusMessage);
            DidModifySystem = true;
            AppServices.Instance.NotifyOperationHistoryChanged();
        }

        ShowCompleteSummary();
    }

    private void ShowCompleteSummary()
    {
        UpdateStageChrome(WizardStage.Complete);

        if ((_lastReport?.RegistryLeftovers.Count ?? 0) == 0 && (_lastReport?.FileSystemLeftovers.Count ?? 0) == 0)
        {
            DoneTitleText.Text = $"{_app.Name} Uninstalled Spotlessly";
            DoneSummaryText.Text = $"Zero leftover registry traces or orphaned folders detected in {_selectedDepth} scan mode ({_lastReport?.InspectedLocationCount ?? 0:N0} locations checked).";
        }
        else
        {
            DoneTitleText.Text = $"{_app.Name} Cleanup Finished";
            var details = new List<string>
            {
                $"Scan Mode: {_selectedDepth}",
                $"Registry Traces Cleaned: {_registryDeletedCount}",
                $"Files/Folders Recycled: {_filesRecycledCount} ({ByteFormatter.FormatBytes(_reclaimedBytes)})"
            };
            if (_summaryNotes.Count > 0)
            {
                details.Add(string.Join(" • ", _summaryNotes));
            }
            DoneSummaryText.Text = string.Join("\n", details);
        }
    }

    // Selection helpers
    private void OnRegSelectAllClick(object sender, RoutedEventArgs e)
    {
        bool isElevated = AppServices.Instance.RepairAndDebloatService.IsCurrentSessionElevated;
        foreach (var item in RegistryItems) item.IsSelected = !item.RequiresAdmin || isElevated;
    }

    private void OnRegSelectSafeClick(object sender, RoutedEventArgs e)
    {
        bool isElevated = AppServices.Instance.RepairAndDebloatService.IsCurrentSessionElevated;
        foreach (var item in RegistryItems) item.IsSelected = item.IsHighConfidence && (!item.RequiresAdmin || isElevated);
    }

    private void OnRegUnselectAllClick(object sender, RoutedEventArgs e)
    {
        foreach (var item in RegistryItems) item.IsSelected = false;
    }

    private void OnFilesSelectAllClick(object sender, RoutedEventArgs e)
    {
        foreach (var item in FileItems) item.IsSelected = true;
    }

    private void OnFilesSelectSafeClick(object sender, RoutedEventArgs e)
    {
        foreach (var item in FileItems) item.IsSelected = item.IsHighConfidence;
    }

    private void OnFilesUnselectAllClick(object sender, RoutedEventArgs e)
    {
        foreach (var item in FileItems) item.IsSelected = false;
    }

    private void OnOpenTracePathClick(object sender, RoutedEventArgs e)
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
}
