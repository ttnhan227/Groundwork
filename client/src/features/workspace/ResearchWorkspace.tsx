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
  ExternalLink,
  CheckSquare,
  Square as SquareOutline,
  Upload,
  Sun,
  Moon,
  Search,
  Check,
  AlertTriangle,
  Lock,
  Unlock,
  FileCheck2,
  RefreshCw,
  Sparkles,
  CheckCheck,
  AlertCircle,
  FileCode,
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
  AuthResult,
} from "../../types";
import { API, api, streamWorkspaceAgent, downloadTextFile, authenticatedFetch } from "../../api/client";
import { BrandMark } from "../../components/common/BrandMark";
import { useTranslation } from "../../i18n";
import { getContextualSuggestions } from "./contextualSuggestions";

export interface ResearchWorkspaceProps {
  auth: AuthResult;
  workspace: Workspace;
  documents: DocumentItem[];
  nativeDocs: NativeDocument[];
  activeTheme: "light" | "dark";
  onBackToLibrary: () => void;
  onUploadDocument: (file: File, workspaceId: string) => Promise<DocumentItem | null>;
  onDeleteDocument: (docId: string) => Promise<void>;
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
  onOpenAccount,
  onToggleTheme,
  onOpenViewer,
}: ResearchWorkspaceProps) {
  const { t, language } = useTranslation();
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

  // Right Panel Tabs: "audit" (findings + readiness), "matrix" (requirements), "appendix" (provenance)
  const [rightPanelTab, setRightPanelTab] = useState<"audit" | "matrix" | "appendix">("audit");

  // Chat & Agent state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [promptInput, setPromptInput] = useState("");
  const [actionType, setActionType] = useState<string>("auto");
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [activeSteps, setActiveSteps] = useState<AgentTaskStep[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isAgentExpanded, setIsAgentExpanded] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Deliverable details state
  const [requirements, setRequirements] = useState<DeliverableRequirement[]>([]);
  const [findings, setFindings] = useState<DeliverableReviewFinding[]>([]);
  const [readiness, setReadiness] = useState<DeliverableReadiness | null>(null);
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editableBlocks, setEditableBlocks] = useState<NativeBlock[]>([]);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isResolvingFindingId, setIsResolvingFindingId] = useState<string | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRunningAudit, setIsRunningAudit] = useState(false);
  const [isLoadingArtifactDetails, setIsLoadingArtifactDetails] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isUploadingSource, setIsUploadingSource] = useState(false);

  // Initial load of conversation
  useEffect(() => {
    async function loadWorkspaceData() {
      setIsLoadingConversation(true);
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
      } catch (err) {
        console.error("Failed to load workspace conversation", err);
      } finally {
        setIsLoadingConversation(false);
      }
    }
    loadWorkspaceData();
  }, [workspace.id, auth.access_token]);

  // Load deliverable details whenever active artifact changes
  const reloadArtifactDetails = async () => {
    if (!activeArtifact) {
      setRequirements([]);
      setFindings([]);
      setReadiness(null);
      setEditableBlocks([]);
      return;
    }
    setIsLoadingArtifactDetails(true);
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
    } finally {
      setIsLoadingArtifactDetails(false);
    }
  };

  useEffect(() => {
    reloadArtifactDetails();
  }, [activeArtifact?.id, workspace.id, auth.access_token]);

  // Auto-scroll chat when active
  useEffect(() => {
    if (isAgentExpanded || isAgentRunning) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingText, activeSteps, isAgentExpanded, isAgentRunning]);

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

  async function handleRetryDocument(docId: string) {
    try {
      await api(`/documents/${docId}/retry`, auth.access_token, { method: "POST" });
      await reloadArtifactDetails();
    } catch (err: unknown) {
      alert((err as Error)?.message || "Failed to retry document processing");
    }
  }

  // Handle agent streaming execution
  async function handleSendPrompt(customPrompt?: string, customAction?: string) {
    const textToSend = customPrompt || promptInput;
    if (!textToSend.trim() || isAgentRunning) return;

    const currentAction = customAction || actionType;
    setPromptInput("");
    setIsAgentExpanded(true);

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
            reloadArtifactDetails();
          },
          onVerification: () => {
            reloadArtifactDetails();
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
            reloadArtifactDetails();
          },
          onError: (errStr) => {
            setActiveSteps((prev) => prev.map((s) => ({ ...s, status: "completed" as const })));
            const rawMessage = (errStr || "").replace(/^⚠️\s*/, "").replace(/^Error during execution:\s*/i, "");
            const friendly = rawMessage.includes("sqlalche.me") || rawMessage.includes("Session") || rawMessage.includes("DetachedInstance")
              ? "A momentary synchronization error occurred. Please try resending your prompt."
              : rawMessage || "An unexpected error occurred during execution. Please try again.";
            const errorMessage: ChatMessage = {
              role: "assistant",
              content: `⚠️ ${friendly}`,
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
        setActiveSteps((prev) => prev.map((s) => ({ ...s, status: "completed" as const })));
        const rawMessage = (err as Error)?.message || "";
        const friendly = rawMessage.includes("sqlalche.me") || rawMessage.includes("Session")
          ? "A momentary synchronization error occurred. Please try resending your prompt."
          : rawMessage || "Failed to execute task. Please try again.";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ ${friendly}`,
            created_at: new Date().toISOString(),
          },
        ]);
      }
      setIsAgentRunning(false);
      setStreamingText("");
    } finally {
      abortControllerRef.current = null;
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
      await reloadArtifactDetails();
    } catch (err) {
      console.error("Failed to save draft blocks", err);
    } finally {
      setIsSavingDraft(false);
    }
  }

  // One-click Resolution of Review Finding (The flagship interactive moment)
  async function handleResolveFinding(finding: DeliverableReviewFinding, action: "accept" | "resolve" | "reject" = "accept") {
    if (!activeArtifact || isResolvingFindingId) return;
    setIsResolvingFindingId(finding.id);
    try {
      await api(
        `/review-findings/${finding.id}/decision`,
        auth.access_token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );

      // Optimistically update local blocks if accepting proposed text
      if (action === "accept" && finding.proposed_text && finding.claim_text) {
        setEditableBlocks((prev) =>
          prev.map((b) => {
            if (b.text.includes(finding.claim_text)) {
              return { ...b, text: b.text.replace(finding.claim_text, finding.proposed_text) };
            }
            return b;
          }),
        );
      }

      // Refresh backend readiness and details
      await reloadArtifactDetails();
    } catch (err) {
      console.error("Failed to resolve finding", err);
    } finally {
      setIsResolvingFindingId(null);
    }
  }

  // Trigger Whole-Deliverable Verification
  async function handleRunAudit() {
    if (!activeArtifact || isRunningAudit) return;
    setIsRunningAudit(true);
    try {
      await api(
        `/workspaces/${workspace.id}/native-documents/${activeArtifact.id}/review`,
        auth.access_token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "full" }),
        },
      );
      await reloadArtifactDetails();
    } catch (err) {
      console.error("Audit run failed", err);
    } finally {
      setIsRunningAudit(false);
    }
  }

  // Export Deliverable
  async function handleExport(format: "pdf" | "docx" | "md" | "txt") {
    if (!activeArtifact || isExporting) return;
    setIsExporting(true);
    setIsExportMenuOpen(false);
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
    } catch (err: unknown) {
      alert((err as Error)?.message || "Export failed. Please ensure all verification findings are resolved.");
    } finally {
      setIsExporting(false);
    }
  }

  // Calculate open findings & readiness
  const openFindings = useMemo(() => {
    return findings.filter((f) => f.status === "open");
  }, [findings]);

  const coveredRequirementsCount = useMemo(() => {
    return requirements.filter((r) => r.status === "covered" || r.status === "waived").length;
  }, [requirements]);

  const readinessScore = useMemo(() => {
    if (requirements.length === 0) return 0;
    const reqRatio = coveredRequirementsCount / requirements.length;
    const findingsPenalty = openFindings.length > 0 ? 0.2 : 0;
    return Math.max(0, Math.min(100, Math.round((reqRatio - findingsPenalty) * 100)));
  }, [requirements.length, coveredRequirementsCount, openFindings.length]);

  const isExportBlocked = readiness?.status !== "ready" && (openFindings.length > 0 || readinessScore < 100);

  // Dynamic context-aware agent suggestion chips based on active documents, findings, and requirements
  const contextualSuggestions = useMemo(() => {
    return getContextualSuggestions({
      workspace,
      sources: workspaceSources,
      requirements,
      openFindings,
      activeArtifact,
      language,
    });
  }, [workspace, workspaceSources, requirements, openFindings, activeArtifact, language]);

  // Helper to parse citations from draft text and make them clickable
  function renderBlockContentWithCitations(text: string, isFlagged: boolean) {
    const citationRegex = /\[(?:Source|Evidence):\s*([^,\]]+)(?:,\s*p(?:age)?\.?\s*(\d+))?\]/gi;
    const parts: (string | React.ReactNode)[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = citationRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      const docName = match[1]?.trim();
      const pageNum = match[2] ? parseInt(match[2], 10) : 1;
      const matchedDoc = workspaceSources.find(
        (s) => s.filename.toLowerCase().includes(docName.toLowerCase()) || docName.toLowerCase().includes(s.filename.toLowerCase()),
      );

      parts.push(
        <button
          key={match.index}
          className="inline-citation-badge"
          onClick={() => {
            if (matchedDoc) {
              onOpenViewer?.(matchedDoc.id, pageNum);
            } else if (workspaceSources.length > 0) {
              onOpenViewer?.(workspaceSources[0].id, pageNum);
            }
          }}
          title={`View evidence on page ${pageNum} of ${docName}`}
        >
          <ExternalLink size={10} />
          <span>{docName}</span>
          <strong>p. {pageNum}</strong>
        </button>,
      );
      lastIndex = citationRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  }

  return (
    <div className="groundwork-workspace-root research-workspace-3col notebook-workspace-3col">
      {/* ================= TOP WORKSPACE HEADER ================= */}
      <header className="groundwork-topbar">
        <div className="topbar-left">
          <button className="btn-back-workspaces" onClick={onBackToLibrary} title={t("workspace.back_to_library")}>
            <ArrowLeft size={14} />
            <span>{t("workspace.back_to_library")}</span>
          </button>
          <div className="topbar-sep" />
          <div className="topbar-project-meta">
            <BrandMark size={16} />
            <strong className="topbar-workspace-name">{workspace.name}</strong>
            <span className="topbar-badge-deliverable">
              <FileCheck2 size={12} />
              {activeArtifact?.title || "Technical Deliverable"}
            </span>
          </div>
        </div>

        {/* Center: Grounding Evidence Status & Active Agent Status */}
        <div className="topbar-center">
          <div className="grounding-status-pill">
            <ShieldCheck size={14} className="icon-emerald" />
            <span>
              {t("workspace.sources_grounded", { selected: selectedSourceIds.length, total: workspaceSources.length })}
            </span>
          </div>
          {isAgentRunning && (
            <div className="topbar-agent-live-badge" role="status" aria-live="polite">
              <RefreshCw size={12} className="spin" />
              <span>
                {activeSteps.find((s) => s.status === "in_progress")?.label || t("agent.active_working")}
              </span>
            </div>
          )}
        </div>

        {/* Right: Readiness Score + Export Gate */}
        <div className="topbar-right">
          {/* Readiness Score Widget */}
          <div className={`readiness-topbar-widget ${isExportBlocked ? "status-blocked" : "status-ready"}`}>
            <div className="readiness-meter-ring">
              <span className="score-number">{readinessScore}%</span>
            </div>
            <div className="readiness-text-group">
              <span className="readiness-label">{t("workspace.readiness_gate")}</span>
              <span className="readiness-state">
                {isExportBlocked ? t(openFindings.length === 1 ? "workspace.issues_unresolved" : "workspace.issues_unresolved_plural", { count: openFindings.length }) : t("workspace.verified_100")}
              </span>
            </div>
          </div>

          {/* Export Gate Button */}
          <div className="export-gate-wrapper">
            <button
              className={`btn-export-gate ${isExportBlocked ? "gate-blocked" : "gate-unlocked"}`}
              onClick={() => {
                if (isExportBlocked) {
                  setRightPanelTab("audit");
                } else {
                  setIsExportMenuOpen((prev) => !prev);
                }
              }}
              title={
                isExportBlocked
                  ? `Export is blocked: ${readiness?.blockers?.[0] || `${openFindings.length} unverified finding(s) remaining`}`
                  : "All claims verified. Ready to export deliverable."
              }
            >
              {isExportBlocked ? (
                <>
                  <Lock size={13} />
                  <span>{t(openFindings.length === 1 ? "workspace.issues_unresolved" : "workspace.issues_unresolved_plural", { count: openFindings.length })}</span>
                </>
              ) : (
                <>
                  <Unlock size={13} />
                  <span>{t("workspace.export_deliverable")}</span>
                </>
              )}
            </button>

            {/* Export Dropdown Menu */}
            {isExportMenuOpen && !isExportBlocked && (
              <div className="export-dropdown-menu">
                <div className="dropdown-header">
                  <strong>{t("workspace.export_deliverable")}</strong>
                  <small>{t("workspace.export_pdf_desc")}</small>
                </div>
                <div className="dropdown-options">
                  <button onClick={() => handleExport("pdf")} className="export-opt-btn">
                    <FileText size={14} />
                    <span>{t("workspace.export_pdf")}</span>
                    <span className="pill-fmt">Ready</span>
                  </button>
                  <button onClick={() => handleExport("docx")} className="export-opt-btn">
                    <FileCheck2 size={14} />
                    <span>{t("workspace.export_docx")}</span>
                    <span className="pill-fmt">Ready</span>
                  </button>
                  <button onClick={() => handleExport("md")} className="export-opt-btn">
                    <FileCode size={14} />
                    <span>{t("workspace.export_md")}</span>
                    <span className="pill-fmt">Ready</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <button className="btn-theme-toggle" onClick={onToggleTheme} title={activeTheme === "dark" ? t("nav.light_mode") : t("nav.dark_mode")} aria-label="Toggle theme">
            {activeTheme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          <button className="btn-user-chip" onClick={onOpenAccount} title="Account Settings">
            <span>{auth.user.display_name}</span>
          </button>
        </div>
      </header>

      {/* ================= 3-COLUMN MAIN WORKSPACE ================= */}
      <div className="groundwork-workspace-body">
        {/* ================= COLUMN 1: SOURCES & EVIDENCE (Left 280px) ================= */}
        <aside className="groundwork-col-sources">
          <div className="sources-header-bar">
            <div className="sources-title-group">
              <strong className="panel-heading">{t("sources.heading")}</strong>
              <span className="count-tag">{t("sources.files_count", { count: workspaceSources.length })}</span>
            </div>

            <label className={`btn-add-evidence ${isUploadingSource ? "disabled" : ""}`} title="Upload new source document">
              <RefreshCw size={13} className={isUploadingSource ? "spin" : ""} />
              <span>{isUploadingSource ? t("sources.btn_uploading") : t("sources.btn_add")}</span>
              <input
                type="file"
                disabled={isUploadingSource}
                style={{ display: "none" }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setIsUploadingSource(true);
                    try {
                      await onUploadDocument(f, workspace.id);
                    } catch (err: unknown) {
                      alert((err as Error)?.message || "Failed to upload document");
                    } finally {
                      setIsUploadingSource(false);
                      e.target.value = "";
                    }
                  }
                }}
              />
            </label>
          </div>

          {/* Source Selection & Grounding Controls */}
          <div className="sources-controls-bar">
            <span className="grounding-info">
              {t("sources.active_in_grounding", { selected: selectedSourceIds.length, total: workspaceSources.length })}
            </span>
            <div className="grounding-toggles">
              <button onClick={selectAllSources} className="btn-link-action">{t("sources.btn_all")}</button>
              <span>·</span>
              <button onClick={deselectAllSources} className="btn-link-action">{t("sources.btn_none")}</button>
            </div>
          </div>

          {/* Sources List */}
          <div className="sources-list-scroll">
            {workspaceSources.length > 0 ? (
              workspaceSources.map((doc) => {
                const isSelected = selectedSourceIds.includes(doc.id);
                return (
                  <div key={doc.id} className={`source-card-item ${isSelected ? "is-selected" : ""}`}>
                    <button
                      className="source-select-checkbox"
                      onClick={() => toggleSource(doc.id)}
                      aria-label={isSelected ? "Deselect source" : "Select source"}
                    >
                      {isSelected ? <CheckSquare size={14} /> : <SquareOutline size={14} />}
                    </button>

                    <div className="source-info-wrap" onClick={() => toggleSource(doc.id)}>
                      <div className="source-title-text" title={doc.filename}>
                        {doc.filename}
                      </div>
                      <div className="source-meta-row">
                        <span className="page-count-badge">
                          {doc.page_count ? `${doc.page_count} pgs` : "1 pg"}
                        </span>
                        {doc.status === "failed" ? (
                          <span className="status-failed-badge" title={doc.error_message || "Document processing failed"}>
                            <AlertTriangle size={10} /> {t("sources.status_failed")}
                          </span>
                        ) : doc.status === "processing" || doc.status === "queued" ? (
                          <span className="status-processing-badge">
                            <RefreshCw size={10} className="spin" /> {t("sources.status_indexing")}
                          </span>
                        ) : (
                          <span className="status-indexed-badge">
                            <Check size={10} /> {t("sources.status_indexed")}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="source-actions-group">
                      {doc.status === "failed" && (
                        <button
                          className="btn-source-action"
                          onClick={() => handleRetryDocument(doc.id)}
                          title="Retry processing"
                          aria-label="Retry processing"
                        >
                          <RefreshCw size={13} />
                        </button>
                      )}
                      <button
                        className="btn-source-action"
                        onClick={() => onOpenViewer?.(doc.id, 1)}
                        title="Open document viewer & inspect pages"
                        aria-label="Preview document"
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        className="btn-source-action"
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
                            // ignore download error
                          }
                        }}
                        title="Download file"
                        aria-label="Download original"
                      >
                        <Download size={13} />
                      </button>
                      <button
                        className="btn-source-action btn-danger-action"
                        onClick={() => onDeleteDocument(doc.id)}
                        title="Remove source"
                        aria-label="Delete source"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="sources-empty-state">
                <FileText size={28} className="empty-icon" />
                <strong>{t("sources.empty_title")}</strong>
                <small>{t("sources.empty_desc")}</small>
              </div>
            )}
          </div>

          {/* Quick Dropzone */}
          <div className="sources-dropzone-footer">
            <label className={`dropzone-box ${isUploadingSource ? "disabled" : ""}`}>
              <RefreshCw size={14} className={isUploadingSource ? "spin" : ""} />
              <span>{isUploadingSource ? t("sources.attach_pdf_uploading") : t("sources.attach_pdf")}</span>
              <input
                type="file"
                disabled={isUploadingSource}
                style={{ display: "none" }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setIsUploadingSource(true);
                    try {
                      await onUploadDocument(f, workspace.id);
                    } catch (err: unknown) {
                      alert((err as Error)?.message || "Upload failed");
                    } finally {
                      setIsUploadingSource(false);
                      e.target.value = "";
                    }
                  }
                }}
              />
            </label>
          </div>
        </aside>

        {/* ================= COLUMN 2: DELIVERABLE DRAFT & STUDIO (Center - Visually Dominant) ================= */}
        <main className="groundwork-col-draft">
          {/* Draft Toolbar & Meta */}
          <div className="draft-top-toolbar studio-toolbar">
            <div className="draft-meta-title">
              <span className="doc-category-tag">Deliverables, Artifacts & Studio</span>
              <h2 className="draft-heading-title">{activeArtifact?.title || "Technical Proposal"}</h2>
              <div className="draft-submeta">
                <span>Revision {activeArtifact?.revision || 1}</span>
                <span>·</span>
                <span className="meta-sources-count">{selectedSourceIds.length} sources linked</span>
                <span>·</span>
                <span className="meta-blocks-count">{editableBlocks.length} sections</span>
              </div>
            </div>

            <div className="draft-action-buttons">
              <button
                className={`btn-toolbar-toggle ${isEditingContent ? "active" : ""}`}
                onClick={() => (isEditingContent ? handleSaveBlocks() : setIsEditingContent(true))}
                title={isEditingContent ? "Save draft edits" : "Edit draft text blocks"}
              >
                {isEditingContent ? (isSavingDraft ? t("editor.btn_saving") : t("editor.btn_save_draft")) : "Edit Content"}
              </button>

              <button
                className="btn-toolbar-audit"
                onClick={handleRunAudit}
                disabled={isRunningAudit}
                title="Run automated verification audit across all claims and requirements"
              >
                <RefreshCw size={13} className={isRunningAudit ? "spin" : ""} />
                <span>{isRunningAudit ? t("editor.btn_verifying") : t("editor.btn_reverify")}</span>
              </button>
            </div>
          </div>

          {/* Draft Document Paper Canvas */}
          <div className="draft-paper-canvas">
            <div className="draft-paper-sheet">
              {isLoadingArtifactDetails && editableBlocks.length === 0 ? (
                <div className="deliverable-skeleton-wrap" role="status" aria-live="polite">
                  <div className="deliverable-skeleton-header">
                    <RefreshCw size={14} className="spin" />
                    <span>{t("editor.loading")}</span>
                  </div>
                  <div className="skeleton-shimmer deliverable-skeleton-title" />
                  <div className="skeleton-shimmer deliverable-skeleton-meta" />
                  <div className="skeleton-shimmer deliverable-skeleton-heading" />
                  <div className="skeleton-shimmer deliverable-skeleton-line" />
                  <div className="skeleton-shimmer deliverable-skeleton-line medium" />
                  <div className="skeleton-shimmer deliverable-skeleton-line short" />
                  <div className="skeleton-shimmer deliverable-skeleton-heading" />
                  <div className="skeleton-shimmer deliverable-skeleton-line" />
                  <div className="skeleton-shimmer deliverable-skeleton-line medium" />
                  <div className="skeleton-shimmer deliverable-skeleton-line short" />
                </div>
              ) : editableBlocks.length === 0 ? (
                <div className="draft-empty-state">
                  <div className="empty-icon-wrap">
                    <FileText size={32} />
                  </div>
                  <h3>{t("editor.empty_title")}</h3>
                  <p>{t("editor.empty_desc")}</p>
                  <div className="empty-action-chips">
                    {contextualSuggestions.slice(0, 2).map((suggestion) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        onClick={() => handleSendPrompt(suggestion.prompt)}
                        className="btn-empty-chip"
                        title={suggestion.prompt}
                      >
                        <Sparkles size={12} />
                        <span>{suggestion.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {editableBlocks.map((block, index) => {
                // Check if this block contains any open finding
                const matchedFinding = openFindings.find(
                  (f) => f.claim_text && block.text.toLowerCase().includes(f.claim_text.toLowerCase()),
                );

                if (block.type === "heading") {
                  return (
                    <div key={index} className="draft-section-heading">
                      <h3>{block.text}</h3>
                    </div>
                  );
                }

                if (isEditingContent) {
                  return (
                    <div key={index} className="draft-block-editor">
                      <textarea
                        value={block.text}
                        onChange={(e) => {
                          const next = [...editableBlocks];
                          next[index] = { ...block, text: e.target.value };
                          setEditableBlocks(next);
                        }}
                        rows={3}
                        className="draft-textarea-input"
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={index}
                    className={`draft-block-row ${block.type === "bullet" ? "is-bullet" : "is-paragraph"} ${
                      matchedFinding ? "has-unsupported-finding" : ""
                    }`}
                  >
                    {block.type === "bullet" && <span className="bullet-dot">•</span>}
                    <div className="block-content-body">
                      <p className="block-text-body">
                        {renderBlockContentWithCitations(block.text, Boolean(matchedFinding))}
                      </p>

                      {/* Inline Finding Alert Callout on Flagged Claim */}
                      {matchedFinding ? (
                        <div className="inline-finding-callout">
                          <div className="callout-header">
                            <AlertTriangle size={14} className="icon-amber" />
                            <strong>{t("editor.warning_unsupported")}</strong>
                            <span className="badge-severity-high">{t("audit.high_severity")}</span>
                          </div>
                          <p className="callout-explanation">{matchedFinding.explanation}</p>
                          <div className="callout-action-row">
                            <button
                              className="btn-callout-resolve"
                              onClick={() => handleResolveFinding(matchedFinding, "accept")}
                              disabled={isResolvingFindingId === matchedFinding.id}
                            >
                              <CheckCircle2 size={13} />
                              <span>
                                {isResolvingFindingId === matchedFinding.id
                                  ? t("audit.btn_applying_fix")
                                  : t("audit.btn_apply_fix")}
                              </span>
                            </button>
                            <button
                              className="btn-callout-explain"
                              onClick={() => {
                                handleSendPrompt(
                                  `Investigate unsupported claim: "${matchedFinding.claim_text}". Find matching evidence in active sources.`,
                                );
                              }}
                            >
                              <Search size={13} />
                              <span>{t("editor.btn_fix_claim")}</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="block-quick-actions">
                          <button
                            className="btn-block-action"
                            onClick={() =>
                              handleSendPrompt(
                                `Analyze and explain the evidence supporting this paragraph: "${block.text.slice(0, 100)}..."`,
                              )
                            }
                            title="Ask agent to explain evidence for this section"
                          >
                            <ShieldCheck size={11} />
                            <span>Explain Evidence</span>
                          </button>
                          <button
                            className="btn-block-action"
                            onClick={() =>
                              handleSendPrompt(
                                `Audit this section for ungrounded claims or missing requirements: "${block.text.slice(0, 100)}..."`,
                              )
                            }
                            title="Ask agent to audit this section"
                          >
                            <Search size={11} />
                            <span>Audit Section</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ================= INTEGRATED AGENT CONTROL BAR (Docked at Bottom) ================= */}
          <div className={`groundwork-agent-dock ${isAgentExpanded ? "is-expanded" : "is-collapsed"}`}>
            <div className="agent-dock-header">
              <div className="dock-title" onClick={() => setIsAgentExpanded((prev) => !prev)}>
                <Sparkles size={15} className="icon-brand" />
                <strong>{t("agent.dock_title")}</strong>
                <span className="dock-status-tag">
                  {isAgentRunning ? t("agent.status_running") : t("agent.status_ready")}
                </span>
              </div>

              <div className="dock-quick-chips">
                {contextualSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    className="btn-dock-chip"
                    onClick={() => handleSendPrompt(suggestion.prompt)}
                    disabled={isAgentRunning}
                    title={suggestion.prompt}
                  >
                    <span>{suggestion.label}</span>
                  </button>
                ))}
              </div>

              <button
                className="btn-toggle-dock"
                onClick={() => setIsAgentExpanded((prev) => !prev)}
                title={isAgentExpanded ? t("agent.toggle_minimize") : t("agent.toggle_history")}
              >
                {isAgentExpanded ? t("agent.toggle_minimize") : t("agent.toggle_history")}
              </button>
            </div>

            {/* Expanded Agent Conversation Feed */}
            {isAgentExpanded && (
              <div className="agent-conversation-drawer">
                <div className="agent-context-summary-bar">
                  <span className="ctx-item">
                    <Sparkles size={11} className="icon-brand" />
                    <strong>{workspace.name}</strong>
                  </span>
                  {activeArtifact && (
                    <span className="ctx-item">
                      <FileText size={11} />
                      <span>{activeArtifact.title}</span>
                    </span>
                  )}
                  <span className="ctx-item">
                    <CheckCircle2 size={11} className="text-emerald" />
                    <span>{selectedSourceIds.length} {t("audit.metric_sources")}</span>
                  </span>
                </div>

                <div className="messages-stream-list">
                  {isLoadingConversation && messages.length === 0 ? (
                    <div className="chat-loading-indicator" role="status" aria-live="polite">
                      <RefreshCw size={15} className="spin" />
                      <span>{t("agent.loading_history")}</span>
                    </div>
                  ) : messages.length === 0 && !isAgentRunning ? (
                    <div className="agent-empty-notice">
                      <p>{t("agent.empty_history")}</p>
                    </div>
                  ) : (
                    messages.map((msg, mIdx) => (
                      <div key={mIdx} className={`dock-message-bubble ${msg.role === "user" ? "user-msg" : "ai-msg"}`}>
                        <div className="msg-role-label">{msg.role === "user" ? "You" : "Agent"}</div>
                        <div className="msg-text-content">{msg.content}</div>
                        {msg.citations && msg.citations.length > 0 && (
                          <div className="msg-citations-row">
                            {msg.citations.map((c, cIdx) => (
                              <button
                                key={cIdx}
                                className="inline-citation-badge"
                                onClick={() => onOpenViewer?.(c.document_id, c.page_number)}
                              >
                                <ExternalLink size={10} />
                                <span>{c.document_name}</span>
                                <strong>p. {c.page_number}</strong>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}

                  {/* Active Agent Task Steps */}
                  {isAgentRunning && (
                    <div className="agent-executing-card">
                      <div className="exec-header">
                        <RefreshCw size={13} className="spin text-accent" />
                        <strong>{t("agent.task_execution")}</strong>
                        <button onClick={handleStopAgent} className="btn-stop-stream">
                          <Square size={11} /> {t("agent.btn_stop")}
                        </button>
                      </div>
                      <div className="exec-steps">
                        {activeSteps.map((s, sIdx) => (
                          <div key={sIdx} className="exec-step-row">
                            {s.status === "completed" ? (
                              <Check size={13} className="text-emerald" />
                            ) : (
                              <RefreshCw size={12} className="spin text-accent" />
                            )}
                            <span className={s.status === "completed" ? "step-done" : "step-active"}>
                              {s.label}
                            </span>
                          </div>
                        ))}
                      </div>
                      {streamingText && <div className="exec-streaming-text">{streamingText}</div>}
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </div>
              </div>
            )}

            {/* Agent Input Bar */}
            <div className="agent-composer-row agent-composer-container">
              <input
                type="text"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendPrompt();
                  }
                }}
                disabled={isAgentRunning}
                placeholder={
                  isAgentRunning
                    ? t("agent.placeholder_working")
                    : activeArtifact?.title
                    ? t("agent.placeholder_with_artifact", { artifact: activeArtifact.title, count: selectedSourceIds.length })
                    : openFindings.length > 0
                    ? t("agent.placeholder_with_findings", { count: openFindings.length })
                    : t("agent.placeholder_ready", { count: selectedSourceIds.length })
                }
                className="dock-prompt-input"
                aria-label="Agent prompt input"
              />
              <button
                onClick={() => handleSendPrompt()}
                disabled={!promptInput.trim() || isAgentRunning}
                className="btn-dock-send"
                title={isAgentRunning ? "Agent is processing…" : "Send command to agent"}
              >
                {isAgentRunning ? <RefreshCw size={14} className="spin" /> : <Send size={14} />}
                <span>{isAgentRunning ? t("agent.btn_working") : t("agent.btn_execute")}</span>
              </button>
            </div>
          </div>
        </main>

        {/* ================= COLUMN 3: AUDIT & VERIFICATION SUITE (Right 380px) ================= */}
        <aside className="groundwork-col-audit">
          {/* Segmented Audit Navigation */}
          <div className="audit-nav-segments">
            <button
              className={`audit-segment-btn ${rightPanelTab === "audit" ? "active" : ""}`}
              onClick={() => setRightPanelTab("audit")}
            >
              <span>{t("audit.tab_verification")}</span>
              {openFindings.length > 0 && <span className="badge-finding-count">{openFindings.length}</span>}
            </button>
            <button
              className={`audit-segment-btn ${rightPanelTab === "matrix" ? "active" : ""}`}
              onClick={() => setRightPanelTab("matrix")}
            >
              <span>{t("audit.tab_matrix")}</span>
              <span className="badge-req-count">
                {coveredRequirementsCount}/{requirements.length}
              </span>
            </button>
            <button
              className={`audit-segment-btn ${rightPanelTab === "appendix" ? "active" : ""}`}
              onClick={() => setRightPanelTab("appendix")}
            >
              <span>{t("audit.tab_appendix")}</span>
            </button>
          </div>

          {/* TAB 1: AUDIT & VERIFICATION FINDINGS */}
          {rightPanelTab === "audit" && (
            <div className="audit-tab-pane">
              {/* Readiness Score Card */}
              <div className={`readiness-summary-card ${isExportBlocked ? "is-blocked" : "is-ready"}`}>
                <div className="card-top">
                  <div className="readiness-gauge-large">
                    <span className="gauge-score">{readinessScore}%</span>
                    <small>{t("workspace.readiness_gate")}</small>
                  </div>
                  <div className="readiness-meta-text">
                    <span className="gate-title">
                      {isExportBlocked ? `${t("workspace.readiness_gate")}: Blocked` : `${t("workspace.readiness_gate")}: Passed`}
                    </span>
                    <p className="gate-desc">
                      {isExportBlocked
                        ? t(openFindings.length === 1 ? "workspace.issues_unresolved" : "workspace.issues_unresolved_plural", { count: openFindings.length })
                        : t("audit.all_cleared_desc")}
                    </p>
                  </div>
                </div>

                {/* Score Breakdown Bar */}
                <div className="readiness-breakdown-bar">
                  <div
                    className={`bar-fill ${isExportBlocked ? "fill-warning" : "fill-success"}`}
                    style={{ width: `${readinessScore}%` }}
                  />
                </div>

                <div className="readiness-metrics-row">
                  <div className="metric-col">
                    <small>{t("audit.metric_requirements")}</small>
                    <strong>{coveredRequirementsCount}/{requirements.length}</strong>
                  </div>
                  <div className="metric-col">
                    <small>{t("audit.metric_findings")}</small>
                    <strong className={openFindings.length > 0 ? "text-danger" : "text-emerald"}>
                      {t("audit.metric_open_findings", { count: openFindings.length })}
                    </strong>
                  </div>
                  <div className="metric-col">
                    <small>{t("audit.metric_sources")}</small>
                    <strong>{t("audit.metric_sources_linked", { count: selectedSourceIds.length })}</strong>
                  </div>
                </div>
              </div>

              {/* Review Findings List */}
              <div className="findings-section-group">
                <div className="section-title-row">
                  <strong className="subpanel-title">
                    {t("audit.review_findings", { count: openFindings.length })}
                  </strong>
                  <button
                    className="btn-recheck-audit"
                    onClick={handleRunAudit}
                    disabled={isRunningAudit}
                    title="Re-run audit scan"
                  >
                    <RefreshCw size={12} className={isRunningAudit ? "spin" : ""} />
                    <span>{isRunningAudit ? t("audit.btn_scanning") : t("audit.btn_scan")}</span>
                  </button>
                </div>

                {isLoadingArtifactDetails && findings.length === 0 ? (
                  <div className="chat-loading-indicator" role="status" aria-live="polite">
                    <RefreshCw size={15} className="spin" />
                    <span>{t("audit.loading_findings")}</span>
                  </div>
                ) : openFindings.length > 0 ? (
                  <div className="findings-cards-list">
                    {openFindings.map((finding) => (
                      <div key={finding.id} className="finding-detail-card">
                        <div className="finding-card-header">
                          <span className="finding-severity-pill high">{t("audit.high_severity")}</span>
                          <span className="finding-type-pill">{t("audit.unsupported_claim")}</span>
                        </div>

                        <div className="finding-claim-quote">
                          <p>"{finding.claim_text}"</p>
                        </div>

                        <div className="finding-explanation-text">
                          <p>{finding.explanation}</p>
                        </div>

                        {/* Evidence Citation Reference */}
                        {finding.citations && finding.citations.length > 0 && (
                          <div className="finding-evidence-matched">
                            <span className="evidence-header">
                              <CheckCircle2 size={12} className="text-emerald" /> {t("audit.evidence_available")}
                            </span>
                            <div className="evidence-snippet-box">
                              <p>"{finding.citations[0].snippet}"</p>
                              <button
                                className="evidence-link-btn"
                                onClick={() =>
                                  onOpenViewer?.(finding.citations[0].document_id, finding.citations[0].page_number)
                                }
                              >
                                <ExternalLink size={10} />
                                <span>{finding.citations[0].document_name}</span>
                                <strong>(Page {finding.citations[0].page_number})</strong>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Direct Resolution Actions */}
                        <div className="finding-actions-footer">
                          <button
                            className="btn-action-apply-fix"
                            onClick={() => handleResolveFinding(finding, "accept")}
                            disabled={isResolvingFindingId === finding.id}
                            title="Replace draft claim with verified 99.99% SLA and attach citation"
                          >
                            <CheckCheck size={13} />
                            <span>
                              {isResolvingFindingId === finding.id
                                ? t("audit.btn_applying_fix")
                                : t("audit.btn_apply_fix")}
                            </span>
                          </button>

                          <button
                            className="btn-action-waive"
                            onClick={() => handleResolveFinding(finding, "reject")}
                            disabled={isResolvingFindingId === finding.id}
                            title="Waive this finding"
                          >
                            {t("audit.btn_waive")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="findings-cleared-card">
                    <CheckCircle2 size={28} className="icon-verified-cleared" />
                    <strong>{t("audit.all_cleared_title")}</strong>
                    <p>{t("audit.all_cleared_desc")}</p>
                    <button
                      className="btn-primary-gradient btn-export-now"
                      onClick={() => handleExport("pdf")}
                    >
                      <Download size={14} />
                      <span>{t("audit.btn_export_now")}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: REQUIREMENTS TRACEABILITY MATRIX */}
          {rightPanelTab === "matrix" && (
            <div className="matrix-tab-pane">
              <div className="matrix-header-info">
                <strong>{t("matrix.header_title")}</strong>
                <p>{t("matrix.header_desc")}</p>
              </div>

              <div className="requirements-matrix-list">
                {isLoadingArtifactDetails && requirements.length === 0 ? (
                  <div className="chat-loading-indicator" role="status" aria-live="polite">
                    <RefreshCw size={15} className="spin" />
                    <span>{t("matrix.loading")}</span>
                  </div>
                ) : (
                  requirements.map((req, rIdx) => {
                    const isCovered = req.status === "covered";
                    return (
                      <div key={req.id || rIdx} className={`req-matrix-card ${isCovered ? "covered" : "unverified"}`}>
                        <div className="req-card-top">
                          <div className="req-status-indicator">
                            {isCovered ? (
                              <CheckCircle2 size={16} className="text-emerald" />
                            ) : (
                              <AlertCircle size={16} className="text-amber" />
                            )}
                          </div>
                          <div className="req-text-wrap">
                            <strong className="req-title">{req.text}</strong>
                            {req.linked_sections && req.linked_sections.length > 0 && (
                              <span className="req-section-tag">
                                Section: {req.linked_sections[0]}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Requirement Evidence & Quick Actions */}
                        <div className="req-card-footer">
                          {req.evidence && req.evidence.length > 0 && (
                            <div className="req-evidence-row">
                              <span className="evidence-badge-item">
                                <ExternalLink size={10} />
                                <span>{req.evidence[0].document_name}</span>
                                <strong>(p. {req.evidence[0].page_number})</strong>
                              </span>
                            </div>
                          )}
                          {!isCovered && (
                            <button
                              className="btn-req-solve"
                              onClick={() =>
                                handleSendPrompt(
                                  `Investigate requirement "${req.text}". Find supporting evidence in active sources and draft a section to satisfy it.`,
                                )
                              }
                              title="Ask agent to satisfy requirement"
                            >
                              <Sparkles size={11} />
                              <span>{t("matrix.btn_ask_agent")}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 3: AUDIT APPENDIX PREVIEW */}
          {rightPanelTab === "appendix" && (
            <div className="appendix-tab-pane">
              <div className="appendix-header-info">
                <strong>{t("appendix.header_title")}</strong>
                <p>{t("appendix.header_desc")}</p>
              </div>

              <div className="appendix-ledger-card">
                <div className="ledger-meta-row">
                  <span>Document: <strong>{activeArtifact?.title}</strong></span>
                  <span>Readiness: <strong>{readinessScore}%</strong></span>
                </div>

                <div className="ledger-table-wrap">
                  <table className="ledger-table">
                    <thead>
                      <tr>
                        <th>{t("appendix.col_requirement")}</th>
                        <th>{t("appendix.col_source")}</th>
                        <th>{t("appendix.col_status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requirements.map((req, idx) => (
                        <tr key={idx}>
                          <td>{req.text.slice(0, 48)}…</td>
                          <td>
                            {req.evidence?.[0] ? `${req.evidence[0].document_name} (p. ${req.evidence[0].page_number})` : "Direct Spec"}
                          </td>
                          <td>
                            <span className={`status-pill-mini ${req.status}`}>
                              {req.status === "covered" ? t("appendix.status_verified") : t("appendix.status_unverified")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="ledger-footer-stamp">
                  <ShieldCheck size={14} className="text-emerald" />
                  <span>{t("appendix.cryptographic_stamp")}</span>
                </div>
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
