import { useState, useEffect, useRef, useMemo } from "react";
import {
  ArrowLeft,
  FileText,
  Plus,
  Trash2,
  CheckCircle2,
  Send,
  Square,
  ShieldCheck,
  Download,
  Eye,
  ChevronRight,
  ExternalLink,
  CheckSquare,
  Square as SquareOutline,
  Scissors,
  Upload,
  Sun,
  Moon,
  Search,
  Check,
} from "lucide-react";
import type {
  Workspace,
  DocumentItem,
  NativeDocument,
  NativeBlock,
  DeliverableRequirement,
  DeliverableReviewFinding,
  DeliverableReadiness,
  ChatMessage,
  Citation,
  AgentTaskStep,
  WorkspaceNote,
  AuthResult,
} from "../../types";
import { API, api, streamWorkspaceAgent, downloadTextFile, authenticatedFetch } from "../../api/client";
import { BrandMark } from "../../components/common/BrandMark";

export interface ResearchWorkspaceProps {
  auth: AuthResult;
  workspace: Workspace;
  documents: DocumentItem[];
  nativeDocs: NativeDocument[];
  activeTheme: "light" | "dark";
  onBackToLibrary: () => void;
  onUploadDocument: (file: File, workspaceId: string) => Promise<DocumentItem | null>;
  onDeleteDocument: (docId: string) => Promise<void>;
  onOpenPdfTools?: () => void;
  onOpenAccount?: () => void;
  onToggleTheme?: () => void;
  onOpenViewer?: (docId: string, pageNumber?: number) => void;
}

export type NotebookWorkspaceProps = ResearchWorkspaceProps;

