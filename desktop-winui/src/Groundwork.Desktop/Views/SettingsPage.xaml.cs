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
                "custom" => 6,
                _ => 0
            };

            UpdateApiKeyVisibility();
            LoadProviderFieldsIntoUi();
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
        LoadProviderFieldsIntoUi();
        if (_isInitializing) return;
        SaveSettingsFromUi();
    }

    private void UpdateApiKeyVisibility()
    {
        string? provider = (AiProviderCombo.SelectedItem as ComboBoxItem)?.Tag as string;
        bool hasProvider = provider is "ollama" or "gemini" or "openai" or "mistral" or "anthropic" or "custom";
        bool needsKey = provider is "gemini" or "openai" or "mistral" or "anthropic" or "custom";
        bool needsEndpoint = provider is "ollama" or "custom";

        AiModelGrid.Visibility = hasProvider ? Visibility.Visible : Visibility.Collapsed;
        AiEndpointGrid.Visibility = needsEndpoint ? Visibility.Visible : Visibility.Collapsed;
        ApiKeyGrid.Visibility = needsKey ? Visibility.Visible : Visibility.Collapsed;
    }

    private void LoadProviderFieldsIntoUi()
    {
        bool prevInit = _isInitializing;
        _isInitializing = true;
        try
        {
            string? provider = (AiProviderCombo.SelectedItem as ComboBoxItem)?.Tag as string;
            var s = AppServices.Instance.Settings;
            AiModelTextBox.Text = provider switch
            {
                "ollama" => s.OllamaModel,
                "gemini" => s.GeminiModel,
                "openai" => s.OpenAiModel,
                "mistral" => s.MistralModel,
                "anthropic" => s.AnthropicModel,
                "custom" => s.CustomModel,
                _ => string.Empty
            };
            AiEndpointTextBox.Text = provider switch
            {
                "ollama" => s.OllamaUrl,
                "custom" => s.CustomEndpoint,
                _ => string.Empty
            };
            ApiKeyPasswordBox.Password = provider switch
            {
                "gemini" => s.GeminiApiKey,
                "openai" => s.OpenAiApiKey,
                "mistral" => s.MistralApiKey,
                "anthropic" => s.AnthropicApiKey,
                "custom" => s.CustomApiKey,
                _ => string.Empty
            };
        }
        finally
        {
            _isInitializing = prevInit;
        }
    }

    private void OnAiConfigTextChanged(object sender, RoutedEventArgs e)
    {
        if (_isInitializing) return;
        string? provider = (AiProviderCombo.SelectedItem as ComboBoxItem)?.Tag as string;
        var s = AppServices.Instance.Settings;
        var model = AiModelTextBox.Text.Trim();
        var endpoint = AiEndpointTextBox.Text.Trim();

        switch (provider)
        {
            case "ollama":
                if (!string.IsNullOrEmpty(model)) s.OllamaModel = model;
                if (!string.IsNullOrEmpty(endpoint)) s.OllamaUrl = endpoint;
                break;
            case "gemini":
                if (!string.IsNullOrEmpty(model)) s.GeminiModel = model;
                break;
            case "openai":
                if (!string.IsNullOrEmpty(model)) s.OpenAiModel = model;
                break;
            case "mistral":
                if (!string.IsNullOrEmpty(model)) s.MistralModel = model;
                break;
            case "anthropic":
                if (!string.IsNullOrEmpty(model)) s.AnthropicModel = model;
                break;
            case "custom":
                if (!string.IsNullOrEmpty(model)) s.CustomModel = model;
                if (!string.IsNullOrEmpty(endpoint)) s.CustomEndpoint = endpoint;
                break;
        }

        SaveSettingsFromUi();
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
            case "custom": s.CustomApiKey = key; break;
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
