import React, { useRef, useEffect, useState } from "react";
import {
  RefreshCw,
  Check,
  Square,
  ExternalLink,
  Bot,
  User,
  MessageSquareText,
  Copy,
  RotateCcw,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { copyTextToClipboard, formatDateTime } from "../../api/client";
import type { ChatMessage, AgentTaskStep } from "../../types";

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return parts.filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={key}
          className="rounded bg-[var(--paper-subtle)] px-1 py-0.5 font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return <span key={key}>{part}</span>;
  });
}

function AssistantMessageContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const headingClass =
        level === 1
          ? "font-serif text-sm font-bold text-[var(--ink)] mt-2 mb-1"
          : level === 2
            ? "font-serif text-xs font-bold text-[var(--ink)] mt-2 mb-1"
            : "font-mono text-[11px] font-semibold text-[var(--ink-secondary)] mt-1.5 mb-0.5 uppercase tracking-wide";
      blocks.push(
        <div key={`heading-${index}`} className={headingClass}>
          {renderInlineMarkdown(text, `heading-${index}`)}
        </div>,
      );
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul
          key={`list-${index}`}
          className="my-1 list-disc space-y-1 pl-4 text-xs leading-relaxed"
        >
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>
              {renderInlineMarkdown(item, `item-${index}-${itemIndex}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3})\s+/.test(lines[index].trim()) &&
      !/^[-*]\s+/.test(lines[index].trim())
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const paragraph = paragraphLines.join(" ");
    blocks.push(
      <p key={`paragraph-${index}`} className="my-1 text-xs leading-relaxed">
        {renderInlineMarkdown(paragraph, `paragraph-${index}`)}
      </p>,
    );
  }

  return <div className="space-y-1">{blocks}</div>;
}

export interface AgentReasoningDrawerProps {
  isAgentRunning: boolean;
  messages: ChatMessage[];
  activeSteps: AgentTaskStep[];
  streamingText: string;
  placement?: "inline" | "side";
  onStopAgent: () => void;
  onClearHistory?: () => void;
  onOpenViewer?: (docId: string, pageNumber?: number) => void;
}

export const AgentReasoningDrawer: React.FC<AgentReasoningDrawerProps> = ({
  isAgentRunning,
  messages,
  activeSteps,
  streamingText,
  placement = "inline",
  onStopAgent,
  onClearHistory,
  onOpenViewer,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, activeSteps, isAgentRunning]);

  const isSidePanel = placement === "side";

  return (
    <div
      className={
        isSidePanel
          ? "flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--paper)] min-w-0 w-full select-text"
          : "border-t border-[var(--hairline)] bg-[var(--paper-subtle)] max-h-72 flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 min-w-0 w-full select-text"
      }
    >
      {/* Header */}
      <div className="px-4 py-2 border-b border-[var(--hairline)] bg-[var(--surface)] flex items-center justify-between text-xs min-w-0">
        <div className="flex items-center gap-2 font-mono text-[var(--ink-sepia)] font-semibold min-w-0">
          <MessageSquareText size={13} className="flex-shrink-0" />
          <span className="truncate">Activity</span>
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          {messages.length > 0 && !isAgentRunning && onClearHistory && (
            <button
              type="button"
              onClick={onClearHistory}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-[var(--ink-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-bg)] transition-colors cursor-pointer"
              title="Clear assistant chat and start over"
            >
              <RotateCcw size={10} />
              <span>Start over</span>
            </button>
          )}

          {isAgentRunning && (
            <Button
              variant="danger"
              size="xs"
              onClick={onStopAgent}
              className="flex-shrink-0 ml-1"
            >
              <Square size={11} />
              <span>Stop</span>
            </Button>
          )}
        </div>
      </div>

      {/* Message & Step Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-w-0 select-text">
        {messages.length === 0 && !isAgentRunning && (
          <div className="border border-[var(--hairline)] bg-[var(--surface)] p-4 text-xs leading-relaxed text-[var(--ink-secondary)]">
            <div className="flex items-center gap-2 font-semibold text-[var(--ink)]">
              <Bot size={14} className="text-[var(--ink-sepia)]" />
              Ask about this response
            </div>
            <p className="mt-2">
              Ask questions, extract evidence, generate study guides, or compare perspectives
              grounded directly in the sources selected on the left.
            </p>
          </div>
        )}
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`p-3 rounded-[var(--radius-sm)] border text-xs leading-relaxed min-w-0 select-text ${
              msg.role === "user"
                ? "bg-[var(--surface)] border-[var(--hairline)] text-[var(--ink)]"
                : "bg-[var(--ink-sepia-subtle)] border-[var(--ink-sepia-border)] text-[var(--ink)]"
            }`}
          >
            <div className="flex items-center justify-between gap-1.5 mb-1.5 min-w-0">
              <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-[var(--ink-muted)] min-w-0">
                {msg.role === "user" ? (
                  <>
                    <User
                      size={12}
                      className="text-[var(--ink-blue)] flex-shrink-0"
                    />
                    <span className="text-[var(--ink-blue)] truncate">You</span>
                  </>
                ) : (
                  <>
                    <Bot
                      size={12}
                      className="text-[var(--ink-sepia)] flex-shrink-0"
                    />
                    <span className="text-[var(--ink-sepia)] truncate">
                      Groundwork AI
                    </span>
                  </>
                )}
                {msg.created_at && (
                  <span className="text-[9px] font-normal text-[var(--ink-faint)] ml-1 flex-shrink-0">
                    {formatDateTime(msg.created_at)}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={async () => {
                  const ok = await copyTextToClipboard(msg.content);
                  if (ok) {
                    setCopiedIndex(idx);
                    setTimeout(() => setCopiedIndex(null), 2000);
                  }
                }}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer select-none"
                title="Copy message text"
                aria-label="Copy message text"
              >
                {copiedIndex === idx ? (
                  <>
                    <Check size={10} className="text-[var(--success)]" />
                    <span className="text-[var(--success)]">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={10} />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            <div className="font-sans break-words select-text">
              {msg.role === "assistant" ? (
                <AssistantMessageContent content={msg.content} />
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>

            {/* Citations */}
            {msg.citations && msg.citations.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-[var(--hairline-subtle)] min-w-0">
                {msg.citations.map((c, cIdx) => (
                  <button
                    key={cIdx}
                    type="button"
                    onClick={() => onOpenViewer?.(c.document_id, c.page_number)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--surface)] hover:bg-[var(--paper)] border border-[var(--hairline)] text-[10px] font-mono text-[var(--ink-blue)] transition-colors cursor-pointer max-w-full truncate"
                  >
                    <ExternalLink size={9} className="flex-shrink-0" />
                    <span className="truncate max-w-[120px]">
                      {c.document_name}
                    </span>
                    <strong className="flex-shrink-0">
                      p. {c.page_number}
                    </strong>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Live Active Execution Card */}
        {isAgentRunning && (
          <div className="p-3 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--ink-sepia-border)] shadow-[var(--shadow-subtle)] space-y-2 min-w-0">
            <div className="flex items-center gap-2 text-xs font-mono font-semibold text-[var(--ink-sepia)] min-w-0">
              <RefreshCw
                size={12}
                className="spin text-[var(--ink-sepia)] flex-shrink-0"
              />
              <span className="truncate">Current progress:</span>
            </div>

            <div className="space-y-1 pl-4 border-l-2 border-[var(--ink-sepia-border)] min-w-0">
              {activeSteps.map((step, sIdx) => (
                <div
                  key={sIdx}
                  className="flex items-center gap-2 text-xs font-mono min-w-0"
                >
                  {step.status === "completed" ? (
                    <Check
                      size={12}
                      className="text-[var(--success)] flex-shrink-0"
                    />
                  ) : (
                    <RefreshCw
                      size={11}
                      className="spin text-[var(--ink-sepia)] flex-shrink-0"
                    />
                  )}
                  <span
                    className={`truncate ${step.status === "completed" ? "text-[var(--ink-muted)] line-through" : "text-[var(--ink)] font-medium"}`}
                  >
                    {step.label}
                  </span>
                </div>
              ))}
            </div>

            {streamingText && (
              <div className="p-2 rounded bg-[var(--ink-sepia-subtle)] font-mono text-xs text-[var(--ink-sepia)] whitespace-pre-wrap break-words agent-drafting select-text min-w-0">
                {streamingText}
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default AgentReasoningDrawer;
