using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

public sealed record AgentPlannedTurn(
    string UserQuery,
    InvestigationType SelectedInvestigationType,
    InvestigationReport InvestigationReport,
    IReadOnlyList<OperationProposal> PendingApprovalProposals,
    string DeterministicMarkdownResponse,
    string GroundedLlmEvidencePrompt,
    IReadOnlyList<string>? ToolTrace = null,
    string? UsedAiProvider = null,
    bool UsedLiveLlm = false);

/// <summary>
/// Coordinates the Groundwork AI Agent lifecycle:
/// 1. Understands user intent
/// 2. Selects registered read-only diagnostic tools (or runs multi-turn LLM tool-calling when configured)
/// 3. Collects actual live system telemetry
/// 4. Separates confirmed findings from potential causes
/// 5. Prepares approval-gated OperationProposals for any requested modifications
/// 6. Produces both a deterministic offline explanation and a rich grounded prompt for optional LLMs.
/// </summary>
public sealed class AgentPlannerService
{
    private readonly InvestigationEngineService _investigationEngine;
    private readonly ToolRegistryService _toolRegistry;
    private readonly AiProviderClientService _aiClient;

    public AgentPlannerService(
        InvestigationEngineService? investigationEngine = null,
        ToolRegistryService? toolRegistry = null,
        AiProviderClientService? aiClient = null)
    {
        _toolRegistry = toolRegistry ?? new ToolRegistryService();
        _investigationEngine = investigationEngine ?? new InvestigationEngineService(_toolRegistry);
        _aiClient = aiClient ?? new AiProviderClientService();
    }

    public InvestigationEngineService InvestigationEngine => _investigationEngine;
    public ToolRegistryService ToolRegistry => _toolRegistry;

    public async Task<AgentPlannedTurn> RunAssistantTurnAsync(
        string userQuery,
        AiProviderConfig? aiConfig = null,
        IReadOnlyList<(string User, string Assistant)>? conversationHistory = null,
        IProgress<string>? progress = null,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var cleanQuery = string.IsNullOrWhiteSpace(userQuery)
            ? "Check the health and performance of my computer."
            : userQuery.Trim();

        if (aiConfig is { IsConfigured: true })
        {
            progress?.Report($"Consulting {aiConfig.Provider} ({aiConfig.Model}) with Groundwork tools...");
            var startedAt = DateTimeOffset.UtcNow;
            var loop = await _aiClient.RunToolLoopAsync(
                aiConfig,
                cleanQuery,
                _toolRegistry,
                conversationHistory,
                progress,
                cancellationToken).ConfigureAwait(false);

            if (loop.Succeeded && !string.IsNullOrWhiteSpace(loop.FinalAnswerMarkdown))
            {
                var invType = InvestigationEngineService.InferInvestigationTypeFromQuery(cleanQuery);
                var synthFindings = loop.ToolResults
                    .Select(r => new InvestigationFinding(
                        FindingCategory.ConfirmedObservation,
                        r.ToolName,
                        r.SummaryText,
                        r.ToolName,
                        r.Succeeded ? "Confirmed (Live Tool)" : "Tool Error",
                        r.Succeeded ? "Normal" : "Medium"))
                    .ToList();

                var synthReport = new InvestigationReport(
                    ReportId: $"llm-turn-{Guid.NewGuid():N}",
                    InvestigationType: invType,
                    Title: $"AI Agent Investigation ({aiConfig.Provider})",
                    UserQuery: cleanQuery,
                    ExecutiveSummary: loop.FinalAnswerMarkdown,
                    ExecutedTools: loop.ToolResults.Select(r => r.ToolName).Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
                    ConfirmedObservations: synthFindings,
                    PotentialCauses: [],
                    UnverifiedHypotheses: [],
                    RecommendedActions: [],
                    ToolResults: loop.ToolResults,
                    StartedAtUtc: startedAt,
                    CompletedAtUtc: DateTimeOffset.UtcNow);

                return new AgentPlannedTurn(
                    UserQuery: cleanQuery,
                    SelectedInvestigationType: invType,
                    InvestigationReport: synthReport,
                    PendingApprovalProposals: loop.PendingProposals,
                    DeterministicMarkdownResponse: loop.FinalAnswerMarkdown,
                    GroundedLlmEvidencePrompt: loop.FinalAnswerMarkdown,
                    ToolTrace: loop.ExecutedToolTrace,
                    UsedAiProvider: aiConfig.Provider,
                    UsedLiveLlm: true);
            }

            // Fall back cleanly to deterministic investigation if LLM call failed
            progress?.Report($"AI provider fallback ({loop.ErrorMessage ?? "unavailable"}); running local Groundwork investigation...");
            var fallback = await PlanAndInvestigateUserRequestAsync(cleanQuery, cancellationToken).ConfigureAwait(false);
            var notice = $"> *Note: `{aiConfig.Provider}` was unavailable ({loop.ErrorMessage ?? "error"}); showing Groundwork's local telemetry investigation.*\n\n";
            return fallback with
            {
                DeterministicMarkdownResponse = notice + fallback.DeterministicMarkdownResponse,
                ToolTrace = fallback.InvestigationReport.ExecutedTools,
                UsedAiProvider = aiConfig.Provider,
                UsedLiveLlm = false
            };
        }

        progress?.Report("Running local Groundwork diagnostic investigation...");
        var localTurn = await PlanAndInvestigateUserRequestAsync(cleanQuery, cancellationToken).ConfigureAwait(false);
        return localTurn with
        {
            ToolTrace = localTurn.InvestigationReport.ExecutedTools,
            UsedAiProvider = "local",
            UsedLiveLlm = false
        };
    }

