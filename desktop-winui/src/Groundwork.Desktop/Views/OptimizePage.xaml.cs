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
    private PowerManagementSnapshot? _powerSnapshot;

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

    public void ShowSegment(string segment)
    {
        SubViewStartup.Visibility = Visibility.Collapsed;
        SubViewPower.Visibility = Visibility.Collapsed;
        SubViewSettings.Visibility = Visibility.Collapsed;

        TabStartupBtn.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];
        TabPowerBtn.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];
        TabSettingsBtn.Style = (Style)Application.Current.Resources["GwSecondaryButtonStyle"];

        switch (segment.ToLowerInvariant())
        {
            case "power" or "powerplans":
                SubViewPower.Visibility = Visibility.Visible;
                TabPowerBtn.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
                break;
            case "settings" or "windowssettings" or "tuning":
                SubViewSettings.Visibility = Visibility.Visible;
                TabSettingsBtn.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
                break;
            default:
                SubViewStartup.Visibility = Visibility.Visible;
                TabStartupBtn.Style = (Style)Application.Current.Resources["GwPrimaryButtonStyle"];
                break;
        }
    }

    public async Task LoadOptimizeStateAsync()
    {
        _isUpdatingUi = true;
        try
        {
            await Task.Run(() =>
            {
                var startup = AppServices.Instance.OptimizationService.InspectStartupItems();
                var power = AppServices.Instance.OptimizationService.InspectPowerPlans();
                var settings = AppServices.Instance.OptimizationService.InspectConfigurableSettings();

                DispatcherQueue.TryEnqueue(() =>
                {
                    // 1. Startup Items
                    StartupItems.Clear();
                    int enabledCount = 0;
                    foreach (var item in startup)
                    {
                        if (item.IsEnabled) enabledCount++;
                        StartupItems.Add(new StartupItemRowViewModel
                        {
                            EntryId = item.EntryId,
                            Name = item.Name,
                            Publisher = !string.IsNullOrEmpty(item.Publisher) ? item.Publisher : "Verified Windows / Third-Party Program",
                            CommandOrTarget = item.CommandOrTarget,
                            ScopeDisplay = item.ScopeDisplay,
                            IsEnabled = item.IsEnabled,
                            ImpactAssessment = item.ImpactAssessment + " Impact",
                            CanModify = true
                        });
                    }
                    StartupAppsSummaryText.Text = $"{enabledCount} active startup applications launching at logon ({StartupItems.Count} total discovered).";

                    // 2. Power Schemes
                    _powerSnapshot = power;
                    UpdatePowerCards(power);

                    // 3. Configurable Settings
                    ConfigurableSettings.Clear();
                    foreach (var s in settings)
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
                });
            });
        }
        finally
        {
            _isUpdatingUi = false;
        }
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
    }

    private async void OnStartupItemToggled(object sender, RoutedEventArgs e)
    {
        if (_isUpdatingUi) return;
        if (sender is ToggleSwitch ts && ts.Tag is string entryId)
        {
            bool desiredState = ts.IsOn;
            try
            {
                var proposal = AppServices.Instance.OptimizationService.ProposeToggleStartupItem(entryId, desiredState);
                var result = await AppServices.Instance.SafeOperationEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
                if (result.Succeeded)
                {
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
            var result = await AppServices.Instance.SafeOperationEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
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
        if (sender is ToggleSwitch ts && ts.Tag is string settingId)
        {
            bool desired = ts.IsOn;
            try
            {
                var proposal = AppServices.Instance.OptimizationService.ProposeToggleSetting(settingId, desired);
                var result = await AppServices.Instance.SafeOperationEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
                if (result.Succeeded)
                {
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
