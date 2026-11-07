using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

/// <summary>
/// Delegate set for a registered system operation type managed by <see cref="SafeOperationEngine"/>.
/// </summary>
public sealed record RegisteredOperationHandler(
    SystemOperationDescriptor Descriptor,
    Func<string, CancellationToken, Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)>> ExecuteAsync,
    Func<string, CancellationToken, Task<(bool Succeeded, string StatusMessage, OperationVerificationResult Verification)>>? RollbackAsync = null);

/// <summary>
/// Implements the 10-Step Safe Operation Framework:
/// 1. Inspect current state
/// 2. Validate prerequisites
/// 3. Capture original state
/// 4. Explain proposed change
/// 5. Display potential risks &amp; effects
/// 6. Request user approval (single-use token)
/// 7. Execute operation
/// 8. Verify resulting state
/// 9. Record result in history
/// 10. Provide recovery / rollback
/// </summary>
public sealed class SafeOperationEngine
{
    private static readonly TimeSpan DefaultTokenTtl = TimeSpan.FromMinutes(5);

    private readonly PolicyEngine _policyEngine;
    private readonly OperationHistoryService _historyService;
    private readonly ConcurrentDictionary<string, RegisteredOperationHandler> _handlers = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, PendingProposalEntry> _pendingProposals = new(StringComparer.Ordinal);

