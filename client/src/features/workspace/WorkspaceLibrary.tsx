import React, { useEffect, useState, useMemo } from "react";
import {
  Plus,
  Search,
  FileText,
  Layers,
  Trash2,
  Edit3,
  FolderPlus,
  ShieldCheck,
  ArrowRight,
  MoreVertical,
  Upload,
  Sun,
  Moon,
  FileCheck2,
  BookOpen,
  PanelLeft,
} from "lucide-react";
import type {
  Workspace,
  DocumentItem,
  NativeDocument,
  AuthResult,
} from "../../types";
import { BrandMark } from "../../components/common/BrandMark";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Input } from "../../components/ui/Input";
import { formatDateTime } from "../../api/client";

export interface WorkspaceLibraryProps {
  auth: AuthResult;
  workspaces: Workspace[];
  documents: DocumentItem[];
  nativeDocs: NativeDocument[];
  activeTheme: "light" | "dark";
  isSidebarOpen?: boolean;
  isLoading?: boolean;
  createRequestKey?: number;
  onToggleSidebar?: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (
    name: string,
    template?: string,
  ) => Promise<string | null>;
  onDeleteWorkspace: (workspaceId: string) => Promise<void>;
  onRenameWorkspace: (workspaceId: string, newName: string) => Promise<void>;
  onUploadToNewWorkspace: (file: File) => Promise<void>;
  onOpenAccount: () => void;
  onToggleTheme: () => void;
  onSelectNotebook?: (workspaceId: string) => void;
}

