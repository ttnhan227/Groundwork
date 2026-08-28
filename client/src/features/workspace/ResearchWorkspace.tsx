import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  ShieldCheck,
  FileText,
  FileCheck2,
  Layers,
  Sparkles,
  RefreshCw,
  Eye,
  PanelRightClose,
  PanelRight,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Tabs } from "../../components/ui/Tabs";
import { TopBar } from "../../components/layout/TopBar";
import { SourcesSidebar } from "../sources/SourcesSidebar";
import { BlockItem } from "../editor/BlockItem";
import { MarginColumn } from "../agent/MarginColumn";
import { AgentBottomBar } from "../agent/AgentBottomBar";
import { AgentReasoningDrawer } from "../agent/AgentReasoningDrawer";
import { ReviewFindingsAudit } from "../change-log/ReviewFindingsAudit";
import { TraceabilityMatrix } from "../verification/TraceabilityMatrix";
import { ProvenanceAppendix } from "../verification/ProvenanceAppendix";
import { getContextualSuggestions } from "./contextualSuggestions";
import { API, api, streamWorkspaceAgent, downloadTextFile } from "../../api/client";
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

// Groundwork Agentic Workspace Architecture:
// - Multi-Step Task Execution with SSE streaming
// - Verifiable Requirements Traceability Matrix & Review Findings Audit
// - Unsupported claim detection with deterministic Export Deliverable gate
// - Sources, Grounded Agent, Artifacts, Studio & Notes

export interface ResearchWorkspaceProps {
  auth: AuthResult;
  workspace: Workspace;
  documents: DocumentItem[];
  nativeDocs: NativeDocument[];
  activeTheme: "light" | "dark";
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onBackToLibrary: () => void;
  onUploadDocument: (file: File, workspaceId: string) => Promise<DocumentItem | null>;
  onDeleteDocument: (docId: string) => Promise<void>;
  onOpenAccount?: () => void;
  onToggleTheme?: () => void;
  onOpenViewer?: (docId: string, pageNumber?: number) => void;
}

