using System;
using System.Collections.Generic;

namespace Groundwork.Engine.Models;

/// <summary>
/// Classifies whether a system operation modifies state and whether it can be undone.
/// </summary>
public enum OperationReversibility
{
    ReadOnly = 0,
    Reversible = 1,
    PartiallyReversible = 2,
    Irreversible = 3
}

/// <summary>
/// Classifies the potential system impact of an operation.
/// </summary>
public enum OperationRiskLevel
{
    None = 0,
    Low = 1,
    Medium = 2,
    High = 3,
    Critical = 4
}

/// <summary>
/// Specifies the Windows privilege level required to execute an operation.
/// </summary>
public enum OperationElevationRequirement
{
    StandardUser = 0,
    AdministratorRequired = 1
}

/// <summary>
/// Metadata describing a registered system operation type.
/// </summary>
public sealed record SystemOperationDescriptor(
    string OperationTypeId,
    string DisplayName,
    string Category,
    string Description,
    OperationReversibility Reversibility,
    OperationRiskLevel RiskLevel,
    OperationElevationRequirement ElevationRequirement,
    IReadOnlyList<string> PotentialRisks,
    string VerificationMethodDescription,
    string RollbackMethodDescription);

/// <summary>
/// Result of checking prerequisites and policy boundaries before proposing or executing an operation.
/// </summary>
public sealed record OperationPrerequisiteResult(
    bool IsMet,
    string Reason,
    bool RequiresElevation,
    bool IsCurrentlyElevated);

/// <summary>
/// Represents an inspected, explained, and token-gated operation proposal (Steps 1–6 of the Safe Operation Lifecycle).
/// </summary>
public sealed record OperationProposal(
    string ProposalId,
    string ConfirmationToken,
    string OperationTypeId,
    string DisplayName,
    string Category,
    string TargetDescription,
    string InspectedCurrentStateSummary,
    string PreChangeStateJson,
    string ProposedChangeExplanation,
    IReadOnlyList<string> PotentialRisks,
    IReadOnlyList<string> ExpectedEffects,
    OperationReversibility Reversibility,
    OperationRiskLevel RiskLevel,
    OperationElevationRequirement ElevationRequirement,
    bool PrerequisitesMet,
    string PrerequisiteFailureReason,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset ExpiresAtUtc)
{
    public string ReversibilityDisplay => Reversibility switch
    {
        OperationReversibility.ReadOnly => "Read-only",
        OperationReversibility.Reversible => "Reversible (Undo supported)",
        OperationReversibility.PartiallyReversible => "Partially reversible",
        OperationReversibility.Irreversible => "Irreversible",
        _ => Reversibility.ToString()
    };

    public string RiskDisplay => RiskLevel switch
    {
        OperationRiskLevel.None => "None",
        OperationRiskLevel.Low => "Low Risk",
        OperationRiskLevel.Medium => "Medium Risk",
        OperationRiskLevel.High => "High Risk",
        OperationRiskLevel.Critical => "Critical Risk",
        _ => RiskLevel.ToString()
    };
}

/// <summary>
/// Result of verifying the actual system state after executing or rolling back an operation (Step 8).
/// </summary>
public sealed record OperationVerificationResult(
    bool IsVerified,
    string ObservedStateSummary,
    string VerificationDetails,
    DateTimeOffset VerifiedAtUtc);

/// <summary>
/// Persistent audit record of an executed operation and its verification/rollback state (Steps 7–10).
/// </summary>
public sealed record OperationExecutionRecord(
    string ExecutionId,
    string ProposalId,
    string OperationTypeId,
    string DisplayName,
    string Category,
    string TargetDescription,
    bool Succeeded,
    string StatusMessage,
    string PreChangeStateJson,
    string PostChangeStateSummary,
    OperationReversibility Reversibility,
    OperationRiskLevel RiskLevel,
    OperationVerificationResult Verification,
    bool CanRollback,
    bool IsRolledBack,
    string RollbackStatusMessage,
    DateTimeOffset? RolledBackAtUtc,
    DateTimeOffset ExecutedAtUtc)
{
    public string ExecutedAtDisplay => ExecutedAtUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
    public string ReversibilityDisplay => Reversibility switch
    {
        OperationReversibility.ReadOnly => "Read-only",
        OperationReversibility.Reversible => "Reversible (Undo supported)",
        OperationReversibility.PartiallyReversible => "Partially reversible",
        OperationReversibility.Irreversible => "Irreversible",
        _ => Reversibility.ToString()
    };
    public string StatusBadge => IsRolledBack
        ? "Rolled Back"
        : (Succeeded ? (Verification.IsVerified ? "Verified" : "Executed") : "Failed");

    public string LedgerClassificationBadge => IsRolledBack
        ? "Rolled Back"
        : (Reversibility == OperationReversibility.Irreversible
            ? "Permanent (Audit Only)"
            : (CanRollback ? "Reversible (Undo Ready)" : "Audit Record"));

    public string ReversibilityNote => Reversibility switch
    {
        OperationReversibility.Irreversible => "Permanent system change — cannot be rolled back; recorded for audit transparency.",
        OperationReversibility.PartiallyReversible => "Partially reversible change.",
        OperationReversibility.Reversible => IsRolledBack ? "Original state has been restored." : "Reversible: original pre-change state captured for one-click Undo.",
        _ => "Read-only inspection record."
    };
}

/// <summary>
/// Result of rolling back a previously executed reversible operation (Step 10).
/// </summary>
public sealed record RollbackResult(
    bool Succeeded,
    string ExecutionId,
    string StatusMessage,
    OperationVerificationResult Verification,
    DateTimeOffset RolledBackAtUtc);
