import { useState, useEffect, useRef, useMemo } from "react";
import {
  ArrowLeft,
  FileText,
  Plus,
  Trash2,
  CheckCircle2,
  Sparkles,
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
  NotebookNote,
  AuthResult,
} from "../../types";
import { API, api, streamNotebookAgent, downloadTextFile, authenticatedFetch } from "../../api/client";
import { BrandMark } from "../../components/common/BrandMark";

interface NotebookWorkspaceProps {
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

export function NotebookWorkspace({
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
}: NotebookWorkspaceProps) {
  // Sources state
  const workspaceSources = useMemo(() => {
    return documents.filter((d) => (d as any).workspace_id === workspace.id);
  }, [documents, workspace.id]);

  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  useEffect(() => {
    setSelectedSourceIds(workspaceSources.map((s) => s.id));
  }, [workspaceSources.length]);

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
  const [notes, setNotes] = useState<NotebookNote[]>([]);
  const [newNoteInput, setNewNoteInput] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);

  // Initial load of conversation, deliverable details, and notes
  useEffect(() => {
    async function loadWorkspaceData() {
      try {
        const convs = await api<any[]>(`/conversations?workspace_id=${workspace.id}`, auth.access_token);
        if (convs && convs.length > 0) {
          const latestConv = convs[0];
          setConversationId(latestConv.id);
          const fullConv = await api<any>(`/conversations/${latestConv.id}`, auth.access_token);
          if (fullConv?.messages) {
            setMessages(fullConv.messages);
          }
        }

        const loadedNotes = await api<NotebookNote[]>(
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
  }, [activeArtifact?.id, workspace.id, auth.access_token]);

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
      await streamNotebookAgent(
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
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ Failed to execute task: ${err.message || "Unknown error"}`,
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
      const exportData = await api<any>(
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
      const newNote = await api<NotebookNote>(`/workspaces/${workspace.id}/memories`, auth.access_token, {
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
      prompt: "Synthesize the key findings, market data, and strategic metrics into an executive client report.",
    },
    {
      label: "Audit & Verify Claims",
      action: "verify",
      prompt: "Review the active deliverable against the source evidence and flag any unsupported claims or missing requirements.",
    },
  ];

  return (
    <div className="notebook-workspace-3col">
      {/* Top Navbar */}
      <header className="notebook-workspace-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <button
            className="btn-secondary-white"
            onClick={onBackToLibrary}
            style={{ height: "36px", padding: "0 12px" }}
          >
            <ArrowLeft size={15} />
            <span>Notebooks</span>
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <BrandMark />
            <strong style={{ fontSize: "15px", color: "var(--ink)", fontWeight: 750 }}>
              {workspace.name}
            </strong>
            <span style={{ fontSize: "11px", color: "var(--muted)", background: "#edf1f7", padding: "2px 8px", borderRadius: "999px", fontWeight: 700 }}>
              Personal Workspace
            </span>
          </div>
        </div>

        {/* Center Grounding status indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "var(--purple)", fontWeight: 700, background: "#eef2ff", padding: "4px 12px", borderRadius: "999px", border: "1px solid #dbe4f9", display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <Sparkles size={13} /> {selectedSourceIds.length} sources grounded
          </span>
        </div>

        {/* Right action controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {onOpenPdfTools && (
            <button className="btn-secondary-white" onClick={onOpenPdfTools} style={{ height: "36px" }}>
              <Scissors size={14} color="var(--purple)" />
              <span>PDF Tools</span>
            </button>
          )}

          {activeArtifact && (
            <button
              className="btn-primary-gradient"
              style={{ height: "36px", padding: "0 16px" }}
              onClick={() => handleExport("pdf")}
            >
              <Download size={14} />
              <span>Export Deliverable</span>
            </button>
          )}

          <button className="btn-secondary-white" onClick={onOpenAccount} style={{ height: "36px", padding: "0 12px" }}>
            <strong style={{ fontSize: "12px", color: "var(--navy)" }}>{auth.user.display_name}</strong>
          </button>
        </div>
      </header>

      {/* ================= COLUMN 1: SOURCES (Left 280px) ================= */}
      <aside className="notebook-left-sources">
        <div style={{ padding: "16px 18px", borderBottom: "1px solid #e2e7f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <strong style={{ fontSize: "13px", color: "var(--ink)", display: "block" }}>Sources</strong>
            <small style={{ fontSize: "11px", color: "var(--muted)" }}>{workspaceSources.length} files in notebook</small>
          </div>

          <label className="btn-pdf-action" style={{ cursor: "pointer", height: "32px", padding: "0 10px", fontSize: "11px" }}>
            <Plus size={14} />
            <span>Add</span>
            <input
              type="file"
              style={{ display: "none" }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  try {
                    await onUploadDocument(f, workspace.id);
                  } catch (err: any) {
                    console.error("Upload error:", err);
                    alert(err.message || "Failed to upload document");
                  } finally {
                    e.target.value = "";
                  }
                }
              }}
            />
          </label>
        </div>

        {/* Multi-select Controls */}
        <div style={{ padding: "8px 18px", borderBottom: "1px solid #edf1f7", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fafbfe" }}>
          <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 700 }}>
            {selectedSourceIds.length} of {workspaceSources.length} active
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              style={{ border: 0, background: "transparent", color: "var(--purple)", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}
              onClick={selectAllSources}
            >
              All
            </button>
            <span style={{ color: "#cbd5e7" }}>·</span>
            <button
              style={{ border: 0, background: "transparent", color: "var(--muted)", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}
              onClick={deselectAllSources}
            >
              None
            </button>
          </div>
        </div>

        {/* Source List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
          {workspaceSources.length > 0 ? (
            workspaceSources.map((doc) => {
              const isSelected = selectedSourceIds.includes(doc.id);
              const isReady = doc.status === "ready";

              return (
                <div
                  key={doc.id}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: isSelected ? "1px solid #c7d2fe" : "1px solid transparent",
                    background: isSelected ? "#f4f7ff" : "transparent",
                    marginBottom: "4px",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    transition: "all 0.15s",
                  }}
                >
                  <button
                    style={{ border: 0, background: "transparent", cursor: "pointer", padding: 0, marginTop: "2px", color: isSelected ? "var(--purple)" : "#94a3b8" }}
                    onClick={() => toggleSource(doc.id)}
                  >
                    {isSelected ? <CheckSquare size={16} /> : <SquareOutline size={16} />}
                  </button>

                  <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => toggleSource(doc.id)}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {doc.filename}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
                      <span style={{ fontSize: "10px", color: "var(--muted)" }}>
                        {doc.page_count ? `${doc.page_count} pages` : "Processing"}
                      </span>
                      {isReady && (
                        <span style={{ fontSize: "9px", color: "#2d9366", background: "#e8f6ef", padding: "1px 5px", borderRadius: "4px", fontWeight: 750 }}>
                          Ready
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", padding: "2px" }}
                    onClick={() => onOpenViewer?.(doc.id, 1)}
                    title="Preview source"
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", padding: "2px" }}
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
                      } catch {}
                    }}
                    title="Download original source"
                    aria-label="Download original"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    style={{ border: 0, background: "transparent", color: "var(--red)", cursor: "pointer", padding: "2px" }}
                    onClick={() => onDeleteDocument(doc.id)}
                    title="Delete source"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          ) : (
            <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--muted)" }}>
              <FileText size={32} color="#cbd5e7" style={{ margin: "0 auto 8px" }} />
              <strong style={{ fontSize: "12px", color: "var(--ink)", display: "block" }}>No sources added</strong>
              <small style={{ fontSize: "11px" }}>Upload a PDF or brief to ground this notebook.</small>
            </div>
          )}
        </div>

        {/* Dotted Upload Dropzone */}
        <div style={{ padding: "12px" }}>
          <label
            style={{
              padding: "16px",
              border: "2px dashed #cbd5e7",
              borderRadius: "12px",
              background: "#fbfcfe",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            <Upload size={18} color="var(--purple)" />
            <strong style={{ fontSize: "11px", color: "var(--ink)" }}>Drop PDF to add source</strong>
            <input
              type="file"
              style={{ display: "none" }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  try {
                    await onUploadDocument(f, workspace.id);
                  } catch (err: any) {
                    console.error("Upload error:", err);
                    alert(err.message || "Failed to upload document");
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
        <div style={{ padding: "14px 24px", borderBottom: "1px solid #e2e7f0", background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Sparkles size={16} color="var(--purple)" />
            <strong style={{ fontSize: "13px", color: "var(--ink)" }}>Grounded Agent</strong>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 700 }}>Task Mode:</span>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              style={{ padding: "4px 8px", border: "1px solid #dfe4ed", borderRadius: "8px", fontSize: "11px", fontWeight: 700, color: "var(--ink)", background: "#fff", outline: 0 }}
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
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {messages.length === 0 && !isAgentRunning ? (
            <div style={{ margin: "auto", textAlign: "center", maxWidth: "480px" }}>
              <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "var(--ai-gradient)", color: "#fff", display: "grid", placeItems: "center", margin: "0 auto 12px", boxShadow: "0 6px 18px rgba(49,84,216,0.2)" }}>
                <Sparkles size={24} />
              </div>
              <h3 style={{ fontSize: "16px", fontWeight: 750, color: "var(--ink)", margin: "0 0 6px" }}>
                Ask InsightPDF or generate deliverables
              </h3>
              <p style={{ fontSize: "13px", color: "var(--muted)", margin: "0 0 20px", lineHeight: 1.5 }}>
                The agent grounds its answers directly on your {selectedSourceIds.length} active sources and verifies every claim.
              </p>

              {/* Starter Prompts */}
              <div style={{ display: "grid", gap: "8px" }}>
                {STARTER_PROMPTS.map((sp, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendPrompt(sp.prompt, sp.action)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 14px",
                      borderRadius: "12px",
                      border: "1px solid #e2e7f0",
                      background: "#ffffff",
                      cursor: "pointer",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "var(--ink)",
                      boxShadow: "0 2px 8px rgba(10, 24, 61, 0.02)",
                      textAlign: "left",
                    }}
                  >
                    <span>{sp.label}</span>
                    <ChevronRight size={14} color="var(--purple)" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => {
                const isUser = msg.role === "user";
                return (
                  <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
                    <div className={`agent-message-bubble ${isUser ? "user" : "ai"}`}>
                      <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>

                      {/* Inline citations */}
                      {msg.citations && msg.citations.length > 0 && (
                        <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px solid #edf1f7", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "10px", fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>Sources:</span>
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
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 800, color: "var(--purple)", display: "flex", alignItems: "center", gap: "6px" }}>
                      <Sparkles size={14} className="spin" /> Multi-Step Task Execution
                    </span>
                    <button
                      onClick={handleStopAgent}
                      style={{ border: 0, background: "transparent", color: "var(--red)", fontSize: "11px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                    >
                      <Square size={10} /> Stop
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {activeSteps.map((step, sIdx) => {
                      const isDone = step.status === "completed";
                      return (
                        <div key={sIdx} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
                          {isDone ? (
                            <CheckCircle2 size={14} color="#2d9366" />
                          ) : (
                            <div style={{ width: "12px", height: "12px", borderRadius: "50%", border: "2px solid var(--purple)", borderTopColor: "transparent" }} className="spin" />
                          )}
                          <span style={{ color: isDone ? "var(--muted)" : "var(--ink)", fontWeight: isDone ? 600 : 750 }}>
                            {step.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {streamingText && (
                    <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid #dbe4f9", fontSize: "13px", color: "var(--ink)", whiteSpace: "pre-wrap" }}>
                      {streamingText}
                    </div>
                  )}
                </div>
              )}
              <div ref={chatBottomRef} />
            </>
          )}
        </div>

        {/* Follow-up Prompt Chips */}
        <div style={{ padding: "8px 24px", display: "flex", gap: "6px", overflowX: "auto", borderTop: "1px solid #edf1f7", background: "#fafbfe" }}>
          {["Audit unsupported claims", "Make section 2 shorter", "Export deliverable", "Save key findings as note"].map((sug, idx) => (
            <button
              key={idx}
              onClick={() => handleSendPrompt(sug)}
              disabled={isAgentRunning}
              style={{
                padding: "4px 10px",
                borderRadius: "999px",
                border: "1px solid #dfe4ed",
                background: "#ffffff",
                fontSize: "11px",
                fontWeight: 650,
                color: "var(--muted)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
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
              style={{
                width: "100%",
                border: 0,
                outline: 0,
                fontSize: "13px",
                color: "var(--ink)",
                background: "transparent",
                resize: "none",
                fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "11px", color: "var(--muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                <Sparkles size={12} color="var(--purple)" /> Verifiable Citation Grounding
              </span>
              <button
                onClick={() => handleSendPrompt()}
                disabled={!promptInput.trim() || isAgentRunning}
                className="btn-primary-gradient"
                style={{ height: "32px", padding: "0 14px", fontSize: "12px" }}
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
        {/* Right Panel Tabs */}
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #e2e7f0", display: "flex", gap: "8px", background: "#fafbfe" }}>
          <button
            className={rightPanelTab === "artifacts" ? "active" : ""}
            onClick={() => setRightPanelTab("artifacts")}
            style={{
              flex: 1,
              height: "32px",
              borderRadius: "8px",
              border: rightPanelTab === "artifacts" ? "1px solid var(--purple)" : "1px solid #dfe4ed",
              background: rightPanelTab === "artifacts" ? "var(--purple-soft)" : "#ffffff",
              color: rightPanelTab === "artifacts" ? "var(--purple)" : "var(--muted)",
              fontSize: "12px",
              fontWeight: 750,
              cursor: "pointer",
            }}
          >
            Artifacts
          </button>
          <button
            className={rightPanelTab === "studio" ? "active" : ""}
            onClick={() => setRightPanelTab("studio")}
            style={{
              flex: 1,
              height: "32px",
              borderRadius: "8px",
              border: rightPanelTab === "studio" ? "1px solid var(--purple)" : "1px solid #dfe4ed",
              background: rightPanelTab === "studio" ? "var(--purple-soft)" : "#ffffff",
              color: rightPanelTab === "studio" ? "var(--purple)" : "var(--muted)",
              fontSize: "12px",
              fontWeight: 750,
              cursor: "pointer",
            }}
          >
            Studio
          </button>
          <button
            className={rightPanelTab === "notes" ? "active" : ""}
            onClick={() => setRightPanelTab("notes")}
            style={{
              flex: 1,
              height: "32px",
              borderRadius: "8px",
              border: rightPanelTab === "notes" ? "1px solid var(--purple)" : "1px solid #dfe4ed",
              background: rightPanelTab === "notes" ? "var(--purple-soft)" : "#ffffff",
              color: rightPanelTab === "notes" ? "var(--purple)" : "var(--muted)",
              fontSize: "12px",
              fontWeight: 750,
              cursor: "pointer",
            }}
          >
            Notes ({notes.length})
          </button>
        </div>

        {/* Tab 1: Artifacts & Verification */}
        {rightPanelTab === "artifacts" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "18px" }}>
            {activeArtifact ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Deliverable Header */}
                <div style={{ padding: "16px", border: "1px solid #e2e7f0", borderRadius: "14px", background: "#ffffff", boxShadow: "0 2px 10px rgba(10, 24, 61, 0.02)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
                    <div>
                      <span className="ai-eyebrow" style={{ fontSize: "10px" }}><ShieldCheck size={12} /> Deliverable</span>
                      <h4 style={{ fontSize: "15px", fontWeight: 750, color: "var(--ink)", margin: "4px 0" }}>
                        {activeArtifact.title || "Untitled Deliverable"}
                      </h4>
                    </div>

                    {readiness && (
                      <span style={{ fontSize: "11px", fontWeight: 800, color: "#2d9366", background: "#e8f6ef", padding: "3px 8px", borderRadius: "999px" }}>
                        {readiness.unsupported_claims === 0 ? "✓ Verified" : `${readiness.unsupported_claims} warnings`}
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button className="btn-primary-gradient" style={{ height: "30px", padding: "0 12px", fontSize: "11px" }} onClick={() => handleExport("pdf")}>
                      Export PDF
                    </button>
                    <button className="btn-secondary-white" style={{ height: "30px", padding: "0 10px", fontSize: "11px" }} onClick={() => handleExport("md")}>
                      Markdown
                    </button>
                  </div>
                </div>

                {/* Requirements Checklist */}
                {requirements.length > 0 && (
                  <div>
                    <h5 style={{ fontSize: "12px", fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 8px" }}>
                      Verifiable Requirements ({requirements.filter((r) => r.status === "covered").length}/{requirements.length})
                    </h5>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {requirements.map((req) => (
                        <div
                          key={req.id}
                          style={{
                            padding: "8px 10px",
                            borderRadius: "8px",
                            border: "1px solid #edf1f7",
                            background: "#ffffff",
                            fontSize: "12px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "8px",
                          }}
                        >
                          <span style={{ color: "var(--ink)" }}>{req.text}</span>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 750,
                              padding: "2px 6px",
                              borderRadius: "4px",
                              background: req.status === "covered" ? "#e8f6ef" : req.status === "partial" ? "#fff8e6" : "#f0f2f7",
                              color: req.status === "covered" ? "#2d9366" : req.status === "partial" ? "#b45309" : "#64748b",
                            }}
                          >
                            {req.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Review Findings */}
                {findings.length > 0 && (
                  <div>
                    <h5 style={{ fontSize: "12px", fontWeight: 800, color: "var(--red)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 8px" }}>
                      Review Findings ({findings.length})
                    </h5>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {findings.map((fnd) => (
                        <div
                          key={fnd.id}
                          style={{
                            padding: "10px 12px",
                            borderRadius: "10px",
                            border: "1px solid #fed7aa",
                            background: "#fffaf5",
                            fontSize: "12px",
                          }}
                        >
                          <strong style={{ color: "#9a3412", display: "block", marginBottom: "2px" }}>
                            {fnd.kind === "unsupported_claim" ? "Unsupported Claim" : "Missing Requirement"}
                          </strong>
                          <p style={{ margin: "0 0 6px", color: "#7c2d12", fontSize: "11px" }}>{fnd.claim_text}</p>
                          <button
                            className="btn-secondary-white"
                            style={{ height: "24px", padding: "0 8px", fontSize: "10px" }}
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
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <h5 style={{ fontSize: "12px", fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
                      Deliverable Blocks
                    </h5>
                    <button
                      style={{ border: 0, background: "transparent", color: "var(--purple)", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}
                      onClick={() => (isEditingContent ? handleSaveBlocks() : setIsEditingContent(true))}
                    >
                      {isEditingContent ? (isSavingDraft ? "Saving..." : "Save Draft") : "Edit Blocks"}
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {editableBlocks.map((blk, bIdx) => (
                      <div
                        key={bIdx}
                        style={{
                          padding: "12px 14px",
                          borderRadius: "10px",
                          border: "1px solid #e2e7f0",
                          background: "#ffffff",
                          fontSize: "13px",
                          lineHeight: 1.5,
                        }}
                      >
                        {isEditingContent ? (
                          <textarea
                            value={blk.text}
                            onChange={(e) => {
                              const next = [...editableBlocks];
                              next[bIdx] = { ...blk, text: e.target.value };
                              setEditableBlocks(next);
                            }}
                            rows={4}
                            style={{ width: "100%", border: 0, outline: 0, fontSize: "12px", resize: "vertical", fontFamily: "inherit" }}
                          />
                        ) : (
                          <div style={{ whiteSpace: "pre-wrap", color: "var(--ink)" }}>{blk.text}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--muted)" }}>
                <ShieldCheck size={36} color="#cbd5e7" style={{ margin: "0 auto 8px" }} />
                <strong style={{ fontSize: "13px", color: "var(--ink)", display: "block" }}>No deliverable generated yet</strong>
                <p style={{ fontSize: "12px", margin: "4px 0 16px" }}>Use the agent in the center panel to draft your first proposal or report.</p>
                <button
                  className="btn-primary-gradient"
                  style={{ height: "34px", padding: "0 14px", fontSize: "12px" }}
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
          <div style={{ flex: 1, overflowY: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <h5 style={{ fontSize: "12px", fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4px" }}>
              Studio Fast Generations
            </h5>
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
              <div
                key={idx}
                style={{
                  padding: "14px",
                  borderRadius: "12px",
                  border: "1px solid #e2e7f0",
                  background: "#ffffff",
                  boxShadow: "0 2px 8px rgba(10, 24, 61, 0.02)",
                }}
              >
                <strong style={{ fontSize: "13px", color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                  {st.title}
                </strong>
                <p style={{ fontSize: "11px", color: "var(--muted)", margin: "0 0 10px", lineHeight: 1.45 }}>
                  {st.detail}
                </p>
                <button
                  className="btn-secondary-white"
                  style={{ height: "28px", padding: "0 10px", fontSize: "11px" }}
                  onClick={() => handleSendPrompt(`Generate ${st.title} from active sources`, st.action)}
                >
                  Generate in Agent →
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Tab 3: Notebook Notes */}
        {rightPanelTab === "notes" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <form onSubmit={handleAddNote} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <textarea
                value={newNoteInput}
                onChange={(e) => setNewNoteInput(e.target.value)}
                placeholder="Write a quick note or finding..."
                rows={2}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "10px",
                  border: "1px solid #dfe4ed",
                  fontSize: "12px",
                  color: "var(--ink)",
                  boxSizing: "border-box",
                  outline: 0,
                  fontFamily: "inherit",
                }}
              />
              <button
                type="submit"
                className="btn-primary-gradient"
                disabled={!newNoteInput.trim() || isAddingNote}
                style={{ height: "30px", padding: "0 12px", fontSize: "11px", alignSelf: "flex-end" }}
              >
                <Plus size={12} />
                <span>Save Note</span>
              </button>
            </form>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
              {notes.map((note, nIdx) => (
                <div
                  key={note.id || nIdx}
                  style={{
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid #edf1f7",
                    background: "#ffffff",
                    fontSize: "12px",
                    lineHeight: 1.5,
                    color: "var(--ink)",
                  }}
                >
                  <p style={{ margin: 0 }}>{note.value}</p>
                  <small style={{ display: "block", marginTop: "6px", color: "#94a3b8", fontSize: "10px" }}>
                    {note.created_at ? new Date(note.created_at).toLocaleString() : "Just now"}
                  </small>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