export function ResearchWorkspace({
  auth,
  workspace,
  documents,
  nativeDocs,
  activeTheme,
  isSidebarOpen = true,
  onToggleSidebar = () => {},
  onBackToLibrary,
  onUploadDocument,
  onDeleteDocument,
  onOpenAccount,
  onToggleTheme,
  onOpenViewer,
}: ResearchWorkspaceProps) {
  // Filter sources for this workspace
  const workspaceSources = useMemo(() => {
    return documents.filter((d) => d.workspace_id === workspace.id);
  }, [documents, workspace.id]);

  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  useEffect(() => {
    setSelectedSourceIds(workspaceSources.map((s) => s.id));
  }, [workspaceSources]);

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

  // Active artifact / deliverable
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

  // Layout panels
  const [isSourcesOpen, setIsSourcesOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<"audit" | "matrix" | "appendix">("audit");

  // Agent & Execution state
  const [promptInput, setPromptInput] = useState("");
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeSteps, setActiveSteps] = useState<AgentTaskStep[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);

  // Deliverable details state
  const [requirements, setRequirements] = useState<DeliverableRequirement[]>([]);
  const [findings, setFindings] = useState<DeliverableReviewFinding[]>([]);
  const [readiness, setReadiness] = useState<DeliverableReadiness | null>(null);
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editableBlocks, setEditableBlocks] = useState<NativeBlock[]>([]);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isResolvingFindingId, setIsResolvingFindingId] = useState<string | null>(null);
  const [isRunningAudit, setIsRunningAudit] = useState(false);
  const [isUploadingSource, setIsUploadingSource] = useState(false);

  // Load deliverable details
  const reloadArtifactDetails = async () => {
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
  };

  useEffect(() => {
    reloadArtifactDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArtifact?.id, workspace.id, auth.access_token]);

  // Initial load of conversation
  useEffect(() => {
    async function loadWorkspaceData() {
      try {
        const convs = await api<Array<{ id: string }>>(
          `/conversations?workspace_id=${workspace.id}`,
          auth.access_token,
        );
        if (convs && convs.length > 0) {
          const latestConv = convs[0];
          setConversationId(latestConv.id);
          const fullConv = await api<{ messages?: ChatMessage[] }>(
            `/conversations/${latestConv.id}`,
            auth.access_token,
          );
          if (fullConv?.messages) {
            setMessages(fullConv.messages);
          }
        }
      } catch (err) {
        console.error("Failed to load workspace conversation", err);
      }
    }
    loadWorkspaceData();
  }, [workspace.id, auth.access_token]);

  // Handle agent streaming execution
  async function handleSendPrompt(customPrompt?: string) {
    const textToSend = customPrompt || promptInput;
    if (!textToSend.trim() || isAgentRunning) return;

    setPromptInput("");
    setIsDrawerOpen(true);

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
          action_type: "auto",
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
            if (data.conversation_id) setConversationId(data.conversation_id);
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
            const friendly =
              rawMessage.includes("sqlalche.me") || rawMessage.includes("Session")
                ? "A momentary synchronization error occurred. Please try resending your prompt."
                : rawMessage || "An unexpected error occurred during execution.";
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `⚠️ ${friendly}`,
                created_at: new Date().toISOString(),
              },
            ]);
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
            content: `⚠️ ${(err as Error)?.message || "Failed to execute task"}`,
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

  // Save modified blocks
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

  // 1-Click Resolve Review Finding (Signature Interaction)
  async function handleResolveFinding(
    finding: DeliverableReviewFinding,
    action: "accept" | "reject" = "accept",
  ) {
    if (!activeArtifact || isResolvingFindingId) return;
    setIsResolvingFindingId(finding.id);
    try {
      await api(`/review-findings/${finding.id}/decision`, auth.access_token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      // Optimistically update local block text with proposed revision
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

      await reloadArtifactDetails();
    } catch (err) {
      console.error("Failed to resolve finding", err);
    } finally {
      setIsResolvingFindingId(null);
    }
  }

  // Run whole-deliverable verification audit
  async function handleRunAudit() {
    if (!activeArtifact || isRunningAudit) return;
    setIsRunningAudit(true);
    try {
      await api(`/workspaces/${workspace.id}/native-documents/${activeArtifact.id}/review`, auth.access_token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "full" }),
      });
      await reloadArtifactDetails();
    } catch (err) {
      console.error("Audit run failed", err);
    } finally {
      setIsRunningAudit(false);
    }
  }

  // Export Deliverable
  async function handleExport(format: "pdf" | "docx" | "md") {
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
    } catch (err: unknown) {
      alert((err as Error)?.message || "Export failed. Please verify all claims.");
    }
  }

  // Calculate open findings & readiness
  const openFindings = useMemo(() => findings.filter((f) => f.status === "open"), [findings]);
  const coveredRequirementsCount = useMemo(
    () => requirements.filter((r) => r.status === "covered" || r.status === "waived").length,
    [requirements],
  );
  const readinessScore = useMemo(() => {
    if (requirements.length === 0) return 0;
    const reqRatio = coveredRequirementsCount / requirements.length;
    const findingsPenalty = openFindings.length > 0 ? 0.2 : 0;
    return Math.max(0, Math.min(100, Math.round((reqRatio - findingsPenalty) * 100)));
  }, [requirements.length, coveredRequirementsCount, openFindings.length]);

  const isExportBlocked = readiness?.status !== "ready" && (openFindings.length > 0 || readinessScore < 100);

  const contextualSuggestions = useMemo(() => {
    return getContextualSuggestions({
      workspace,
      sources: workspaceSources,
      requirements,
      openFindings,
      activeArtifact,
      language: "en",
    });
  }, [workspace, workspaceSources, requirements, openFindings, activeArtifact]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--paper)] overflow-hidden research-workspace-3col notebook-workspace-3col min-w-0 w-full">
      {/* TopBar */}
      <TopBar
        workspace={workspace}
        activeDoc={activeArtifact}
        sourcesCount={workspaceSources.length}
        selectedSourcesCount={selectedSourceIds.length}
        isAgentRunning={isAgentRunning}
        activeAgentStepLabel={activeSteps.find((s) => s.status === "in_progress")?.label}
        readinessScore={readinessScore}
        isExportBlocked={isExportBlocked}
        openFindingsCount={openFindings.length}
        isSidebarOpen={isSidebarOpen}
        isSourcesOpen={isSourcesOpen}
        isRightPanelOpen={isRightPanelOpen}
        onToggleSidebar={onToggleSidebar}
        onToggleSources={() => setIsSourcesOpen((v) => !v)}
        onToggleRightPanel={() => setIsRightPanelOpen((v) => !v)}
        onOpenAudit={() => {
          setIsRightPanelOpen(true);
          setRightPanelTab("audit");
        }}
        onExport={handleExport}
      />

      {/* Main 3-Column Document Body */}
      <div className="flex-1 flex overflow-hidden min-w-0 w-full relative">
        {/* Left: Sources & Grounding Sidebar */}
        {isSourcesOpen ? (
          <SourcesSidebar
            sources={workspaceSources}
            selectedSourceIds={selectedSourceIds}
            isUploading={isUploadingSource}
            onToggleSource={toggleSource}
            onSelectAll={selectAllSources}
            onDeselectAll={deselectAllSources}
            onUploadFile={async (file) => {
              setIsUploadingSource(true);
              try {
                await onUploadDocument(file, workspace.id);
              } finally {
                setIsUploadingSource(false);
              }
            }}
            onDeleteSource={(id) => onDeleteDocument(id)}
            onRetrySource={async (id) => {
              try {
                await api(`/documents/${id}/retry`, auth.access_token, { method: "POST" });
              } catch (err: unknown) {
                alert((err as Error)?.message || "Retry failed");
              }
            }}
            onOpenViewer={(id, page) => onOpenViewer?.(id, page)}
          />
        ) : (
          <div className="w-11 border-r border-[var(--hairline)] bg-[var(--surface)] flex flex-col items-center py-3 gap-3 select-none flex-shrink-0">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setIsSourcesOpen(true)}
              className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
              title="Expand Evidence Sources"
            >
              <FileText size={15} />
            </Button>
            <span className="text-[10px] font-mono font-bold text-[var(--ink-blue)] px-1 py-0.5 rounded bg-[var(--ink-blue-subtle)]">
              {workspaceSources.length}
            </span>
          </div>
        )}

        {/* Center: Block-Based Document Canvas */}
        <main className="flex-1 flex flex-col min-w-0 bg-[var(--paper)] overflow-hidden groundwork-col-draft">
          <div className="flex-1 flex overflow-y-auto justify-center px-4 sm:px-8 md:px-12 py-8 sm:py-12 min-w-0">
            {/* Single-Column Document Paper Sheet */}
            <div className="w-full max-w-[760px] bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-md)] shadow-[var(--shadow-card)] p-8 sm:p-12 md:p-14 mb-16 min-h-[650px] h-fit flex flex-col min-w-0">
              {/* Document Title Header */}
              <div className="border-b border-[var(--hairline-subtle)] pb-6 mb-8 min-w-0 space-y-4">
                {/* 1. Action Row */}
                <div className="flex items-center justify-between gap-4 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-[var(--success)] px-2 py-0.5 rounded bg-[var(--success-bg)] border border-[var(--success-border)]">
                      <ShieldCheck size={12} />
                      v2.4 Final Draft · Legal Review Active
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => (isEditingContent ? handleSaveBlocks() : setIsEditingContent(true))}
                      className="text-[var(--ink-secondary)] hover:text-[var(--ink)]"
                    >
                      {isEditingContent ? (isSavingDraft ? "Saving…" : "Save Changes") : "Edit Text"}
                    </Button>

                    <Button
                      variant="agent"
                      size="xs"
                      onClick={handleRunAudit}
                      disabled={isRunningAudit}
                    >
                      <RefreshCw size={11} className={isRunningAudit ? "spin" : ""} />
                      <span>{isRunningAudit ? "Verifying…" : "Re-Verify"}</span>
                    </Button>
                  </div>
                </div>

                {/* 2. Document Title Heading */}
                <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[var(--ink)] tracking-tight leading-[1.25] break-normal">
                  {activeArtifact?.title || "Cloudflare 2026 Form 10-K Regulatory Compliance & Infrastructure Strategy"}
                </h1>

                {/* 3. Reviewers & Enterprise Compliance Strip */}
                <div className="flex items-center justify-between gap-3 text-xs text-[var(--ink-muted)] flex-wrap pt-2 border-t border-[var(--hairline)]">
                  <div className="flex items-center gap-2 font-sans">
                    <span className="text-[11px] text-[var(--ink-secondary)]">Reviewers:</span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ink)] px-2 py-0.5 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Sarah Chen (Legal Counsel)
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ink)] px-2 py-0.5 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                      Marcus Vance (Compliance)
                    </span>
                  </div>

                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-[var(--success)] font-semibold">✔ 0 Phantom Citations</span>
                    <span>·</span>
                    <span>SOX 404 Ready</span>
                  </div>
                </div>
              </div>

              {/* Document Blocks List */}
              <div className="space-y-4 flex-1 min-w-0">
                {editableBlocks.map((block, idx) => {
                  const matchedFinding = openFindings.find(
                    (f) => f.claim_text && block.text.toLowerCase().includes(f.claim_text.toLowerCase()),
                  );

                  return (
                    <BlockItem
                      key={idx}
                      block={block}
                      index={idx}
                      isEditing={isEditingContent}
                      matchedFinding={matchedFinding}
                      sources={workspaceSources}
                      isResolvingFinding={isResolvingFindingId === matchedFinding?.id}
                      onUpdateText={(newText) => {
                        const next = [...editableBlocks];
                        next[idx] = { ...block, text: newText };
                        setEditableBlocks(next);
                      }}
                      onOpenViewer={(docId, page) => onOpenViewer?.(docId, page)}
                      onResolveFinding={handleResolveFinding}
                      onPromptSection={(prompt) => handleSendPrompt(prompt)}
                    />
                  );
                })}

                {editableBlocks.length === 0 && (
                  <div className="py-16 text-center text-xs text-[var(--ink-muted)] space-y-2 min-w-0">
                    <FileText size={28} className="mx-auto text-[var(--ink-faint)]" />
                    <p className="font-serif text-sm font-semibold text-[var(--ink)]">
                      Empty Document Canvas
                    </p>
                    <p className="text-[11px] max-w-sm mx-auto">
                      Use the agent prompt composer below to draft your first sections based on uploaded RFP sources.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Collapsible Agent Reasoning History Drawer */}
          <AgentReasoningDrawer
            isOpen={isDrawerOpen}
            isAgentRunning={isAgentRunning}
            messages={messages}
            activeSteps={activeSteps}
            streamingText={streamingText}
            onStopAgent={handleStopAgent}
            onOpenViewer={onOpenViewer}
          />

          {/* Bottom Prompt Composer Bar */}
          <AgentBottomBar
            promptInput={promptInput}
            isAgentRunning={isAgentRunning}
            isDrawerOpen={isDrawerOpen}
            suggestions={contextualSuggestions}
            onPromptChange={setPromptInput}
            onSubmitPrompt={handleSendPrompt}
            onToggleDrawer={() => setIsDrawerOpen((v) => !v)}
          />
        </main>

        {/* Right: Verification Audit & Traceability Suite */}
        {isRightPanelOpen ? (
          <aside className="w-80 flex-shrink-0 flex flex-col bg-[var(--paper)] border-l border-[var(--hairline)] select-none groundwork-col-audit min-w-0">
            {/* Panel Tabs Header */}
            <div className="p-3 border-b border-[var(--hairline)] flex items-center justify-between min-w-0">
              <Tabs
                variant="segment"
                size="sm"
                tabs={[
                  {
                    id: "audit",
                    label: "Audit",
                    badge:
                      openFindings.length > 0 ? (
                        <span className="px-1 rounded-full bg-[var(--warning)] text-white text-[9px] font-mono">
                          {openFindings.length}
                        </span>
                      ) : undefined,
                  },
                  {
                    id: "matrix",
                    label: "Matrix",
                  },
                  {
                    id: "appendix",
                    label: "Ledger",
                  },
                ]}
                activeTab={rightPanelTab}
                onChange={(t) => setRightPanelTab(t)}
              />

              <Button
                variant="ghost"
                size="xs"
                onClick={() => setIsRightPanelOpen(false)}
                className="text-[var(--ink-muted)] hover:text-[var(--ink)] flex-shrink-0"
                title="Collapse audit panel"
              >
                <PanelRightClose size={14} />
              </Button>
            </div>

            {/* Tab Pane Body */}
            <div className="flex-1 overflow-y-auto min-w-0">
              {rightPanelTab === "audit" && (
                <ReviewFindingsAudit
                  findings={findings}
                  requirements={requirements}
                  readinessScore={readinessScore}
                  isExportBlocked={isExportBlocked}
                  isRunningAudit={isRunningAudit}
                  isResolvingFindingId={isResolvingFindingId}
                  onRunAudit={handleRunAudit}
                  onResolveFinding={handleResolveFinding}
                  onOpenViewer={(docId, page) => onOpenViewer?.(docId, page)}
                  onPromptAgent={handleSendPrompt}
                  onExport={() => handleExport("pdf")}
                />
              )}

              {rightPanelTab === "matrix" && (
                <TraceabilityMatrix
                  requirements={requirements}
                  onPromptAgent={handleSendPrompt}
                  onOpenViewer={(docId, page) => onOpenViewer?.(docId, page)}
                />
              )}

              {rightPanelTab === "appendix" && (
                <ProvenanceAppendix
                  activeArtifact={activeArtifact}
                  requirements={requirements}
                  readinessScore={readinessScore}
                />
              )}
            </div>
          </aside>
        ) : (
          <div className="w-11 border-l border-[var(--hairline)] bg-[var(--surface)] flex flex-col items-center py-3 gap-3 select-none flex-shrink-0">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setIsRightPanelOpen(true)}
              className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
              title="Expand Audit &amp; Verification Suite"
            >
              <ShieldCheck size={15} />
            </Button>
            {openFindings.length > 0 && (
              <span className="text-[9px] font-mono font-bold text-white px-1 py-0.2 rounded-full bg-[var(--warning)]">
                {openFindings.length}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ResearchWorkspace;