export function WorkspaceLibrary({
  auth,
  workspaces,
  documents,
  nativeDocs,
  activeTheme,
  isSidebarOpen = true,
  isLoading: _isLoading = false,
  createRequestKey = 0,
  onToggleSidebar = () => {},
  onSelectWorkspace,
  onCreateWorkspace,
  onDeleteWorkspace,
  onRenameWorkspace,
  onUploadToNewWorkspace,
  onOpenAccount,
  onToggleTheme,
  onSelectNotebook,
}: WorkspaceLibraryProps) {
  const selectWs = onSelectWorkspace || onSelectNotebook;
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("rfp");
  const [isCreating, setIsCreating] = useState(false);
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [workspacePendingDeletion, setWorkspacePendingDeletion] =
    useState<Workspace | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (createRequestKey <= 0) return;
    setNewWorkspaceName("");
    setSelectedTemplate("rfp");
    setIsCreateModalOpen(true);
  }, [createRequestKey]);

  const TEMPLATES = [
    {
      id: "rfp",
      title: "Research & Literature Synthesis",
      alias: "RFP Response",
      icon: ShieldCheck,
      description:
        "Synthesize papers, documents, or RFP Response requirements with verified page citations.",
      color: "var(--ink-blue)",
      bg: "var(--ink-blue-subtle)",
    },
    {
      id: "security-questionnaire",
      title: "Study Guide & Knowledge Base",
      alias: "Security Questionnaire",
      icon: FileText,
      description:
        "Generate summaries, FAQs, key concepts, and answers from technical policies or Security Questionnaire sources.",
      color: "var(--ink-sepia)",
      bg: "var(--ink-sepia-subtle)",
    },
    {
      id: "due-diligence",
      title: "Project & Due Diligence Brief",
      alias: "Vendor Due Diligence",
      icon: Layers,
      description:
        "Coordinate technical, operational, and commercial evidence for Vendor Due Diligence and buyer review.",
      color: "var(--ink-blue)",
      bg: "var(--ink-blue-subtle)",
    },
    {
      id: "blank",
      title: "Blank Notebook",
      alias: "Blank Response",
      icon: BookOpen,
      description:
        "Clean canvas to start your notebook research or Blank Response from scratch.",
      color: "var(--ink)",
      bg: "var(--paper-subtle)",
    },
  ];

  function closeDeleteDialog() {
    if (isDeleting) return;
    setWorkspacePendingDeletion(null);
    setDeleteConfirmation("");
    setDeleteError("");
  }

  async function confirmWorkspaceDeletion() {
    if (
      !workspacePendingDeletion ||
      deleteConfirmation !== workspacePendingDeletion.name
    ) {
      return;
    }

    setIsDeleting(true);
    setDeleteError("");
    try {
      await onDeleteWorkspace(workspacePendingDeletion.id);
      setWorkspacePendingDeletion(null);
      setDeleteConfirmation("");
    } catch (reason) {
      setDeleteError(
        reason instanceof Error
          ? reason.message
          : "The response workspace could not be deleted.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  // Group stats per workspace
  const workspaceStats = useMemo(() => {
    const map: Record<
      string,
      { sourcesCount: number; deliverablesCount: number; hasDraft: boolean }
    > = {};
    for (const ws of workspaces) {
      const wsDocs = documents.filter((d) => d.workspace_id === ws.id);
      const wsArtifacts = nativeDocs.filter((n) => n.workspace_id === ws.id);
      const hasDraft = wsArtifacts.some((a) => a.status === "complete");
      map[ws.id] = {
        sourcesCount: wsDocs.length,
        deliverablesCount: wsArtifacts.length,
        hasDraft,
      };
    }
    return map;
  }, [workspaces, documents, nativeDocs]);

  // Filter workspaces
  const filteredWorkspaces = useMemo(() => {
    return workspaces.filter((ws) =>
      ws.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [workspaces, searchQuery]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newWorkspaceName.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const id = await onCreateWorkspace(
        newWorkspaceName.trim(),
        selectedTemplate,
      );
      setIsCreateModalOpen(false);
      setNewWorkspaceName("");
      if (id) selectWs(id);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSaveRename(wsId: string) {
    if (!renameValue.trim()) {
      setEditingWorkspaceId(null);
      return;
    }
    await onRenameWorkspace(wsId, renameValue.trim());
    setEditingWorkspaceId(null);
    setRenameValue("");
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      onUploadToNewWorkspace(files[0]).catch(() => undefined);
    }
  }

  return (
    <div
      className="min-h-screen w-full bg-[var(--paper)] flex flex-col overflow-x-hidden min-w-0 flex-1"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (
          !e.relatedTarget ||
          (e.relatedTarget as HTMLElement).nodeName === "HTML"
        ) {
          setIsDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        handleFileDrop(e);
      }}
    >
      {/* Full-Page Drag Overlay */}
      {isDragging && !isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-[rgba(43,58,85,0.08)] backdrop-blur-xs flex flex-col items-center justify-center pointer-events-none text-[var(--ink-blue)]">
          <Upload size={36} />
          <strong className="text-sm font-serif font-bold mt-2">
            Drop an RFP here to start a response
          </strong>
          <span className="text-xs text-[var(--ink-muted)]">
            Groundwork will create a response workspace and index the file.
          </span>
        </div>
      )}

      {/* Top Navbar */}
      <header className="h-12 border-b border-[var(--hairline)] bg-[var(--surface)] px-3 sm:px-6 flex items-center justify-between min-w-0 w-full z-20">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {!isSidebarOpen && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onToggleSidebar}
              className="text-[var(--ink-muted)] hover:text-[var(--ink)] flex-shrink-0"
              title="Open sidebar"
              aria-label="Open sidebar"
            >
              <PanelLeft size={16} />
            </Button>
          )}

          {isSidebarOpen ? (
            <strong className="font-serif text-sm font-bold text-[var(--ink)] truncate">
              Notebooks &amp; Responses
            </strong>
          ) : (
            <>
              <BrandMark size={20} className="flex-shrink-0" />
              <strong className="font-serif text-sm font-bold text-[var(--ink)] truncate">
                Ground<span className="text-[var(--ink-blue)]">work</span>
              </strong>
              <span className="hidden xs:inline text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--paper-subtle)] text-[var(--ink-muted)] ml-1 flex-shrink-0">
                Bid responses
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <div className="relative w-36 sm:w-64 hidden xs:block">
            <Input
              icon={<Search size={13} />}
              placeholder="Search responses &amp; notebooks… (⌘K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-xs bg-[var(--paper)]"
            />
          </div>

          <Button
            variant="ghost"
            size="xs"
            onClick={onToggleTheme}
            className="text-[var(--ink-muted)] hover:text-[var(--ink)] flex-shrink-0"
            title="Toggle color theme"
          >
            {activeTheme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </Button>

          <Button
            variant="human"
            size="sm"
            aria-label="New Response"
            onClick={() => {
              setNewWorkspaceName("");
              setIsCreateModalOpen(true);
            }}
            className="flex-shrink-0"
          >
            <Plus size={13} />
            <span className="hidden sm:inline">New Notebook</span>
            <span className="sm:hidden">New</span>
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenAccount}
            title="Account profile & preferences"
            className="flex-shrink-0 max-w-[120px] truncate"
          >
            <span className="truncate">{auth.user.display_name}</span>
          </Button>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-8 space-y-6 sm:space-y-8 notebook-library-container min-w-0">
        {/* Canonical starting action */}
        <section className="space-y-3 min-w-0 w-full">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ink-blue)]">
              AI Research Workspace
            </p>
            <h1 className="mt-1 font-serif text-xl sm:text-2xl font-bold text-[var(--ink)]">
              Turn source documents into a grounded notebook
            </h1>
            <p className="mt-1 max-w-2xl text-xs sm:text-sm text-[var(--ink-secondary)] leading-relaxed">
              Upload research papers, project documents, or an RFP pack. Groundwork indexes
              each source, creates your notebook, and keeps insights, draft notes, and evidence citations
              together. Turn a bid pack into a controlled response or research synthesis.
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.25fr_0.75fr]">
            <label
              data-testid="rfp-upload-card"
              className="group flex min-h-40 cursor-pointer flex-col justify-between rounded-[var(--radius-md)] border border-[var(--ink-blue)] bg-[var(--control-room)] p-5 text-[var(--control-room-foreground)] shadow-[var(--shadow-card)] transition-all hover:-translate-y-px hover:bg-[var(--control-room-hover)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--signal)] text-[var(--control-room)]">
                  <Upload size={19} />
                </div>
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--control-room-muted)]">
                  Recommended
                </span>
              </div>
              <div className="mt-5">
                <strong data-testid="rfp-upload-title" className="font-serif text-base">
                  Upload source documents
                </strong>
                <p className="mt-1 max-w-lg text-xs leading-relaxed text-[var(--control-room-muted)]">
                  PDF, Word, research paper, PowerPoint, or text file. Groundwork indexes each source,
                  links citations to exact pages, and prepares the AI assistant.
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[var(--signal)]">
                  Choose file <ArrowRight size={12} />
                </span>
              </div>
              <input
                className="sr-only"
                type="file"
                accept=".pdf,.docx,.pptx,.md,.markdown,.txt,.rtf,.png,.jpg,.jpeg,.webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUploadToNewWorkspace(file).catch(() => undefined);
                  event.target.value = "";
                }}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((tmpl) => {
                const Icon = tmpl.icon;
                return (
                  <button
                    type="button"
                    key={tmpl.id}
                    onClick={() => {
                      setSelectedTemplate(tmpl.id);
                      setNewWorkspaceName(tmpl.title);
                      setIsCreateModalOpen(true);
                    }}
                    className="rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] p-3 text-left transition-all hover:border-[var(--ink-blue-border)] hover:shadow-[var(--shadow-subtle)]"
                    title={tmpl.description}
                  >
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)]"
                      style={{ background: tmpl.bg, color: tmpl.color }}
                    >
                      <Icon size={14} />
                    </span>
                    <span className="mt-3 block font-serif text-xs font-bold text-[var(--ink)]">
                      {tmpl.title}
                    </span>
                    <span className="mt-0.5 block font-mono text-[9px] text-[var(--ink-blue)]">
                      {tmpl.alias}
                    </span>
                    <span className="mt-1 block text-[10px] text-[var(--ink-muted)]">
                      Start blank notebook
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Responses List Grid */}
        <section className="space-y-4 min-w-0 w-full">
          <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-2 min-w-0">
            <h2 className="font-serif text-base sm:text-lg font-bold text-[var(--ink)] truncate">
              Notebooks &amp; Responses ({filteredWorkspaces.length})
            </h2>
            <span className="text-xs text-[var(--ink-muted)] font-mono flex-shrink-0">
              {documents.length} sources · {workspaces.length} responses
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full min-w-0">
            {filteredWorkspaces.map((ws) => {
              const stats = workspaceStats[ws.id] || {
                sourcesCount: 0,
                deliverablesCount: 0,
                hasDraft: false,
              };
              const isEditing = editingWorkspaceId === ws.id;

              return (
                <div
                  key={ws.id}
                  className="p-4 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--hairline)] hover:border-[var(--hairline-strong)] hover:shadow-[var(--shadow-card)] transition-all flex flex-col justify-between group notebook-card min-w-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <FileCheck2
                          size={16}
                          className="text-[var(--ink-blue)] flex-shrink-0 mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <div className="flex items-center gap-1 min-w-0">
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveRename(ws.id);
                                  if (e.key === "Escape")
                                    setEditingWorkspaceId(null);
                                }}
                                className="w-full px-1.5 py-0.5 text-xs bg-[var(--paper)] border border-[var(--ink-blue)] rounded outline-none text-[var(--ink)] min-w-0"
                              />
                              <Button
                                variant="human"
                                size="xs"
                                onClick={() => handleSaveRename(ws.id)}
                                className="flex-shrink-0"
                              >
                                Save
                              </Button>
                            </div>
                          ) : (
                            <h3
                              onClick={() => selectWs(ws.id)}
                              className="font-serif text-sm font-bold text-[var(--ink)] truncate cursor-pointer hover:text-[var(--ink-blue)] block"
                              title={ws.name}
                            >
                              {ws.name}
                            </h3>
                          )}
                          <div className="flex items-center gap-1.5 text-[10px] text-[var(--ink-muted)] font-mono mt-0.5 flex-wrap">
                            <span>Updated {formatDateTime(ws.updated_at || ws.created_at)}</span>
                            <span>·</span>
                            <span>Created {formatDateTime(ws.created_at)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Dropdown Options */}
                      <div className="relative flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="xs"
                          className="opacity-70 group-hover:opacity-100 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                          aria-label={`Open actions for ${ws.name}`}
                          title={`Open actions for ${ws.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveDropdownId(
                              activeDropdownId === ws.id ? null : ws.id,
                            );
                          }}
                        >
                          <MoreVertical size={13} />
                        </Button>

                        {activeDropdownId === ws.id && (
                          <>
                            <div
                              className="fixed inset-0 z-20"
                              onClick={() => setActiveDropdownId(null)}
                            />
                            <div
                              className="absolute right-0 mt-1 w-32 bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-sm)] shadow-[var(--shadow-popover)] p-1 z-30"
                              role="menu"
                              aria-label={`Actions for ${ws.name}`}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingWorkspaceId(ws.id);
                                  setRenameValue(ws.name);
                                  setActiveDropdownId(null);
                                }}
                                role="menuitem"
                                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--ink)] hover:bg-[var(--surface-hover)] rounded"
                              >
                                <Edit3 size={12} />
                                <span>Rename</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveDropdownId(null);
                                  setWorkspacePendingDeletion(ws);
                                  setDeleteConfirmation("");
                                  setDeleteError("");
                                }}
                                role="menuitem"
                                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)] rounded"
                              >
                                <Trash2 size={12} />
                                <span>Delete</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Real workspace counts */}
                    <div
                      onClick={() => selectWs(ws.id)}
                      className="my-2.5 cursor-pointer rounded border border-[var(--hairline)] bg-[var(--paper-subtle)] p-3 transition-colors hover:border-[var(--ink-blue-border)]"
                    >
                      <div className="flex items-center gap-4 font-mono text-[10px] text-[var(--ink-muted)]">
                        <span>{stats.sourcesCount} {stats.sourcesCount === 1 ? "source" : "sources"}</span>
                        <span>{stats.deliverablesCount} {stats.deliverablesCount === 1 ? "note" : "notes"}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--ink-secondary)]">
                        {stats.sourcesCount === 0
                          ? "Add documents and supporting sources to begin."
                          : stats.hasDraft
                            ? "Continue research notes or review findings."
                            : "Sources are ready for synthesis and question answering."}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-[var(--hairline-subtle)] text-xs min-w-0">
                    <span className="inline-flex items-center gap-1 text-[var(--ink-muted)] font-mono text-[11px] truncate">
                      <FileText size={12} className="flex-shrink-0" />
                      <span>{stats.hasDraft ? "Response in progress" : "No response draft"}</span>
                    </span>

                    <button
                      onClick={() => selectWs(ws.id)}
                      className="inline-flex items-center gap-1 text-[var(--ink-blue)] font-medium hover:underline cursor-pointer flex-shrink-0 ml-2"
                    >
                      <span>Open response</span>
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredWorkspaces.length === 0 && (
            <div className="py-16 text-center text-xs text-[var(--ink-muted)] space-y-2">
              <FolderPlus
                size={32}
                className="mx-auto text-[var(--ink-faint)]"
              />
              <p className="font-serif text-sm font-semibold text-[var(--ink)]">
                {searchQuery ? "No matching responses" : "No responses yet"}
              </p>
              <p>
                {searchQuery
                  ? "Try a different search."
                  : "Start from source documents, notes, or blank synthesis."}
              </p>
              <Button
                variant="human"
                size="sm"
                onClick={() => {
                  setNewWorkspaceName("");
                  setIsCreateModalOpen(true);
                }}
              >
                <Plus size={13} />
                <span>Create Response</span>
              </Button>
            </div>
          )}
        </section>
      </main>

      <Modal
        isOpen={Boolean(workspacePendingDeletion)}
        onClose={closeDeleteDialog}
        title="Delete response workspace?"
        eyebrow="Permanent action"
        maxWidth="sm"
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            confirmWorkspaceDeletion().catch(() => undefined);
          }}
        >
          <div className="rounded-[var(--radius-md)] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger)]">
            <div className="flex items-start gap-3">
              <Trash2 size={18} className="mt-0.5 shrink-0" />
              <p className="leading-relaxed">
                This permanently deletes the workspace, its uploaded source
                files, response drafts, requirements, and review history. This
                cannot be undone.
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs leading-relaxed text-[var(--ink-secondary)]">
              Type{" "}
              <strong className="select-text font-mono font-semibold text-[var(--ink)] bg-[var(--paper-subtle)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">
                {workspacePendingDeletion?.name}
              </strong>{" "}
              to confirm.
            </p>
            <label
              htmlFor="delete-workspace-confirmation"
              className="mt-2.5 block text-xs font-semibold text-[var(--ink)]"
            >
              Workspace name
            </label>
            <Input
              id="delete-workspace-confirmation"
              data-testid="delete-workspace-confirmation"
              value={deleteConfirmation}
              onChange={(event) => {
                setDeleteConfirmation(event.target.value);
                if (deleteError) setDeleteError("");
              }}
              autoComplete="off"
              autoFocus
              disabled={isDeleting}
              className="mt-1"
            />
            {deleteConfirmation &&
              deleteConfirmation !== workspacePendingDeletion?.name && (
                <p className="mt-2 text-[11px] text-[var(--danger)]">
                  The name must match exactly, including capitalization.
                </p>
              )}
            {deleteError && (
              <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
                {deleteError}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--hairline)] pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={closeDeleteDialog}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              isLoading={isDeleting}
              disabled={
                !workspacePendingDeletion ||
                deleteConfirmation !== workspacePendingDeletion.name
              }
            >
              Delete workspace
            </Button>
          </div>
        </form>
      </Modal>

      {/* Create Response Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create notebook or response"
        eyebrow="Grounded AI · Sources · Citations · Studio"
      >
        <div className="space-y-4">
          {/* Dropzone */}
          <div
            className="p-6 rounded-[var(--radius-md)] border-2 border-dashed border-[var(--hairline-strong)] bg-[var(--paper)] text-center space-y-1.5 cursor-pointer hover:border-[var(--ink-blue)] transition-colors"
            onClick={() => {}}
          >
            <Upload size={20} className="mx-auto text-[var(--ink-muted)]" />
            <p className="text-xs font-semibold text-[var(--ink)]">
              Start with a source document or dataset
            </p>
            <p className="text-[11px] text-[var(--ink-muted)]">
              Groundwork creates your workspace and indexes the file for
              grounded chat and page-level citations.
            </p>
            <label className="inline-block mt-2">
              <Button variant="secondary" size="xs" type="button">
                Browse file
              </Button>
              <input
                type="file"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setIsCreateModalOpen(false);
                    onUploadToNewWorkspace(file).catch(() => undefined);
                  }
                }}
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex-1 h-px bg-[var(--hairline)]" />
            <span className="text-[10px] font-mono text-[var(--ink-faint)] uppercase">
              or start empty
            </span>
            <span className="flex-1 h-px bg-[var(--hairline)]" />
          </div>

          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label htmlFor="new-workspace-name" className="block text-xs font-medium text-[var(--ink)] mb-1">
                Response Name
              </label>
              <Input
                id="new-workspace-name"
                placeholder="e.g. Climate Policy & Clean Tech Research"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="human"
                size="sm"
                type="submit"
                disabled={!newWorkspaceName.trim() || isCreating}
              >
                {isCreating ? "Creating…" : "Create Response"}
              </Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}

export default WorkspaceLibrary;
