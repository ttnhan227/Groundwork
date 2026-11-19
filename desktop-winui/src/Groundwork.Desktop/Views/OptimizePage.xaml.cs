using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using Groundwork.Desktop.Services;
using Groundwork.Engine.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;

namespace Groundwork.Desktop.Views;

public sealed partial class OptimizePage : Page
{
    private bool _isUpdatingUi;
    private int _suppressGeneration;
    private PowerManagementSnapshot? _powerSnapshot;
    private bool _hibernationEnabled;
    private IReadOnlyList<StartupItemEntry> _allStartupItems = Array.Empty<StartupItemEntry>();
    private IReadOnlyList<WindowsConfigurableSetting> _allSettings = Array.Empty<WindowsConfigurableSetting>();
    private string _startupFilter = "all";
    private string _tweakFilter = "all";

    public ObservableCollection<StartupItemRowViewModel> StartupItems { get; } = new();
    public ObservableCollection<ConfigurableSettingRowViewModel> ConfigurableSettings { get; } = new();

    public OptimizePage()
    {
        this.InitializeComponent();
        this.NavigationCacheMode = NavigationCacheMode.Required;

        StartupAppsListView.ItemsSource = StartupItems;
        SettingsListView.ItemsSource = ConfigurableSettings;
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        if (e.Parameter is string targetSegment && !string.IsNullOrEmpty(targetSegment))
        {
            ShowSegment(targetSegment);
        }
        await LoadOptimizeStateAsync();
    }

