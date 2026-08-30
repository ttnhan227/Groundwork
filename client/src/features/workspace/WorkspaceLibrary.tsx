import React, { useState, useMemo } from "react";
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
  CheckCircle2,
  FileCheck2,
  BookOpen,
  PanelLeft,
  PanelLeftClose,
} from "lucide-react";
import type {
  Workspace,
  DocumentItem,
  NativeDocument,
  AuthResult,
} from "../../types";
import { BrandMark } from "../../components/common/BrandMark";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { Input } from "../../components/ui/Input";

export interface WorkspaceLibraryProps {
  auth: AuthResult;
  workspaces: Workspace[];
  documents: DocumentItem[];
  nativeDocs: NativeDocument[];
  activeTheme: "light" | "dark";
  isSidebarOpen?: boolean;
  isLoading?: boolean;
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
  onOpenTwoMinuteDemo?: () => void;
  onSelectNotebook?: (workspaceId: string) => void;
}

export function WorkspaceLibrary({
  auth,
  workspaces,
  documents,
  nativeDocs,
  activeTheme,
  isSidebarOpen = true,
  isLoading = false,
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
  const [selectedTemplate, setSelectedTemplate] = useState("proposal");
  const [isCreating, setIsCreating] = useState(false);
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const TEMPLATES = [
    {
      id: "proposal",
      title: "Technical Proposal",
      icon: ShieldCheck,
      description:
        "Grounded technical proposal with continuous SLA and claim verification.",
      color: "var(--ink-blue)",
      bg: "var(--ink-blue-subtle)",
    },
    {
      id: "report",
      title: "Client Research Report",
      icon: FileText,
      description:
        "Multi-document synthesis report with cited evidence appendix.",
      color: "var(--ink-sepia)",
      bg: "var(--ink-sepia-subtle)",
    },
    {
      id: "presentation",
      title: "Executive Presentation",
      icon: Layers,
      description:
        "Concise summary structured for stakeholders and review boards.",
      color: "var(--ink-blue)",
      bg: "var(--ink-blue-subtle)",
    },
    {
      id: "blank",
      title: "Blank Workspace",
      icon: BookOpen,
      description:
        "Empty workspace to draft and ground any custom deliverable.",
      color: "var(--ink)",
      bg: "var(--paper-subtle)",
    },
  ];

  // Group stats per workspace
  const workspaceStats = useMemo(() => {
    const map: Record<
      string,
      { sourcesCount: number; deliverablesCount: number; hasVerified: boolean }
    > = {};
    for (const ws of workspaces) {
      const wsDocs = documents.filter((d) => d.workspace_id === ws.id);
      const wsArtifacts = nativeDocs.filter((n) => n.workspace_id === ws.id);
      const hasVerified = wsArtifacts.some((a) => a.status === "complete");
      map[ws.id] = {
        sourcesCount: wsDocs.length,
        deliverablesCount: wsArtifacts.length,
        hasVerified,
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
      className="min-h-screen w-full bg-[var(--paper)] flex flex-col select-none overflow-x-hidden min-w-0 flex-1"
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
            Drop file here to start new workspace
          </strong>
          <span className="text-xs text-[var(--ink-muted)]">
            We'll automatically initialize and index your document
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

          <BrandMark size={20} className="flex-shrink-0" />
          <strong className="font-serif text-sm font-bold text-[var(--ink)] truncate">
            Ground<span className="text-[var(--ink-blue)]">work</span>
          </strong>
          <span className="hidden xs:inline text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--paper-subtle)] text-[var(--ink-muted)] ml-1 flex-shrink-0">
            Workspaces
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <div className="relative w-36 sm:w-64 hidden xs:block">
            <Input
              icon={<Search size={13} />}
              placeholder="Search workspaces… (⌘K)"
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
            onClick={() => {
              setNewWorkspaceName("");
              setIsCreateModalOpen(true);
            }}
            className="flex-shrink-0"
          >
            <Plus size={13} />
            <span className="hidden sm:inline">New Workspace</span>
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
        {/* Templates Banner */}
        <section className="space-y-3 min-w-0 w-full">
          <div className="flex items-center justify-between min-w-0">
            <h2 className="font-serif text-base sm:text-lg font-bold text-[var(--ink)] truncate">
              Recommended Workflows
            </h2>
            <span className="hidden sm:inline text-xs text-[var(--ink-muted)] truncate">
              Preconfigured with grounded evidence workflows
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full min-w-0">
            {TEMPLATES.map((tmpl) => {
              const Icon = tmpl.icon;
              return (
                <div
                  key={tmpl.id}
                  onClick={() => {
                    setSelectedTemplate(tmpl.id);
                    setNewWorkspaceName(tmpl.title);
                    setIsCreateModalOpen(true);
                  }}
                  className="p-4 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--hairline)] hover:border-[var(--hairline-strong)] hover:shadow-[var(--shadow-card)] cursor-pointer transition-all flex flex-col justify-between group notebook-template-card min-w-0"
                >
                  <div className="min-w-0">
                    <div
                      className="w-8 h-8 rounded-[var(--radius-sm)] flex items-center justify-center mb-3 flex-shrink-0"
                      style={{ background: tmpl.bg, color: tmpl.color }}
                    >
                      <Icon size={16} />
                    </div>
                    <h3 className="font-serif text-sm font-bold text-[var(--ink)] group-hover:text-[var(--ink-blue)] transition-colors break-words">
                      {tmpl.title}
                    </h3>
                    <p className="text-xs text-[var(--ink-secondary)] mt-1 line-clamp-2 leading-snug break-words">
                      {tmpl.description}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--ink-blue)] font-medium mt-3">
                    Use template →
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Workspaces List Grid */}
        <section className="space-y-4 min-w-0 w-full">
          <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-2 min-w-0">
            <h2 className="font-serif text-base sm:text-lg font-bold text-[var(--ink)] truncate">
              Research Workspaces ({filteredWorkspaces.length})
            </h2>
            <span className="text-xs text-[var(--ink-muted)] font-mono flex-shrink-0">
              {documents.length} sources · {workspaces.length} workspaces
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full min-w-0">
            {filteredWorkspaces.map((ws) => {
              const stats = workspaceStats[ws.id] || {
                sourcesCount: 0,
                deliverablesCount: 0,
                hasVerified: false,
              };
              const isEditing = editingWorkspaceId === ws.id;

              return (
                <div
                  key={ws.id}
                  className="p-4 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--hairline)] hover:border-[var(--hairline-strong)] hover:shadow-[var(--shadow-card)] transition-all flex flex-col justify-between group notebook-card min-w-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <FileCheck2
                          size={16}
                          className="text-[var(--ink-blue)] flex-shrink-0"
                        />
                        {isEditing ? (
                          <div className="flex items-center gap-1 min-w-0 flex-1">
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
                            className="font-serif text-sm font-bold text-[var(--ink)] truncate cursor-pointer hover:text-[var(--ink-blue)] flex-1 min-w-0"
                            title={ws.name}
                          >
                            {ws.name}
                          </h3>
                        )}
                      </div>

                      {/* Dropdown Options */}
                      <div className="relative flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="xs"
                          className="opacity-0 group-hover:opacity-100 text-[var(--ink-muted)] hover:text-[var(--ink)]"
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
                            <div className="absolute right-0 mt-1 w-32 bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-sm)] shadow-[var(--shadow-popover)] p-1 z-30">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingWorkspaceId(ws.id);
                                  setRenameValue(ws.name);
                                  setActiveDropdownId(null);
                                }}
                                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--ink)] hover:bg-[var(--surface-hover)] rounded"
                              >
                                <Edit3 size={12} />
                                <span>Rename</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveDropdownId(null);
                                  onDeleteWorkspace(ws.id);
                                }}
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

                    {/* Document Preview Thumbnail & Details */}
                    <div
                      onClick={() => selectWs(ws.id)}
                      className="cursor-pointer my-2.5 flex items-center gap-3 p-2 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] hover:border-[var(--ink-blue-border)] transition-colors"
                    >
                      <img
                        src={
                          ws.name.toLowerCase().includes("rfp") ||
                          ws.name.toLowerCase().includes("defense")
                            ? "/doc-dod-rfp.jpg"
                            : ws.name.toLowerCase().includes("soc") ||
                                ws.name.toLowerCase().includes("security")
                              ? "/doc-audit-soc2.jpg"
                              : "/doc-sec-10k.jpg"
                        }
                        alt="Document Cover"
                        className="w-10 h-13 object-cover rounded shadow-sm border border-[var(--hairline)] shrink-0 bg-white"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--ink-muted)]">
                          <span>
                            {stats.sourcesCount || 3} evidence sources
                          </span>
                          <span>·</span>
                          <span>{stats.deliverablesCount || 1} draft</span>
                        </div>
                        <p className="text-[11px] text-[var(--ink-secondary)] font-sans mt-0.5 truncate">
                          {ws.name.toLowerCase().includes("rfp")
                            ? "DoD Logistics Spec & High-Availability SLA"
                            : ws.name.toLowerCase().includes("soc")
                              ? "Continuous NIST AI RMF & ISO Assessment"
                              : "SEC Form 10-K Ingestion & Audit Trail"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-[var(--hairline-subtle)] text-xs min-w-0">
                    {stats.hasVerified ? (
                      <span className="inline-flex items-center gap-1 text-[var(--success)] font-mono text-[11px] font-semibold truncate">
                        <CheckCircle2 size={12} className="flex-shrink-0" />
                        <span>100% Grounded</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[var(--ink-blue)] font-mono text-[11px] font-semibold truncate">
                        <ShieldCheck size={12} className="flex-shrink-0" />
                        <span>Continuous Audit</span>
                      </span>
                    )}

                    <button
                      onClick={() => selectWs(ws.id)}
                      className="inline-flex items-center gap-1 text-[var(--ink-blue)] font-medium hover:underline cursor-pointer flex-shrink-0 ml-2"
                    >
                      <span>Open Studio</span>
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
                No Workspaces Found
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
                <span>Create Workspace</span>
              </Button>
            </div>
          )}
        </section>
      </main>

      {/* Create Workspace Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Workspace"
        eyebrow="Agentic Workspace"
      >
        <div className="space-y-4">
          {/* Dropzone */}
          <div
            className="p-6 rounded-[var(--radius-md)] border-2 border-dashed border-[var(--hairline-strong)] bg-[var(--paper)] text-center space-y-1.5 cursor-pointer hover:border-[var(--ink-blue)] transition-colors"
            onClick={() => {}}
          >
            <Upload size={20} className="mx-auto text-[var(--ink-muted)]" />
            <p className="text-xs font-semibold text-[var(--ink)]">
              Drop RFP, Spec, or Documentation here
            </p>
            <p className="text-[11px] text-[var(--ink-muted)]">
              We'll automatically initialize and index the workspace from your
              document.
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
              <label className="block text-xs font-medium text-[var(--ink)] mb-1">
                Workspace Name
              </label>
              <Input
                placeholder="e.g. Apex Horizon RFP Technical Proposal"
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
                {isCreating ? "Creating…" : "Create Workspace"}
              </Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}

export default WorkspaceLibrary;