    private sealed record PendingProposalEntry(
        OperationProposal Proposal,
        string PayloadJson,
        Func<CancellationToken, Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)>>? InlineExecuteAsync);

    public SafeOperationEngine(PolicyEngine? policyEngine = null, OperationHistoryService? historyService = null)
    {
        _policyEngine = policyEngine ?? new PolicyEngine();
        _historyService = historyService ?? new OperationHistoryService();
    }

    public PolicyEngine Policy => _policyEngine;
    public OperationHistoryService History => _historyService;

    public void RegisterHandler(RegisteredOperationHandler handler)
    {
        ArgumentNullException.ThrowIfNull(handler);
        _handlers[handler.Descriptor.OperationTypeId] = handler;
    }

    public IReadOnlyCollection<SystemOperationDescriptor> GetRegisteredDescriptors()
    {
        var list = new List<SystemOperationDescriptor>();
        foreach (var kvp in _handlers)
        {
            list.Add(kvp.Value.Descriptor);
        }
        return list;
    }

    /// <summary>
    /// Creates an inspected, policy-validated, token-gated operation proposal (Steps 1–6).
    /// </summary>
    public OperationProposal CreateProposal(
        SystemOperationDescriptor descriptor,
        string targetDescription,
        string inspectedCurrentStateSummary,
        string preChangeStateJson,
        string proposedChangeExplanation,
        IReadOnlyList<string>? expectedEffects = null,
        string payloadJson = "{}",
        Func<(bool IsMet, string Reason)>? customPrerequisiteValidator = null,
        Func<CancellationToken, Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)>>? inlineExecuteAsync = null,
        TimeSpan? tokenTtl = null)
    {
        ArgumentNullException.ThrowIfNull(descriptor);

        PruneExpiredProposals();

        var prereq = _policyEngine.ValidateDescriptorPolicy(descriptor, targetDescription, customPrerequisiteValidator);
        var now = DateTimeOffset.UtcNow;
        var ttl = tokenTtl ?? DefaultTokenTtl;
        var proposalId = $"prop-{Guid.NewGuid():N}";
        var token = prereq.IsMet ? $"op-tok-{Guid.NewGuid():N}" : string.Empty;

        var proposal = new OperationProposal(
            ProposalId: proposalId,
            ConfirmationToken: token,
            OperationTypeId: descriptor.OperationTypeId,
            DisplayName: descriptor.DisplayName,
            Category: descriptor.Category,
            TargetDescription: targetDescription,
            InspectedCurrentStateSummary: inspectedCurrentStateSummary,
            PreChangeStateJson: preChangeStateJson ?? string.Empty,
            ProposedChangeExplanation: proposedChangeExplanation,
            PotentialRisks: descriptor.PotentialRisks,
            ExpectedEffects: expectedEffects ?? [],
            Reversibility: descriptor.Reversibility,
            RiskLevel: descriptor.RiskLevel,
            ElevationRequirement: descriptor.ElevationRequirement,
            PrerequisitesMet: prereq.IsMet,
            PrerequisiteFailureReason: prereq.IsMet ? string.Empty : prereq.Reason,
            CreatedAtUtc: now,
            ExpiresAtUtc: now.Add(ttl));

        if (prereq.IsMet && !string.IsNullOrEmpty(token))
        {
            _pendingProposals[token] = new PendingProposalEntry(proposal, payloadJson, inlineExecuteAsync);
        }

        return proposal;
    }

    /// <summary>
    /// Executes an approved proposal using its single-use confirmation token, verifies the resulting state,
    /// and records the execution in <see cref="OperationHistoryService"/> (Steps 7–9).
    /// </summary>
    public async Task<OperationExecutionRecord> ExecuteApprovedProposalAsync(
        string confirmationToken,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (string.IsNullOrWhiteSpace(confirmationToken))
        {
            throw new InvalidOperationException("Confirmation token is required before executing a modifying system operation.");
        }

        if (!_pendingProposals.TryRemove(confirmationToken, out var entry))
        {
            throw new InvalidOperationException("Confirmation token is invalid or has already been consumed.");
        }

        var proposal = entry.Proposal;
        if (DateTimeOffset.UtcNow > proposal.ExpiresAtUtc)
        {
            throw new InvalidOperationException("Confirmation token has expired. Please re-inspect and generate a new operation proposal.");
        }

        if (!proposal.PrerequisitesMet)
        {
            throw new InvalidOperationException($"Cannot execute operation because prerequisites were not met: {proposal.PrerequisiteFailureReason}");
        }

        var executionId = $"exec-{Guid.NewGuid():N}";
        var executedAt = DateTimeOffset.UtcNow;

        bool succeeded;
        string postStateSummary;
        string statusMessage;
        OperationVerificationResult verification;

        try
        {
            if (entry.InlineExecuteAsync is not null)
            {
                (succeeded, postStateSummary, statusMessage, verification) = await entry.InlineExecuteAsync(cancellationToken).ConfigureAwait(false);
            }
            else if (_handlers.TryGetValue(proposal.OperationTypeId, out var handler))
            {
                (succeeded, postStateSummary, statusMessage, verification) = await handler.ExecuteAsync(entry.PayloadJson, cancellationToken).ConfigureAwait(false);
            }
            else
            {
                throw new InvalidOperationException($"No execution handler is registered for operation type '{proposal.OperationTypeId}'.");
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            succeeded = false;
            postStateSummary = "Execution threw an exception.";
            statusMessage = ex.Message;
            verification = new OperationVerificationResult(
                IsVerified: false,
                ObservedStateSummary: "Operation failed before verification.",
                VerificationDetails: ex.Message,
                VerifiedAtUtc: DateTimeOffset.UtcNow);
        }

        var canRollback = succeeded &&
            (proposal.Reversibility == OperationReversibility.Reversible ||
             proposal.Reversibility == OperationReversibility.PartiallyReversible) &&
            !string.IsNullOrWhiteSpace(proposal.PreChangeStateJson);

        var record = new OperationExecutionRecord(
            ExecutionId: executionId,
            ProposalId: proposal.ProposalId,
            OperationTypeId: proposal.OperationTypeId,
            DisplayName: proposal.DisplayName,
            Category: proposal.Category,
            TargetDescription: proposal.TargetDescription,
            Succeeded: succeeded,
            StatusMessage: statusMessage,
            PreChangeStateJson: proposal.PreChangeStateJson,
            PostChangeStateSummary: postStateSummary,
            Reversibility: proposal.Reversibility,
            RiskLevel: proposal.RiskLevel,
            Verification: verification,
            CanRollback: canRollback,
            IsRolledBack: false,
            RollbackStatusMessage: string.Empty,
            RolledBackAtUtc: null,
            ExecutedAtUtc: executedAt);

        _historyService.RecordExecution(record);
        return record;
    }

    /// <summary>
    /// Rolls back a previously executed reversible operation using its captured pre-change state (Step 10).
    /// </summary>
    public async Task<RollbackResult> RollbackOperationAsync(
        string executionId,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var record = _historyService.GetRecordById(executionId);
        if (record is null)
        {
            return new RollbackResult(
                Succeeded: false,
                ExecutionId: executionId ?? string.Empty,
                StatusMessage: "Operation execution record was not found in history.",
                Verification: new OperationVerificationResult(false, "Record not found", "No matching execution ID.", DateTimeOffset.UtcNow),
                RolledBackAtUtc: DateTimeOffset.UtcNow);
        }

        if (record.IsRolledBack)
        {
            return new RollbackResult(
                Succeeded: false,
                ExecutionId: record.ExecutionId,
                StatusMessage: "This operation has already been rolled back.",
                Verification: new OperationVerificationResult(false, "Already rolled back", record.RollbackStatusMessage, DateTimeOffset.UtcNow),
                RolledBackAtUtc: DateTimeOffset.UtcNow);
        }

        if (!record.CanRollback || string.IsNullOrWhiteSpace(record.PreChangeStateJson))
        {
            return new RollbackResult(
                Succeeded: false,
                ExecutionId: record.ExecutionId,
                StatusMessage: $"Operation '{record.DisplayName}' is marked as {record.ReversibilityDisplay} and cannot be automatically rolled back.",
                Verification: new OperationVerificationResult(false, "Not reversible", "No rollback state available.", DateTimeOffset.UtcNow),
                RolledBackAtUtc: DateTimeOffset.UtcNow);
        }

        if (!_handlers.TryGetValue(record.OperationTypeId, out var handler) || handler.RollbackAsync is null)
        {
            return new RollbackResult(
                Succeeded: false,
                ExecutionId: record.ExecutionId,
                StatusMessage: $"No rollback handler is registered for operation type '{record.OperationTypeId}'.",
                Verification: new OperationVerificationResult(false, "No handler", "Rollback handler missing.", DateTimeOffset.UtcNow),
                RolledBackAtUtc: DateTimeOffset.UtcNow);
        }

        try
        {
            var (succeeded, statusMessage, verification) = await handler.RollbackAsync(record.PreChangeStateJson, cancellationToken).ConfigureAwait(false);
            var rolledBackAt = DateTimeOffset.UtcNow;
            _historyService.UpdateRecordAfterRollback(record.ExecutionId, succeeded, statusMessage, rolledBackAt);

            return new RollbackResult(
                Succeeded: succeeded,
                ExecutionId: record.ExecutionId,
                StatusMessage: statusMessage,
                Verification: verification,
                RolledBackAtUtc: rolledBackAt);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            var now = DateTimeOffset.UtcNow;
            _historyService.UpdateRecordAfterRollback(record.ExecutionId, false, $"Rollback failed: {ex.Message}", now);
            return new RollbackResult(
                Succeeded: false,
                ExecutionId: record.ExecutionId,
                StatusMessage: $"Rollback failed: {ex.Message}",
                Verification: new OperationVerificationResult(false, "Rollback exception", ex.Message, now),
                RolledBackAtUtc: now);
        }
    }

    private void PruneExpiredProposals()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var kvp in _pendingProposals)
        {
            if (now > kvp.Value.Proposal.ExpiresAtUtc)
            {
                _pendingProposals.TryRemove(kvp.Key, out _);
            }
        }
    }
}
