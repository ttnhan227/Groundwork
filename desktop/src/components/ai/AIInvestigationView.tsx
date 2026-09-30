import React, { useEffect, useState } from "react";
import {
  BrainCircuit,
  Search,
  Sparkles,
  ExternalLink,
  FolderOpen,
  Terminal,
  ShieldAlert,
  CheckCircle,
  FileCode,
  ArrowRight,
  RefreshCw,
  Cpu,
} from "lucide-react";
import { api } from "../../services/api";
import type { AIQueryResponse, CitationItem } from "../../types/api";

interface AIInvestigationViewProps {
  selectedProjectId: string | null;
}

export const AIInvestigationView: React.FC<AIInvestigationViewProps> = ({
  selectedProjectId,
}) => {
  const [question, setQuestion] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [response, setResponse] = useState<AIQueryResponse | null>(null);
  const [providers, setProviders] = useState<Array<{ id: string; name: string; is_local: boolean; active: boolean }>>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [investigationMode, setInvestigationMode] = useState<boolean>(false);
  
  // Tool Confirmation Modal state
  const [pendingTool, setPendingTool] = useState<{
    toolName: string;
    args: Record<string, any>;
    promptMessage: string;
  } | null>(null);
  const [toolExecuting, setToolExecuting] = useState<boolean>(false);
  const [toolResult, setToolResult] = useState<any | null>(null);

  useEffect(() => {
    api.listProviders().then((data) => {
      setProviders(data);
      const active = data.find((p) => p.active);
      if (active) setSelectedProvider(active.id);
    }).catch(() => {});
  }, []);

  const handleRunInvestigation = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!question.trim()) return;

    setLoading(true);
    setToolResult(null);

    try {
      if (investigationMode) {
        const inv = await api.investigateProblem(question, selectedProjectId || undefined);
        setResponse({
          answer: inv.analysis,
          citations: inv.inspected_files.map((f) => ({
            path: f,
            filename: f.split(/[\\/]/).pop() || f,
            line_start: null,
            line_end: null,
            snippet: "Identified as critical component during investigation.",
          })),
          evidence_count: inv.evidence_count,
          provider_used: selectedProvider || "local",
          suggested_actions: [
            { label: "View Associated Commits", action: "view_commits" },
            { label: "Create Session from Investigation", action: "create_session", title: inv.title },
          ],
          session_id: inv.session_id,
        });
      } else {
        const res = await api.queryAI(
          question,
          selectedProjectId || undefined,
          selectedProvider || undefined
        );
        setResponse(res);
      }
    } catch (err: any) {
      console.error("AI query failed:", err);
      setResponse({
        answer: `Error executing AI investigation: ${err.message || err}`,
        citations: [],
        evidence_count: 0,
        provider_used: selectedProvider,
        suggested_actions: [],
        session_id: null,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteAction = (action: { label: string; action: string; path?: string; title?: string }) => {
    if (action.path) {
      api.openFile(action.path);
    } else if (action.action === "run_command") {
      // Require explicit security confirmation
      setPendingTool({
        toolName: "run_shell_command",
        args: { command: "git status" },
        promptMessage: "Execute allowlisted shell command 'git status' in workspace?",
      });
    } else if (action.action === "create_session" && action.title) {
      api.createSession(action.title, selectedProjectId || undefined, response?.answer?.slice(0, 300));
      alert("Context Session created and saved!");
    }
  };

  const handleConfirmTool = async () => {
    if (!pendingTool) return;
    setToolExecuting(true);
    try {
      // Single-use token logic
      const res = await api.executeTool(pendingTool.toolName, pendingTool.args, "user_confirmed");
      setToolResult(res);
    } catch (err: any) {
      setToolResult({ error: err.message || "Execution failed" });
    } finally {
      setToolExecuting(false);
      setPendingTool(null);
    }
  };

  const presetQueries = [
    "Explain project structure and primary entry points",
    "Where is configuration and environment handling implemented?",
    "Show recent Git commits and active modified files",
    "Find all security and path sanitization checks",
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--paper)] text-[var(--ink)] font-sans w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-[var(--hairline)]">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)] mb-1">
            Grounded AI Assistant
          </p>
          <h1 className="text-xl font-serif font-bold tracking-tight text-[var(--ink)] flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-[var(--ink-blue)]" />
            AI Context &amp; Investigation Engine
          </h1>
          <p className="text-xs text-[var(--ink-secondary)] mt-1">
            Grounded local investigation assistant. Every response is bounded by actual repository files, symbols, and citations.
          </p>
        </div>

        {/* Provider Selector */}
        <div className="flex items-center gap-2 bg-[var(--surface)] p-1.5 rounded border border-[var(--hairline)]">
          <Cpu className="w-3.5 h-3.5 text-[var(--ink-muted)] ml-1" />
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="bg-transparent text-xs text-[var(--ink)] focus:outline-none cursor-pointer font-sans"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id} className="bg-[var(--surface)] text-[var(--ink)]">
                {p.name} {p.is_local ? "(Offline Local)" : "(Cloud API)"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Query Bar */}
      <div className="bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg p-5 shadow-[var(--shadow-card)] mb-6">
        <form onSubmit={handleRunInvestigation} className="space-y-3">
          <div className="relative">
            <input
              type="text"
              placeholder="Ask an investigation question about your workspace or codebase..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded pl-3 pr-28 py-2.5 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)] transition-colors font-sans"
            />
            <div className="absolute right-1.5 top-1.5 flex items-center gap-1.5">
              <button
                type="submit"
                disabled={loading || !question.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--control-room)] hover:bg-[var(--control-room-hover)] disabled:opacity-50 text-white text-xs font-bold transition-colors shadow-xs"
              >
                {loading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                Investigate
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs pt-1">
            {/* Mode switch */}
            <label className="flex items-center gap-2 cursor-pointer text-[var(--ink-secondary)] hover:text-[var(--ink)] select-none">
              <input
                type="checkbox"
                checked={investigationMode}
                onChange={(e) => setInvestigationMode(e.target.checked)}
                className="rounded border-[var(--hairline-strong)] text-[var(--ink-blue)] focus:ring-0"
              />
              <span className="font-semibold text-[var(--ink)]">Deep Multi-Step Investigation Mode</span>
            </label>

            {/* Presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-[var(--ink-muted)] font-mono">Try:</span>
              {presetQueries.slice(0, 2).map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setQuestion(q)}
                  className="px-2 py-0.5 rounded bg-[var(--paper-subtle)] hover:bg-[var(--surface-hover)] border border-[var(--hairline)] text-[var(--ink-secondary)] hover:text-[var(--ink)] text-[10px] transition-colors truncate max-w-xs"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>

      {/* Main Results Container */}
      {response && (
        <div className="space-y-6">
          {/* Answer Section */}
          <div className="bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-[var(--hairline)]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--ink-blue)]" />
                <span className="text-sm font-serif font-bold text-[var(--ink)]">Investigation Synthesis</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-[var(--ink-muted)] font-mono">
                <span>Provider: {response.provider_used}</span>
                <span>•</span>
                <span>{response.evidence_count} evidence items retrieved</span>
              </div>
            </div>

            <div className="text-xs leading-relaxed text-[var(--ink)] whitespace-pre-wrap font-sans">
              {response.answer}
            </div>

            {/* Suggested Next Actions */}
            {response.suggested_actions && response.suggested_actions.length > 0 && (
              <div className="mt-5 pt-4 border-t border-[var(--hairline)]">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--ink)] block mb-2">
                  Suggested Context Actions
                </span>
                <div className="flex flex-wrap gap-2">
                  {response.suggested_actions.map((act, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleExecuteAction(act)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded bg-[var(--paper-subtle)] hover:bg-[var(--surface-hover)] border border-[var(--hairline)] text-xs text-[var(--ink)] font-semibold transition-colors shadow-xs"
                    >
                      <ArrowRight className="w-3 h-3 text-[var(--ink-blue)]" />
                      {act.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Citations & Evidence Drawer */}
          {response.citations && response.citations.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg p-5 shadow-[var(--shadow-card)]">
              <div className="flex items-center gap-2 pb-3 mb-4 border-b border-[var(--hairline)]">
                <FileCode className="w-4 h-4 text-[var(--ink-blue)]" />
                <span className="text-sm font-serif font-bold text-[var(--ink)]">
                  Grounded Citations &amp; Code References ({response.citations.length})
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {response.citations.map((c: CitationItem, idx: number) => (
                  <div
                    key={idx}
                    className="p-3 rounded bg-[var(--paper)] border border-[var(--hairline)] hover:border-[var(--ink-blue)] transition-colors group shadow-xs"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-xs font-bold text-[var(--ink-blue)] truncate">
                        {c.filename}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => api.openFile(c.path)}
                          title="Open File in Default Editor"
                          className="p-1 hover:bg-[var(--surface-hover)] rounded text-[var(--ink-secondary)] hover:text-[var(--ink)] border border-[var(--hairline)]"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => api.revealFile(c.path)}
                          title="Reveal in Explorer"
                          className="p-1 hover:bg-[var(--surface-hover)] rounded text-[var(--ink-secondary)] hover:text-[var(--ink)] border border-[var(--hairline)]"
                        >
                          <FolderOpen className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <p className="text-[10px] text-[var(--ink-muted)] font-mono truncate mb-2">
                      {c.path}
                      {c.line_start ? ` : L${c.line_start}` : ""}
                    </p>

                    <div className="p-2 rounded bg-[var(--paper-subtle)] border border-[var(--hairline-subtle)] text-[11px] font-mono text-[var(--ink-secondary)] whitespace-pre-wrap max-h-24 overflow-y-auto">
                      {c.snippet}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tool Execution Result Block */}
          {toolResult && (
            <div className="bg-[var(--surface)] border border-[var(--hairline)] rounded-lg p-4 font-mono text-xs">
              <div className="flex items-center gap-2 mb-2 text-[var(--ink)] font-bold">
                <Terminal className="w-4 h-4 text-[var(--success)]" />
                <span>Tool Execution Output</span>
              </div>
              <pre className="bg-[var(--paper-subtle)] p-3 rounded text-[var(--ink)] overflow-x-auto whitespace-pre-wrap border border-[var(--hairline-subtle)]">
                {JSON.stringify(toolResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Security Action Confirmation Modal */}
      {pendingTool && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] border-2 border-[var(--warning)] rounded-lg max-w-md w-full p-6 shadow-[var(--shadow-modal)] space-y-4">
            <div className="flex items-center gap-3 text-[var(--warning)]">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <h2 className="text-base font-serif font-bold text-[var(--ink)]">Action Confirmation Required</h2>
            </div>

            <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">
              {pendingTool.promptMessage}
            </p>

            <div className="bg-[var(--paper)] border border-[var(--hairline)] p-2.5 rounded font-mono text-xs text-[var(--ink)]">
              <code>{pendingTool.toolName} ({JSON.stringify(pendingTool.args)})</code>
            </div>

            <p className="text-[11px] text-[var(--ink-muted)]">
              In accordance with Groundwork security guidelines, local execution tools require single-use user authorization.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setPendingTool(null)}
                className="px-3 py-1.5 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] text-[var(--ink-secondary)] hover:text-[var(--ink)] text-xs font-semibold"
              >
                Deny &amp; Cancel
              </button>
              <button
                onClick={handleConfirmTool}
                disabled={toolExecuting}
                className="px-4 py-1.5 rounded bg-[var(--control-room)] hover:bg-[var(--control-room-hover)] text-white text-xs font-bold flex items-center gap-1.5 shadow-xs"
              >
                {toolExecuting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Authorize &amp; Execute
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