    private void SuppressTogglesUntilIdle()
    {
        _isUpdatingUi = true;
        int gen = ++_suppressGeneration;
        DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () =>
        {
            if (gen == _suppressGeneration)
            {
                _isUpdatingUi = false;
            }
        });
    }

    public void ShowSegment(string segment)
    {
        SuppressTogglesUntilIdle();
        SubViewStartup.Visibility = Visibility.Collapsed;
        SubViewPower.Visibility = Visibility.Collapsed;
        SubViewSettings.Visibility = Visibility.Collapsed;

        TabStartupBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabStyle"];
        TabPowerBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabStyle"];
        TabSettingsBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabStyle"];

        switch (segment.ToLowerInvariant())
        {
            case "power" or "powerplans":
                SubViewPower.Visibility = Visibility.Visible;
                TabPowerBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabActiveStyle"];
                break;
            case "settings" or "windowssettings" or "tuning":
                SubViewSettings.Visibility = Visibility.Visible;
                TabSettingsBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabActiveStyle"];
                break;
            default:
                SubViewStartup.Visibility = Visibility.Visible;
                TabStartupBtn.Style = (Style)Application.Current.Resources["GwUnderlineTabActiveStyle"];
                break;
        }
    }

    public async Task LoadOptimizeStateAsync()
    {
        SuppressTogglesUntilIdle();
        var (startup, power, settings, hiber) = await Task.Run(() =>
        {
            var s = AppServices.Instance.OptimizationService.InspectStartupItems();
            var p = AppServices.Instance.OptimizationService.InspectPowerPlans();
            var cfg = AppServices.Instance.OptimizationService.InspectConfigurableSettings();
            var hib = AppServices.Instance.OptimizationService.InspectHibernationStatus();
            return (s, p, cfg, hib);
        });

        SuppressTogglesUntilIdle();
        _allStartupItems = startup;
        ApplyStartupFilter();

        // 2. Power Schemes & Hibernation
        _powerSnapshot = power;
        UpdatePowerCards(power);
        _hibernationEnabled = hiber.IsEnabled;
        if (hiber.IsEnabled)
        {
            string sizeNote = hiber.HiberfileBytes > 0 ? $" ({ByteFormatter.FormatBytes(hiber.HiberfileBytes)} used by C:\\hiberfil.sys)" : string.Empty;
            HibernateStatusText.Text = $"Enabled{sizeNote}. Disabling frees SSD space immediately on desktops.";
            BtnToggleHibernation.Content = "Disable Hibernation";
        }
        else
        {
            HibernateStatusText.Text = "Disabled (hiberfil.sys removed, SSD space freed).";
            BtnToggleHibernation.Content = "Enable Hibernation";
        }

        // 3. Configurable Settings
        _allSettings = settings;
        ApplyTweakFilter();
        SuppressTogglesUntilIdle();
    }

    private void ApplyStartupFilter()
    {
        bool prev = _isUpdatingUi;
        _isUpdatingUi = true;
        try
        {
            StartupItems.Clear();
            string query = StartupSearchBox?.Text?.Trim() ?? string.Empty;
            var filtered = _allStartupItems.Where(item =>
            {
                bool matchesMode = _startupFilter switch
                {
                    "enabled" => item.IsEnabled,
                    "high" => item.ImpactAssessment.Contains("High", StringComparison.OrdinalIgnoreCase),
                    "missing" => !item.TargetExists,
                    _ => true
                };
                if (!matchesMode) return false;
                if (string.IsNullOrEmpty(query)) return true;
                return item.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                       item.Publisher.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                       item.CommandOrTarget.Contains(query, StringComparison.OrdinalIgnoreCase);
            });

            foreach (var item in filtered)
            {
                StartupItems.Add(new StartupItemRowViewModel
                {
                    EntryId = item.EntryId,
                    Name = item.Name,
                    Publisher = !string.IsNullOrEmpty(item.Publisher) ? item.Publisher : "Verified Windows / Third-Party Program",
                    CommandOrTarget = item.CommandOrTarget,
                    ScopeDisplay = item.ScopeDisplay,
                    IsEnabled = item.IsEnabled,
                    ImpactAssessment = item.TargetExists
                        ? (item.ImpactAssessment.EndsWith("Impact", StringComparison.OrdinalIgnoreCase)
                            ? item.ImpactAssessment
                            : $"{item.ImpactAssessment} Impact")
                        : "Missing Target",
                    CanModify = true
                });
            }

            int enabledCount = _allStartupItems.Count(i => i.IsEnabled);
            int missingCount = _allStartupItems.Count(i => !i.TargetExists);
            StartupAppsSummaryText.Text = $"{enabledCount} enabled at startup ({_allStartupItems.Count} total" +
                                          (missingCount > 0 ? $", {missingCount} broken/missing)" : ")");
        }
        finally
        {
            SuppressTogglesUntilIdle();
        }
    }

    private void OnStartupFilterClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string mode) return;
        _startupFilter = mode;
        FilterAllBtn.Style = (Style)Application.Current.Resources[mode == "all" ? "GwPrimaryButtonStyle" : "GwSecondaryButtonStyle"];
        FilterEnabledBtn.Style = (Style)Application.Current.Resources[mode == "enabled" ? "GwPrimaryButtonStyle" : "GwSecondaryButtonStyle"];
        FilterHighBtn.Style = (Style)Application.Current.Resources[mode == "high" ? "GwPrimaryButtonStyle" : "GwSecondaryButtonStyle"];
        FilterMissingBtn.Style = (Style)Application.Current.Resources[mode == "missing" ? "GwPrimaryButtonStyle" : "GwSecondaryButtonStyle"];
        ApplyStartupFilter();
    }

    private void OnStartupSearchChanged(object sender, TextChangedEventArgs e)
    {
        ApplyStartupFilter();
    }

    private void OnOpenStartupLocationClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string cmd || string.IsNullOrWhiteSpace(cmd)) return;
        try
        {
            var exe = Groundwork.Engine.Services.WindowsOptimizationService.ExtractExecutablePathFromCommand(cmd);
            if (!string.IsNullOrWhiteSpace(exe) && System.IO.File.Exists(exe))
            {
                System.Diagnostics.Process.Start("explorer.exe", $"/select,\"{exe}\"");
            }
            else
            {
                _ = AppServices.Instance.ShowDialogAsync("Missing Target", $"Executable no longer exists on disk:\n{cmd}\n\nYou can safely disable this orphaned startup entry.");
            }
        }
        catch { }
    }

    private void UpdatePowerCards(PowerManagementSnapshot power)
    {
        string activeGuid = power.ActiveSchemeGuid ?? string.Empty;

        // Reset all buttons to default
        BtnActivateBalanced.Content = "Set Active";
        BtnActivateBalanced.IsEnabled = true;
        BtnActivateHighPerf.Content = "Set Active";
        BtnActivateHighPerf.IsEnabled = true;
        BtnActivatePowerSaver.Content = "Set Active";
        BtnActivatePowerSaver.IsEnabled = true;

        var brushAccent = (Brush)Application.Current.Resources["GwAccentBrush"];
        var brushNormal = (Brush)Application.Current.Resources["GwCardBorderBrush"];

        CardBalanced.BorderBrush = brushNormal;
        CardHighPerf.BorderBrush = brushNormal;
        CardPowerSaver.BorderBrush = brushNormal;

        // Balanced GUID
        if (activeGuid.StartsWith("381b4222", StringComparison.OrdinalIgnoreCase))
        {
            CardBalanced.BorderBrush = brushAccent;
            BtnActivateBalanced.Content = "✓ Active Plan";
            BtnActivateBalanced.IsEnabled = false;
        }
        else if (activeGuid.StartsWith("8c5e7fda", StringComparison.OrdinalIgnoreCase))
        {
            CardHighPerf.BorderBrush = brushAccent;
            BtnActivateHighPerf.Content = "✓ Active Plan";
            BtnActivateHighPerf.IsEnabled = false;
        }
        else if (activeGuid.StartsWith("a1841308", StringComparison.OrdinalIgnoreCase))
        {
            CardPowerSaver.BorderBrush = brushAccent;
            BtnActivatePowerSaver.Content = "✓ Active Plan";
            BtnActivatePowerSaver.IsEnabled = false;
        }

        var ultimate = power.Plans.FirstOrDefault(p => p.Name.Contains("Ultimate Performance", StringComparison.OrdinalIgnoreCase));
        CardUltimatePerf.BorderBrush = ultimate?.IsActive == true ? brushAccent : brushNormal;
        if (ultimate?.IsActive == true)
        {
            BtnUnlockUltimatePerf.Content = "✓ Active Plan";
            BtnUnlockUltimatePerf.IsEnabled = false;
            UltimateStatusText.Text = $"Ultimate Performance ({ultimate.SchemeGuid}) is currently active.";
        }
        else if (ultimate is not null)
        {
            BtnUnlockUltimatePerf.Content = "Set Active";
            BtnUnlockUltimatePerf.IsEnabled = true;
            UltimateStatusText.Text = $"Ultimate Performance ({ultimate.SchemeGuid}) is unlocked on this PC.";
        }
        else
        {
            BtnUnlockUltimatePerf.Content = "Unlock & Activate";
            BtnUnlockUltimatePerf.IsEnabled = true;
            UltimateStatusText.Text = "Unhides Windows' built-in Ultimate Performance scheme to minimize micro-latency on desktops.";
        }
    }

    private void ApplyTweakFilter()
    {
        bool prev = _isUpdatingUi;
        _isUpdatingUi = true;
        try
        {
            ConfigurableSettings.Clear();
            var filtered = _allSettings.Where(s => _tweakFilter switch
            {
                "ui" => s.Category.Contains("UI", StringComparison.OrdinalIgnoreCase),
                "debloat" => s.Category.Contains("Debloat", StringComparison.OrdinalIgnoreCase),
                "perf" => s.Category.Contains("Gaming", StringComparison.OrdinalIgnoreCase) || s.Category.Contains("Performance", StringComparison.OrdinalIgnoreCase),
                _ => true
            });

            foreach (var s in filtered)
            {
                ConfigurableSettings.Add(new ConfigurableSettingRowViewModel
                {
                    SettingId = s.SettingId,
                    DisplayName = s.DisplayName,
                    Category = s.Category,
                    CurrentStateDisplay = s.CurrentStateDisplay,
                    IsEnabled = s.IsEnabled,
                    Explanation = s.Explanation,
                    RecommendationNote = s.RecommendationNote,
                    CanToggle = true
                });
            }
        }
        finally
        {
            SuppressTogglesUntilIdle();
        }
    }

    private void OnTweakCategoryFilterClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button btn || btn.Tag is not string mode) return;
        _tweakFilter = mode;
        TweakFilterAllBtn.Style = (Style)Application.Current.Resources[mode == "all" ? "GwPrimaryButtonStyle" : "GwSecondaryButtonStyle"];
        TweakFilterUiBtn.Style = (Style)Application.Current.Resources[mode == "ui" ? "GwPrimaryButtonStyle" : "GwSecondaryButtonStyle"];
        TweakFilterDebloatBtn.Style = (Style)Application.Current.Resources[mode == "debloat" ? "GwPrimaryButtonStyle" : "GwSecondaryButtonStyle"];
        TweakFilterPerfBtn.Style = (Style)Application.Current.Resources[mode == "perf" ? "GwPrimaryButtonStyle" : "GwSecondaryButtonStyle"];
        ApplyTweakFilter();
    }

    private async void OnUnlockUltimatePerfClick(object sender, RoutedEventArgs e)
    {
        try
        {
            var proposal = AppServices.Instance.OptimizationService.ProposeUnlockUltimatePerformancePlan();
            var record = await AppServices.Instance.ExecuteWithGateAsync(this.XamlRoot, proposal, "Power Scheme Note", "Unlocking Ultimate Performance plan...", "Power Plan");
            if (record != null)
            {
                await LoadOptimizeStateAsync();
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Power Scheme Error", ex.Message);
        }
    }

    private async void OnToggleHibernationClick(object sender, RoutedEventArgs e)
    {
        try
        {
            var proposal = AppServices.Instance.OptimizationService.ProposeToggleHibernation(!_hibernationEnabled);
            var record = await AppServices.Instance.ExecuteWithGateAsync(this.XamlRoot, proposal, "Administrator Required", "Updating Windows Hibernation...", "Windows Hibernation");
            if (record != null)
            {
                await LoadOptimizeStateAsync();
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Hibernation Error", ex.Message);
        }
    }

    private async void OnApplyCleanWin11PresetClick(object sender, RoutedEventArgs e)
    {
        await ApplyPresetAsync("Clean Windows 11 & Debloat Preset", Groundwork.Engine.Services.WindowsOptimizationService.CleanWindows11Preset);
    }

    private async void OnApplyGamingPresetClick(object sender, RoutedEventArgs e)
    {
        await ApplyPresetAsync("Gaming & Raw Mouse Preset", Groundwork.Engine.Services.WindowsOptimizationService.GamingLatencyPreset);
    }

    private async Task ApplyPresetAsync(string presetName, System.Collections.Generic.IReadOnlyDictionary<string, bool> desiredStates)
    {
        try
        {
            var proposal = AppServices.Instance.OptimizationService.ProposeApplyTweakPreset(presetName, desiredStates);
            var record = await AppServices.Instance.ExecuteWithGateAsync(this.XamlRoot, proposal, "Preset Notice", $"Applying {presetName}...", presetName);
            if (record != null)
            {
                await LoadOptimizeStateAsync();
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Preset Error", ex.Message);
        }
    }

    private async void OnRestartExplorerClick(object sender, RoutedEventArgs e)
    {
        var ok = await Task.Run(Groundwork.Engine.Services.WindowsOptimizationService.RestartFileExplorer);
        AppServices.Instance.NotifyStatus(ok
            ? "File Explorer restarted — shell/context-menu tweaks applied."
            : "Could not restart File Explorer automatically.");
    }

    private async void OnStartupItemToggled(object sender, RoutedEventArgs e)
    {
        if (_isUpdatingUi) return;
        if (sender is ToggleSwitch ts && ts.IsLoaded && ts.Tag is string entryId)
        {
            bool desiredState = ts.IsOn;
            if (ts.DataContext is StartupItemRowViewModel vm && vm.IsEnabled == desiredState)
            {
                return;
            }
            try
            {
                var proposal = AppServices.Instance.OptimizationService.ProposeToggleStartupItem(entryId, desiredState);
                var result = await Task.Run(() => AppServices.Instance.SafeOperationEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken));
                if (result.Succeeded)
                {
                    if (ts.DataContext is StartupItemRowViewModel itemVm)
                    {
                        itemVm.IsEnabled = desiredState;
                    }
                    AppServices.Instance.NotifyOperationHistoryChanged();
                    AppServices.Instance.NotifyStatus($"Startup application {entryId} updated: {(desiredState ? "Enabled" : "Disabled")}.");
                }
                else
                {
                    _isUpdatingUi = true;
                    ts.IsOn = !desiredState;
                    _isUpdatingUi = false;
                    await AppServices.Instance.ShowDialogAsync("Action Failed", result.StatusMessage ?? "Could not modify startup item.");
                }
            }
            catch (Exception ex)
            {
                _isUpdatingUi = true;
                ts.IsOn = !desiredState;
                _isUpdatingUi = false;
                await AppServices.Instance.ShowDialogAsync("Error", ex.Message);
            }
        }
    }

    private async void OnActivateBalancedClick(object sender, RoutedEventArgs e)
    {
        await SwitchPowerPlanAsync("381b4222-f694-41f0-9685-ff5bb260df2e", "Balanced");
    }

    private async void OnActivateHighPerfClick(object sender, RoutedEventArgs e)
    {
        await SwitchPowerPlanAsync("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", "High Performance");
    }

    private async void OnActivatePowerSaverClick(object sender, RoutedEventArgs e)
    {
        await SwitchPowerPlanAsync("a1841308-3541-4fab-bc81-f71556f20b4a", "Power Saver");
    }

    private async Task SwitchPowerPlanAsync(string guid, string friendlyName)
    {
        try
        {
            var proposal = AppServices.Instance.OptimizationService.ProposeSwitchPowerPlan(guid);
            var result = await Task.Run(() => AppServices.Instance.SafeOperationEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken));
            if (result.Succeeded)
            {
                AppServices.Instance.NotifyOperationHistoryChanged();
                AppServices.Instance.NotifyStatus($"Active power scheme switched to {friendlyName}.");
                await LoadOptimizeStateAsync();
            }
            else
            {
                await AppServices.Instance.ShowDialogAsync("Switch Failed", result.StatusMessage ?? "Power scheme could not be activated.");
            }
        }
        catch (Exception ex)
        {
            await AppServices.Instance.ShowDialogAsync("Power Scheme Error", ex.Message);
        }
    }

    private async void OnConfigurableSettingToggled(object sender, RoutedEventArgs e)
    {
        if (_isUpdatingUi) return;
        if (sender is ToggleSwitch ts && ts.IsLoaded && ts.Tag is string settingId)
        {
            bool desired = ts.IsOn;
            if (ts.DataContext is ConfigurableSettingRowViewModel vm && vm.IsEnabled == desired)
            {
                return;
            }
            try
            {
                var proposal = AppServices.Instance.OptimizationService.ProposeToggleSetting(settingId, desired);
                if (!proposal.PrerequisitesMet)
                {
                    _isUpdatingUi = true;
                    ts.IsOn = !desired;
                    _isUpdatingUi = false;
                    await AppServices.Instance.ShowDialogAsync("Prerequisite Notice", proposal.PrerequisiteFailureReason ?? "Setting cannot be modified here.");
                    return;
                }
                var result = await Task.Run(() => AppServices.Instance.SafeOperationEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken));
                if (result.Succeeded)
                {
                    if (ts.DataContext is ConfigurableSettingRowViewModel settingVm)
                    {
                        settingVm.IsEnabled = desired;
                    }
                    AppServices.Instance.NotifyOperationHistoryChanged();
                    AppServices.Instance.NotifyStatus($"Configured setting {settingId}: {(desired ? "Enabled" : "Disabled")}.");
                }
                else
                {
                    _isUpdatingUi = true;
                    ts.IsOn = !desired;
                    _isUpdatingUi = false;
                    await AppServices.Instance.ShowDialogAsync("Configuration Failed", result.StatusMessage ?? "Setting could not be changed.");
                }
            }
            catch (Exception ex)
            {
                _isUpdatingUi = true;
                ts.IsOn = !desired;
                _isUpdatingUi = false;
                await AppServices.Instance.ShowDialogAsync("Configuration Error", ex.Message);
            }
        }
    }

    private async void OnRefreshStartupClick(object sender, RoutedEventArgs e)
    {
        await LoadOptimizeStateAsync();
    }

    private void OnTabStartupClick(object sender, RoutedEventArgs e) => ShowSegment("startup");
    private void OnTabPowerClick(object sender, RoutedEventArgs e) => ShowSegment("power");
    private void OnTabSettingsClick(object sender, RoutedEventArgs e) => ShowSegment("settings");
}
