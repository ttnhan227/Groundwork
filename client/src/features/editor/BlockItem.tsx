import React, { useState } from "react";
import {
  GripVertical,
  Plus,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Search,
  Check,
  Sparkles,
} from "lucide-react";
import type {
  NativeBlock,
  DeliverableReviewFinding,
  DocumentItem,
} from "../../types";
import { Button } from "../../components/ui/Button";

export interface BlockItemProps {
  block: NativeBlock;
  index: number;
  isEditing: boolean;
  matchedFinding?: DeliverableReviewFinding | null;
  sources: DocumentItem[];
  isResolvingFinding?: boolean;
  onUpdateText: (newText: string) => void;
  onOpenViewer: (docId: string, pageNumber?: number) => void;
  onResolveFinding?: (
    finding: DeliverableReviewFinding,
    action: "accept" | "reject",
  ) => void;
  onPromptSection?: (prompt: string) => void;
}

export const BlockItem: React.FC<BlockItemProps> = ({
  block,
  index,
  isEditing,
  matchedFinding,
  sources,
  isResolvingFinding,
  onUpdateText,
  onOpenViewer,
  onResolveFinding,
  onPromptSection,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  // Helper to parse citations from text [Source: Document.pdf, p. 4]
  const renderTextWithCitations = (text: string) => {
    const citationRegex =
      /\[(?:Source|Evidence):\s*([^,\]]+)(?:,\s*p(?:age)?\.?\s*(\d+))?\]/gi;
    const parts: (string | React.ReactNode)[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = citationRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      const docName = match[1]?.trim();
      const pageNum = match[2] ? parseInt(match[2], 10) : 1;
      const matchedDoc = sources.find(
        (s) =>
          s.filename.toLowerCase().includes(docName.toLowerCase()) ||
          docName.toLowerCase().includes(s.filename.toLowerCase()),
      );

      parts.push(
        <button
          key={match.index}
          type="button"
          onClick={() => {
            if (matchedDoc) {
              onOpenViewer(matchedDoc.id, pageNum);
            } else if (sources.length > 0) {
              onOpenViewer(sources[0].id, pageNum);
            }
          }}
          className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] border border-[var(--ink-blue-border)] text-xs font-mono font-medium hover:bg-[var(--surface-hover)] cursor-pointer select-none transition-colors align-baseline"
          title={`Inspect verified evidence on page ${pageNum} of ${docName}`}
        >
          <ExternalLink size={9} />
          <span className="truncate max-w-[120px]">{docName}</span>
          <strong className="text-[10px] opacity-80">p. {pageNum}</strong>
        </button>,
      );
      lastIndex = citationRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  };

  // Section Heading
  if (block.type === "heading") {
    if (isEditing) {
      return (
        <div className="py-2">
          <input
            type="text"
            value={block.text}
            onChange={(e) => onUpdateText(e.target.value)}
            className="w-full font-serif text-xl font-bold text-[var(--ink)] bg-transparent border-b border-[var(--hairline-strong)] pb-1 outline-none focus:border-[var(--ink-blue)]"
          />
        </div>
      );
    }
    return (
      <div className="group relative py-3 mt-4 first:mt-0">
        <h3 className="font-serif text-xl font-bold text-[var(--ink)] tracking-tight leading-snug">
          {block.text}
        </h3>
      </div>
    );
  }

  // Editable textarea mode
  if (isEditing) {
    return (
      <div className="py-1.5">
        <textarea
          value={block.text}
          onChange={(e) => onUpdateText(e.target.value)}
          rows={3}
          className="w-full p-2.5 rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[14px] text-[var(--ink)] leading-relaxed outline-none focus:border-[var(--ink-blue)] focus:ring-2 focus:ring-[var(--ink-blue-faint)] font-sans"
        />
      </div>
    );
  }

  // Discrete Block Row with hover handles and manuscript margin anchor
  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative py-1.5 px-2 -mx-2 rounded-[var(--radius-sm)] transition-colors ${
        matchedFinding
          ? "bg-[var(--warning-bg)] border-l-2 border-[var(--warning)]"
          : "hover:bg-[rgba(0,0,0,0.015)]"
      }`}
    >
      {/* Left Hover Handle (Notion-style) */}
      <div className="absolute -left-6 top-2 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity text-[var(--ink-faint)]">
        <button
          type="button"
          className="p-0.5 hover:text-[var(--ink)] rounded cursor-grab"
          title="Drag block"
        >
          <GripVertical size={13} />
        </button>
      </div>

      <div className="flex items-start gap-2">
        {block.type === "bullet" && (
          <span className="text-[var(--ink-muted)] text-base select-none leading-relaxed">
            •
          </span>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-[14px] text-[var(--ink)] leading-relaxed font-sans">
            {renderTextWithCitations(block.text)}
          </p>

          {/* Inline Finding Alert Callout on Flagged Claim */}
          {matchedFinding && (
            <div className="mt-2.5 p-3 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--warning-border)] shadow-[var(--shadow-subtle)] animate-in fade-in">
              <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-[var(--warning)]">
                <AlertTriangle size={14} className="flex-shrink-0" />
                <span>Verification Finding: Unsupported Claim</span>
                <span className="ml-auto text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--warning-bg)] border border-[var(--warning-border)]">
                  {matchedFinding.severity} severity
                </span>
              </div>

              <p className="text-xs text-[var(--ink-secondary)] leading-normal mb-2.5 font-sans">
                {matchedFinding.explanation}
              </p>

              {matchedFinding.proposed_text && (
                <div className="mb-2.5 p-2 rounded-[var(--radius-xs)] bg-[var(--ink-sepia-subtle)] border border-[var(--ink-sepia-border)]">
                  <div className="text-[10px] font-mono text-[var(--ink-sepia)] font-semibold mb-0.5">
                    Proposed Revision (Cited 99.99% SLA):
                  </div>
                  <p className="text-xs font-mono text-[var(--ink-sepia)]">
                    "{matchedFinding.proposed_text}"
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2">
                {onResolveFinding && (
                  <Button
                    variant="agent"
                    size="xs"
                    onClick={() => onResolveFinding(matchedFinding, "accept")}
                    disabled={isResolvingFinding}
                  >
                    <CheckCircle2 size={12} />
                    <span>Apply Verified Revision</span>
                  </Button>
                )}

                {onPromptSection && (
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() =>
                      onPromptSection(
                        `Investigate unsupported claim "${matchedFinding.claim_text}". Find matching evidence in active sources and revise paragraph.`,
                      )
                    }
                  >
                    <Search size={12} />
                    <span>Audit Evidence</span>
                  </Button>
                )}

                {onResolveFinding && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => onResolveFinding(matchedFinding, "reject")}
                    disabled={isResolvingFinding}
                    className="text-[var(--ink-muted)] hover:text-[var(--ink)] ml-auto"
                  >
                    Waive
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Block Quick Actions Bar on Hover (when no open finding) */}
          {!matchedFinding && isHovered && onPromptSection && (
            <div className="mt-1 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  onPromptSection(
                    `Analyze evidence supporting section: "${block.text.slice(0, 80)}..."`,
                  )
                }
                className="text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink-blue)] h-5 px-1.5"
              >
                <ShieldCheck size={11} className="text-[var(--ink-blue)]" />
                <span>Explain Evidence</span>
              </Button>

              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  onPromptSection(
                    `Audit section for missing RFP requirements: "${block.text.slice(0, 80)}..."`,
                  )
                }
                className="text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink-sepia)] h-5 px-1.5"
              >
                <Sparkles size={11} className="text-[var(--ink-sepia)]" />
                <span>Audit Section</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BlockItem;
