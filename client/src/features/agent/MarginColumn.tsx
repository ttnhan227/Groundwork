import React from "react";
import {
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import type { DeliverableReviewFinding, DocumentItem } from "../../types";
import { Button } from "../../components/ui/Button";

export interface MarginColumnProps {
  findings: DeliverableReviewFinding[];
  sources: DocumentItem[];
  isResolvingFindingId: string | null;
  onResolveFinding: (
    finding: DeliverableReviewFinding,
    action: "accept" | "reject",
  ) => void;
  onOpenViewer: (docId: string, pageNumber?: number) => void;
  onPromptAgent: (prompt: string) => void;
}

/**
 * Manuscript Margin Column
 * Inspired by classic annotated manuscripts:
 * - Human notes & marginalia in ink-blue
 * - Agent review findings & audit stamps in ink-sepia
 * - Anchors next to the document canvas without cluttering the main text
 */
export const MarginColumn: React.FC<MarginColumnProps> = ({
  findings,
  sources: _sources,
  isResolvingFindingId,
  onResolveFinding,
  onOpenViewer,
  onPromptAgent: _onPromptAgent,
}) => {
  const openFindings = findings.filter((f) => f.status === "open");

  return (
    <aside className="w-[280px] flex-shrink-0 flex flex-col py-4 px-3 space-y-3 min-w-0">
      <div className="flex items-center justify-between pb-2 border-b border-[var(--hairline)] min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-secondary)] min-w-0">
          <Sparkles
            size={13}
            className="text-[var(--ink-sepia)] flex-shrink-0"
          />
          <span className="font-serif truncate">Margin Marginalia</span>
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--paper-subtle)] text-[var(--ink-muted)] flex-shrink-0">
          {openFindings.length} notes
        </span>
      </div>

      <div className="space-y-3 overflow-y-auto min-w-0">
        {openFindings.map((finding) => {
          const isResolving = isResolvingFindingId === finding.id;
          const firstCitation = finding.citations?.[0];

          return (
            <div
              key={finding.id}
              className="p-3 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--ink-sepia-border)] shadow-[var(--shadow-subtle)] transition-all hover:border-[var(--ink-sepia)] group min-w-0"
            >
              {/* Note Header: Agent Accent */}
              <div className="flex items-center justify-between gap-1 text-[11px] font-mono text-[var(--ink-sepia)] font-semibold mb-1.5 min-w-0">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--ink-sepia)] flex-shrink-0" />
                  <span className="truncate">Agent Verification</span>
                </div>
                <span className="text-[10px] uppercase opacity-75 flex-shrink-0">
                  {finding.severity}
                </span>
              </div>

              {/* Finding Claim Quote */}
              <p className="text-[12px] font-mono text-[var(--ink)] bg-[var(--ink-sepia-subtle)] p-2 rounded-[var(--radius-xs)] mb-2 break-words">
                "{finding.claim_text}"
              </p>

              <p className="text-[11px] text-[var(--ink-secondary)] leading-snug mb-2.5 font-sans break-words">
                {finding.explanation}
              </p>

              {/* Source Evidence Citation */}
              {firstCitation && (
                <button
                  type="button"
                  onClick={() =>
                    onOpenViewer(
                      firstCitation.document_id,
                      firstCitation.page_number,
                    )
                  }
                  className="w-full flex items-center justify-between px-2 py-1 mb-2.5 rounded bg-[var(--paper-subtle)] hover:bg-[var(--surface-hover)] border border-[var(--hairline)] text-[10px] font-mono text-[var(--ink-blue)] transition-colors cursor-pointer text-left min-w-0"
                  title="Inspect source evidence"
                >
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    <ExternalLink size={10} className="flex-shrink-0" />
                    <span className="truncate">
                      {firstCitation.document_name}
                    </span>
                  </div>
                  <strong className="flex-shrink-0 ml-1.5">
                    p. {firstCitation.page_number}
                  </strong>
                </button>
              )}

              {/* Quick Actions */}
              <div className="flex items-center gap-1.5 pt-1.5 border-t border-[var(--hairline-subtle)] min-w-0">
                <Button
                  variant="agent"
                  size="xs"
                  onClick={() => onResolveFinding(finding, "accept")}
                  disabled={isResolving}
                  className="flex-1 truncate"
                >
                  <CheckCircle2 size={11} className="flex-shrink-0" />
                  <span className="truncate">Accept Fix</span>
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
          <div className="p-4 rounded-[var(--radius-sm)] border border-dashed border-[var(--hairline-strong)] text-center min-w-0">
            <ShieldCheck
              size={20}
              className="mx-auto text-[var(--success)] mb-1.5"
            />
            <p className="text-xs font-serif font-semibold text-[var(--ink)]">
              No open findings
            </p>
            <p className="text-[11px] text-[var(--ink-muted)] mt-0.5 break-words">
              Automated review has no open findings. Complete a final human review.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
};

export default MarginColumn;
