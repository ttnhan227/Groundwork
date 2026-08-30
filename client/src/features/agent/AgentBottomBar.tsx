import React from "react";
import {
  Sparkles,
  Send,
  RefreshCw,
  PanelBottomClose,
  PanelBottomOpen,
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
  isDrawerOpen: boolean;
  suggestions: ContextualSuggestion[];
  onPromptChange: (value: string) => void;
  onSubmitPrompt: (customPrompt?: string) => void;
  onToggleDrawer: () => void;
}

export const AgentBottomBar: React.FC<AgentBottomBarProps> = ({
  promptInput,
  isAgentRunning,
  isDrawerOpen,
  suggestions,
  onPromptChange,
  onSubmitPrompt,
  onToggleDrawer,
}) => {
  return (
    <div className="border-t border-[var(--hairline)] bg-[var(--surface)] p-2.5 sm:p-3 select-none min-w-0 w-full z-10">
      {/* Contextual Suggestion Chips */}
      {suggestions.length > 0 && !isAgentRunning && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-1 scrollbar-none min-w-0 w-full">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--ink-faint)] flex-shrink-0 mr-0.5">
            Suggested:
          </span>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              onClick={() => onSubmitPrompt(suggestion.prompt)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-full)] bg-[var(--paper)] hover:bg-[var(--surface-hover)] border border-[var(--hairline)] text-xs text-[var(--ink-secondary)] hover:text-[var(--ink)] font-medium transition-colors cursor-pointer flex-shrink-0"
              title={suggestion.prompt}
            >
              <Sparkles
                size={11}
                className="text-[var(--ink-sepia)] flex-shrink-0"
              />
              <span>{suggestion.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input Composer */}
      <div className="flex items-center gap-2 min-w-0 w-full">
        <div className="flex-1 min-w-0 relative flex items-center rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--paper)] focus-within:border-[var(--ink-blue-border)] focus-within:ring-2 focus-within:ring-[var(--ink-blue-faint)] transition-all">
          <input
            type="text"
            value={promptInput}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmitPrompt();
              }
            }}
            disabled={isAgentRunning}
            placeholder={
              isAgentRunning
                ? "Agent is analyzing evidence and drafting…"
                : "Ask agent to draft, verify claims, or audit against RFP specifications…"
            }
            className="w-full h-9 px-3 text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] bg-transparent outline-none font-sans min-w-0"
          />

          <button
            type="button"
            onClick={onToggleDrawer}
            className="px-2 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors text-xs flex items-center gap-1 font-mono cursor-pointer flex-shrink-0"
            title={
              isDrawerOpen
                ? "Minimize reasoning drawer"
                : "Open agent reasoning history"
            }
          >
            {isDrawerOpen ? (
              <PanelBottomClose size={14} />
            ) : (
              <PanelBottomOpen size={14} />
            )}
          </button>
        </div>

        <Button
          variant="agent"
          size="md"
          onClick={() => onSubmitPrompt()}
          disabled={!promptInput.trim() || isAgentRunning}
          title="Execute agent task"
          className="flex-shrink-0"
        >
          {isAgentRunning ? (
            <RefreshCw size={13} className="spin flex-shrink-0" />
          ) : (
            <Send size={13} className="flex-shrink-0" />
          )}
          <span className="hidden xs:inline">
            {isAgentRunning ? "Drafting…" : "Draft"}
          </span>
        </Button>
      </div>
    </div>
  );
};

export default AgentBottomBar;
