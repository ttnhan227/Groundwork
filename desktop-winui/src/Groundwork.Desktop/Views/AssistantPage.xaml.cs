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
            // Remove leading emoji if present
            string cleaned = prompt.Length > 3 ? prompt.Substring(3).Trim() : prompt;
            QueryInputBox.Text = cleaned;
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
            var plannedTurn = await Task.Run(async () =>
            {
                return await AppServices.Instance.AgentPlanner.PlanAndInvestigateUserRequestAsync(query);
            });

            // If an operation is proposed that needs confirmation
            if (plannedTurn.PendingApprovalProposals.Count > 0)
            {
                var proposal = plannedTurn.PendingApprovalProposals[0];
                var gate = new SafeOperationGateDialog(
                    proposal.DisplayName,
                    proposal.ProposedChangeExplanation,
                    proposal.TargetDescription,
                    proposal.Reversibility == OperationReversibility.Reversible,
                    string.Join("; ", proposal.PotentialRisks));

                if (this.XamlRoot != null)
                {
                    gate.XamlRoot = this.XamlRoot;
                    var res = await gate.ShowAsync();
                    if (res == ContentDialogResult.Primary)
                    {
                        var execRecord = await Task.Run(async () => await AppServices.Instance.SafeOperationEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken));
                        AppServices.Instance.NotifyOperationHistoryChanged();
                        Messages.Add(new AssistantChatMessage
                        {
                            IsUser = false,
                            Content = $"Approved and executed: {execRecord.StatusMessage}\n\n{plannedTurn.DeterministicMarkdownResponse}",
                            ToolActivity = $"⚙️ Executed {proposal.DisplayName} ✓"
                        });
                        return;
                    }
                }
            }

            int obsCount = plannedTurn.InvestigationReport.ConfirmedObservations.Count + plannedTurn.InvestigationReport.PotentialCauses.Count;
            string toolActivityDesc = obsCount > 0
                ? $"⚙️ Grounded investigation ({obsCount} verified telemetry observations) ✓"
                : string.Empty;

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
        UpdateConversationVisibility();
        AppServices.Instance.NotifyStatus("Conversation cleared.");
    }
}
