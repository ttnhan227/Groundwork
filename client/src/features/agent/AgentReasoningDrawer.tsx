import React, { useRef, useEffect } from "react";
import {
  RefreshCw,
  Check,
  Square,
  ExternalLink,
  Sparkles,
  Bot,
  User,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { ChatMessage, AgentTaskStep } from "../../types";

export interface AgentReasoningDrawerProps {
  isOpen: boolean;
  isAgentRunning: boolean;
  messages: ChatMessage[];
  activeSteps: AgentTaskStep[];
  streamingText: string;
  onStopAgent: () => void;
  onOpenViewer?: (docId: string, pageNumber?: number) => void;
}

export const AgentReasoningDrawer: React.FC<AgentReasoningDrawerProps> = ({
  isOpen,
  isAgentRunning,
  messages,
  activeSteps,
  streamingText,
  onStopAgent,
  onOpenViewer,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen || isAgentRunning) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingText, activeSteps, isOpen, isAgentRunning]);

  if (!isOpen && !isAgentRunning) return null;

  return (
    <div className="border-t border-[var(--hairline)] bg-[var(--paper-subtle)] max-h-72 flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 min-w-0 w-full">
      {/* Header */}
      <div className="px-4 py-2 border-b border-[var(--hairline)] bg-[var(--surface)] flex items-center justify-between text-xs min-w-0">
        <div className="flex items-center gap-2 font-mono text-[var(--ink-sepia)] font-semibold min-w-0">
          <Sparkles size={13} className="flex-shrink-0" />
          <span className="truncate">Agent Reasoning & Activity Stream</span>
        </div>

        {isAgentRunning && (
          <Button variant="danger" size="xs" onClick={onStopAgent} className="flex-shrink-0 ml-2">
            <Square size={11} />
            <span>Stop</span>
          </Button>
        )}
      </div>

      {/* Message & Step Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-w-0">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`p-3 rounded-[var(--radius-sm)] border text-xs leading-relaxed min-w-0 ${
              msg.role === "user"
                ? "bg-[var(--surface)] border-[var(--hairline)] text-[var(--ink)]"
                : "bg-[var(--ink-sepia-subtle)] border-[var(--ink-sepia-border)] text-[var(--ink)]"
            }`}
          >
            <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-[var(--ink-muted)] mb-1 min-w-0">
              {msg.role === "user" ? (
                <>
                  <User size={12} className="text-[var(--ink-blue)] flex-shrink-0" />
                  <span className="text-[var(--ink-blue)] truncate">You</span>
                </>
              ) : (
                <>
                  <Bot size={12} className="text-[var(--ink-sepia)] flex-shrink-0" />
                  <span className="text-[var(--ink-sepia)] truncate">Agent</span>
                </>
              )}
            </div>

            <div className={`font-sans whitespace-pre-wrap break-words ${msg.role === "assistant" ? "font-mono text-[12px]" : ""}`}>
              {msg.content}
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
                    <span className="truncate max-w-[120px]">{c.document_name}</span>
                    <strong className="flex-shrink-0">p. {c.page_number}</strong>
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
              <RefreshCw size={12} className="spin text-[var(--ink-sepia)] flex-shrink-0" />
              <span className="truncate">Executing reasoning steps:</span>
            </div>

            <div className="space-y-1 pl-4 border-l-2 border-[var(--ink-sepia-border)] min-w-0">
              {activeSteps.map((step, sIdx) => (
                <div key={sIdx} className="flex items-center gap-2 text-xs font-mono min-w-0">
                  {step.status === "completed" ? (
                    <Check size={12} className="text-[var(--success)] flex-shrink-0" />
                  ) : (
                    <RefreshCw size={11} className="spin text-[var(--ink-sepia)] flex-shrink-0" />
                  )}
                  <span className={`truncate ${step.status === "completed" ? "text-[var(--ink-muted)] line-through" : "text-[var(--ink)] font-medium"}`}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>

            {streamingText && (
              <div className="p-2 rounded bg-[var(--ink-sepia-subtle)] font-mono text-xs text-[var(--ink-sepia)] whitespace-pre-wrap break-words agent-drafting min-w-0">
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
