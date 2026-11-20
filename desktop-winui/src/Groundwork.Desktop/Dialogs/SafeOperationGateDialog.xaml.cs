using Groundwork.Engine.Models;
using Microsoft.UI.Xaml.Controls;

namespace Groundwork.Desktop.Dialogs;

public sealed partial class SafeOperationGateDialog : ContentDialog
{
    public SafeOperationGateDialog(string title, string description, string target, bool isReversible, string risks)
    {
        this.InitializeComponent();
        OperationTitleText.Text = title;
        OperationDescText.Text = description;
        TargetText.Text = target;
        ReversibilityText.Text = isReversible ? "Reversible via Rollback Ledger" : "Permanent Operation (Irreversible)";
        ReversibilityText.Foreground = MainWindow.ResolveThemeBrush(
            this,
            isReversible ? "GwSignalGreenBrush" : "GwDangerBrush");
        RisksText.Text = string.IsNullOrWhiteSpace(risks) ? "No abnormal risks identified." : risks;
    }

    public SafeOperationGateDialog(OperationProposal proposal)
        : this(
            proposal.DisplayName,
            proposal.ProposedChangeExplanation,
            proposal.TargetDescription,
            proposal.Reversibility == OperationReversibility.Reversible,
            proposal.PotentialRisks.Count > 0 ? string.Join("\n• ", proposal.PotentialRisks) : "No abnormal risks identified.")
    {
    }
}