    public async Task<AgentPlannedTurn> PlanAndInvestigateUserRequestAsync(
        string userQuery,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var cleanQuery = string.IsNullOrWhiteSpace(userQuery)
            ? "Check the health and performance of my computer."
            : userQuery.Trim();

        var invType = InvestigationEngineService.InferInvestigationTypeFromQuery(cleanQuery);
        var report = await _investigationEngine.RunInvestigationAsync(invType, cleanQuery, cancellationToken).ConfigureAwait(false);

        var proposals = new List<OperationProposal>();
        foreach (var rec in report.RecommendedActions)
        {
            if (!string.IsNullOrWhiteSpace(rec.AssociatedToolName))
            {
                var toolRes = await _toolRegistry.ExecuteToolAsync(
                    new AgentToolCallRequest(rec.AssociatedToolName, rec.ToolArguments),
                    cancellationToken).ConfigureAwait(false);

                if (toolRes.PendingProposal is { } prop &&
                    !proposals.Any(existing => string.Equals(existing.OperationTypeId, prop.OperationTypeId, StringComparison.OrdinalIgnoreCase) &&
                                               string.Equals(existing.TargetDescription, prop.TargetDescription, StringComparison.OrdinalIgnoreCase)))
                {
                    proposals.Add(prop);
                }
            }
        }

        // Also check for explicit user action requests (e.g., "create a restore point")
        if (cleanQuery.Contains("restore point", StringComparison.OrdinalIgnoreCase))
        {
            var rpRes = await _toolRegistry.ExecuteToolAsync(
                new AgentToolCallRequest("propose_create_restore_point"),
                cancellationToken).ConfigureAwait(false);
            if (rpRes.PendingProposal is { } rpProp &&
                !proposals.Any(existing => string.Equals(existing.OperationTypeId, rpProp.OperationTypeId, StringComparison.OrdinalIgnoreCase)))
            {
                proposals.Add(rpProp);
            }
        }

        var markdown = BuildDeterministicMarkdownResponse(report, proposals);
        var llmPrompt = BuildGroundedEvidencePrompt(cleanQuery, report, proposals);

        return new AgentPlannedTurn(
            UserQuery: cleanQuery,
            SelectedInvestigationType: invType,
            InvestigationReport: report,
            PendingApprovalProposals: proposals,
            DeterministicMarkdownResponse: markdown,
            GroundedLlmEvidencePrompt: llmPrompt);
    }

