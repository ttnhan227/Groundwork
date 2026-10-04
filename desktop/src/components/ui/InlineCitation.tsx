import React, { useState } from "react";
import { FileCode, ExternalLink } from "lucide-react";

export interface CitationItem {
  file_path: string;
  line_start?: number;
  line_end?: number;
  snippet?: string;
  symbol_name?: string;
}

export interface InlineCitationProps {
  index: number;
  citation?: CitationItem;
  onOpenFile?: (path: string, line?: number) => void;
}

export function InlineCitationChip({
  index,
  citation,
  onOpenFile,
}: InlineCitationProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!citation) {
    return (
      <span className="inline-flex items-center justify-center font-mono text-xs font-bold text-[var(--ink-blue)] bg-[var(--surface-hover)] px-1 py-0.5 rounded mx-0.5 border border-[var(--hairline)] select-none">
        [{index}]
      </span>
    );
  }

  const filename =
    citation.file_path.split(/[/\\]/).pop() || citation.file_path;

  return (
    <span className="relative inline-block select-none my-0.5">
      <button
        type="button"
        onClick={() => onOpenFile?.(citation.file_path, citation.line_start)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        className="agent-citation-chip inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--paper-subtle)] hover:bg-[var(--surface-hover)] border border-[var(--hairline-strong)] text-sm font-mono font-semibold text-[var(--ink-blue)] cursor-pointer transition-all hover:border-[var(--ink-blue)] hover:shadow-xs focus:outline-none focus:ring-1 focus:ring-[var(--ink-blue)]"
        aria-label={`Source citation ${index}: ${filename}${citation.line_start ? ` line ${citation.line_start}` : ""}`}
      >
        <span>[{index}]</span>
      </button>

      {showTooltip && (
        <div
          role="tooltip"
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-72 p-2.5 rounded-[var(--radius-sm)] bg-[var(--surface)] text-[var(--ink)] text-xs shadow-[var(--shadow-modal)] border border-[var(--hairline-strong)] pointer-events-none animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="flex items-center gap-1.5 font-mono font-semibold text-sm text-[var(--ink-blue)] mb-1 truncate">
            <FileCode size={12} className="shrink-0" />
            <span className="truncate">{filename}</span>
            {citation.line_start && (
              <span className="text-xs text-[var(--ink-muted)] shrink-0">
                L{citation.line_start}
                {citation.line_end ? `-${citation.line_end}` : ""}
              </span>
            )}
          </div>
          {citation.snippet && (
            <p className="font-mono text-xs leading-relaxed text-[var(--ink-secondary)] italic line-clamp-4 border-l-2 border-[var(--ink-sepia-border)] pl-1.5 my-1 bg-[var(--paper)] p-1 rounded-xs">
              {citation.snippet}
            </p>
          )}
          <div className="flex items-center gap-1 text-xs font-mono text-[var(--ink-muted)] mt-1.5 pt-1 border-t border-[var(--hairline-subtle)]">
            <ExternalLink size={9} />
            <span>Click to inspect file in editor</span>
          </div>
        </div>
      )}
    </span>
  );
}

export default InlineCitationChip;
