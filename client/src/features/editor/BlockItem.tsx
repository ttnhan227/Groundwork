import React, { useState } from "react";
import {
  GripVertical,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Search,
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
  index: _index,
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

  // Helper to parse formatting tokens (bold, code, italic)
  const renderFormattingOnly = (raw: string, prefix: string): React.ReactNode => {
    const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
    const tokens = raw.split(tokenRegex);
    return tokens.map((tok, i) => {
      if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
        return (
          <strong key={`${prefix}-b-${i}`} className="font-semibold text-[var(--ink)]">
            {tok.slice(2, -2)}
          </strong>
        );
      }
      if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
        return (
          <code
            key={`${prefix}-c-${i}`}
            className="px-1 py-0.5 rounded bg-[var(--surface-muted)] text-[12px] font-mono text-[var(--ink-blue)]"
          >
            {tok.slice(1, -1)}
          </code>
        );
      }
      if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
        return (
          <em key={`${prefix}-i-${i}`} className="italic text-[var(--ink)]">
            {tok.slice(1, -1)}
          </em>
        );
      }
      return tok;
    });
  };

  // Helper to parse citations and inline formatting from text [Source: Document.pdf, p. 4]
  const renderInlineContent = (text: string, keyPrefix = "inline"): React.ReactNode => {
    const citationRegex =
      /\[(?:Source|Evidence):\s*([^,\]]+)(?:,\s*p(?:age)?\.?\s*(\d+))?\]/gi;
    const parts: (string | React.ReactNode)[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = citationRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(
          renderFormattingOnly(
            text.slice(lastIndex, match.index),
            `${keyPrefix}-${lastIndex}`,
          ),
        );
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
          key={`${keyPrefix}-cit-${match.index}`}
          type="button"
          onClick={() => {
            if (matchedDoc) {
              onOpenViewer(matchedDoc.id, pageNum);
            } else if (sources.length > 0) {
              onOpenViewer(sources[0].id, pageNum);
            }
          }}
          className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] border border-[var(--ink-blue-border)] text-xs font-mono font-medium hover:bg-[var(--surface-hover)] cursor-pointer select-none transition-colors align-baseline"
          title={`Inspect cited evidence on page ${pageNum} of ${docName}`}
        >
          <ExternalLink size={9} />
          <span className="truncate max-w-[120px]">{docName}</span>
          <strong className="text-[10px] opacity-80">p. {pageNum}</strong>
        </button>,
      );
      lastIndex = citationRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(
        renderFormattingOnly(
          text.slice(lastIndex),
          `${keyPrefix}-${lastIndex}`,
        ),
      );
    }

    return parts;
  };

  // Structured multi-line Markdown parser for notes and synthesis documents
  const renderFormattedContent = (content: string) => {
    const lines = content.split("\n");
    const elements: React.ReactNode[] = [];
    let bulletGroup: string[] = [];
    let numGroup: string[] = [];

    const flushLists = (idx: number) => {
      if (bulletGroup.length > 0) {
        elements.push(
          <ul key={`ul-${idx}`} className="my-2 pl-5 list-disc space-y-1 text-[13px] text-[var(--ink)] leading-relaxed">
            {bulletGroup.map((bText, bIdx) => (
              <li key={`b-${idx}-${bIdx}`}>
                {renderInlineContent(bText, `b-${idx}-${bIdx}`)}
              </li>
            ))}
          </ul>,
        );
        bulletGroup = [];
      }
      if (numGroup.length > 0) {
        elements.push(
          <ol key={`ol-${idx}`} className="my-2 pl-5 list-decimal space-y-1 text-[13px] text-[var(--ink)] leading-relaxed">
            {numGroup.map((nText, nIdx) => (
              <li key={`n-${idx}-${nIdx}`}>
                {renderInlineContent(nText, `n-${idx}-${nIdx}`)}
              </li>
            ))}
          </ol>,
        );
        numGroup = [];
      }
    };

    lines.forEach((line, lIdx) => {
      const trimmed = line.trim();

      if (!trimmed) {
        flushLists(lIdx);
        return;
      }

      // Horizontal rules
      if (/^(---|___|\*\*\*)$/.test(trimmed)) {
        flushLists(lIdx);
        elements.push(
          <hr key={`hr-${lIdx}`} className="my-3 border-t border-[var(--hairline-strong)]" />,
        );
        return;
      }

      // Markdown Headings
      if (trimmed.startsWith("### ")) {
        flushLists(lIdx);
        elements.push(
          <h4
            key={`h4-${lIdx}`}
            className="font-sans text-xs font-bold uppercase tracking-wider text-[var(--ink-sepia)] mt-3 mb-1"
          >
            {renderInlineContent(trimmed.slice(4), `h4-${lIdx}`)}
          </h4>,
        );
        return;
      }
      if (trimmed.startsWith("## ")) {
        flushLists(lIdx);
        elements.push(
          <h3
            key={`h3-${lIdx}`}
            className="font-serif text-base font-bold text-[var(--ink)] mt-3.5 mb-1 text-[var(--ink)]"
          >
            {renderInlineContent(trimmed.slice(3), `h3-${lIdx}`)}
          </h3>,
        );
        return;
      }
      if (trimmed.startsWith("# ")) {
        flushLists(lIdx);
        elements.push(
          <h2
            key={`h2-${lIdx}`}
            className="font-serif text-lg font-bold text-[var(--ink)] mt-4 mb-2 pb-1 border-b border-[var(--hairline)]"
          >
            {renderInlineContent(trimmed.slice(2), `h2-${lIdx}`)}
          </h2>,
        );
        return;
      }

      // Blockquotes
      if (trimmed.startsWith("> ")) {
        flushLists(lIdx);
        elements.push(
          <blockquote
            key={`quote-${lIdx}`}
            className="my-2 pl-3 border-l-2 border-[var(--ink-blue)] italic text-[13px] text-[var(--ink-secondary)] bg-[var(--ink-blue-subtle)] py-1.5 rounded-r"
          >
            {renderInlineContent(trimmed.slice(2), `quote-${lIdx}`)}
          </blockquote>,
        );
        return;
      }

      // Bullet lists (- or * or •)
      const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
      if (bulletMatch) {
        if (numGroup.length > 0) flushLists(lIdx);
        bulletGroup.push(bulletMatch[1]);
        return;
      }

      // Numbered lists (1. 2. etc.)
      const numMatch = trimmed.match(/^\d+\.\s+(.*)$/);
      if (numMatch) {
        if (bulletGroup.length > 0) flushLists(lIdx);
        numGroup.push(numMatch[1]);
        return;
      }

      // Regular paragraph line
      flushLists(lIdx);
      elements.push(
        <p key={`p-${lIdx}`} className="text-[14px] text-[var(--ink)] leading-relaxed font-sans my-1">
          {renderInlineContent(trimmed, `p-${lIdx}`)}
        </p>,
      );
    });

    flushLists(lines.length);
    return elements.length > 0 ? elements : renderInlineContent(content);
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
          <div className="text-[14px] text-[var(--ink)] leading-relaxed font-sans">
            {renderFormattedContent(block.text)}
          </div>

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
                    <span>Apply suggested revision</span>
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
                    <span>Review evidence</span>
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
                    `Audit section against source evidence: "${block.text.slice(0, 80)}..."`,
                  )
                }
                className="text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink-sepia)] h-5 px-1.5"
              >
                <Sparkles size={11} className="text-[var(--ink-sepia)]" />
                <span>Review section</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BlockItem;