    private static string BuildDeterministicMarkdownResponse(
        InvestigationReport report,
        IReadOnlyList<OperationProposal> proposals)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"### {report.Title}");
        sb.AppendLine(report.ExecutiveSummary);
        sb.AppendLine();

        sb.AppendLine("#### Confirmed Observations (Live System Evidence)");
        foreach (var obs in report.ConfirmedObservations)
        {
            sb.AppendLine($"- **{obs.Title}**: {obs.Detail} *(Source: {obs.EvidenceSource})*");
        }
        sb.AppendLine();

        if (report.PotentialCauses.Count > 0)
        {
            sb.AppendLine("#### Potential Contributing Factors");
            foreach (var cause in report.PotentialCauses)
            {
                sb.AppendLine($"- **{cause.Title}** ({cause.ConfidenceLevel}): {cause.Detail}");
            }
            sb.AppendLine();
        }

        if (report.UnverifiedHypotheses.Count > 0)
        {
            sb.AppendLine("#### Unverified Hypotheses & Sensor Boundaries");
            foreach (var hyp in report.UnverifiedHypotheses)
            {
                sb.AppendLine($"- **{hyp.Title}**: {hyp.Detail}");
            }
            sb.AppendLine();
        }

        if (report.RecommendedActions.Count > 0)
        {
            sb.AppendLine("#### Recommended Actions");
            foreach (var rec in report.RecommendedActions)
            {
                sb.AppendLine($"- **{rec.Title}** `[{rec.SafetyBadge}]`: {rec.Explanation}");
            }
        }

        if (proposals.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("#### Prepared Safe Operation Proposals (Approval Gate)");
            foreach (var p in proposals)
            {
                var status = p.PrerequisitesMet
                    ? $"Ready for Approval (`{p.ReversibilityDisplay}`, `{p.RiskDisplay}`)"
                    : $"Prerequisite Notice: {p.PrerequisiteFailureReason}";
                sb.AppendLine($"- **{p.DisplayName}** ({p.TargetDescription}): {p.ProposedChangeExplanation} — *{status}*");
            }
        }

        return sb.ToString().Trim();
    }

    private static string BuildGroundedEvidencePrompt(
        string userQuery,
        InvestigationReport report,
        IReadOnlyList<OperationProposal> proposals)
    {
        var sb = new StringBuilder();
        sb.AppendLine("=== GROUNDWORK AGENT TOOL EXECUTION EVIDENCE ===");
        sb.AppendLine($"Investigation Executed: {report.Title} ({report.InvestigationType})");
        sb.AppendLine($"Registered Tools Invoked: {string.Join(", ", report.ExecutedTools)}");
        sb.AppendLine($"Executive Summary: {report.ExecutiveSummary}");
        sb.AppendLine();
        sb.AppendLine("[CONFIRMED LIVE OBSERVATIONS]");
        foreach (var obs in report.ConfirmedObservations)
        {
            sb.AppendLine($"- {obs.Title}: {obs.Detail} [Source: {obs.EvidenceSource}]");
        }
        sb.AppendLine();
        sb.AppendLine("[POTENTIAL CONTRIBUTING FACTORS]");
        foreach (var cause in report.PotentialCauses)
        {
            sb.AppendLine($"- {cause.Title} ({cause.ConfidenceLevel}): {cause.Detail}");
        }
        sb.AppendLine();
        sb.AppendLine("[UNVERIFIED HYPOTHESES / SENSOR LIMITS]");
        foreach (var hyp in report.UnverifiedHypotheses)
        {
            sb.AppendLine($"- {hyp.Title}: {hyp.Detail}");
        }
        sb.AppendLine();
        sb.AppendLine("[PREPARED SAFE OPERATION PROPOSALS (AWAITING USER APPROVAL)]");
        if (proposals.Count == 0)
        {
            sb.AppendLine("- None.");
        }
        else
        {
            foreach (var p in proposals)
            {
                sb.AppendLine($"- {p.DisplayName} ({p.ReversibilityDisplay}, {p.RiskDisplay}): {p.ProposedChangeExplanation}");
            }
        }
        sb.AppendLine("=== END TOOL EVIDENCE ===");
        sb.AppendLine();
        sb.AppendLine("Instructions: Explain these findings clearly to the user. Explicitly distinguish confirmed live observations from potential causes and unverified hypotheses. Never claim a modification has already been executed if it is awaiting approval.");
        sb.AppendLine($"User Question: {userQuery}");
        return sb.ToString();
    }
}
