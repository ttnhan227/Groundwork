using System;
using System.Diagnostics;
using System.IO;
using Groundwork.Desktop.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace Groundwork.Desktop.Views;

public sealed partial class SettingsPage : Page
{
    private bool _isInitializing = true;

    public SettingsPage()
    {
        this.InitializeComponent();
        this.NavigationCacheMode = NavigationCacheMode.Required;
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        LoadSettingsIntoUi();
    }

    private void LoadSettingsIntoUi()
    {
        _isInitializing = true;
        try
        {
            var s = AppServices.Instance.Settings;

            // Theme
            ThemeModeCombo.SelectedIndex = string.Equals(s.ThemeMode, "Dark", StringComparison.OrdinalIgnoreCase) ? 1 : 0;

            // Size Unit
            SizeUnitCombo.SelectedIndex = s.SizeUnit switch
            {
                "Binary" => 1,
                "Decimal" => 2,
                _ => 0
            };

            // Mask Serials
            MaskSerialsSwitch.IsOn = s.MaskHardwareSerials;

            // AI Provider
            AiProviderCombo.SelectedIndex = s.AiProvider?.ToLowerInvariant() switch
            {
                "ollama" => 1,
                "gemini" => 2,
                "openai" => 3,
                "mistral" => 4,
                "anthropic" => 5,
                _ => 0
            };

            UpdateApiKeyVisibility();
            WorkerThreadsNumberBox.Value = s.ParallelThreads;
            ExcludedPathsBox.Text = s.ExcludedPaths;
        }
        finally
        {
            _isInitializing = false;
        }
    }

    private void SaveSettingsFromUi()
    {
        if (_isInitializing) return;

        var s = AppServices.Instance.Settings;
        s.ThemeMode = (ThemeModeCombo.SelectedItem as ComboBoxItem)?.Tag as string ?? "Light";
        s.SizeUnit = (SizeUnitCombo.SelectedItem as ComboBoxItem)?.Tag as string ?? "Auto";
        s.MaskHardwareSerials = MaskSerialsSwitch.IsOn;
        s.AiProvider = (AiProviderCombo.SelectedItem as ComboBoxItem)?.Tag as string ?? "none";
        s.ParallelThreads = (int)WorkerThreadsNumberBox.Value;
        s.ExcludedPaths = ExcludedPathsBox.Text;

        AppSettingsService.Save(s);
        AppServices.Instance.NotifyStatus("Settings saved successfully.");
    }

    private void OnThemeModeSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_isInitializing) return;
        SaveSettingsFromUi();
        string theme = (ThemeModeCombo.SelectedItem as ComboBoxItem)?.Tag as string ?? "Light";
        AppServices.Instance.MainWindow?.ApplyTheme(theme);
    }

    private void OnSizeUnitSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_isInitializing) return;
        SaveSettingsFromUi();
        ByteFormatter.InvalidateUnitCache();
    }

    private void OnMaskSerialsToggled(object sender, RoutedEventArgs e)
    {
        if (_isInitializing) return;
        SaveSettingsFromUi();
    }

    private void OnAiProviderSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        UpdateApiKeyVisibility();
        if (_isInitializing) return;
        SaveSettingsFromUi();
    }

    private void UpdateApiKeyVisibility()
    {
        string? provider = (AiProviderCombo.SelectedItem as ComboBoxItem)?.Tag as string;
        bool needsKey = provider is "gemini" or "openai" or "mistral" or "anthropic";
        ApiKeyGrid.Visibility = needsKey ? Visibility.Visible : Visibility.Collapsed;

        if (needsKey && !_isInitializing)
        {
            var s = AppServices.Instance.Settings;
            ApiKeyPasswordBox.Password = provider switch
            {
                "gemini" => s.GeminiApiKey,
                "openai" => s.OpenAiApiKey,
                "mistral" => s.MistralApiKey,
                "anthropic" => s.AnthropicApiKey,
                _ => string.Empty
            };
        }
    }

    private void OnApiKeyPasswordChanged(object sender, RoutedEventArgs e)
    {
        if (_isInitializing) return;
        string? provider = (AiProviderCombo.SelectedItem as ComboBoxItem)?.Tag as string;
        var s = AppServices.Instance.Settings;
        string key = ApiKeyPasswordBox.Password;

        switch (provider)
        {
            case "gemini": s.GeminiApiKey = key; break;
            case "openai": s.OpenAiApiKey = key; break;
            case "mistral": s.MistralApiKey = key; break;
            case "anthropic": s.AnthropicApiKey = key; break;
        }

        SaveSettingsFromUi();
    }

    private void OnOpenLogsFolderClick(object sender, RoutedEventArgs e)
    {
        try
        {
            string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Groundwork");
            Directory.CreateDirectory(appData);
            Process.Start("explorer.exe", $"\"{appData}\"");
        }
        catch (Exception ex)
        {
            _ = AppServices.Instance.ShowDialogAsync("Cannot Open Logs", ex.Message);
        }
    }
}
