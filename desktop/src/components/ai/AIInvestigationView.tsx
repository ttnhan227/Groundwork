import React, { useEffect, useState } from "react";
import {
  BrainCircuit,
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
import {
  Button,
  Card,
  Badge,
  Modal,
  EmptyState,
  InlineCitationChip,
} from "../ui";

interface AIInvestigationViewProps {
  onChooseFiles?: () => void;
  onConfigure?: () => void;
  selectedProjectId: string | null;
  initialQuestion?: string;
  focusedPath?: string;
  focusedLine?: number;
  sessionId?: string;
}

export const AIInvestigationView: React.FC<AIInvestigationViewProps> = ({
  onChooseFiles,
  onConfigure,
  selectedProjectId,
  initialQuestion = "",
  focusedPath,
  focusedLine,
  sessionId,
}) => {
  const [question, setQuestion] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<AIQueryResponse | null>(null);
  const [providers, setProviders] = useState<
    Array<{ id: string; name: string; is_local: boolean; active: boolean }>
  >([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [investigationMode, setInvestigationMode] = useState<boolean>(false);

  useEffect(() => {
    if (initialQuestion) setQuestion(initialQuestion);
  }, [initialQuestion]);

  // Tool Confirmation Modal state
  const [pendingTool, setPendingTool] = useState<{
    toolName: string;
    args: Record<string, any>;
    promptMessage: string;
    confirmationToken?: string;
  } | null>(null);
  const [toolExecuting, setToolExecuting] = useState<boolean>(false);
  const [toolResult, setToolResult] = useState<any | null>(null);

  useEffect(() => {
    api
      .listProviders()
      .then((data) => {
        setProviders(data);
        const active = data.find((p) => p.active);
        if (active) setSelectedProvider(active.id);
      })
      .catch(() => {});
  }, []);

  const handleRunInvestigation = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!question.trim()) return;

    setLoading(true);
    setError("");
    setToolResult(null);

    try {
      if (investigationMode) {
        const inv = await api.investigateProblem(
          question,
          selectedProjectId || undefined,
          selectedProvider || undefined,
          focusedPath,
          focusedLine,
          sessionId,
        );
        setResponse({
          answer: inv.analysis,
          citations: inv.citations,
          evidence_count: inv.evidence_count,
          provider_used: inv.provider_used,
          suggested_actions: [],
          session_id: inv.session_id,
        });
      } else {
        const res = await api.queryAI(
          question,
          selectedProjectId || undefined,
          selectedProvider || undefined,
          focusedPath,
          focusedLine,
          sessionId,
        );
        setResponse(res);
      }
    } catch (err: any) {
      console.error("AI query failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't answer that question. Please try again.",
      );
      setResponse(null);
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteAction = async (action: {
    label: string;
    action: string;
    path?: string;
    title?: string;
    content?: string;
  }) => {
    if (action.path) {
      api.openFile(action.path);
    } else if (action.action === "create_note" && action.title) {
      try {
        await api.createNote(
          action.title,
          action.content || response?.answer || "",
          selectedProjectId || undefined,
        );
        setToolResult({ status: "saved", message: "Note saved" });
      } catch (error) {
        setToolResult({ error: String(error) });
      }
    } else if (action.action === "run_command") {
      try {
        // Probe execution to obtain a genuine single-use confirmation token
        const probe = await api.executeTool("run_command", {
          command: "git status",
        });
        if (probe.status === "confirmation_required") {
          setPendingTool({
            toolName: "run_command",
            args: { command: "git status" },
            promptMessage:
              probe.prompt ||
              "Execute allowlisted shell command 'git status' in workspace?",
            confirmationToken: probe.confirmation_token,
          });
        }
      } catch (err) {
        console.error("Tool probe failed", err);
      }
    } else if (action.action === "create_session" && action.title) {
      await api.createSession(
        action.title,
        selectedProjectId || undefined,
        response?.answer?.slice(0, 300),
      );
      alert("Your work is saved.");
    }
  };

  const handleConfirmTool = async () => {
    if (!pendingTool) return;
    setToolExecuting(true);
    try {
      const res = await api.executeTool(
        pendingTool.toolName,
        pendingTool.args,
        pendingTool.confirmationToken,
      );
      setToolResult(res);
    } catch (err: any) {
      setToolResult({ error: err.message || "Execution failed" });
    } finally {
      setToolExecuting(false);
      setPendingTool(null);
    }
  };

  const presetQueries = [
    "Help me understand this project",
    "Where are the settings for this project?",
    "What changed recently?",
    "Where should I start reading?",
  ];

  if (!focusedPath)
    return (
      <div className="gw-page max-w-3xl">
        <h1 className="gw-title">Ask about your files</h1>
        <p className="gw-description">
          Choose files first, then ask what you would like to know. Only
          selected files are used for an answer.
        </p>
        <Button variant="primary" onClick={onChooseFiles}>
          Choose files
        </Button>
        {onConfigure && <Button onClick={onConfigure}>AI settings</Button>}
      </div>
    );

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--paper)] text-[var(--ink)] font-sans w-full">
      {/* Header */}
      <div className="flex flex-wrap gap-4 items-center justify-between mb-6 pb-4 border-b border-[var(--hairline)]">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)] mb-1">
            Understand your work
          </p>
          <h1 className="text-xl font-serif font-bold tracking-tight text-[var(--ink)] flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-[var(--ink-blue)]" />
            Ask your files
          </h1>
          <p className="text-xs text-[var(--ink-secondary)] mt-1">
            Ask a question and follow the sources back to your files.
          </p>
        </div>

        {/* Provider Selector */}
        <div className="flex items-center gap-2 bg-[var(--surface)] p-1.5 rounded-[var(--radius-sm)] border border-[var(--hairline)]">
          {onConfigure && (
            <Button onClick={onConfigure} variant="ghost">
              Set up answers
            </Button>
          )}
          <Cpu className="w-3.5 h-3.5 text-[var(--ink-muted)] ml-1" />
          <select
            aria-label="Answer service"
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="bg-transparent text-xs text-[var(--ink)] focus:outline-none cursor-pointer font-sans"
          >
            {providers.map((p) => (
              <option
                key={p.id}
                value={p.id}
                className="bg-[var(--surface)] text-[var(--ink)]"
              >
                {{
                  local: "Matching passages",
                  ollama: "Ollama",
                  openai: "OpenAI",
                  gemini: "Google Gemini",
                }[p.id] || p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Query Bar Card */}
      {providers.find((provider) => provider.id === selectedProvider)
        ?.is_local === false && (
        <p className="mb-3 text-xs text-[var(--ink-sepia)]">
          This service receives your question, selected file path, and readable
          excerpts when you ask. Choose matching passages to stay offline.
        </p>
      )}
      <Card className="mb-6 border-[var(--hairline-strong)]">
        {selectedProvider === "local" && (
          <p className="text-sm text-[var(--ink-secondary)] mb-4">
            Find relevant passages without AI or internet. For written answers,
            choose Set up answers.
          </p>
        )}
        {error && (
          <p role="alert" className="gw-notice mb-4">
            {error}
          </p>
        )}
        <form onSubmit={handleRunInvestigation} className="space-y-3">
          <div className="flex gap-3 items-center">
            <input
              type="text"
              placeholder="What would you like to know about your files?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="gw-input flex-1 min-w-0"
            />
            <div className="flex items-center gap-1.5">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={loading || !question.trim()}
                isLoading={loading}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Ask
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 items-center justify-between text-sm pt-2">
            {/* Mode switch */}
            <label className="flex items-center gap-2 cursor-pointer text-[var(--ink-secondary)] hover:text-[var(--ink)] select-none">
              <input
                type="checkbox"
                checked={investigationMode}
                onChange={(e) => setInvestigationMode(e.target.checked)}
                className="rounded-[var(--radius-xs)] border-[var(--hairline-strong)] text-[var(--ink-blue)] focus:ring-0 cursor-pointer"
              />
              <span className="font-semibold text-[var(--ink)]">
                Explore related files and save this work
              </span>
            </label>

            {/* Presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-[var(--ink-muted)] font-mono">
                Try:
              </span>
              {presetQueries.slice(0, 2).map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setQuestion(q)}
                  className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--paper-subtle)] hover:bg-[var(--surface-hover)] border border-[var(--hairline)] text-[var(--ink-secondary)] hover:text-[var(--ink)] text-xs transition-colors truncate max-w-xs cursor-pointer font-sans"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </form>
      </Card>

      {/* Main Results Container */}
      {response && (
        <div className="space-y-6">
          {/* Answer Section */}
          <Card className="border-[var(--hairline-strong)]">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-[var(--hairline)]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--ink-blue)]" />
                <span className="text-sm font-serif font-bold text-[var(--ink)]">
                  Your answer
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-[var(--ink-muted)] font-mono">
                <Badge variant="neutral">
                  Provider: {response.provider_used}
                </Badge>
                <Badge variant="human">
                  {response.evidence_count} matching passages
                </Badge>
              </div>
            </div>

            <div className="text-base leading-relaxed text-[var(--ink)] whitespace-pre-wrap font-sans">
              {response.answer}
            </div>

            {/* Suggested Next Actions */}
            {response.suggested_actions &&
              response.suggested_actions.length > 0 && (
                <div className="mt-5 pt-4 border-t border-[var(--hairline)]">
                  <span className="text-sm font-mono font-bold uppercase tracking-wider text-[var(--ink)] block mb-2">
                    Next steps
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {response.suggested_actions.map((act, idx) => (
                      <Button
                        key={idx}
                        variant="secondary"
                        size="sm"
                        onClick={() => handleExecuteAction(act)}
                      >
                        <ArrowRight className="w-3 h-3 text-[var(--ink-blue)]" />
                        {act.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
          </Card>

          {/* Citations & Evidence Drawer */}
          {response.citations && response.citations.length > 0 && (
            <Card className="border-[var(--hairline-strong)]">
              <div className="flex items-center gap-2 pb-3 mb-4 border-b border-[var(--hairline)]">
                <FileCode className="w-4 h-4 text-[var(--ink-blue)]" />
                <span className="text-sm font-serif font-bold text-[var(--ink)]">
                  Sources ({response.citations.length})
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {response.citations.map((c: CitationItem, idx: number) => (
                  <div
                    key={idx}
                    className="p-3 rounded-[var(--radius-sm)] bg-[var(--paper)] border border-[var(--hairline)] hover:border-[var(--ink-blue)] transition-all group shadow-[var(--shadow-subtle)]"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <InlineCitationChip
                        index={idx + 1}
                        citation={{
                          file_path: c.path,
                          line_start: c.line_start ?? undefined,
                          line_end: c.line_end ?? undefined,
                          snippet: c.snippet,
                        }}
                        onOpenFile={(path) => api.openFile(path)}
                      />
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => api.openFile(c.path)}
                          title="Open File in Default Editor"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => api.revealFile(c.path)}
                          title="Reveal in Explorer"
                        >
                          <FolderOpen className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>

                    <p className="text-xs text-[var(--ink-muted)] font-mono truncate mb-2">
                      {c.path}
                      {c.line_start ? ` : L${c.line_start}` : ""}
                    </p>

                    <div className="p-2 rounded-[var(--radius-xs)] bg-[var(--paper-subtle)] border border-[var(--hairline-subtle)] text-sm font-mono text-[var(--ink-secondary)] whitespace-pre-wrap max-h-24 overflow-y-auto leading-relaxed">
                      {c.snippet}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Tool Execution Result Block */}
          {toolResult && (
            <Card className="font-mono text-xs">
              <div className="flex items-center gap-2 mb-2 text-[var(--ink)] font-bold">
                <Terminal className="w-4 h-4 text-[var(--success)]" />
                <span>Tool Execution Output</span>
              </div>
              <pre className="bg-[var(--paper-subtle)] p-3 rounded-[var(--radius-xs)] text-[var(--ink)] overflow-x-auto whitespace-pre-wrap border border-[var(--hairline-subtle)]">
                {JSON.stringify(toolResult, null, 2)}
              </pre>
            </Card>
          )}
        </div>
      )}

      {/* Security Action Confirmation Modal */}
      {pendingTool && (
        <Modal
          isOpen={true}
          onClose={() => setPendingTool(null)}
          eyebrow="Security Boundary"
          title={
            <div className="flex items-center gap-2 text-[var(--warning)]">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <span>Action Authorization Required</span>
            </div>
          }
          maxWidth="md"
        >
          <div className="space-y-4">
            <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">
              {pendingTool.promptMessage}
            </p>

            <div className="bg-[var(--paper)] border border-[var(--hairline)] p-2.5 rounded-[var(--radius-sm)] font-mono text-xs text-[var(--ink)]">
              <code>
                {pendingTool.toolName} ({JSON.stringify(pendingTool.args)})
              </code>
            </div>

            <p className="text-sm text-[var(--ink-muted)]">
              In accordance with Groundwork security guidelines, local execution
              tools require single-use cryptographic authorization.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--hairline)]">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPendingTool(null)}
              >
                Deny &amp; Cancel
              </Button>
              <Button
                variant="agent"
                size="sm"
                onClick={handleConfirmTool}
                disabled={toolExecuting}
                isLoading={toolExecuting}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Authorize &amp; Execute
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
export default AIInvestigationView;
