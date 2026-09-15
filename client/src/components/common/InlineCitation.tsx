import React, { useState } from "react";
import { FileText, ExternalLink } from "lucide-react";
import type { Citation } from "../../types";

export interface InlineCitationProps {
  index: number;
  citation?: Citation;
  onOpenViewer?: (docId: string, pageNumber?: number, snippet?: string) => void;
}

export function InlineCitationChip({
  index,
  citation,
  onOpenViewer,
}: InlineCitationProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!citation) {
    return (
      <span className="inline-flex items-center justify-center font-mono text-[10px] font-bold text-[var(--ink-blue)] bg-[var(--surface-hover)] px-1 py-0.5 rounded mx-0.5 border border-[var(--hairline)] select-none">
        [{index}]
      </span>
    );
  }

  return (
    <span className="relative inline-block select-none my-0.5">
      <button
        type="button"
        onClick={() =>
          onOpenViewer?.(
            citation.document_id,
            citation.page_number,
            citation.snippet,
          )
        }
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        className="agent-citation-chip inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-[var(--paper-subtle)] hover:bg-[var(--surface-hover)] border border-[var(--hairline-strong)] text-[11px] font-mono font-semibold text-[var(--ink-blue)] cursor-pointer transition-all hover:border-[var(--ink-blue)] hover:shadow-xs focus:outline-none focus:ring-1 focus:ring-[var(--ink-blue)]"
        aria-label={`Citation ${index}: ${citation.document_name}, page ${citation.page_number}`}
      >
        <span>[{index}]</span>
      </button>

      {showTooltip && (
        <div
          role="tooltip"
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-64 p-2.5 rounded-[var(--radius-sm)] bg-[var(--surface)] text-[var(--ink)] text-xs shadow-[var(--shadow-modal)] border border-[var(--hairline-strong)] pointer-events-none animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="flex items-center gap-1.5 font-sans font-semibold text-[11px] text-[var(--ink-blue)] mb-1 truncate">
            <FileText size={12} className="flex-shrink-0" />
            <span className="truncate">{citation.document_name}</span>
            <span className="font-mono text-[10px] text-[var(--ink-muted)] flex-shrink-0">
              p. {citation.page_number}
            </span>
          </div>
          {citation.snippet && (
            <p className="font-sans text-[11px] leading-relaxed text-[var(--ink-secondary)] italic line-clamp-3 border-l-2 border-[var(--ink-sepia-border)] pl-1.5 my-1">
              "{citation.snippet}"
            </p>
          )}
          <div className="flex items-center gap-1 text-[10px] font-mono text-[var(--ink-muted)] mt-1.5 pt-1 border-t border-[var(--hairline-subtle)]">
            <ExternalLink size={9} />
            <span>Click to inspect original passage</span>
          </div>
        </div>
      )}
    </span>
  );
}

export function renderTextWithCitations(
  text: string,
  citations: Citation[],
  onOpenViewer?: (docId: string, pageNumber?: number, snippet?: string) => void,
): React.ReactNode {
  // Matches [1], [2], etc.
  const parts = text.split(/(\[\d+\])/g);

  return parts.map((part, idx) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const citeIndex = parseInt(match[1], 10);
      const citation = citations[citeIndex - 1];
      return (
        <InlineCitationChip
          key={idx}
          index={citeIndex}
          citation={citation}
          onOpenViewer={onOpenViewer}
        />
      );
    }
    return part;
  });
}
