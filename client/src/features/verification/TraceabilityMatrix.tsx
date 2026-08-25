import React from "react";
import { CheckCircle2, AlertCircle, Sparkles, ExternalLink } from "lucide-react";
import type { DeliverableRequirement } from "../../types";
import { Button } from "../../components/ui/Button";

export interface TraceabilityMatrixProps {
  requirements: DeliverableRequirement[];
  onPromptAgent: (prompt: string) => void;
  onOpenViewer: (docId: string, pageNumber?: number) => void;
}

export const TraceabilityMatrix: React.FC<TraceabilityMatrixProps> = ({
  requirements,
  onPromptAgent,
  onOpenViewer,
}) => {
  const coveredCount = requirements.filter((r) => r.status === "covered" || r.status === "waived").length;

  return (
    <div className="p-4 space-y-4 min-w-0">
      <div className="flex items-center justify-between pb-2 border-b border-[var(--hairline)] min-w-0">
        <div className="min-w-0 flex-1">
          <h4 className="font-serif text-sm font-semibold text-[var(--ink)] truncate">
            Requirements Traceability Matrix
          </h4>
          <p className="text-xs text-[var(--ink-muted)] break-words">
            Extracted RFP acceptance criteria and delivery specifications.
          </p>
        </div>
        <span className="text-xs font-mono font-semibold text-[var(--ink)] flex-shrink-0 ml-2">
          {coveredCount} / {requirements.length} Covered
        </span>
      </div>

      <div className="space-y-2.5 overflow-y-auto min-w-0">
        {requirements.map((req, idx) => {
          const isCovered = req.status === "covered";
          const firstEvidence = req.evidence?.[0];

          return (
            <div
              key={req.id || idx}
              className={`p-3 rounded-[var(--radius-sm)] border transition-all text-xs min-w-0 ${
                isCovered
                  ? "bg-[var(--surface)] border-[var(--hairline)]"
                  : "bg-[var(--warning-bg)] border-[var(--warning-border)]"
              }`}
            >
              <div className="flex items-start gap-2 mb-1.5 min-w-0">
                {isCovered ? (
                  <CheckCircle2 size={14} className="text-[var(--success)] flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle size={14} className="text-[var(--warning)] flex-shrink-0 mt-0.5" />
                )}

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--ink)] font-sans leading-snug break-words">{req.text}</p>
                  {req.linked_sections?.[0] && (
                    <span className="inline-block mt-1 text-[10px] font-mono text-[var(--ink-muted)] truncate max-w-full">
                      Mapped to section: {req.linked_sections[0]}
                    </span>
                  )}
                </div>
              </div>

              {/* Evidence or Solve Action */}
              <div className="flex items-center justify-between pt-1.5 border-t border-[var(--hairline-subtle)] text-[11px] min-w-0">
                {firstEvidence ? (
                  <button
                    type="button"
                    onClick={() => onOpenViewer(firstEvidence.document_id, firstEvidence.page_number)}
                    className="inline-flex items-center gap-1 font-mono text-[var(--ink-blue)] hover:underline truncate max-w-[140px] sm:max-w-xs cursor-pointer min-w-0"
                  >
                    <ExternalLink size={10} className="flex-shrink-0" />
                    <span className="truncate">{firstEvidence.document_name}</span>
                    <strong className="flex-shrink-0">p. {firstEvidence.page_number}</strong>
                  </button>
                ) : (
                  <span className="text-[10px] font-mono text-[var(--warning)] flex-shrink-0">
                    Evidence pending
                  </span>
                )}

                {!isCovered && (
                  <Button
                    variant="agent"
                    size="xs"
                    onClick={() =>
                      onPromptAgent(
                        `Investigate requirement "${req.text}". Find supporting evidence in active sources and draft a section to satisfy it.`,
                      )
                    }
                    className="flex-shrink-0 ml-2"
                  >
                    <Sparkles size={10} />
                    <span>Satisfy</span>
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {requirements.length === 0 && (
          <div className="p-4 text-center text-xs text-[var(--ink-muted)] min-w-0">
            No requirements extracted yet. Ask the agent to analyze the uploaded RFP.
          </div>
        )}
      </div>
    </div>
  );
};

export default TraceabilityMatrix;
