import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  ShieldCheck,
  FileText,
  RefreshCw,
  PanelRightClose,
  Upload,
  ListChecks,
  PenLine,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  X,
  Save,
  Undo2,
  MessageSquareText,
  Headphones,
  BookOpen,
  HelpCircle,
  FileSpreadsheet,
  Copy,
  Pin,
  Plus,
  Download,
  Bot,
  User,
  ExternalLink,
  Sparkles,
  Send,
  Video,
  ChevronLeft,
  ChevronRight,
  Film,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { Tabs } from "../../components/ui/Tabs";
import { TopBar } from "../../components/layout/TopBar";
import { FormattedAnswer } from "../../components/common/FormattedAnswer";
import { SourcesSidebar } from "../sources/SourcesSidebar";
import { AddSourceModal } from "../sources/AddSourceModal";
import { BlockItem } from "../editor/BlockItem";
import { AgentBottomBar } from "../agent/AgentBottomBar";
import { AgentReasoningDrawer } from "../agent/AgentReasoningDrawer";
import { ReviewFindingsAudit } from "../change-log/ReviewFindingsAudit";
import { TraceabilityMatrix } from "../verification/TraceabilityMatrix";
import { ProvenanceAppendix } from "../verification/ProvenanceAppendix";
import { getContextualSuggestions } from "./contextualSuggestions";
import {
  api,
  streamWorkspaceAgent,
  downloadTextFile,
  copyTextToClipboard,
  formatDateTime,
  fetchWorkspaceNotes,
  createWorkspaceNote,
  updateWorkspaceNote,
  deleteWorkspaceNote,
} from "../../api/client";
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
  Note,
  NoteType,
} from "../../types";
import { NotesCanvas } from "./NotesCanvas";
import { DocumentReader } from "../reader/DocumentReader";

export interface ResearchWorkspaceProps {
  auth: AuthResult;
  workspace: Workspace;
  documents: DocumentItem[];
  nativeDocs: NativeDocument[];
  activeTheme: "light" | "dark";
  requestedDraftId?: string | null;
  onActiveDraftChange?: (draftId: string | null) => void;
  onDirtyStateChange?: (isDirty: boolean) => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onBackToLibrary: () => void;
  onUploadDocument: (
    file: File,
    workspaceId: string,
  ) => Promise<DocumentItem | null>;
  onCreateDraft: (
    title: string,
    sourceDocumentIds: string[],
  ) => Promise<NativeDocument | null>;
  onDeleteDocument: (docId: string) => Promise<void>;
  onDeleteDraft?: (draftId: string) => Promise<void>;
  onOpenAccount?: () => void;
  onToggleTheme?: () => void;
  onOpenViewer?: (docId: string, pageNumber?: number, snippet?: string) => void;
}

const SOURCE_UPLOAD_ACCEPT =
  ".pdf,.docx,.pptx,.md,.markdown,.txt,.rtf,.png,.jpg,.jpeg,.webp";

type WorkspaceNotice = {
  tone: "success" | "error" | "info";
  message: string;
};