export function ResearchWorkspace({
  auth,
  workspace,
  documents,
  nativeDocs,
  activeTheme,
  onBackToLibrary,
  onUploadDocument,
  onDeleteDocument,
  onOpenPdfTools,
  onOpenAccount,
  onToggleTheme,
  onOpenViewer,
}: ResearchWorkspaceProps) {
  // Sources state
  const workspaceSources = useMemo(() => {
    return documents.filter((d) => d.workspace_id === workspace.id);
  }, [documents, workspace.id]);

  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  useEffect(() => {
    setSelectedSourceIds(workspaceSources.map((s) => s.id));
  }, [workspaceSources]);

  // Active deliverable / artifact
  const workspaceArtifacts = useMemo(() => {
    return nativeDocs.filter((n) => n.workspace_id === workspace.id);
  }, [nativeDocs, workspace.id]);

  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  useEffect(() => {
    if (workspaceArtifacts.length > 0 && !activeArtifactId) {
      setActiveArtifactId(workspaceArtifacts[0].id);
    }
  }, [workspaceArtifacts, activeArtifactId]);

  const activeArtifact = useMemo(() => {
    return workspaceArtifacts.find((a) => a.id === activeArtifactId) || workspaceArtifacts[0] || null;
  }, [workspaceArtifacts, activeArtifactId]);

  // Right Panel Tabs
  const [rightPanelTab, setRightPanelTab] = useState<"artifacts" | "studio" | "notes">("artifacts");

  // Chat & Agent state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [promptInput, setPromptInput] = useState("");
  const [actionType, setActionType] = useState<string>("auto");
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [activeSteps, setActiveSteps] = useState<AgentTaskStep[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Deliverable details state
  const [requirements, setRequirements] = useState<DeliverableRequirement[]>([]);
  const [findings, setFindings] = useState<DeliverableReviewFinding[]>([]);
  const [readiness, setReadiness] = useState<DeliverableReadiness | null>(null);
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editableBlocks, setEditableBlocks] = useState<NativeBlock[]>([]);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  // Notes state
  const [notes, setNotes] = useState<WorkspaceNote[]>([]);
  const [newNoteInput, setNewNoteInput] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);

  // Initial load of conversation, deliverable details, and notes
  useEffect(() => {
    async function loadWorkspaceData() {
      try {
        const convs = await api<Array<{ id: string }>>(`/conversations?workspace_id=${workspace.id}`, auth.access_token);
        if (convs && convs.length > 0) {
          const latestConv = convs[0];
          setConversationId(latestConv.id);
          const fullConv = await api<{ messages?: ChatMessage[] }>(`/conversations/${latestConv.id}`, auth.access_token);
          if (fullConv?.messages) {
            setMessages(fullConv.messages);
          }
        }

        const loadedNotes = await api<WorkspaceNote[]>(
          `/workspaces/${workspace.id}/memories`,
          auth.access_token,
        ).catch(() => []);
        setNotes(loadedNotes || []);
      } catch (err) {
        console.error("Failed to load workspace data", err);
      }
    }
    loadWorkspaceData();
  }, [workspace.id, auth.access_token]);

  // Load deliverable details whenever active artifact changes
  useEffect(() => {
    async function loadArtifactDetails() {
      if (!activeArtifact) {
        setRequirements([]);
        setFindings([]);
        setReadiness(null);
        setEditableBlocks([]);
        return;
      }
      try {
        const [reqs, fnds, rdn, blocks] = await Promise.all([
          api<DeliverableRequirement[]>(
            `/workspaces/${workspace.id}/native-documents/${activeArtifact.id}/requirements`,
            auth.access_token,
          ).catch(() => []),
          api<DeliverableReviewFinding[]>(
            `/workspaces/${workspace.id}/native-documents/${activeArtifact.id}/review-findings`,
            auth.access_token,
          ).catch(() => []),
          api<DeliverableReadiness>(
            `/workspaces/${workspace.id}/native-documents/${activeArtifact.id}/readiness`,
            auth.access_token,
          ).catch(() => null),
          api<NativeBlock[]>(
            `/workspaces/${workspace.id}/native-documents/${activeArtifact.id}/blocks`,
            auth.access_token,
          ).catch(() => []),
        ]);
        setRequirements(reqs || []);
        setFindings(fnds || []);
        setReadiness(rdn);
        setEditableBlocks(blocks || activeArtifact.content?.blocks || []);
      } catch (err) {
        console.error("Failed to load artifact details", err);
      }
    }
    loadArtifactDetails();
  }, [activeArtifact, workspace.id, auth.access_token]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, activeSteps]);

  // Toggle source selection
  function toggleSource(sourceId: string) {
    setSelectedSourceIds((prev) =>
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId],
    );
  }

  function selectAllSources() {
    setSelectedSourceIds(workspaceSources.map((s) => s.id));
  }

  function deselectAllSources() {
    setSelectedSourceIds([]);
  }

  // Handle agent streaming execution
  async function handleSendPrompt(customPrompt?: string, customAction?: string) {
    const textToSend = customPrompt || promptInput;
    if (!textToSend.trim() || isAgentRunning) return;

    const currentAction = customAction || actionType;
    setPromptInput("");

    // Add user message immediately
    const userMessage: ChatMessage = {
      role: "user",
      content: textToSend,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    setIsAgentRunning(true);
    setActiveSteps([]);
    setStreamingText("");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let fullAiResponse = "";
    const citationsAccumulator: Citation[] = [];

    try {
      await streamWorkspaceAgent(
        {
          workspace_id: workspace.id,
          prompt: textToSend,
          action_type: currentAction,
          source_document_ids: selectedSourceIds,
          conversation_id: conversationId ?? undefined,
          artifact_id: activeArtifactId ?? undefined,
        },
        auth.access_token,
        {
          onStatus: (step) => {
            const agentStep: AgentTaskStep = {
              step: step.step,
              label: step.label,
              status: "in_progress",
            };
            setActiveSteps((prev) => {
              const existingIdx = prev.findIndex((s) => s.step === step.step);
              if (existingIdx >= 0) {
                const next = [...prev];
                next[existingIdx] = agentStep;
                return next;
              }
              const next = prev.map((s) => ({ ...s, status: "completed" as const }));
              return [...next, agentStep];
            });
          },
          onToken: (token) => {
            fullAiResponse += token;
            setStreamingText((prev) => prev + token);
          },
          onCitation: (cit) => {
            citationsAccumulator.push(cit);
          },
          onArtifact: (art) => {
            setActiveArtifactId(art.id);
            setRightPanelTab("artifacts");
          },
          onVerification: (metrics) => {
            setReadiness((prev) => ({
              requirements_total: prev?.requirements_total || 0,
              requirements_covered: prev?.requirements_covered || 0,
              requirements_required: prev?.requirements_required || 0,
              required_covered: prev?.required_covered || 0,
              unsupported_claims: metrics.unsupported_claims,
              open_findings: prev?.open_findings || 0,
              unresolved_comments: 0,
              sources_linked: selectedSourceIds.length,
              sources_used: selectedSourceIds.length,
              status: metrics.unsupported_claims === 0 ? "ready" : "needs_review",
              blockers: [],
            }));
          },
          onComplete: (data) => {
            if (data.conversation_id) {
              setConversationId(data.conversation_id);
            }
            setActiveSteps((prev) => prev.map((s) => ({ ...s, status: "completed" as const })));
            const aiMessage: ChatMessage = {
              role: "assistant",
              content: fullAiResponse || "Task completed successfully.",
              citations: citationsAccumulator,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, aiMessage]);
            setStreamingText("");
            setIsAgentRunning(false);
          },
          onError: (errStr) => {
            const errorMessage: ChatMessage = {
              role: "assistant",
              content: `⚠️ Error during execution: ${errStr}`,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, errorMessage]);
            setStreamingText("");
            setIsAgentRunning(false);
          },
        },
        controller.signal,
      );
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ Failed to execute task: ${(err as Error)?.message || "Unknown error"}`,
            created_at: new Date().toISOString(),
          },
        ]);
      }
      setIsAgentRunning(false);
      setStreamingText("");
    }
  }

  function handleStopAgent() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsAgentRunning(false);
      setStreamingText("");
    }
  }

  // Save modified deliverable blocks
  async function handleSaveBlocks() {
    if (!activeArtifact) return;
    setIsSavingDraft(true);
    try {
      await api(
        `/workspaces/${workspace.id}/native-documents/${activeArtifact.id}/blocks`,
        auth.access_token,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocks: editableBlocks }),
        },
      );
      setIsEditingContent(false);
    } catch (err) {
      console.error("Failed to save draft blocks", err);
    } finally {
      setIsSavingDraft(false);
    }
  }

  // Export Deliverable
  async function handleExport(format: "pdf" | "docx" | "md" | "txt") {
    if (!activeArtifact) return;
    try {
      const exportData = await api<{ download_url?: string; content?: string }>(
        `/workspaces/${workspace.id}/native-documents/${activeArtifact.id}/export?format=${format}`,
        auth.access_token,
      );
      if (exportData?.download_url) {
        window.open(exportData.download_url, "_blank");
      } else if (exportData?.content) {
        downloadTextFile(`${activeArtifact.title || "deliverable"}.${format}`, exportData.content);
      }
    } catch (err) {
      console.error("Export failed", err);
    }
  }

  // Add Note
  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!newNoteInput.trim() || isAddingNote) return;
    setIsAddingNote(true);
    try {
      const newNote = await api<WorkspaceNote>(`/workspaces/${workspace.id}/memories`, auth.access_token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "note", value: newNoteInput.trim() }),
      });
      setNotes((prev) => [newNote, ...prev]);
      setNewNoteInput("");
    } catch (err) {
      console.error("Failed to save note", err);
    } finally {
      setIsAddingNote(false);
    }
  }

  const STARTER_PROMPTS = [
    {
      label: "Draft Technical Proposal",
      action: "proposal",
      prompt: "Analyze the uploaded sources, extract all requirements, and generate a fully verified technical proposal.",
    },
    {
      label: "Client Research Report",
      action: "report",
      prompt: "Synthesize key findings, metrics, and strategic points across active sources into an executive report.",
    },
    {
      label: "Audit & Verify Claims",
      action: "verify",
      prompt: "Review the active deliverable against the source evidence and flag any unsupported claims or missing requirements.",
    },
  ];

  return (
    <div className="notebook-workspace-3col research-workspace-3col">
      {/* Top Header Bar */}
      <header className="notebook-workspace-topbar">
        <div className="topbar-left">
          <button className="btn-back-library" onClick={onBackToLibrary} title="Back to Workspace Library">
            <ArrowLeft size={15} />
            <span>Workspaces</span>
          </button>
          <div className="topbar-divider" />
          <div className="topbar-workspace-meta">
            <BrandMark />
            <strong className="workspace-name">{workspace.name}</strong>
            <span className="workspace-tag">Personal</span>
          </div>
        </div>

        {/* Center Grounding indicator */}
        <div className="topbar-center">
          <span className="grounding-badge">
            <ShieldCheck size={13} />
            <b>{selectedSourceIds.length}</b> source{selectedSourceIds.length === 1 ? "" : "s"} grounded
          </span>
        </div>

        {/* Right action controls */}
        <div className="topbar-right">
          {onOpenPdfTools && (
            <button className="btn-secondary-white" onClick={onOpenPdfTools} title="Document tools (merge, split, convert)">
              <Scissors size={14} />
              <span>PDF Tools</span>
            </button>
          )}

          {activeArtifact && (
            <button
              className="btn-primary-gradient"
              onClick={() => handleExport("pdf")}
              title="Download compiled deliverable PDF"
            >
              <Download size={14} />
              <span>Export Deliverable</span>
            </button>
          )}

          <button className="btn-theme-toggle" onClick={onToggleTheme} title="Toggle theme" aria-label="Toggle theme">
            {activeTheme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          <button className="btn-account-chip" onClick={onOpenAccount} title="Account Settings">
            <span>{auth.user.display_name}</span>
          </button>
        </div>
      </header>

      {/* 3-Column Layout Body */}
      <div className="notebook-workspace-body">
        {/* ================= COLUMN 1: SOURCES (Left 280px) ================= */}
        <aside className="notebook-left-sources">
          <div className="panel-header-row">
            <div>
              <strong className="panel-title">Sources</strong>
              <small className="panel-subtitle">{workspaceSources.length} document{workspaceSources.length === 1 ? "" : "s"}</small>
            </div>

            <label className="btn-add-source" title="Attach new document">
              <Plus size={13} />
              <span>Add</span>
              <input
                type="file"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    try {
                      await onUploadDocument(f, workspace.id);
                    } catch (err: unknown) {
                      console.error("Upload error:", err);
                      alert((err as Error)?.message || "Failed to upload document");
                    } finally {
                      e.target.value = "";
                    }
                  }
                }}
              />
            </label>
          </div>

          {/* Multi-select Controls */}
          <div className="sources-selection-bar">
            <span className="selection-count">
              {selectedSourceIds.length} of {workspaceSources.length} active
            </span>
            <div className="selection-buttons">
              <button onClick={selectAllSources} className="btn-text-action">All</button>
              <span className="divider">·</span>
              <button onClick={deselectAllSources} className="btn-text-action">None</button>
            </div>
          </div>

          {/* Source List */}
          <div className="sources-scroll-list">
            {workspaceSources.length > 0 ? (
              workspaceSources.map((doc) => {
                const isSelected = selectedSourceIds.includes(doc.id);
                const isReady = doc.status === "ready";

                return (
                  <div
                    key={doc.id}
                    className={`source-row-item ${isSelected ? "selected" : ""}`}
                  >
                    <button
                      className="source-checkbox"
                      onClick={() => toggleSource(doc.id)}
                      aria-label={isSelected ? "Deselect source" : "Select source"}
                    >
                      {isSelected ? <CheckSquare size={15} /> : <SquareOutline size={15} />}
                    </button>

                    <div className="source-info-wrap" onClick={() => toggleSource(doc.id)}>
                      <div className="source-filename" title={doc.filename}>
                        {doc.filename}
                      </div>
                      <div className="source-meta-row">
                        <span className="source-page-count">
                          {doc.page_count ? `${doc.page_count} pages` : "Processing"}
                        </span>
                        {isReady && (
                          <span className="source-ready-pill">
                            Ready
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="source-row-actions">
                      <button
                        className="btn-icon-subtle"
                        onClick={() => onOpenViewer?.(doc.id, 1)}
                        title="Preview document"
                        aria-label="Preview document"
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        className="btn-icon-subtle"
                        onClick={async () => {
                          try {
                            const res = await authenticatedFetch(`${API}/documents/${doc.id}/download`, auth.access_token);
                            if (res.ok) {
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              const a = window.document.createElement("a");
                              a.href = url;
                              a.download = doc.filename;
                              a.click();
                              URL.revokeObjectURL(url);
                            }
                          } catch {
                            /* ignore download error */
                          }
                        }}
                        title="Download original document"
                        aria-label="Download original"
                      >
                        <Download size={13} />
                      </button>
                      <button
                        className="btn-icon-danger"
                        onClick={() => onDeleteDocument(doc.id)}
                        title="Delete source"
                        aria-label="Delete source"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="sources-empty-box">
                <FileText size={28} className="empty-icon" />
                <strong>No sources added</strong>
                <small>Upload a PDF, Word doc, or brief to ground this workspace.</small>
              </div>
            )}
          </div>

          {/* Dotted Upload Dropzone */}
          <div className="sources-dropzone-wrap">
            <label className="sources-mini-dropzone">
              <Upload size={16} />
              <span>Drop PDF or document to add source</span>
              <input
                type="file"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    try {
                      await onUploadDocument(f, workspace.id);
                    } catch (err: unknown) {
                      console.error("Upload error:", err);
                      alert((err as Error)?.message || "Failed to upload document");
                    } finally {
                      e.target.value = "";
                    }
                  }
                }}
              />
            </label>
          </div>
        </aside>

        {/* ================= COLUMN 2: GROUNDED AGENT CHAT (Center) ================= */}
        <section className="notebook-center-agent">
          {/* Center Header */}
          <div className="agent-header-bar">
            <div className="agent-title-wrap">
              <Search size={15} />
              <strong>Grounded Agent</strong>
            </div>

            <div className="agent-mode-wrap">
              <span className="mode-label">Task:</span>
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
                className="agent-mode-select"
                aria-label="Task mode"
              >
                <option value="auto">Auto Intent</option>
                <option value="proposal">Technical Proposal</option>
                <option value="report">Client Report</option>
                <option value="presentation">Presentation</option>
                <option value="verify">Verify Claims</option>
                <option value="note">Save Note</option>
              </select>
            </div>
          </div>

          {/* Chat Messages Stream */}
          <div className="agent-messages-stream">
            {messages.length === 0 && !isAgentRunning ? (
              <div className="agent-empty-hero">
                <div className="agent-hero-icon">
                  <FileText size={24} />
                </div>
                <h3>Ask questions or generate deliverables</h3>
                <p>
                  Grounded across {selectedSourceIds.length} active source{selectedSourceIds.length === 1 ? "" : "s"}. Every answer includes verifiable page citations.
                </p>

                {/* Starter Prompts */}
                <div className="agent-starter-grid">
                  {STARTER_PROMPTS.map((sp, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendPrompt(sp.prompt, sp.action)}
                      className="starter-prompt-card"
                    >
                      <span>{sp.label}</span>
                      <ChevronRight size={14} className="prompt-arrow" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => {
                  const isUser = msg.role === "user";
                  return (
                    <div key={idx} className={`agent-message-row ${isUser ? "user-row" : "ai-row"}`}>
                      <div className={`agent-message-bubble ${isUser ? "user" : "ai"}`}>
                        <div className="message-content-text">{msg.content}</div>

                        {/* Inline citations */}
                        {msg.citations && msg.citations.length > 0 && (
                          <div className="message-citations-bar">
                            <span className="citations-label">Sources:</span>
                            {msg.citations.map((cit, cIdx) => (
                              <button
                                key={cIdx}
                                onClick={() => onOpenViewer?.(cit.document_id, cit.page_number)}
                                title={cit.snippet}
                                className="agent-citation-chip"
                              >
                                <ExternalLink size={10} />
                                {cit.document_name || "Doc"} (p. {cit.page_number})
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Active Agent Task Progress Card */}
                {isAgentRunning && (
                  <div className="agent-task-progress-card">
                    <div className="progress-header">
                      <span className="progress-title">
                        <CheckCircle2 size={14} /> Multi-Step Task Execution
                      </span>
                      <button onClick={handleStopAgent} className="btn-stop-task">
                        <Square size={10} /> Stop
                      </button>
                    </div>

                    <div className="progress-steps-list">
                      {activeSteps.map((step, sIdx) => {
                        const isDone = step.status === "completed";
                        return (
                          <div key={sIdx} className="progress-step-item">
                            {isDone ? (
                              <Check size={14} className="text-success" />
                            ) : (
                              <div className="step-spinner" />
                            )}
                            <span className={isDone ? "step-label-done" : "step-label-active"}>
                              {step.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {streamingText && (
                      <div className="progress-streaming-output">
                        {streamingText}
                      </div>
                    )}
                  </div>
                )}
                <div ref={chatBottomRef} />
              </>
            )}
          </div>

          {/* Quick Follow-up Prompt Chips */}
          <div className="agent-chips-strip">
            {["Audit unsupported claims", "Make executive summary shorter", "Export deliverable", "Save key findings as note"].map((sug, idx) => (
              <button
                key={idx}
                onClick={() => handleSendPrompt(sug)}
                disabled={isAgentRunning}
                className="btn-prompt-chip"
              >
                {sug}
              </button>
            ))}
          </div>

          {/* Composer Input Area */}
          <div className="agent-composer-container">
            <div className="agent-composer-box">
              <textarea
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendPrompt();
                  }
                }}
                placeholder={`Ask InsightPDF agent grounded on ${selectedSourceIds.length} sources...`}
                rows={2}
                className="composer-textarea"
                aria-label="Agent prompt input"
              />
              <div className="composer-footer">
                <span className="composer-grounding-hint">
                  <ShieldCheck size={13} /> Verifiable Grounding
                </span>
                <button
                  onClick={() => handleSendPrompt()}
                  disabled={!promptInput.trim() || isAgentRunning}
                  className="btn-primary-gradient btn-composer-send"
                >
                  <Send size={13} />
                  <span>Send</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ================= COLUMN 3: STUDIO & ARTIFACTS (Right 420px) ================= */}
        <aside className="notebook-right-studio">
          {/* Right Panel Segment Tabs */}
          <div className="studio-tabs-bar">
            <button
              className={`studio-tab-btn ${rightPanelTab === "artifacts" ? "active" : ""}`}
              onClick={() => setRightPanelTab("artifacts")}
            >
              Deliverables
            </button>
            <button
              className={`studio-tab-btn ${rightPanelTab === "studio" ? "active" : ""}`}
              onClick={() => setRightPanelTab("studio")}
            >
              Studio
            </button>
            <button
              className={`studio-tab-btn ${rightPanelTab === "notes" ? "active" : ""}`}
              onClick={() => setRightPanelTab("notes")}
            >
              Notes ({notes.length})
            </button>
          </div>

          {/* Tab 1: Artifacts & Verification */}
          {rightPanelTab === "artifacts" && (
            <div className="studio-panel-content">
              {activeArtifact ? (
                <div className="deliverable-panel-wrap">
                  {/* Deliverable Header */}
                  <div className="deliverable-header-card">
                    <div className="card-top-row">
                      <div>
                        <span className="deliverable-type-tag">Deliverable Document</span>
                        <h4 className="deliverable-title">
                          {activeArtifact.title || "Untitled Deliverable"}
                        </h4>
                      </div>

                      {readiness && (
                        <span className={`readiness-badge ${readiness.unsupported_claims === 0 ? "verified" : "warning"}`}>
                          {readiness.unsupported_claims === 0 ? "✓ Verified" : `${readiness.unsupported_claims} Unsupported`}
                        </span>
                      )}
                    </div>

                    <div className="deliverable-export-actions">
                      <button className="btn-primary-gradient btn-sm" onClick={() => handleExport("pdf")}>
                        <Download size={13} /> Export PDF
                      </button>
                      <button className="btn-secondary-white btn-sm" onClick={() => handleExport("docx")}>
                        Word (.docx)
                      </button>
                      <button className="btn-secondary-white btn-sm" onClick={() => handleExport("md")}>
                        Markdown
                      </button>
                    </div>
                  </div>

                  {/* Requirements Checklist */}
                  {requirements.length > 0 && (
                    <div className="requirements-section">
                      <h5 className="section-subtitle">
                        Verifiable Requirements ({requirements.filter((r) => r.status === "covered").length}/{requirements.length})
                      </h5>
                      <div className="requirements-list">
                        {requirements.map((req) => (
                          <div key={req.id} className="requirement-row">
                            <span className="req-text">{req.text}</span>
                            <span className={`req-status-pill ${req.status}`}>
                              {req.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Review Findings */}
                  {findings.length > 0 && (
                    <div className="findings-section">
                      <h5 className="section-subtitle text-danger">
                        Review Findings ({findings.length})
                      </h5>
                      <div className="findings-list">
                        {findings.map((fnd) => (
                          <div key={fnd.id} className="finding-card">
                            <strong className="finding-title">
                              {fnd.kind === "unsupported_claim" ? "Unsupported Claim" : "Missing Requirement"}
                            </strong>
                            <p className="finding-desc">{fnd.claim_text}</p>
                            <button
                              className="btn-secondary-white btn-xs"
                              onClick={() => handleSendPrompt(`Fix finding: ${fnd.claim_text}`)}
                            >
                              Apply Verified Fix
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Content Block Editor */}
                  <div className="blocks-section">
                    <div className="blocks-header">
                      <h5 className="section-subtitle">Deliverable Blocks</h5>
                      <button
                        className="btn-edit-toggle"
                        onClick={() => (isEditingContent ? handleSaveBlocks() : setIsEditingContent(true))}
                      >
                        {isEditingContent ? (isSavingDraft ? "Saving..." : "Save Draft") : "Edit Blocks"}
                      </button>
                    </div>

                    <div className="blocks-list">
                      {editableBlocks.map((blk, bIdx) => (
                        <div key={bIdx} className="block-card">
                          {isEditingContent ? (
                            <textarea
                              value={blk.text}
                              onChange={(e) => {
                                const next = [...editableBlocks];
                                next[bIdx] = { ...blk, text: e.target.value };
                                setEditableBlocks(next);
                              }}
                              rows={4}
                              className="block-textarea"
                            />
                          ) : (
                            <div className="block-text-view">{blk.text}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="studio-empty-state">
                  <ShieldCheck size={32} className="empty-icon" />
                  <strong>No deliverable generated yet</strong>
                  <p>Use the agent in the center panel to draft your first proposal or report.</p>
                  <button
                    className="btn-primary-gradient"
                    onClick={() => handleSendPrompt("Draft technical proposal from active sources", "proposal")}
                  >
                    Generate Deliverable
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Studio Fast Actions */}
          {rightPanelTab === "studio" && (
            <div className="studio-panel-content">
              <h5 className="section-subtitle">Studio Fast Generations</h5>
              <div className="studio-cards-list">
                {[
                  {
                    title: "Technical Proposal",
                    detail: "Generate structured requirement matrix, architecture spec, and delivery milestones.",
                    action: "proposal",
                  },
                  {
                    title: "Executive Presentation Deck",
                    detail: "Draft 8-slide structured narrative with talking points from grounded citations.",
                    action: "presentation",
                  },
                  {
                    title: "Comparative Matrix",
                    detail: "Cross-reference vendor features, metrics, and compliance points across sources.",
                    action: "report",
                  },
                ].map((st, idx) => (
                  <div key={idx} className="studio-action-card">
                    <strong className="studio-card-title">{st.title}</strong>
                    <p className="studio-card-detail">{st.detail}</p>
                    <button
                      className="btn-secondary-white btn-sm"
                      onClick={() => handleSendPrompt(`Generate ${st.title} from active sources`, st.action)}
                    >
                      Generate in Agent →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab 3: Workspace Notes */}
          {rightPanelTab === "notes" && (
            <div className="studio-panel-content">
              <form onSubmit={handleAddNote} className="notes-create-form">
                <textarea
                  value={newNoteInput}
                  onChange={(e) => setNewNoteInput(e.target.value)}
                  placeholder="Write a quick note or finding..."
                  rows={2}
                  className="notes-textarea"
                />
                <button
                  type="submit"
                  className="btn-primary-gradient btn-sm btn-save-note"
                  disabled={!newNoteInput.trim() || isAddingNote}
                >
                  <Plus size={12} />
                  <span>Save Note</span>
                </button>
              </form>

              <div className="notes-list">
                {notes.map((note, nIdx) => (
                  <div key={note.id || nIdx} className="note-card">
                    <p>{note.value}</p>
                    <small>{note.created_at ? new Date(note.created_at).toLocaleString() : "Just now"}</small>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// Backward-compatibility alias
export const NotebookWorkspace = ResearchWorkspace;
