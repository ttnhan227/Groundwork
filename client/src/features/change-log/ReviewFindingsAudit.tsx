import React from "react";
import {
  ShieldCheck,
  CheckCircle2,
  CheckCheck,
  RefreshCw,
  Search,
  ExternalLink,
  Download,
  Lock,
  AlertCircle,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import type {
  DeliverableReviewFinding,
  DeliverableRequirement,
  DeliverableReadiness,
} from "../../types";

export interface ReviewFindingsAuditProps {
  findings: DeliverableReviewFinding[];
  requirements: DeliverableRequirement[];
  readiness: DeliverableReadiness | null;
  readinessScore: number;
  isExportBlocked: boolean;
  isRunningAudit: boolean;
  isResolvingFindingId: string | null;
  onRunAudit: () => void;
  onResolveFinding: (
    finding: DeliverableReviewFinding,
    action: "accept" | "reject",
  ) => void;
  onOpenViewer: (docId: string, pageNumber?: number) => void;
  onPromptAgent: (prompt: string) => void;
  onExport: () => void;
}

export const ReviewFindingsAudit: React.FC<ReviewFindingsAuditProps> = ({
  findings,
  requirements,
  readiness,
  readinessScore,
  isExportBlocked,
  isRunningAudit,
  isResolvingFindingId,
  onRunAudit,
  onResolveFinding,
  onOpenViewer,
  onPromptAgent,
  onExport,
}) => {
  const openFindings = findings.filter((f) => f.status === "open");
  const coveredRequirements = requirements.filter(
    (r) => r.status === "covered" || r.status === "waived",
  ).length;
  const isSetupNeeded =
    readiness?.status === "setup_needed" || requirements.length === 0;
  const blockers = readiness?.blockers ?? [];
  const statusTitle = isSetupNeeded
    ? "Finish response setup"
    : isExportBlocked
      ? "Review needed before export"
      : "No blocking findings";

  return (
    <div className="p-4 space-y-4 min-w-0">
      {/* Readiness Summary Card */}
      <div
        className={`p-4 rounded-[var(--radius-md)] border transition-all min-w-0 ${
          isExportBlocked
            ? "bg-[var(--warning-bg)] border-[var(--warning-border)]"
            : "bg-[var(--success-bg)] border-[var(--success-border)]"
        }`}
      >
        <div className="flex items-center justify-between gap-3 mb-3 min-w-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-12 h-12 rounded-full border-2 border-current flex items-center justify-center font-mono font-bold text-base flex-shrink-0">
              {isSetupNeeded ? "—" : `${readinessScore}%`}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-serif text-sm font-bold text-[var(--ink)] flex items-center gap-1.5 min-w-0">
                {isSetupNeeded ? (
                  <>
                    <AlertCircle
                      size={14}
                      className="text-[var(--warning)] flex-shrink-0"
                    />
                    <span className="truncate">{statusTitle}</span>
                  </>
                ) : isExportBlocked ? (
                  <>
                    <Lock
                      size={14}
                      className="text-[var(--warning)] flex-shrink-0"
                    />
                    <span className="truncate">{statusTitle}</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck
                      size={14}
                      className="text-[var(--success)] flex-shrink-0"
                    />
                    <span className="truncate">
                      {statusTitle}
                    </span>
                  </>
                )}
              </div>
              <p className="text-xs text-[var(--ink-secondary)] mt-0.5 font-sans break-words">
                {isSetupNeeded
                  ? "Map the buyer's requirements before relying on a readiness score."
                  : isExportBlocked
                    ? `${blockers.length || openFindings.length} blocking step${(blockers.length || openFindings.length) === 1 ? "" : "s"} remain`
                    : "Automated checks are clear. Complete your final review before export."}
              </p>
            </div>
          </div>

          {!isSetupNeeded && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onRunAudit}
              disabled={isRunningAudit}
              className="text-[var(--ink-secondary)] hover:text-[var(--ink)] flex-shrink-0"
              title="Run the response review again"
            >
              <RefreshCw size={12} className={isRunningAudit ? "spin" : ""} />
              <span className="hidden xs:inline">
                {isRunningAudit ? "Reviewing…" : "Run again"}
              </span>
            </Button>
          )}
        </div>

        {/* Breakdown bar */}
        <div className="w-full h-1.5 rounded-full bg-[rgba(0,0,0,0.08)] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isExportBlocked ? "bg-[var(--warning)]" : "bg-[var(--success)]"
            }`}
            style={{ width: `${isSetupNeeded ? 0 : readinessScore}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] font-mono text-[var(--ink-muted)] mt-2">
          <span>
            Requirements: {coveredRequirements}/{requirements.length}
          </span>
          <span>Open findings: {openFindings.length}</span>
        </div>
      </div>

      {blockers.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] p-3">
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Before export
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-[var(--ink-secondary)]">
            {blockers.map((blocker) => (
              <li key={blocker} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--warning)]" />
                <span>{blocker}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Review Findings List */}
      <div className="space-y-3 min-w-0">
        <div className="flex items-center justify-between min-w-0">
          <h4 className="font-serif text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)] truncate">
            Review findings ({openFindings.length})
          </h4>
        </div>

        {openFindings.map((finding) => {
          const isResolving = isResolvingFindingId === finding.id;
          const firstCitation = finding.citations?.[0];

          return (
            <div
              key={finding.id}
              className="p-3 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--hairline)] shadow-[var(--shadow-subtle)] space-y-2 text-xs min-w-0"
            >
              <div className="flex items-center justify-between min-w-0">
                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.2 rounded bg-[var(--warning-bg)] text-[var(--warning)] border border-[var(--warning-border)] font-semibold flex-shrink-0">
                  {finding.severity} severity
                </span>
                <span className="text-[10px] font-mono text-[var(--ink-muted)] truncate ml-2">
                  {finding.kind?.replace("_", " ") || "Unsupported Claim"}
                </span>
              </div>

              {/* Claim quote */}
              <blockquote className="p-2 rounded bg-[var(--paper-subtle)] font-mono text-[12px] text-[var(--ink)] border-l-2 border-[var(--warning)] break-words">
                "{finding.claim_text}"
              </blockquote>

              <p className="text-xs text-[var(--ink-secondary)] font-sans leading-normal break-words">
                {finding.explanation}
              </p>

              {/* Evidence available in sources */}
              {firstCitation && (
                <div className="p-2 rounded bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] space-y-1 min-w-0">
                  <div className="flex items-center gap-1 text-[10px] font-mono text-[var(--ink-blue)] font-semibold min-w-0">
                    <CheckCircle2 size={11} className="flex-shrink-0" />
                    <span className="truncate">Suggested supporting evidence:</span>
                  </div>
                  {firstCitation.snippet && (
                    <p className="text-[11px] text-[var(--ink-secondary)] italic break-words">
                      "{firstCitation.snippet}"
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      onOpenViewer(
                        firstCitation.document_id,
                        firstCitation.page_number,
                      )
                    }
                    className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--ink-blue)] hover:underline cursor-pointer max-w-full truncate"
                  >
                    <ExternalLink size={9} className="flex-shrink-0" />
                    <span className="truncate">
                      {firstCitation.document_name} (Page{" "}
                      {firstCitation.page_number})
                    </span>
                  </button>
                </div>
              )}

              {/* Resolution Action Row */}
              <div className="flex items-center gap-2 pt-1 border-t border-[var(--hairline-subtle)] min-w-0">
                <Button
                  variant="agent"
                  size="xs"
                  onClick={() => onResolveFinding(finding, "accept")}
                  disabled={isResolving}
                  className="flex-1 truncate"
                >
                  <CheckCheck size={12} className="flex-shrink-0" />
                  <span className="truncate">
                    {isResolving ? "Applying…" : "Apply suggested revision"}
                  </span>
                </Button>

                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() =>
                    onPromptAgent(
                      `Investigate unsupported claim "${finding.claim_text}". Search active evidence sources for verification.`,
                    )
                  }
                  title="Ask Groundwork AI to investigate"
                  className="flex-shrink-0"
                >
                  <Search size={11} />
                </Button>

                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onResolveFinding(finding, "reject")}
                  disabled={isResolving}
                  className="text-[var(--ink-muted)] hover:text-[var(--ink)] flex-shrink-0"
                  title="Waive finding"
                >
                  Waive
                </Button>
              </div>
            </div>
          );
        })}

        {openFindings.length === 0 && (
          <div className="p-6 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--hairline)] text-center space-y-2 min-w-0">
            <CheckCircle2
              size={28}
              className={`mx-auto ${
                isExportBlocked
                  ? "text-[var(--ink-muted)]"
                  : "text-[var(--success)]"
              }`}
            />
            <h5 className="font-serif text-sm font-bold text-[var(--ink)]">
              {isSetupNeeded
                ? "Map requirements first"
                : isExportBlocked
                  ? "Run a response check"
                  : "No open review findings"}
            </h5>
            <p className="text-xs text-[var(--ink-muted)] break-words">
              {isSetupNeeded
                ? "Groundwork needs the buyer's requirements before it can measure coverage or review the response."
                : isExportBlocked
                  ? "Groundwork has not cleared this draft for export. Check requirements and evidence first."
                  : "Automated checks found no remaining blockers. Review the response yourself before exporting."}
            </p>
            {isSetupNeeded ? (
              <Button
                variant="agent"
                size="sm"
                onClick={() =>
                  onPromptAgent(
                    "Extract every mandatory, scored, format, evidence, and deadline requirement from the selected RFP sources. Keep page-level citations and flag anything ambiguous for human review.",
                  )
                }
              >
                <Search size={13} />
                <span>Map requirements</span>
              </Button>
            ) : isExportBlocked ? (
              <Button
                variant="agent"
                size="sm"
                onClick={onRunAudit}
                disabled={isRunningAudit}
                className="mt-2"
              >
                <RefreshCw size={13} className={isRunningAudit ? "spin" : ""} />
                <span>{isRunningAudit ? "Checking…" : "Check response"}</span>
              </Button>
            ) : (
              <Button
                variant="human"
                size="sm"
                onClick={onExport}
                className="mt-2"
              >
                <Download size={13} />
                <span>Export response</span>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReviewFindingsAudit;