function parseVideoScenes(markdown: string): {
  title: string;
  visual: string;
  narration: string;
  takeaway: string;
}[] {
  const sceneBlocks = markdown
    .split(/### Scene \d+:?/i)
    .filter((s) => s.trim().length > 0);

  if (sceneBlocks.length > 0) {
    return sceneBlocks.map((block, idx) => {
      const lines = block.trim().split("\n");
      const firstLine = lines[0].replace(/^#+\s*/, "").trim();
      const visualMatch =
        block.match(/-\s*\*\*Visual\*\*:\s*([^\n]+)/i) ||
        block.match(/\*\*Visual\*\*:\s*([^\n]+)/i);
      const narrationMatch =
        block.match(/-\s*\*\*Narration\*\*:\s*([^\n]+)/i) ||
        block.match(/\*\*Narration\*\*:\s*([^\n]+)/i);
      const takeawayMatch =
        block.match(/-\s*\*\*Key Takeaway\*\*:\s*([^\n]+)/i) ||
        block.match(/\*\*Key Takeaway\*\*:\s*([^\n]+)/i);

      return {
        title: firstLine || `Scene ${idx + 1}`,
        visual: visualMatch
          ? visualMatch[1].trim()
          : "Visual storyboard graphics and cited diagrams from source documents",
        narration: narrationMatch
          ? narrationMatch[1].trim()
          : block.slice(0, 450).trim(),
        takeaway: takeawayMatch
          ? takeawayMatch[1].trim()
          : "Key research insight synthesized directly from your sources",
      };
    });
  }

  return [
    {
      title: "Executive Synthesis",
      visual: "Visual presentation summarizing key themes and cited findings across sources",
      narration: markdown.slice(0, 500),
      takeaway: "Core synthesis grounded directly in your uploaded materials",
    },
  ];
}

export function ResearchWorkspace({
  auth,
  workspace,
  documents,
  nativeDocs,
  activeTheme: _activeTheme,
  requestedDraftId = null,
  onActiveDraftChange = () => {},
  onDirtyStateChange = () => {},
  isSidebarOpen = true,
  onToggleSidebar = () => {},
  onBackToLibrary: _onBackToLibrary,
  onUploadDocument,
  onCreateDraft,
  onDeleteDocument,
  onDeleteDraft,
  onOpenAccount: _onOpenAccount,
  onToggleTheme: _onToggleTheme,
  onOpenViewer: _onOpenViewer,
}: ResearchWorkspaceProps) {
  const [localAddedSources, setLocalAddedSources] = useState<DocumentItem[]>([]);

  // Filter sources for this workspace
  const workspaceSources = useMemo(() => {
    const existing = documents.filter((d) => d.workspace_id === workspace.id);
    const existingIds = new Set(existing.map((d) => d.id));
    const newlyAdded = localAddedSources.filter((d) => !existingIds.has(d.id));
    return [...existing, ...newlyAdded];
  }, [documents, workspace.id, localAddedSources]);

  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  useEffect(() => {
    setSelectedSourceIds(workspaceSources.map((s) => s.id));
  }, [workspaceSources]);

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((prev) =>
      prev.includes(sourceId)
        ? prev.filter((id) => id !== sourceId)
        : [...prev, sourceId],
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
    const requestedDraft = workspaceArtifacts.find(
      (artifact) => artifact.id === requestedDraftId,
    );
    if (requestedDraft && requestedDraft.id !== activeArtifactId) {
      setActiveArtifactId(requestedDraft.id);
      return;
    }
    const activeDraftIsAvailable = workspaceArtifacts.some(
      (artifact) => artifact.id === activeArtifactId,
    );
    if (workspaceArtifacts.length > 0 && !activeDraftIsAvailable) {
      setActiveArtifactId(workspaceArtifacts[0].id);
      onActiveDraftChange(workspaceArtifacts[0].id);
    }
  }, [
    workspaceArtifacts,
    activeArtifactId,
    requestedDraftId,
    onActiveDraftChange,
  ]);

  const activeArtifact = useMemo(() => {
    return (
      workspaceArtifacts.find((a) => a.id === activeArtifactId) ||
      workspaceArtifacts[0] ||
      null
    );
  }, [workspaceArtifacts, activeArtifactId]);

  // Layout panels
  const [isSourcesOpen, setIsSourcesOpen] = useState(
    () => window.innerWidth >= 900,
  );
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(
    () => window.innerWidth >= 1280,
  );
  const [rightPanelTab, setRightPanelTab] = useState<
    "assistant" | "audit" | "matrix" | "appendix"
  >("assistant");

  // Agent & Execution state
  const [promptInput, setPromptInput] = useState("");
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeSteps, setActiveSteps] = useState<AgentTaskStep[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);

  // Deliverable details state
  const [requirements, setRequirements] = useState<DeliverableRequirement[]>(
    [],
  );
  const [findings, setFindings] = useState<DeliverableReviewFinding[]>([]);
  const [readiness, setReadiness] = useState<DeliverableReadiness | null>(null);
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editableBlocks, setEditableBlocks] = useState<NativeBlock[]>([]);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isResolvingFindingId, setIsResolvingFindingId] = useState<
    string | null
  >(null);
  const [isRunningAudit, setIsRunningAudit] = useState(false);
  const [isUploadingSource, setIsUploadingSource] = useState(false);
  const [isCreatingBlankDraft, setIsCreatingBlankDraft] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] =
    useState<WorkspaceNotice | null>(null);
  const [sourcePendingDeletion, setSourcePendingDeletion] =
    useState<DocumentItem | null>(null);
  const [isDeletingSource, setIsDeletingSource] = useState(false);
  const [draftPendingDeletion, setDraftPendingDeletion] =
    useState<NativeDocument | null>(null);
  const [isDeletingDraft, setIsDeletingDraft] = useState(false);
  const savedBlocksRef = useRef<NativeBlock[]>([]);

  // NotebookLM Studio & Research state
  const [centerView, setCenterView] = useState<
    "studio" | "document" | "notes" | "reader"
  >("document");
  const [readerSourceId, setReaderSourceId] = useState<string | null>(null);
  const [readerPage, setReaderPage] = useState<number>(1);
  const [readerSearch, setReaderSearch] = useState<string>("");
  const [readerEvidenceSnippet, setReaderEvidenceSnippet] = useState<string | null>(null);
  const [readerEvidencePage, setReaderEvidencePage] = useState<number | null>(null);

  const activeReaderDoc = useMemo(() => {
    return (
      workspaceSources.find((s) => s.id === readerSourceId) ||
      workspaceSources[0] ||
      null
    );
  }, [workspaceSources, readerSourceId]);

  const handleOpenReader = (
    docId: string,
    pageNumber?: number,
    snippet?: string,
  ) => {
    setReaderSourceId(docId);
    setReaderPage(pageNumber || 1);
    setReaderSearch(snippet || "");
    setReaderEvidenceSnippet(snippet || null);
    setReaderEvidencePage(pageNumber || null);
    setCenterView("reader");
  };
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);

  const loadNotes = async () => {
    if (!workspace.id || !auth.access_token) return;
    setIsLoadingNotes(true);
    try {
      const fetched = await fetchWorkspaceNotes(workspace.id, auth.access_token);
      setNotes(fetched || []);
    } catch (err) {
      console.error("Failed to fetch workspace notes", err);
    } finally {
      setIsLoadingNotes(false);
    }
  };

  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, auth.access_token]);
  const [audioOverview, setAudioOverview] = useState<{
    title: string;
    hosts: string[];
    transcript: string;
  } | null>(null);
  const [isAddNoteModalOpen, setIsAddNoteModalOpen] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isAddSourceModalOpen, setIsAddSourceModalOpen] = useState(false);

  const [videoOverview, setVideoOverview] = useState<{
    title: string;
    scenes: {
      title: string;
      visual: string;
      narration: string;
      takeaway: string;
    }[];
    currentSceneIndex: number;
  } | null>(null);

  const hasUnsavedChanges = useMemo(
    () =>
      isEditingContent &&
      JSON.stringify(editableBlocks) !== JSON.stringify(savedBlocksRef.current),
    [editableBlocks, isEditingContent],
  );

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    onDirtyStateChange(hasUnsavedChanges);
    return () => onDirtyStateChange(false);
  }, [hasUnsavedChanges, onDirtyStateChange]);

  useEffect(() => {
    const keepDraftReadable = () => {
      if (window.innerWidth < 900) {
        setIsSourcesOpen(false);
        setIsRightPanelOpen(false);
      } else if (window.innerWidth < 1280) {
        setIsRightPanelOpen(false);
      }
    };
    keepDraftReadable();
    window.addEventListener("resize", keepDraftReadable);
    return () => window.removeEventListener("resize", keepDraftReadable);
  }, []);

  // Load deliverable details
  const reloadArtifactDetails = async (targetDoc?: NativeDocument) => {
    const doc = targetDoc || activeArtifact;
    if (!doc) {
      setRequirements([]);
      setFindings([]);
      setReadiness(null);
      setEditableBlocks([]);
      return;
    }
    try {
      const [reqs, fnds, rdn, blocks] = await Promise.all([
        api<DeliverableRequirement[]>(
          `/workspaces/${workspace.id}/native-documents/${doc.id}/requirements`,
          auth.access_token,
        ).catch(() => []),
        api<DeliverableReviewFinding[]>(
          `/workspaces/${workspace.id}/native-documents/${doc.id}/review-findings`,
          auth.access_token,
        ).catch(() => []),
        api<DeliverableReadiness>(
          `/workspaces/${workspace.id}/native-documents/${doc.id}/readiness`,
          auth.access_token,
        ).catch(() => null),
        api<NativeBlock[]>(
          `/workspaces/${workspace.id}/native-documents/${doc.id}/blocks`,
          auth.access_token,
        ).catch(() => []),
      ]);
      setRequirements(reqs || []);
      setFindings(fnds || []);
      setReadiness(rdn);
      const loadedBlocks =
        blocks && blocks.length > 0 ? blocks : doc.content?.blocks || [];
      savedBlocksRef.current = loadedBlocks;
      setEditableBlocks(loadedBlocks);
    } catch (err) {
      console.error("Failed to load artifact details", err);
      setWorkspaceNotice({
        tone: "error",
        message: "Some response details could not be loaded. Refresh and try again.",
      });
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
  async function handleSendPrompt(customPrompt?: string, actionType?: string) {
    const textToSend = customPrompt || promptInput;
    if (!textToSend.trim() || isAgentRunning) return;
    if (isEditingContent) {
      setWorkspaceNotice({
        tone: "info",
        message: "Save or cancel your manual edits before using Groundwork AI.",
      });
      return;
    }

    setPromptInput("");
    setIsRightPanelOpen(true);
    setRightPanelTab("assistant");

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
          action_type: actionType || "auto",
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
              const next = prev.map((s) => ({
                ...s,
                status: "completed" as const,
              }));
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
          onStudioArtifact: (art) => {
            if (art.type === "studio_audio_overview") {
              setAudioOverview({
                title: art.title,
                hosts: ["Alex", "Jordan"],
                transcript: art.content,
              });
            } else if (art.type === "studio_video_overview") {
              const scenes = parseVideoScenes(art.content);
              setVideoOverview({
                title: art.title,
                scenes,
                currentSceneIndex: 0,
              });
            }
            setCenterView("studio");
          },
          onArtifact: (art) => {
            setActiveArtifactId(art.id);
            onActiveDraftChange(art.id);
            reloadArtifactDetails();
          },
          onVerification: () => {
            reloadArtifactDetails();
          },
          onComplete: (data) => {
            if (data.conversation_id) setConversationId(data.conversation_id);
            setActiveSteps((prev) =>
              prev.map((s) => ({ ...s, status: "completed" as const })),
            );
            const aiMessage: ChatMessage = {
              role: "assistant",
              content: fullAiResponse || "Task completed successfully.",
              citations: citationsAccumulator,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, aiMessage]);
            setStreamingText("");
            setIsAgentRunning(false);
            setWorkspaceNotice({
              tone: "success",
              message: "Groundwork AI finished. Review the draft changes and citations before export.",
            });
            reloadArtifactDetails();
            loadNotes();
          },
          onError: (errStr) => {
            setActiveSteps((prev) =>
              prev.map((s) => ({ ...s, status: "completed" as const })),
            );
            const rawMessage = (errStr || "")
              .replace(/^⚠️\s*/, "")
              .replace(/^Error during execution:\s*/i, "");
            const friendly =
              rawMessage.includes("sqlalche.me") ||
              rawMessage.includes("Session")
                ? "A momentary synchronization error occurred. Please try resending your prompt."
                : rawMessage ||
                  "An unexpected error occurred during execution.";
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
            setWorkspaceNotice({ tone: "error", message: friendly });
          },
        },
        controller.signal,
      );
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        const message = (err as Error)?.message || "Groundwork AI could not complete the task.";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ ${message}`,
            created_at: new Date().toISOString(),
          },
        ]);
        setWorkspaceNotice({ tone: "error", message });
      }
      setIsAgentRunning(false);
      setStreamingText("");
    } finally {
      abortControllerRef.current = null;
    }
  }

  async function handleCreateBlankDraft() {
    if (isCreatingBlankDraft) return;
    setIsCreatingBlankDraft(true);
    try {
      const draft = await onCreateDraft(workspace.name, selectedSourceIds);
      if (draft) {
        setActiveArtifactId(draft.id);
        onActiveDraftChange(draft.id);
        setCenterView("document");
      }
    } finally {
      setIsCreatingBlankDraft(false);
    }
  }

  async function handleDeleteDraft() {
    if (!draftPendingDeletion || isDeletingDraft) return;
    setIsDeletingDraft(true);
    try {
      if (onDeleteDraft) {
        await onDeleteDraft(draftPendingDeletion.id);
      } else {
        await api(
          `/workspaces/${workspace.id}/native-documents/${draftPendingDeletion.id}`,
          auth.access_token,
          { method: "DELETE" },
        );
      }
      setWorkspaceNotice({
        tone: "success",
        message: `Response "${draftPendingDeletion.title}" was deleted.`,
      });
      const remaining = workspaceArtifacts.filter(
        (a) => a.id !== draftPendingDeletion.id,
      );
      if (remaining.length > 0) {
        setActiveArtifactId(remaining[0].id);
        onActiveDraftChange(remaining[0].id);
      } else {
        setActiveArtifactId(null);
        onActiveDraftChange(null);
      }
      setDraftPendingDeletion(null);
    } catch (err: unknown) {
      setWorkspaceNotice({
        tone: "error",
        message: (err as Error)?.message || "Failed to delete response.",
      });
    } finally {
      setIsDeletingDraft(false);
    }
  }

  function handleTriggerStudioAction(actionType: string) {
    if (workspaceSources.length === 0) {
      setWorkspaceNotice({
        tone: "info",
        message: "Add at least one source document on the left before generating studio overviews.",
      });
      return;
    }
    if (selectedSourceIds.length === 0) {
      setWorkspaceNotice({
        tone: "info",
        message: "Select at least one source in context on the left.",
      });
      return;
    }
    setCenterView("studio");
    const prompts: Record<string, string> = {
      studio_audio_overview:
        "Generate an Audio Overview deep-dive podcast between two AI hosts analyzing the uploaded sources.",
      studio_video_overview:
        "Generate a structured Video Overview and visual storyboard with scene-by-scene slides, visuals, and voiceover narration based on the uploaded sources.",
      studio_study_guide:
        "Generate a comprehensive Study Guide with key concepts, practice questions with answer keys, and a glossary based on the uploaded sources.",
      studio_faq:
        "Generate a comprehensive Frequently Asked Questions (FAQ) document grounded in the uploaded sources.",
      studio_briefing_doc:
        "Create an executive briefing document summarizing the core themes, findings, and strategic takeaways from the sources.",
    };
    handleSendPrompt(
      prompts[actionType] || "Synthesize studio overview",
      actionType,
    );
  }

  async function handleSaveAsNote(
    content: string,
    noteTitle?: string,
    citations?: Citation[],
  ) {
    if (!content.trim()) return;
    try {
      const heading = noteTitle || "Pinned Research Note";

      // 1. Persist to durable workspace Note table
      try {
        const createdNote = await createWorkspaceNote(
          workspace.id,
          {
            title: heading,
            content: content.trim(),
            note_type: citations && citations.length > 0 ? "saved_answer" : "user",
            citations: citations || [],
          },
          auth.access_token,
        );
        if (createdNote) {
          setNotes((prev) => [createdNote, ...prev]);
        }
      } catch (noteErr) {
        console.error("Failed to save note record", noteErr);
      }

      // 2. Also append block to active draft deliverable
      const newBlock: NativeBlock = {
        type: "paragraph",
        text: `### ${heading}\n\n${content.trim()}`,
      };

      let targetDraft: NativeDocument | null = activeArtifact;
      if (!targetDraft) {
        const draftTitle = `${workspace.name} - Research Notes`;
        targetDraft = await onCreateDraft(draftTitle, selectedSourceIds);
        if (targetDraft) {
          setActiveArtifactId(targetDraft.id);
          onActiveDraftChange(targetDraft.id);
        }
      }

      const existingBlocks = (
        targetDraft?.content?.blocks || editableBlocks
      ).filter((b) => b.text.trim().length > 0);
      const updated = [...existingBlocks, newBlock];
      setEditableBlocks(updated);
      savedBlocksRef.current = updated;

      if (targetDraft) {
        await api(
          `/workspaces/${workspace.id}/native-documents/${targetDraft.id}/blocks`,
          auth.access_token,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ blocks: updated }),
          },
        );
        await reloadArtifactDetails(targetDraft);
      }

      setWorkspaceNotice({
        tone: "success",
        message: "Saved note to your Research Notes and document canvas.",
      });
    } catch (err) {
      console.error("Failed to save note", err);
      setWorkspaceNotice({
        tone: "error",
        message: "Failed to save note to canvas. Please try again.",
      });
    }
  }

  const handleCreateNoteFromCanvas = async (
    title: string,
    content: string,
    noteType?: NoteType,
  ) => {
    try {
      const created = await createWorkspaceNote(
        workspace.id,
        {
          title,
          content,
          note_type: noteType || "user",
        },
        auth.access_token,
      );
      setNotes((prev) => [created, ...prev]);
      setWorkspaceNotice({
        tone: "success",
        message: "Note saved to your workspace notebook.",
      });
      return created;
    } catch (err: unknown) {
      setWorkspaceNotice({
        tone: "error",
        message: (err as Error)?.message || "Failed to save note.",
      });
      return null;
    }
  };

  const handleUpdateNoteFromCanvas = async (
    noteId: string,
    title: string,
    content: string,
  ) => {
    try {
      const updated = await updateWorkspaceNote(
        workspace.id,
        noteId,
        { title, content },
        auth.access_token,
      );
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      setWorkspaceNotice({
        tone: "success",
        message: "Note updated.",
      });
      return updated;
    } catch (err: unknown) {
      setWorkspaceNotice({
        tone: "error",
        message: (err as Error)?.message || "Failed to update note.",
      });
      return null;
    }
  };

  const handleDeleteNoteFromCanvas = async (noteId: string) => {
    try {
      await deleteWorkspaceNote(workspace.id, noteId, auth.access_token);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      setWorkspaceNotice({
        tone: "info",
        message: "Note deleted.",
      });
    } catch (err: unknown) {
      setWorkspaceNotice({
        tone: "error",
        message: (err as Error)?.message || "Failed to delete note.",
      });
    }
  };

  async function handleCreateCustomNote() {
    if (!newNoteContent.trim() || isSavingNote) return;
    setIsSavingNote(true);
    try {
      await handleSaveAsNote(newNoteContent, "Personal Note");
      setNewNoteContent("");
      setIsAddNoteModalOpen(false);
    } finally {
      setIsSavingNote(false);
    }
  }

  function handleStopAgent() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsAgentRunning(false);
      setStreamingText("");
      setWorkspaceNotice({
        tone: "info",
        message: "Groundwork AI stopped. No further changes will be made.",
      });
    }
  }

  function handleClearConversation() {
    if (isAgentRunning && abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsAgentRunning(false);
    }
    setMessages([]);
    setStreamingText("");
    setActiveSteps([]);
    setConversationId(null);
    setWorkspaceNotice({
      tone: "info",
      message: "Conversation history cleared. Ready for a new research session.",
    });
  }

  // Save modified blocks
  async function handleSaveBlocks() {
    if (!activeArtifact) return;
    if (!hasUnsavedChanges) {
      setIsEditingContent(false);
      return;
    }
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
      savedBlocksRef.current = editableBlocks;
      setIsEditingContent(false);
      setWorkspaceNotice({ tone: "success", message: "Response changes saved." });
      await reloadArtifactDetails();
    } catch (err) {
      console.error("Failed to save draft blocks", err);
      setWorkspaceNotice({
        tone: "error",
        message: "Your changes were not saved. Keep this page open and try again.",
      });
    } finally {
      setIsSavingDraft(false);
    }
  }

  function handleCancelEditing() {
    setEditableBlocks(savedBlocksRef.current);
    setIsEditingContent(false);
    setWorkspaceNotice({ tone: "info", message: "Unsaved changes discarded." });
  }

  async function handleDeleteSource() {
    if (!sourcePendingDeletion || isDeletingSource) return;
    setIsDeletingSource(true);
    try {
      await onDeleteDocument(sourcePendingDeletion.id);
      setWorkspaceNotice({
        tone: "success",
        message: `${sourcePendingDeletion.filename} was removed from this response.`,
      });
      setSourcePendingDeletion(null);
    } catch (reason) {
      setWorkspaceNotice({
        tone: "error",
        message:
          reason instanceof Error
            ? reason.message
            : "The source could not be deleted.",
      });
    } finally {
      setIsDeletingSource(false);
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
              return {
                ...b,
                text: b.text.replace(finding.claim_text, finding.proposed_text),
              };
            }
            return b;
          }),
        );
      }

      await reloadArtifactDetails();
      setWorkspaceNotice({
        tone: "success",
        message:
          action === "accept"
            ? "Suggested revision applied. Review the updated response text."
            : "Finding waived. The decision remains in review history.",
      });
    } catch (err) {
      console.error("Failed to resolve finding", err);
      setWorkspaceNotice({
        tone: "error",
        message: "The review decision could not be saved. Try again.",
      });
    } finally {
      setIsResolvingFindingId(null);
    }
  }

  // Run whole-deliverable verification audit
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
      setWorkspaceNotice({
        tone: "success",
        message: "Response check complete. Review any blockers before export.",
      });
    } catch (err) {
      console.error("Audit run failed", err);
      setWorkspaceNotice({
        tone: "error",
        message: "The response check could not finish. Your draft was not changed.",
      });
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
        downloadTextFile(
          `${activeArtifact.title || "deliverable"}.${format}`,
          exportData.content,
        );
      }
    } catch (err: unknown) {
      setWorkspaceNotice({
        tone: "error",
        message:
          (err as Error)?.message ||
          "Export failed. Complete the remaining review steps and try again.",
      });
    }
  }

  // Calculate open findings & readiness
  const openFindings = useMemo(
    () => findings.filter((f) => f.status === "open"),
    [findings],
  );
  const coveredRequirementsCount = useMemo(
    () =>
      requirements.filter(
        (r) => r.status === "covered" || r.status === "waived",
      ).length,
    [requirements],
  );
  const readinessScore = useMemo(() => {
    if (requirements.length === 0) return 0;
    const reqRatio = coveredRequirementsCount / requirements.length;
    const findingsPenalty = openFindings.length > 0 ? 0.2 : 0;
    return Math.max(
      0,
      Math.min(100, Math.round((reqRatio - findingsPenalty) * 100)),
    );
  }, [requirements.length, coveredRequirementsCount, openFindings.length]);

  const isExportBlocked =
    !activeArtifact ||
    (readiness?.status !== "ready" &&
      (openFindings.length > 0 || readinessScore < 100));

  const readySourcesCount = workspaceSources.filter(
    (source) => source.status === "ready",
  ).length;

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
        activeAgentStepLabel={
          activeSteps.find((s) => s.status === "in_progress")?.label
        }
        readinessScore={readinessScore}
        isExportBlocked={isExportBlocked}
        openFindingsCount={openFindings.length}
        readinessStatus={readiness?.status ?? null}
        readinessBlockers={readiness?.blockers ?? []}
        isSidebarOpen={isSidebarOpen}
        isSourcesOpen={isSourcesOpen}
        isRightPanelOpen={isRightPanelOpen}
        onToggleSidebar={onToggleSidebar}
        onBackToLibrary={_onBackToLibrary}
        onToggleSources={() => setIsSourcesOpen((v) => !v)}
        onToggleRightPanel={() => setIsRightPanelOpen((v) => !v)}
        onOpenAudit={() => {
          setIsRightPanelOpen(true);
          setRightPanelTab("audit");
        }}
        onExport={handleExport}
      />

      {workspaceNotice && (
        <div
          role={workspaceNotice.tone === "error" ? "alert" : "status"}
          className={`flex items-center justify-between gap-3 border-b px-4 py-2 text-xs ${
            workspaceNotice.tone === "error"
              ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]"
              : workspaceNotice.tone === "success"
                ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]"
                : "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]"
          }`}
        >
          <span className="flex items-center gap-2">
            {workspaceNotice.tone === "error" ? (
              <AlertTriangle size={13} />
            ) : (
              <CheckCircle2 size={13} />
            )}
            {workspaceNotice.message}
          </span>
          <button
            type="button"
            onClick={() => setWorkspaceNotice(null)}
            aria-label="Dismiss message"
            className="rounded p-0.5 hover:bg-black/5"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Main 3-Column Document Body */}
      <div className="flex-1 flex overflow-hidden min-w-0 w-full relative">
        {/* Left: Sources & Grounding Sidebar */}
        {isSourcesOpen ? (
          <SourcesSidebar
            responses={workspaceArtifacts}
            activeResponseId={activeArtifact?.id}
            onSelectResponse={(id) => {
              setActiveArtifactId(id);
              onActiveDraftChange(id);
              setCenterView("document");
            }}
            onCreateResponse={handleCreateBlankDraft}
            onViewSources={() => {
              setCenterView("reader");
              if (workspaceSources.length > 0 && !readerSourceId) {
                setReaderSourceId(workspaceSources[0].id);
              }
            }}
            onDeleteResponse={(id) => {
              const draft = workspaceArtifacts.find((a) => a.id === id);
              if (draft) setDraftPendingDeletion(draft);
            }}
            readinessScore={readinessScore}
            readinessStatus={
              !activeArtifact
                ? "setup_needed"
                : requirements.length === 0
                  ? "setup_needed"
                  : openFindings.length > 0
                    ? "needs_review"
                    : "ready"
            }
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
            onDeleteSource={(id) =>
              setSourcePendingDeletion(
                workspaceSources.find((source) => source.id === id) ?? null,
              )
            }
            onRetrySource={async (id) => {
              try {
                await api(`/documents/${id}/retry`, auth.access_token, {
                  method: "POST",
                });
              } catch (err: unknown) {
                  setWorkspaceNotice({
                    tone: "error",
                    message: (err as Error)?.message || "Source retry failed.",
                  });
              }
            }}
            activeSourceId={centerView === "reader" ? activeReaderDoc?.id : null}
            evidenceSourceId={readerEvidenceSnippet ? readerSourceId : null}
            onSelectSource={(id) => handleOpenReader(id, 1)}
            onOpenViewer={(id, page) => handleOpenReader(id, page)}
            onOpenAddSourceModal={() => setIsAddSourceModalOpen(true)}
          />
        ) : (
          <div className="w-11 border-r border-[var(--hairline)] bg-[var(--surface)] flex flex-col items-center py-3 gap-3 select-none flex-shrink-0">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setIsSourcesOpen(true)}
              className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
              title={activeArtifact ? `Deliverable: ${activeArtifact.title}` : "Expand Navigator"}
            >
              <FileText size={15} />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setIsSourcesOpen(true)}
              className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
              title="Expand Evidence Sources"
            >
              <span className="text-[10px] font-mono font-bold text-[var(--ink-blue)] px-1 py-0.5 rounded bg-[var(--ink-blue-subtle)]">
                {workspaceSources.length}
              </span>
            </Button>
          </div>
        )}

        {/* Center: Block-Based Document Canvas & Studio */}
        <main className="flex-1 flex flex-col min-w-0 bg-[var(--paper)] overflow-hidden groundwork-col-draft">
          {/* NotebookLM Center Header & Mode Switcher */}
          <div className="flex items-center justify-between border-b border-[var(--hairline)] bg-[var(--surface)] px-4 py-2 flex-shrink-0 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                onClick={() => setCenterView("studio")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold transition-all cursor-pointer ${
                  centerView === "studio"
                    ? "bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] border border-[var(--ink-blue-border)]"
                    : "text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--paper)]"
                }`}
              >
                <Headphones size={13} className="text-[var(--ink-blue)] flex-shrink-0" />
                <span className="truncate">Studio &amp; Grounded Chat</span>
                {messages.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-[var(--ink-blue)] text-white text-[9px] font-mono">
                    {messages.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setCenterView("notes")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold transition-all cursor-pointer ${
                  centerView === "notes"
                    ? "bg-[var(--success-bg)] text-[var(--success)] border border-[var(--success-border)]"
                    : "text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--paper)]"
                }`}
              >
                <Pin size={13} className="text-[var(--success)] flex-shrink-0" />
                <span className="truncate">Research Notes</span>
                {notes.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-[var(--success)] text-white text-[9px] font-mono">
                    {notes.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setCenterView("document")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold transition-all cursor-pointer ${
                  centerView === "document"
                    ? "bg-[var(--ink-sepia-subtle)] text-[var(--ink-sepia)] border border-[var(--ink-sepia-border)]"
                    : "text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--paper)]"
                }`}
              >
                <FileText size={13} className="text-[var(--ink-sepia)] flex-shrink-0" />
                <span className="truncate">Notes &amp; Document Canvas</span>
                {activeArtifact && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-[var(--ink-sepia)] text-white text-[9px] font-mono">
                    v{activeArtifact.revision || 1}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setCenterView("reader")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold transition-all cursor-pointer ${
                  centerView === "reader"
                    ? "bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] border border-[var(--ink-blue-border)] font-semibold"
                    : "text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--paper)]"
                }`}
              >
                <BookOpen size={13} className="text-[var(--ink-blue)] flex-shrink-0" />
                <span className="truncate">Document Reader</span>
                {activeReaderDoc && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-[var(--ink-blue)] text-white text-[9px] font-mono truncate max-w-[90px]">
                    {activeReaderDoc.filename}
                  </span>
                )}
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setCenterView("reader");
                  if (workspaceSources.length > 0 && !readerSourceId) {
                    setReaderSourceId(workspaceSources[0].id);
                  }
                }}
                className={`text-xs font-medium ${
                  centerView === "reader"
                    ? "bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] border border-[var(--ink-blue-border)]"
                    : "text-[var(--ink-blue)] hover:bg-[var(--ink-blue-subtle)]"
                }`}
                title="View and read grounded research sources"
              >
                <BookOpen size={12} />
                <span className="hidden sm:inline">View Sources</span>
                <span className="font-mono text-[10px] ml-0.5">({workspaceSources.length})</span>
              </Button>

              <Button
                variant="ghost"
                size="xs"
                onClick={() => setIsAddSourceModalOpen(true)}
                className="text-xs text-[var(--ink-secondary)] hover:text-[var(--ink)]"
                title="Add reference document, web URL, or notes"
              >
                <Upload size={12} />
                <span className="hidden sm:inline">Add Source</span>
              </Button>

              <Button
                variant="ghost"
                size="xs"
                onClick={() => setIsAddNoteModalOpen(true)}
                className="text-xs text-[var(--ink-secondary)] hover:text-[var(--ink)]"
                title="Add a quick note to this workspace"
              >
                <Pin size={12} />
                <span className="hidden sm:inline">Add Note</span>
              </Button>

              {activeArtifact && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleExport("pdf")}
                  className="text-xs text-[var(--ink-secondary)] hover:text-[var(--ink)] hidden md:inline-flex"
                  title="Export response deliverable"
                >
                  <Download size={12} />
                  <span>Export</span>
                </Button>
              )}

              {centerView === "document" && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleTriggerStudioAction("studio_audio_overview")}
                  disabled={isAgentRunning}
                  className="text-xs text-[var(--ink-blue)] hidden lg:inline-flex"
                  title="Generate deep-dive audio overview podcast"
                >
                  <Headphones size={12} />
                  <span>Audio Overview</span>
                </Button>
              )}
            </div>
          </div>

          {centerView === "studio" ? (
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[var(--paper)]">
              {/* Studio Stream Content */}
              <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 max-w-4xl mx-auto w-full space-y-6 min-w-0">
                {/* 5-Card Studio Actions Grid */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                      Workspace Actions
                    </h3>
                    <div className="flex items-center gap-3">
                      {messages.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearConversation}
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--ink-muted)] hover:text-[var(--danger)] transition-colors cursor-pointer"
                          title="Clear conversation history and start over"
                        >
                          <RotateCcw size={10} />
                          <span>Clear chat</span>
                        </button>
                      )}
                      <span className="text-[11px] text-[var(--ink-muted)]">
                        Grounded in {selectedSourceIds.length} of {workspaceSources.length} sources
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                    {/* 1. Audio Overview */}
                    <button
                      type="button"
                      onClick={() => handleTriggerStudioAction("studio_audio_overview")}
                      disabled={isAgentRunning}
                      className="p-3 text-left rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--ink-blue)] hover:shadow-[var(--shadow-card)] transition-all group relative overflow-hidden cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-7 h-7 rounded-full bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Headphones size={15} />
                        </div>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--ink-blue)] font-bold">Audio</span>
                      </div>
                      <div className="font-serif font-bold text-xs text-[var(--ink)] group-hover:text-[var(--ink-blue)] transition-colors">
                        Audio Overview
                      </div>
                      <p className="text-[10px] text-[var(--ink-muted)] line-clamp-2 mt-0.5 leading-snug">
                        Two-host deep-dive podcast discussing your sources
                      </p>
                    </button>

                    {/* 2. Video Overview */}
                    <button
                      type="button"
                      onClick={() => handleTriggerStudioAction("studio_video_overview")}
                      disabled={isAgentRunning}
                      className="p-3 text-left rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] hover:border-rose-500 hover:shadow-[var(--shadow-card)] transition-all group cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-7 h-7 rounded-full bg-rose-500/10 text-rose-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Video size={15} />
                        </div>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-rose-600 font-bold">Video</span>
                      </div>
                      <div className="font-serif font-bold text-xs text-[var(--ink)] group-hover:text-rose-600 transition-colors">
                        Video Overview
                      </div>
                      <p className="text-[10px] text-[var(--ink-muted)] line-clamp-2 mt-0.5 leading-snug">
                        Visual storyboard scenes &amp; voiceover narration
                      </p>
                    </button>

                    {/* 3. Study Guide */}
                    <button
                      type="button"
                      onClick={() => handleTriggerStudioAction("studio_study_guide")}
                      disabled={isAgentRunning}
                      className="p-3 text-left rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--ink-sepia)] hover:shadow-[var(--shadow-card)] transition-all group cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-7 h-7 rounded-full bg-[var(--ink-sepia-subtle)] text-[var(--ink-sepia)] flex items-center justify-center group-hover:scale-110 transition-transform">
                          <BookOpen size={15} />
                        </div>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--ink-sepia)] font-bold">Guide</span>
                      </div>
                      <div className="font-serif font-bold text-xs text-[var(--ink)] group-hover:text-[var(--ink-sepia)] transition-colors">
                        Study Guide
                      </div>
                      <p className="text-[10px] text-[var(--ink-muted)] line-clamp-2 mt-0.5 leading-snug">
                        Key concepts, practice quiz questions &amp; glossary
                      </p>
                    </button>

                    {/* 4. FAQ */}
                    <button
                      type="button"
                      onClick={() => handleTriggerStudioAction("studio_faq")}
                      disabled={isAgentRunning}
                      className="p-3 text-left rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--success)] hover:shadow-[var(--shadow-card)] transition-all group cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-7 h-7 rounded-full bg-[var(--success-bg)] text-[var(--success)] flex items-center justify-center group-hover:scale-110 transition-transform">
                          <HelpCircle size={15} />
                        </div>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--success)] font-bold">FAQ</span>
                      </div>
                      <div className="font-serif font-bold text-xs text-[var(--ink)] group-hover:text-[var(--success)] transition-colors">
                        FAQ Document
                      </div>
                      <p className="text-[10px] text-[var(--ink-muted)] line-clamp-2 mt-0.5 leading-snug">
                        Frequently asked questions synthesized with citations
                      </p>
                    </button>

                    {/* 5. Briefing Doc */}
                    <button
                      type="button"
                      onClick={() => handleTriggerStudioAction("studio_briefing_doc")}
                      disabled={isAgentRunning}
                      className="p-3 text-left rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--ink-blue)] hover:shadow-[var(--shadow-card)] transition-all group cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-7 h-7 rounded-full bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] flex items-center justify-center group-hover:scale-110 transition-transform">
                          <FileSpreadsheet size={15} />
                        </div>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--ink-blue)] font-bold">Brief</span>
                      </div>
                      <div className="font-serif font-bold text-xs text-[var(--ink)] group-hover:text-[var(--ink-blue)] transition-colors">
                        Briefing Doc
                      </div>
                      <p className="text-[10px] text-[var(--ink-muted)] line-clamp-2 mt-0.5 leading-snug">
                        Executive summary, key themes &amp; source takeaways
                      </p>
                    </button>

                    {/* 6. Add Note */}
                    <button
                      type="button"
                      onClick={() => setIsAddNoteModalOpen(true)}
                      className="p-3 text-left rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--ink-primary)] hover:shadow-[var(--shadow-card)] transition-all group cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-7 h-7 rounded-full bg-[var(--paper-subtle)] text-[var(--ink)] flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Plus size={15} />
                        </div>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--ink-muted)] font-bold">Note</span>
                      </div>
                      <div className="font-serif font-bold text-xs text-[var(--ink)] group-hover:text-[var(--ink-primary)] transition-colors">
                        Add Note
                      </div>
                      <p className="text-[10px] text-[var(--ink-muted)] line-clamp-2 mt-0.5 leading-snug">
                        Pin your own research notes or ideas to this notebook
                      </p>
                    </button>
                  </div>
                </div>

                {/* Audio Overview Script (if present) */}
                {audioOverview && (
                  <div className="p-4 rounded-[var(--radius-md)] border border-[var(--hairline-strong)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
                    <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--hairline)] flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-[var(--ink-blue)] text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                          <Headphones size={18} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-[var(--ink-blue)] bg-[var(--ink-blue-subtle)] px-1.5 py-0.5 rounded">
                              Audio Overview · Podcast Script
                            </span>
                            <span className="text-xs text-[var(--ink-muted)]">Alex &amp; Jordan</span>
                          </div>
                          <h3 className="font-serif text-sm font-bold text-[var(--ink)] truncate mt-0.5">
                            {audioOverview.title}
                          </h3>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleSaveAsNote(audioOverview.transcript, "Audio Overview Podcast Script")}
                          className="text-xs text-[var(--ink-blue)]"
                          title="Save transcript to notes canvas"
                        >
                          <Pin size={12} /> Save as Note
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => downloadTextFile(`${workspace.name}-audio-overview.txt`, audioOverview.transcript)}
                          className="text-xs text-[var(--ink-muted)]"
                          title="Download script"
                        >
                          <Download size={12} />
                        </Button>
                        <button
                          type="button"
                          onClick={() => setAudioOverview(null)}
                          className="text-[var(--ink-muted)] hover:text-[var(--ink)] p-1 rounded transition-colors cursor-pointer"
                          title="Dismiss Audio Overview"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Script Transcript */}
                    <div className="mt-4 p-4 rounded-[var(--radius-sm)] bg-[var(--paper-subtle)] border border-[var(--hairline)] max-h-72 overflow-y-auto font-sans text-xs space-y-2.5 leading-relaxed">
                      {audioOverview.transcript.split("\n\n").map((para, pIdx) => {
                        const isAlex = para.includes("Alex:") || para.includes("**Alex**");
                        const isJordan = para.includes("Jordan:") || para.includes("**Jordan**");
                        return (
                          <div key={pIdx} className="flex gap-2.5 items-start">
                            <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded h-fit flex-shrink-0 mt-0.5 ${
                              isAlex ? "bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)]" :
                              isJordan ? "bg-[var(--ink-sepia-subtle)] text-[var(--ink-sepia)]" :
                              "bg-[var(--paper)] text-[var(--ink-muted)]"
                            }`}>
                              {isAlex ? "Alex" : isJordan ? "Jordan" : "Overview"}
                            </span>
                            <p className="text-[var(--ink)] flex-1 whitespace-pre-wrap">
                              {para.replace(/^(?:\*\*Alex\*\*|\*\*Jordan\*\*|Alex:|Jordan:)\s*/i, "")}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Video Overview Storyboard Player (if present) */}
                {videoOverview && (
                  <div className="p-4 rounded-[var(--radius-md)] border border-[var(--hairline-strong)] bg-[var(--surface)] shadow-[var(--shadow-card)] space-y-4">
                    <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--hairline)] flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-rose-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                          <Video size={18} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-1.5 py-0.5 rounded">
                              Video Overview · Visual Storyboard
                            </span>
                            <span className="text-xs text-[var(--ink-muted)]">
                              Scene {videoOverview.currentSceneIndex + 1} of {videoOverview.scenes.length}
                            </span>
                          </div>
                          <h3 className="font-serif text-sm font-bold text-[var(--ink)] truncate mt-0.5">
                            {videoOverview.title}
                          </h3>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            const fullStoryboard = videoOverview.scenes
                              .map(
                                (s, idx) =>
                                  `### Scene ${idx + 1}: ${s.title}\n\n- **Visual**: ${s.visual}\n- **Narration**: ${s.narration}\n- **Key Takeaway**: ${s.takeaway}`,
                              )
                              .join("\n\n");
                            handleSaveAsNote(
                              fullStoryboard,
                              `Video Storyboard - ${videoOverview.title}`,
                            );
                          }}
                          className="flex items-center gap-1.5 text-xs text-[var(--ink-secondary)] hover:text-[var(--ink)]"
                          title="Save entire storyboard to your Notes & Document canvas"
                        >
                          <Pin size={12} />
                          <span>Save as Note</span>
                        </Button>

                        <button
                          type="button"
                          onClick={() => setVideoOverview(null)}
                          className="text-[var(--ink-muted)] hover:text-[var(--ink)] p-1 rounded transition-colors cursor-pointer"
                          title="Dismiss Video Overview"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Cinematic Slide Screen */}
                    {(() => {
                      const cur =
                        videoOverview.scenes[videoOverview.currentSceneIndex] ||
                        videoOverview.scenes[0];
                      return (
                        <div className="rounded-[var(--radius-md)] overflow-hidden border border-[var(--hairline)] bg-slate-950 text-slate-100 shadow-inner flex flex-col md:flex-row min-h-[220px]">
                          {/* Visual Slide Projection Area */}
                          <div className="flex-1 p-6 flex flex-col justify-between relative bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-rose-400 bg-rose-950/60 border border-rose-800/40 px-2 py-0.5 rounded">
                                Scene {videoOverview.currentSceneIndex + 1}: {cur.title}
                              </span>
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                                <Film size={13} className="text-rose-400" />
                                <span>Visual Preview</span>
                              </div>
                            </div>

                            <div className="my-4 space-y-2">
                              <div className="flex items-start gap-2.5">
                                <Sparkles
                                  size={16}
                                  className="text-amber-400 shrink-0 mt-0.5"
                                />
                                <p className="text-sm font-medium text-slate-200 leading-snug">
                                  {cur.visual}
                                </p>
                              </div>
                            </div>

                            <div className="p-2.5 rounded bg-slate-900/80 border border-slate-800 text-xs text-amber-300 font-sans flex items-center gap-2">
                              <span className="font-bold text-[10px] font-mono uppercase tracking-wider text-amber-400 shrink-0">
                                Takeaway:
                              </span>
                              <span className="truncate">{cur.takeaway}</span>
                            </div>
                          </div>

                          {/* Narration & Voiceover Script Panel */}
                          <div className="w-full md:w-80 bg-slate-900/95 border-t md:border-t-0 md:border-l border-slate-800 p-5 flex flex-col justify-between">
                            <div>
                              <div className="flex items-center justify-between text-[11px] font-mono uppercase text-slate-400 mb-2">
                                <span className="font-bold tracking-wider">
                                  Voiceover Script
                                </span>
                                <span className="text-[10px] text-slate-500">
                                  Host Narration
                                </span>
                              </div>
                              <p className="text-xs text-slate-300 leading-relaxed font-sans max-h-36 overflow-y-auto">
                                {cur.narration}
                              </p>
                            </div>

                            {/* Scene Controls */}
                            <div className="pt-4 border-t border-slate-800 mt-4 flex items-center justify-between">
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() =>
                                    setVideoOverview((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            currentSceneIndex:
                                              (prev.currentSceneIndex -
                                                1 +
                                                prev.scenes.length) %
                                              prev.scenes.length,
                                          }
                                        : null,
                                    )
                                  }
                                  className="text-slate-300 hover:text-white hover:bg-slate-800 h-7 w-7 p-0"
                                  title="Previous scene"
                                >
                                  <ChevronLeft size={14} />
                                </Button>

                                <span className="text-[10px] font-mono text-slate-400 px-2">
                                  {videoOverview.currentSceneIndex + 1} / {videoOverview.scenes.length}
                                </span>

                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() =>
                                    setVideoOverview((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            currentSceneIndex:
                                              (prev.currentSceneIndex + 1) %
                                              prev.scenes.length,
                                          }
                                        : null,
                                    )
                                  }
                                  className="text-slate-300 hover:text-white hover:bg-slate-800 h-7 w-7 p-0"
                                  title="Next scene"
                                >
                                  <ChevronRight size={14} />
                                </Button>
                              </div>

                              {/* Scene Dots */}
                              <div className="flex items-center gap-1">
                                {videoOverview.scenes.map((_, dotIdx) => (
                                  <button
                                    key={dotIdx}
                                    type="button"
                                    onClick={() =>
                                      setVideoOverview((prev) =>
                                        prev
                                          ? {
                                              ...prev,
                                              currentSceneIndex: dotIdx,
                                            }
                                          : null,
                                      )
                                    }
                                    className={`w-2 h-2 rounded-full transition-all cursor-pointer ${
                                      dotIdx === videoOverview.currentSceneIndex
                                        ? "bg-rose-500 w-4"
                                        : "bg-slate-700 hover:bg-slate-500"
                                    }`}
                                    title={`Go to scene ${dotIdx + 1}`}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Grounded Conversation Thread */}
                <div className="space-y-4">
                  {messages.length === 0 && !isAgentRunning && (
                    <div className="p-8 text-center rounded-[var(--radius-md)] border border-dashed border-[var(--hairline-strong)] bg-[var(--surface)] space-y-3">
                      <div className="w-10 h-10 rounded-full bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] flex items-center justify-center mx-auto">
                        <Sparkles size={20} />
                      </div>
                      <div>
                        <h4 className="font-serif text-base font-bold text-[var(--ink)]">
                          Groundwork Workspace Studio
                        </h4>
                        <p className="text-xs text-[var(--ink-muted)] max-w-md mx-auto mt-1">
                          Ask questions, create study guides, generate deep-dive audio overviews,
                          or synthesize notes grounded directly in your {workspaceSources.length} source file(s).
                        </p>
                      </div>

                      {/* Suggestion Chips */}
                      <div className="flex flex-wrap gap-2 justify-center pt-2 max-w-lg mx-auto">
                        {(contextualSuggestions.length > 0
                          ? contextualSuggestions
                          : [
                              { id: "s1", label: "Summarize main takeaways", prompt: "Summarize main takeaways from active sources." },
                              { id: "s2", label: "Core arguments across sources", prompt: "What are the core arguments and findings across the sources?" },
                              { id: "s3", label: "Create a study guide", prompt: "Create a comprehensive study guide and key concepts breakdown." },
                              { id: "s4", label: "Generate FAQ", prompt: "Generate frequently asked questions (FAQ) based on the sources." },
                            ]
                        ).map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => handleSendPrompt(s.prompt)}
                            className="px-3 py-1.5 rounded-full text-xs font-medium border border-[var(--hairline)] bg-[var(--paper)] text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:border-[var(--ink-blue)] hover:bg-[var(--ink-blue-subtle)] transition-all cursor-pointer"
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-[var(--radius-md)] border text-xs leading-relaxed ${
                        msg.role === "user"
                          ? "bg-[var(--surface)] border-[var(--hairline)] ml-8"
                          : "bg-[var(--surface)] border-[var(--hairline-strong)] shadow-[var(--shadow-subtle)] mr-8"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold">
                          {msg.role === "user" ? (
                            <>
                              <User size={13} className="text-[var(--ink-blue)]" />
                              <span className="text-[var(--ink-blue)]">You</span>
                            </>
                          ) : (
                            <>
                              <Bot size={13} className="text-[var(--ink-sepia)]" />
                              <span className="text-[var(--ink)]">Groundwork AI</span>
                              <span className="text-[10px] font-normal text-[var(--ink-muted)]">· Source-Grounded</span>
                            </>
                          )}
                          {msg.created_at && (
                            <span className="text-[10px] font-normal text-[var(--ink-faint)] font-mono ml-2">
                              · {formatDateTime(msg.created_at)}
                            </span>
                          )}
                        </div>

                        {msg.role === "assistant" && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => handleSaveAsNote(msg.content, "Saved AI Response", msg.citations)}
                              className="text-[10px] text-[var(--ink-blue)] h-6 px-2"
                              title="Save this response to Notes & Document Canvas"
                            >
                              <Pin size={10} /> Save as Note
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={async () => {
                                const ok = await copyTextToClipboard(msg.content);
                                if (ok) {
                                  setWorkspaceNotice({ tone: "info", message: "Copied response to clipboard." });
                                } else {
                                  setWorkspaceNotice({ tone: "error", message: "Failed to copy response to clipboard." });
                                }
                              }}
                              className="text-[10px] text-[var(--ink-muted)] h-6 px-1.5"
                              title="Copy response text"
                            >
                              <Copy size={10} />
                            </Button>
                          </div>
                        )}
                      </div>

                      {msg.role === "assistant" ? (
                        <FormattedAnswer
                          content={msg.content}
                          citations={msg.citations}
                          onOpenViewer={handleOpenReader}
                        />
                      ) : (
                        <div className="font-sans whitespace-pre-wrap break-words text-[13px] text-[var(--ink)] select-text">
                          {msg.content}
                        </div>
                      )}

                      {/* Citations Chips */}
                      {msg.citations && msg.citations.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-[var(--hairline)]">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--ink-muted)] mr-1 self-center">
                            Sources:
                          </span>
                          {msg.citations.map((c, cIdx) => (
                            <button
                              key={cIdx}
                              type="button"
                              onClick={() => handleOpenReader(c.document_id, c.page_number, c.snippet)}
                              className="agent-citation-chip inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--paper)] hover:bg-[var(--paper-subtle)] border border-[var(--hairline)] text-[11px] font-mono text-[var(--ink-blue)] cursor-pointer transition-colors"
                              title={`View ${c.document_name} page ${c.page_number}`}
                            >
                              <ExternalLink size={10} />
                              <span className="max-w-[140px] truncate">{c.document_name}</span>
                              <strong>p. {c.page_number}</strong>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Active Running Progress */}
                  {isAgentRunning && (
                    <div className="p-4 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--ink-sepia-border)] shadow-[var(--shadow-subtle)] space-y-2 mr-8">
                      <div className="flex items-center gap-2 text-xs font-mono font-semibold text-[var(--ink-sepia)]">
                        <RefreshCw size={12} className="spin text-[var(--ink-sepia)]" />
                        <span>Synthesizing source evidence...</span>
                      </div>
                      <div className="space-y-1 pl-4 border-l-2 border-[var(--ink-sepia-border)]">
                        {activeSteps.map((step, sIdx) => (
                          <div key={sIdx} className="flex items-center gap-2 text-xs font-mono">
                            {step.status === "completed" ? (
                              <CheckCircle2 size={12} className="text-[var(--success)]" />
                            ) : (
                              <RefreshCw size={11} className="spin text-[var(--ink-sepia)]" />
                            )}
                            <span className={step.status === "completed" ? "text-[var(--ink-muted)] line-through" : "text-[var(--ink)] font-medium"}>
                              {step.label}
                            </span>
                          </div>
                        ))}
                      </div>
                      {streamingText && (
                        <div className="p-3 rounded bg-[var(--paper)] font-sans text-xs text-[var(--ink)] whitespace-pre-wrap break-words border border-[var(--hairline)]">
                          {streamingText}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Grounded Prompt Bar in Studio */}
              <div className="border-t border-[var(--hairline)] bg-[var(--surface)] p-3 sm:p-4 max-w-4xl mx-auto w-full">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
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
                      placeholder="Ask a question or request a summary based on your sources..."
                      disabled={isAgentRunning || workspaceSources.length === 0}
                      className="w-full h-10 px-3.5 pr-20 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline-strong)] bg-[var(--paper)] text-[var(--ink)] placeholder-[var(--ink-muted)] focus:outline-none focus:border-[var(--ink-blue)]"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[var(--ink-muted)] pointer-events-none hidden sm:inline">
                      {selectedSourceIds.length} sources
                    </span>
                  </div>
                  <Button
                    variant="agent"
                    size="sm"
                    onClick={() => handleSendPrompt()}
                    disabled={isAgentRunning || !promptInput.trim() || workspaceSources.length === 0}
                    className="h-10 px-4"
                  >
                    {isAgentRunning ? <RefreshCw size={13} className="spin" /> : <Send size={13} />}
                    <span className="hidden sm:inline">Ask</span>
                  </Button>
                </div>
              </div>
            </div>
          ) : centerView === "notes" ? (
            <NotesCanvas
              notes={notes}
              isLoading={isLoadingNotes}
              onCreateNote={handleCreateNoteFromCanvas}
              onUpdateNote={handleUpdateNoteFromCanvas}
              onDeleteNote={handleDeleteNoteFromCanvas}
              onOpenViewer={handleOpenReader}
            />
          ) : centerView === "reader" ? (
            <DocumentReader
              document={activeReaderDoc}
              token={auth.access_token}
              initialPage={readerPage}
              initialSearch={readerSearch}
              evidenceSnippet={readerEvidenceSnippet}
              evidencePage={readerEvidencePage}
              isScopedToSource={selectedSourceIds.length === 1 && selectedSourceIds[0] === activeReaderDoc?.id}
              onToggleScopeSource={(docId) => {
                if (selectedSourceIds.length === 1 && selectedSourceIds[0] === docId) {
                  selectAllSources();
                } else {
                  setSelectedSourceIds([docId]);
                }
              }}
              onClose={() => setCenterView(activeArtifact ? "document" : "studio")}
              onDeleteSource={(docId) =>
                setSourcePendingDeletion(
                  workspaceSources.find((s) => s.id === docId) ?? null,
                )
              }
              onRetryProcessing={async (docId) => {
                try {
                  await api(`/documents/${docId}/retry`, auth.access_token, {
                    method: "POST",
                  });
                  setWorkspaceNotice({
                    tone: "info",
                    message: "Source reprocessing scheduled.",
                  });
                } catch (err: unknown) {
                  setWorkspaceNotice({
                    tone: "error",
                    message: (err as Error)?.message || "Source retry failed.",
                  });
                }
              }}
              allSources={workspaceSources}
              onSelectSource={(docId) => handleOpenReader(docId, 1)}
            />
          ) : (
            activeArtifact ? (
            <div className="flex-1 flex overflow-y-auto justify-center px-4 sm:px-8 md:px-12 py-8 sm:py-12 min-w-0">
              {/* Single-Column Document Paper Sheet */}
              <div className="w-full max-w-[760px] bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-md)] shadow-[var(--shadow-card)] p-8 sm:p-12 md:p-14 mb-16 min-h-[650px] h-fit flex flex-col min-w-0">
                {/* Document Title Header */}
                <div className="border-b border-[var(--hairline-subtle)] pb-6 mb-8 min-w-0 space-y-4">
                  {/* 1. Action Row */}
                  <div className="flex items-center justify-between gap-4 min-w-0 flex-wrap sm:flex-nowrap">
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge
                        variant="human"
                        icon={<ShieldCheck size={12} />}
                        className="font-mono font-bold whitespace-nowrap"
                      >
                        Response draft · v{activeArtifact?.revision ?? 1} · Human review required
                      </Badge>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => {
                          setCenterView("reader");
                          if (workspaceSources.length > 0 && !readerSourceId) {
                            setReaderSourceId(workspaceSources[0].id);
                          }
                        }}
                        className="text-xs text-[var(--ink-blue)] hover:bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] gap-1"
                        title="View and read grounded research sources"
                      >
                        <BookOpen size={11} />
                        <span>View sources</span>
                      </Button>

                      {isEditingContent ? (
                        <>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={handleCancelEditing}
                            disabled={isSavingDraft}
                          >
                            <Undo2 size={11} /> Cancel
                          </Button>
                          <Button
                            variant="human"
                            size="xs"
                            onClick={handleSaveBlocks}
                            isLoading={isSavingDraft}
                            disabled={!hasUnsavedChanges}
                          >
                            <Save size={11} /> Save changes
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setIsEditingContent(true)}
                          className="text-[var(--ink-secondary)] hover:text-[var(--ink)] gap-1"
                        >
                          <PenLine size={11} />
                          <span>Edit text</span>
                        </Button>
                      )}

                      <Button
                        variant="agent"
                        size="xs"
                        onClick={handleRunAudit}
                        disabled={isRunningAudit || isEditingContent}
                      >
                        <RefreshCw
                          size={11}
                          className={isRunningAudit ? "spin" : ""}
                        />
                        <span>{isRunningAudit ? "Checking…" : "Check response"}</span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => handleExport("pdf")}
                        className="text-[var(--ink-secondary)] hover:text-[var(--ink)] gap-1"
                        title="Export this response"
                      >
                        <Download size={11} />
                        <span>Export</span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setDraftPendingDeletion(activeArtifact)}
                        className="h-7 w-7 p-0 text-[var(--ink-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-bg)]"
                        title="Delete this response draft"
                        aria-label="Delete response"
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </div>

                  {/* 2. Document Title Heading */}
                  <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[var(--ink)] tracking-tight leading-[1.25] break-normal">
                    {activeArtifact?.title || "Untitled notes"}
                  </h1>

                  {/* Workspace status */}
                  <div className="flex items-center justify-between gap-3 text-xs text-[var(--ink-muted)] flex-wrap pt-2 border-t border-[var(--hairline)]">
                    <div className="flex items-center gap-2">
                      <span>{selectedSourceIds.length} of {workspaceSources.length} sources selected</span>
                      {activeArtifact?.updated_at && (
                        <>
                          <span>·</span>
                          <span title={`Created: ${new Date(activeArtifact.created_at).toLocaleString()}`}>
                            Updated {formatDateTime(activeArtifact.updated_at)}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span>{coveredRequirementsCount}/{requirements.length} requirements covered</span>
                      <span>·</span>
                      <span>{openFindings.length} open findings</span>
                    </div>
                  </div>
                </div>

                {/* Document Blocks List */}
                <div className="space-y-4 flex-1 min-w-0">
                  {editableBlocks.map((block, idx) => {
                    const matchedFinding = openFindings.find(
                      (f) =>
                        f.claim_text &&
                        block.text
                          .toLowerCase()
                          .includes(f.claim_text.toLowerCase()),
                    );

                    return (
                      <BlockItem
                        key={idx}
                        block={block}
                        index={idx}
                        isEditing={isEditingContent}
                        matchedFinding={matchedFinding}
                        sources={workspaceSources}
                        isResolvingFinding={
                          isResolvingFindingId === matchedFinding?.id
                        }
                        onUpdateText={(newText) => {
                          const next = [...editableBlocks];
                          next[idx] = { ...block, text: newText };
                          setEditableBlocks(next);
                        }}
                        onOpenViewer={(docId, page) =>
                          handleOpenReader(docId, page)
                        }
                        onResolveFinding={handleResolveFinding}
                        onPromptSection={(prompt) => handleSendPrompt(prompt)}
                      />
                    );
                  })}

                  {editableBlocks.length === 0 && (
                    <div className="py-16 text-center text-xs text-[var(--ink-muted)] space-y-2 min-w-0">
                      <FileText
                        size={28}
                        className="mx-auto text-[var(--ink-faint)]"
                      />
                      <p className="font-serif text-sm font-semibold text-[var(--ink)]">
                        No notes or draft yet
                      </p>
                      <p className="text-[11px] max-w-sm mx-auto">
                        Add your source documents and notes, then write here or ask
                        Groundwork AI for a source-backed synthesis.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-10">
                {/* 5-Card Studio Actions Grid in Setup */}
                <div className="mx-auto max-w-2xl mb-6">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <button
                      type="button"
                      onClick={() => handleTriggerStudioAction("studio_audio_overview")}
                      disabled={isAgentRunning}
                      className="p-3 text-left rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--ink-blue)] hover:shadow-[var(--shadow-card)] transition-all cursor-pointer"
                    >
                      <div className="w-6 h-6 rounded-full bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] flex items-center justify-center mb-1.5">
                        <Headphones size={13} />
                      </div>
                      <div className="font-serif font-bold text-xs text-[var(--ink)]">Audio Overview</div>
                      <p className="text-[10px] text-[var(--ink-muted)] mt-0.5">Podcast deep dive</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTriggerStudioAction("studio_study_guide")}
                      disabled={isAgentRunning}
                      className="p-3 text-left rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--ink-sepia)] hover:shadow-[var(--shadow-card)] transition-all cursor-pointer"
                    >
                      <div className="w-6 h-6 rounded-full bg-[var(--ink-sepia-subtle)] text-[var(--ink-sepia)] flex items-center justify-center mb-1.5">
                        <BookOpen size={13} />
                      </div>
                      <div className="font-serif font-bold text-xs text-[var(--ink)]">Study Guide</div>
                      <p className="text-[10px] text-[var(--ink-muted)] mt-0.5">Quiz &amp; concepts</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTriggerStudioAction("studio_faq")}
                      disabled={isAgentRunning}
                      className="p-3 text-left rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--success)] hover:shadow-[var(--shadow-card)] transition-all cursor-pointer"
                    >
                      <div className="w-6 h-6 rounded-full bg-[var(--success-bg)] text-[var(--success)] flex items-center justify-center mb-1.5">
                        <HelpCircle size={13} />
                      </div>
                      <div className="font-serif font-bold text-xs text-[var(--ink)]">FAQ Document</div>
                      <p className="text-[10px] text-[var(--ink-muted)] mt-0.5">Key questions &amp; Q&amp;A</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTriggerStudioAction("studio_briefing_doc")}
                      disabled={isAgentRunning}
                      className="p-3 text-left rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--ink-blue)] hover:shadow-[var(--shadow-card)] transition-all cursor-pointer"
                    >
                      <div className="w-6 h-6 rounded-full bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] flex items-center justify-center mb-1.5">
                        <FileSpreadsheet size={13} />
                      </div>
                      <div className="font-serif font-bold text-xs text-[var(--ink)]">Briefing Doc</div>
                      <p className="text-[10px] text-[var(--ink-muted)] mt-0.5">Executive brief</p>
                    </button>
                  </div>
                </div>

                <section className="mx-auto max-w-2xl overflow-hidden rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[var(--control-room)]/5 rounded-[var(--radius-lg)] shadow-[var(--shadow-card)]">
                  <div className="border-b border-[var(--hairline)] bg-[var(--control-room)] p-5 text-[var(--control-room-foreground)] sm:p-6">
                    <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--signal)]">
                      Response setup
                    </p>
                    <h1 className="mt-2 font-serif text-xl font-bold sm:text-2xl">
                      Build {workspace.name}
                    </h1>
                    <p className="mt-2 max-w-xl text-xs leading-relaxed text-[var(--control-room-muted)] sm:text-sm">
                      Start with the buyer&apos;s documents. Groundwork can then map
                      requirements and create a source-backed response for your
                      team to review.
                    </p>
                  </div>

                  <ol className="grid border-b border-[var(--hairline)] sm:grid-cols-4">
                    {[
                      ["01", "Add bid pack", workspaceSources.length > 0],
                      ["02", "Map requirements", requirements.length > 0],
                      ["03", "Draft answers", false],
                      ["04", "Review", false],
                    ].map(([step, label, complete]) => (
                      <li
                        key={String(step)}
                        className="flex items-center gap-2 border-b border-[var(--hairline)] p-3 last:border-b-0 sm:block sm:border-b-0 sm:border-r sm:last:border-r-0"
                      >
                        <span
                          className={`font-mono text-[9px] font-bold ${
                            complete ? "text-[var(--success)]" : "text-[var(--ink-faint)]"
                          }`}
                        >
                          {complete ? "DONE" : step}
                        </span>
                        <span className="block text-[11px] font-semibold text-[var(--ink)] sm:mt-1">
                          {label}
                        </span>
                      </li>
                    ))}
                  </ol>

                  <div className="p-5 sm:p-6 bg-[var(--surface)]">
                    {workspaceSources.length === 0 ? (
                      <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)]">
                          <Upload size={22} />
                        </div>
                        <div>
                          <h2 className="font-serif text-base font-bold text-[var(--ink)]">
                            Upload source documents (Upload the RFP first)
                          </h2>
                          <p className="mt-1 text-xs leading-relaxed text-[var(--ink-secondary)]">
                            Add the reference PDFs, papers, or solicitation that defines
                            what your notebook or response covers.
                          </p>
                          <label className="mt-4 inline-flex h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--ink-blue)] px-4 text-xs font-bold text-white hover:bg-[var(--ink-blue-hover)]">
                            <Upload size={13} /> Choose source file
                            <input
                              className="sr-only"
                              type="file"
                              accept={SOURCE_UPLOAD_ACCEPT}
                              disabled={isUploadingSource}
                              onChange={async (event) => {
                                const file = event.target.files?.[0];
                                if (!file) return;
                                setIsUploadingSource(true);
                                try {
                                  await onUploadDocument(file, workspace.id);
                                } finally {
                                  setIsUploadingSource(false);
                                  event.target.value = "";
                                }
                              }}
                            />
                          </label>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-2 mt-4"
                            disabled={isCreatingBlankDraft}
                            onClick={handleCreateBlankDraft}
                          >
                            <PenLine size={13} />
                            {isCreatingBlankDraft ? "Creating…" : "Start blank draft"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--ink-sepia-subtle)] text-[var(--ink-sepia)]">
                          <ListChecks size={22} />
                        </div>
                        <div>
                          <h2 className="font-serif text-base font-bold text-[var(--ink)]">
                            {readySourcesCount > 0
                              ? "Synthesize sources and create the first draft"
                              : "Your source documents are being indexed"}
                          </h2>
                          <p className="mt-1 text-xs leading-relaxed text-[var(--ink-secondary)]">
                            {readySourcesCount > 0
                              ? `${readySourcesCount} source${readySourcesCount === 1 ? " is" : "s are"} ready. Groundwork will synthesize key insights and draft notes with verified citations.`
                              : "You can keep adding supporting files. Drafting becomes available when at least one source is ready."}
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              variant="agent"
                              size="sm"
                              disabled={readySourcesCount === 0 || isAgentRunning}
                              onClick={() =>
                                handleSendPrompt(
                                  "Synthesize core findings and comparative evidence from the selected sources, then create a source-backed research draft with explicit page-level citations.",
                                )
                              }
                            >
                              {isAgentRunning ? (
                                <RefreshCw size={13} className="spin" />
                              ) : (
                                <PenLine size={13} />
                              )}
                              {isAgentRunning ? "Synthesizing draft…" : "Synthesize first draft"}
                              {!isAgentRunning && <ArrowRight size={12} />}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={isCreatingBlankDraft}
                              onClick={handleCreateBlankDraft}
                            >
                              {isCreatingBlankDraft ? "Creating…" : "Start blank draft"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )
          )}
        </main>

        {/* Right: Assistant, review, and traceability tools */}
        {isRightPanelOpen ? (
          <>
            <button
              type="button"
              aria-label="Close workspace tools"
              onClick={() => setIsRightPanelOpen(false)}
              className="absolute inset-0 z-20 bg-black/20 xl:hidden"
            />
            <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(400px,calc(100%-44px))] flex-shrink-0 flex-col border-l border-[var(--hairline)] bg-[var(--paper)] shadow-[var(--shadow-modal)] xl:static xl:z-auto xl:w-[400px] xl:shadow-none groundwork-col-audit groundwork-col-tools min-w-0">
            {/* Panel Tabs Header */}
            <div className="border-b border-[var(--hairline)] bg-[var(--surface)] px-4 pt-3 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-[var(--ink)]">Studio &amp; Assistant</p>
                  <p className="mt-0.5 text-[10px] text-[var(--ink-muted)]">
                    Chat, review findings, and source evidence
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setIsRightPanelOpen(false)}
                  className="text-[var(--ink-muted)] hover:text-[var(--ink)] flex-shrink-0"
                  title="Collapse workspace tools"
                  aria-label="Collapse workspace tools"
                >
                  <PanelRightClose size={14} />
                </Button>
              </div>
              <Tabs
                variant="line"
                size="sm"
                className="mt-3 w-full justify-between"
                tabs={[
                  {
                    id: "assistant",
                    label: "Assistant",
                  },
                  {
                    id: "audit",
                    label: "Review",
                    badge:
                      openFindings.length > 0 ? (
                        <span className="px-1 rounded-full bg-[var(--warning)] text-white text-[9px] font-mono">
                          {openFindings.length}
                        </span>
                      ) : undefined,
                  },
                  {
                    id: "matrix",
                    label: "Map",
                  },
                  {
                    id: "appendix",
                    label: "Evidence",
                  },
                ]}
                activeTab={rightPanelTab}
                onChange={(t) => setRightPanelTab(t)}
              />
            </div>

            {/* Tab Pane Body */}
            <div className="flex-1 min-h-0 min-w-0">
              {rightPanelTab === "assistant" && (
                <div className="flex h-full min-h-0 flex-col">
                  <AgentReasoningDrawer
                    placement="side"
                    isAgentRunning={isAgentRunning}
                    messages={messages}
                    activeSteps={activeSteps}
                    streamingText={streamingText}
                    onStopAgent={handleStopAgent}
                    onClearHistory={handleClearConversation}
                    onOpenViewer={handleOpenReader}
                  />
                  <AgentBottomBar
                    compact
                    promptInput={promptInput}
                    isAgentRunning={isAgentRunning}
                    selectedSourcesCount={selectedSourceIds.length}
                    disabledReason={
                      isEditingContent
                        ? "Save or cancel manual edits before using the assistant."
                        : workspaceSources.length === 0
                          ? "Add a source document before asking the assistant."
                          : selectedSourceIds.length === 0
                            ? "Select at least one source on the left."
                            : undefined
                    }
                    suggestions={contextualSuggestions}
                    onPromptChange={setPromptInput}
                    onSubmitPrompt={handleSendPrompt}
                  />
                </div>
              )}

              {rightPanelTab === "audit" &&
                (activeArtifact ? (
                  <div className="h-full overflow-y-auto">
                  <ReviewFindingsAudit
                    findings={findings}
                    requirements={requirements}
                    readiness={readiness}
                    readinessScore={readinessScore}
                    isExportBlocked={isExportBlocked}
                    isRunningAudit={isRunningAudit}
                    isResolvingFindingId={isResolvingFindingId}
                    onRunAudit={handleRunAudit}
                    onResolveFinding={handleResolveFinding}
                    onOpenViewer={(docId, page) => handleOpenReader(docId, page)}
                    onPromptAgent={handleSendPrompt}
                    onExport={() => handleExport("pdf")}
                  />
                  </div>
                ) : (
                  <div className="h-full overflow-y-auto p-4">
                    <div className="rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] p-4">
                      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--ink-blue)]">
                        Review becomes available after drafting
                      </p>
                      <h2 className="mt-2 font-serif text-sm font-bold text-[var(--ink)]">
                        Nothing to review yet
                      </h2>
                      <p className="mt-2 text-xs leading-relaxed text-[var(--ink-secondary)]">
                        Add reference documents, synthesize findings, and create your draft.
                        Groundwork will then show evidence gaps and unsupported claims here.
                      </p>
                      <ol className="mt-4 space-y-2 text-xs">
                        {[
                          ["Add source documents", workspaceSources.length > 0],
                          ["Create response draft", false],
                          ["Run response check", false],
                        ].map(([label, complete]) => (
                          <li key={String(label)} className="flex items-center gap-2">
                            {complete ? (
                              <CheckCircle2 size={14} className="text-[var(--success)]" />
                            ) : (
                              <span className="h-3.5 w-3.5 rounded-full border border-[var(--hairline-strong)]" />
                            )}
                            <span className={complete ? "text-[var(--ink)]" : "text-[var(--ink-muted)]"}>
                              {label}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                ))}

              {rightPanelTab === "matrix" && (
                <div className="h-full overflow-y-auto">
                <TraceabilityMatrix
                  requirements={requirements}
                  onPromptAgent={handleSendPrompt}
                  onOpenViewer={(docId, page) => handleOpenReader(docId, page)}
                />
                </div>
              )}

              {rightPanelTab === "appendix" && (
                <div className="h-full overflow-y-auto">
                <ProvenanceAppendix
                  activeArtifact={activeArtifact}
                  requirements={requirements}
                  readinessScore={readinessScore}
                />
                </div>
              )}
            </div>
          </aside>
          </>
        ) : (
          <div className="w-11 border-l border-[var(--hairline)] bg-[var(--surface)] flex flex-col items-center py-3 gap-3 select-none flex-shrink-0">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setIsRightPanelOpen(true)}
              className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
              title="Expand workspace tools"
              aria-label="Expand workspace tools"
            >
              <MessageSquareText size={15} />
            </Button>
            {openFindings.length > 0 && (
              <span className="text-[9px] font-mono font-bold text-white px-1 py-0.2 rounded-full bg-[var(--warning)]">
                {openFindings.length}
              </span>
            )}
          </div>
        )}
      </div>

      <Modal
        isOpen={Boolean(sourcePendingDeletion)}
        onClose={() => {
          if (!isDeletingSource) {
            setSourcePendingDeletion(null);
          }
        }}
        title="Delete source?"
        eyebrow="Permanent action"
        maxWidth="sm"
      >
        <div className="space-y-5">
          <div className="rounded-[var(--radius-md)] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger)]">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="leading-relaxed">
                  Delete{" "}
                  <strong className="select-text font-mono font-semibold break-all bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded border border-[var(--danger-border)]">
                    {sourcePendingDeletion?.filename}
                  </strong>{" "}
                  from this response? Its indexed pages and source links will also be removed.
                </p>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setSourcePendingDeletion(null)}
              disabled={isDeletingSource}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => handleDeleteSource().catch(() => undefined)}
              isLoading={isDeletingSource}
            >
              Delete source
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Response Draft Modal */}
      <Modal
        isOpen={Boolean(draftPendingDeletion)}
        onClose={() => {
          if (!isDeletingDraft) {
            setDraftPendingDeletion(null);
          }
        }}
        title="Delete response draft?"
        eyebrow="Permanent action"
        maxWidth="sm"
      >
        <div className="space-y-5">
          <div className="rounded-[var(--radius-md)] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger)]">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="leading-relaxed">
                  Delete{" "}
                  <strong className="select-text font-mono font-semibold break-all bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded border border-[var(--danger-border)]">
                    {draftPendingDeletion?.title}
                  </strong>
                  ? Its blocks, citations, and review checklist will also be removed.
                </p>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setDraftPendingDeletion(null)}
              disabled={isDeletingDraft}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => handleDeleteDraft().catch(() => undefined)}
              isLoading={isDeletingDraft}
            >
              Delete response
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Note Modal */}
      <Modal
        isOpen={isAddNoteModalOpen}
        onClose={() => {
          if (!isSavingNote) setIsAddNoteModalOpen(false);
        }}
        title="Add Note to Notebook"
        eyebrow="Research Notes"
        maxWidth="md"
      >
        <div className="space-y-4">
          <p className="text-xs text-[var(--ink-muted)]">
            Write your thoughts, findings, or scratchpad notes. Pinned notes will be saved directly into your Notes &amp; Document Canvas.
          </p>
          <textarea
            value={newNoteContent}
            onChange={(e) => setNewNoteContent(e.target.value)}
            placeholder="Type your note or research observations here..."
            rows={5}
            className="w-full p-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline-strong)] bg-[var(--paper)] text-[var(--ink)] placeholder-[var(--ink-muted)] focus:outline-none focus:border-[var(--ink-blue)] leading-relaxed"
          />
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--hairline)]">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsAddNoteModalOpen(false)}
              disabled={isSavingNote}
            >
              Cancel
            </Button>
            <Button
              variant="human"
              size="sm"
              onClick={handleCreateCustomNote}
              isLoading={isSavingNote}
              disabled={!newNoteContent.trim()}
            >
              <Pin size={12} /> Save Note
            </Button>
          </div>
        </div>
      </Modal>

      {/* Multi-Source Ingestion Modal */}
      <AddSourceModal
        isOpen={isAddSourceModalOpen}
        onClose={() => setIsAddSourceModalOpen(false)}
        workspaceId={workspace.id}
        token={auth.access_token}
        onUploadFile={async (file) => {
          setIsUploadingSource(true);
          try {
            await onUploadDocument(file, workspace.id);
          } finally {
            setIsUploadingSource(false);
          }
        }}
        onSourceAdded={(newDoc) => {
          setLocalAddedSources((prev) => [newDoc, ...prev]);
          setWorkspaceNotice({
            tone: "success",
            message: `Added source: ${newDoc.filename}`,
          });
          toggleSource(newDoc.id);
        }}
      />
    </div>
  );
}

export default ResearchWorkspace;
