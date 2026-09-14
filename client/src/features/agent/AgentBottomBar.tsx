import React from "react";
import {
  Send,
  RefreshCw,
} from "lucide-react";
import { Button } from "../../components/ui/Button";

export interface ContextualSuggestion {
  id: string;
  label: string;
  prompt: string;
}

export interface AgentBottomBarProps {
  promptInput: string;
  isAgentRunning: boolean;
  selectedSourcesCount: number;
  disabledReason?: string;
  compact?: boolean;
  suggestions: ContextualSuggestion[];
  onPromptChange: (value: string) => void;
  onSubmitPrompt: (customPrompt?: string) => void;
}

export const AgentBottomBar: React.FC<AgentBottomBarProps> = ({
  promptInput,
  isAgentRunning,
  selectedSourcesCount,
  disabledReason,
  compact = false,
  suggestions,
  onPromptChange,
  onSubmitPrompt,
}) => {
  return (
    <div className="border-t border-[var(--hairline)] bg-[var(--surface)] p-3 min-w-0 w-full z-10">
      {/* Contextual Suggestion Chips */}
      {suggestions.length > 0 && !isAgentRunning && !disabledReason && (
        <div
          className={`flex gap-1.5 pb-2 mb-1 scrollbar-none min-w-0 w-full ${
            compact ? "flex-wrap" : "items-center overflow-x-auto"
          }`}
        >
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--ink-faint)] flex-shrink-0 mr-0.5">
            Suggested:
          </span>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              onClick={() => onSubmitPrompt(suggestion.prompt)}
              className="inline-flex items-center px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--paper)] hover:bg-[var(--surface-hover)] border border-[var(--hairline)] text-[11px] text-[var(--ink-secondary)] hover:text-[var(--ink)] font-medium transition-colors cursor-pointer"
              title={suggestion.prompt}
            >
              <span>{suggestion.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input Composer */}
      <div
        className={`flex gap-2 min-w-0 w-full ${
          compact ? "flex-col items-stretch" : "items-center"
        }`}
      >
        <div className="flex-1 min-w-0 relative flex items-center rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--paper)] focus-within:border-[var(--ink-blue-border)] focus-within:ring-2 focus-within:ring-[var(--ink-blue-faint)] transition-all">
          <textarea
            rows={compact ? 3 : 1}
            value={promptInput}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmitPrompt();
              }
            }}
            disabled={isAgentRunning || Boolean(disabledReason)}
            aria-label="Ask Groundwork AI"
            placeholder={
              isAgentRunning
                ? "Groundwork AI is analyzing selected research sources and evidence…"
                : disabledReason
                  ? disabledReason
                : "Ask a question, find evidence, or draft a research synthesis…"
            }
            className="w-full min-h-9 max-h-28 resize-none px-3 py-2 text-[13px] leading-5 text-[var(--ink)] placeholder:text-[var(--ink-faint)] bg-transparent outline-none font-sans min-w-0"
          />
        </div>

        <Button
          variant="agent"
          size="md"
          onClick={() => onSubmitPrompt()}
          disabled={!promptInput.trim() || isAgentRunning || Boolean(disabledReason)}
          title="Send to Groundwork AI"
          className={compact ? "w-full" : "flex-shrink-0"}
        >
          {isAgentRunning ? (
            <RefreshCw size={13} className="spin flex-shrink-0" />
          ) : (
            <Send size={13} className="flex-shrink-0" />
          )}
          <span className={compact ? "inline" : "hidden xs:inline"}>
            {isAgentRunning ? "Working…" : "Ask AI"}
          </span>
        </Button>
      </div>
      <p className="mt-1.5 px-0.5 text-[10px] leading-relaxed text-[var(--ink-muted)]">
        {disabledReason ??
          `Groundwork AI will use ${selectedSourcesCount} selected source${selectedSourcesCount === 1 ? "" : "s"}. Review generated changes and citations before export.`}
      </p>
    </div>
  );
};

export default AgentBottomBar;
