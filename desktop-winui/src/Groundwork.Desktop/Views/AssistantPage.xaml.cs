using System;
using System.Collections.ObjectModel;
using System.Threading.Tasks;
using Groundwork.Desktop.Dialogs;
using Groundwork.Desktop.Services;
using Groundwork.Engine.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;

namespace Groundwork.Desktop.Views;

public sealed class AssistantChatMessage
{
    public bool IsUser { get; set; }
    public string SenderName => IsUser ? "You" : "Groundwork Assistant";
    public string Content { get; set; } = string.Empty;
    public string Timestamp { get; set; } = DateTime.Now.ToString("HH:mm");
    public string ToolActivity { get; set; } = string.Empty;
    public Visibility ToolActivityVisibility => !string.IsNullOrEmpty(ToolActivity) ? Visibility.Visible : Visibility.Collapsed;

    public HorizontalAlignment BubbleAlignment => IsUser ? HorizontalAlignment.Right : HorizontalAlignment.Left;
    public Brush BubbleBackground => IsUser
        ? (Brush)Application.Current.Resources["GwAccentBgBrush"]
        : (Brush)Application.Current.Resources["GwCardBackgroundHoverBrush"];
    public Brush SenderColor => IsUser
        ? (Brush)Application.Current.Resources["GwAccentBrush"]
        : (Brush)Application.Current.Resources["GwTealBrush"];
    public Brush ContentColor => (Brush)Application.Current.Resources["GwTextPrimaryBrush"];
}

public sealed partial class AssistantPage : Page
{
    public ObservableCollection<AssistantChatMessage> Messages { get; } = new();

    public AssistantPage()
    {
        this.InitializeComponent();
        this.NavigationCacheMode = NavigationCacheMode.Required;

        ChatMessagesListView.ItemsSource = Messages;
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        UpdateConversationVisibility();
        RefreshModeBadge();
    }

    private void RefreshModeBadge()
    {
        var cfg = AppServices.Instance.BuildAiProviderConfig();
        AssistantModeBadge.Text = cfg.IsConfigured
            ? $"AI: {cfg.Provider} ({cfg.Model})"
            : "Local Grounded Engine";
    }

    private void UpdateConversationVisibility()
    {
        bool hasMessages = Messages.Count > 0;
        StandbyWelcomePanel.Visibility = hasMessages ? Visibility.Collapsed : Visibility.Visible;
        ChatMessagesListView.Visibility = hasMessages ? Visibility.Visible : Visibility.Collapsed;
    }

    public void SetQuery(string query)
    {
        QueryInputBox.Text = query;
    }

    private void OnSuggestedPromptClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Content is string prompt)
        {
            QueryInputBox.Text = prompt.Trim();
            OnSendQueryClick(sender, e);
        }
    }

    private void OnQueryInputBoxKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            OnSendQueryClick(sender, new RoutedEventArgs());
        }
    }

    public async void OnSendQueryClick(object sender, RoutedEventArgs e)
    {
        string query = QueryInputBox.Text.Trim();
        if (string.IsNullOrEmpty(query)) return;

        QueryInputBox.Text = string.Empty;
        SendQueryBtn.IsEnabled = false;

        Messages.Add(new AssistantChatMessage
        {
            IsUser = true,
            Content = query
        });
        UpdateConversationVisibility();

        AppServices.Instance.NotifyStatus("Assistant is analyzing system context...");

        try
        {
            var aiConfig = AppServices.Instance.BuildAiProviderConfig();
            var historySnapshot = AppServices.Instance.AgentConversation.ToArray();
            var progress = new Progress<string>(step =>
            {
                DispatcherQueue.TryEnqueue(() => AppServices.Instance.NotifyStatus(step));
            });

            var plannedTurn = await Task.Run(async () =>
                await AppServices.Instance.AgentPlanner.RunAssistantTurnAsync(
                    query,
                    aiConfig,
                    historySnapshot,
                    progress));

            bool looksLikeActionRequest =
                query.Contains("clean", StringComparison.OrdinalIgnoreCase) ||
                query.Contains("delete", StringComparison.OrdinalIgnoreCase) ||
                query.Contains("clear", StringComparison.OrdinalIgnoreCase) ||
                query.Contains("switch", StringComparison.OrdinalIgnoreCase) ||
                query.Contains("change", StringComparison.OrdinalIgnoreCase) ||
                query.Contains("flush", StringComparison.OrdinalIgnoreCase) ||
                query.Contains("disable", StringComparison.OrdinalIgnoreCase) ||
                query.Contains("enable", StringComparison.OrdinalIgnoreCase) ||
                query.Contains("restore point", StringComparison.OrdinalIgnoreCase) ||
                query.Contains("organize", StringComparison.OrdinalIgnoreCase);

            var traceList = plannedTurn.ToolTrace ?? plannedTurn.InvestigationReport.ExecutedTools;
            string modeLabel = plannedTurn.UsedLiveLlm ? $"AI ({plannedTurn.UsedAiProvider})" : "Local Telemetry";
            string toolActivityDesc = traceList.Count > 0
                ? $"⚙️ {modeLabel}: {string.Join(" → ", traceList)} ✓"
                : string.Empty;

            // Only pop the approval dialog when the user requested a modifying action or the live LLM explicitly staged one
            if (plannedTurn.PendingApprovalProposals.Count > 0 && (plannedTurn.UsedLiveLlm || looksLikeActionRequest) && this.XamlRoot != null)
            {
                var proposal = plannedTurn.PendingApprovalProposals[0];
                var execRecord = await AppServices.Instance.ExecuteWithGateAsync(
                    this.XamlRoot,
                    proposal,
                    "Prerequisite Notice",
                    $"Executing {proposal.DisplayName}...");

                if (execRecord != null)
                {
                    var approvedContent = $"Approved and executed: {execRecord.StatusMessage}\n\n{plannedTurn.DeterministicMarkdownResponse}";
                    AppServices.Instance.AgentConversation.Add((query, approvedContent));
                    Messages.Add(new AssistantChatMessage
                    {
                        IsUser = false,
                        Content = approvedContent,
                        ToolActivity = $"⚙️ Executed {proposal.DisplayName} ✓"
                    });
                    return;
                }
            }

            AppServices.Instance.AgentConversation.Add((query, plannedTurn.DeterministicMarkdownResponse));
            Messages.Add(new AssistantChatMessage
            {
                IsUser = false,
                Content = plannedTurn.DeterministicMarkdownResponse,
                ToolActivity = toolActivityDesc
            });
            AppServices.Instance.NotifyStatus("Assistant response ready.");
        }
        catch (Exception ex)
        {
            Messages.Add(new AssistantChatMessage
            {
                IsUser = false,
                Content = $"Encountered an error while investigating: {ex.Message}"
            });
        }
        finally
        {
            SendQueryBtn.IsEnabled = true;
            UpdateConversationVisibility();
            ChatMessagesListView.ScrollIntoView(Messages[^1]);
        }
    }

    private void OnClearConversationClick(object sender, RoutedEventArgs e)
    {
        Messages.Clear();
        AppServices.Instance.AgentConversation.Clear();
        UpdateConversationVisibility();
        AppServices.Instance.NotifyStatus("Conversation cleared.");
    }
}
