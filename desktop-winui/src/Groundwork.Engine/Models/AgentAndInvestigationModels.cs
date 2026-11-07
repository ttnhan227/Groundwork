using System;
using System.Collections.Generic;

namespace Groundwork.Engine.Models;

public sealed record AgentToolParameter(
    string Name,
    string Type,
    bool IsRequired,
    string Description);

public sealed record AgentToolDefinition(
    string Name,
    string DisplayName,
    string Category,
    string Description,
    IReadOnlyList<AgentToolParameter> Parameters,
    OperationElevationRequirement RequiredPermissions,
    bool IsModifying,
    OperationReversibility Reversibility,
    OperationRiskLevel RiskLevel,
    string Preconditions,
    string ExpectedOutputDescription,
    IReadOnlyList<string> PotentialRisks)
{
    public string ModeBadge => IsModifying ? "Modifying (Approval Required)" : "Read-Only Diagnostic";
}

public sealed record AgentToolCallRequest(
    string ToolName,
    IReadOnlyDictionary<string, string>? Arguments = null);

public sealed record AgentToolCallResult(
    string ToolName,
    bool Succeeded,
    bool IsModifyingProposal,
    string SummaryText,
    string StructuredDataJson,
    OperationProposal? PendingProposal,
    DateTimeOffset ExecutedAtUtc);

public enum InvestigationType
{
    Performance = 0,
    Storage = 1,
    Network = 2,
    WindowsHealth = 3,
    Startup = 4,
    Hardware = 5,
    Custom = 6
}

public enum FindingCategory
{
    ConfirmedObservation = 0,
    PotentialCause = 1,
    UnverifiedHypothesis = 2
}

public sealed record InvestigationFinding(
    FindingCategory Category,
    string Title,
    string Detail,
    string EvidenceSource,
    string ConfidenceLevel,
    string Severity)
{
    public string CategoryBadge => Category switch
    {
        FindingCategory.ConfirmedObservation => "Confirmed Observation",
        FindingCategory.PotentialCause => "Potential Cause",
        FindingCategory.UnverifiedHypothesis => "Unverified Hypothesis",
        _ => Category.ToString()
    };
}

public sealed record InvestigationRecommendation(
    string RecommendationId,
    string Title,
    string Explanation,
    OperationReversibility Reversibility,
    OperationRiskLevel RiskLevel,
    bool RequiresUserApproval,
    string? AssociatedToolName = null,
    IReadOnlyDictionary<string, string>? ToolArguments = null)
{
    public string SafetyBadge => $"{Reversibility} • {RiskLevel} Risk" + (RequiresUserApproval ? " • Approval Required" : "");
}

public sealed record InvestigationReport(
    string ReportId,
    InvestigationType InvestigationType,
    string Title,
    string UserQuery,
    string ExecutiveSummary,
    IReadOnlyList<string> ExecutedTools,
    IReadOnlyList<InvestigationFinding> ConfirmedObservations,
    IReadOnlyList<InvestigationFinding> PotentialCauses,
    IReadOnlyList<InvestigationFinding> UnverifiedHypotheses,
    IReadOnlyList<InvestigationRecommendation> RecommendedActions,
    IReadOnlyList<AgentToolCallResult> ToolResults,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset CompletedAtUtc)
{
    public string CompletedAtDisplay => CompletedAtUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
    public double DurationSeconds => Math.Max(0.01, (CompletedAtUtc - StartedAtUtc).TotalSeconds);
}
