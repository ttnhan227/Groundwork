import { useState, useMemo } from "react";
import {
  BookOpen,
  Plus,
  Search,
  FileText,
  Layers,
  Trash2,
  Edit3,
  FolderPlus,
  User as UserIcon,
  ShieldCheck,
  ArrowRight,
  MoreVertical,
  PlayCircle,
  X,
  Upload,
  Sun,
  Moon,
  CheckCircle2,
  Sparkles,
  Lock,
  FileCheck2,
  RefreshCw,
} from "lucide-react";
import type { Workspace, DocumentItem, NativeDocument, AuthResult } from "../../types";
import { BrandMark } from "../../components/common/BrandMark";
import { useTranslation } from "../../i18n";

interface WorkspaceLibraryProps {
  auth: AuthResult;
  workspaces: Workspace[];
  documents: DocumentItem[];
  nativeDocs: NativeDocument[];
  activeTheme: "light" | "dark";
  isLoading?: boolean;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (name: string, template?: string) => Promise<string | null>;
  onDeleteWorkspace: (workspaceId: string) => Promise<void>;
  onRenameWorkspace: (workspaceId: string, newName: string) => Promise<void>;
  onUploadToNewWorkspace: (file: File) => Promise<void>;
  onOpenAccount: () => void;
  onToggleTheme: () => void;
  onOpenTwoMinuteDemo?: () => void;
  // Backward-compatibility props
  onSelectNotebook?: (workspaceId: string) => void;
  onCreateNotebook?: (name: string, template?: string) => Promise<string | null>;
  onDeleteNotebook?: (workspaceId: string) => Promise<void>;
  onRenameNotebook?: (workspaceId: string, newName: string) => Promise<void>;
  onUploadToNewNotebook?: (file: File) => Promise<void>;
}

export function WorkspaceLibrary({
  auth,
  workspaces,
  documents,
  nativeDocs,
  activeTheme,
  isLoading = false,
  onSelectWorkspace,
  onCreateWorkspace,
  onDeleteWorkspace,
  onRenameWorkspace,
  onUploadToNewWorkspace,
  onOpenAccount,
  onToggleTheme,
  onOpenTwoMinuteDemo,
  onSelectNotebook,
  onCreateNotebook,
  onDeleteNotebook,
  onRenameNotebook,
  onUploadToNewNotebook,
}: WorkspaceLibraryProps) {
  const { t } = useTranslation();
  const selectWorkspace = onSelectWorkspace || onSelectNotebook || (() => {});
  const createWorkspace = onCreateWorkspace || onCreateNotebook || (async () => null);
  const deleteWorkspace = onDeleteWorkspace || onDeleteNotebook || (async () => {});
  const renameWorkspace = onRenameWorkspace || onRenameNotebook || (async () => {});
  const uploadToNewWorkspace = onUploadToNewWorkspace || onUploadToNewNotebook || (async () => {});

  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("proposal");
  const [isCreating, setIsCreating] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const TEMPLATES = [
    {
      id: "proposal",
      title: t("library.template_proposal_title"),
      icon: ShieldCheck,
      description: t("library.template_proposal_desc"),
      color: "var(--accent)",
      bg: "var(--accent-subtle)",
    },
    {
      id: "report",
      title: t("library.template_report_title"),
      icon: FileText,
      description: t("library.template_report_desc"),
      color: "#059669",
      bg: "#ecfdf5",
    },
    {
      id: "presentation",
      title: t("library.template_presentation_title"),
      icon: Layers,
      description: t("library.template_presentation_desc"),
      color: "#7c3aed",
      bg: "#f5f3ff",
    },
    {
      id: "blank",
      title: t("library.template_blank_title"),
      icon: BookOpen,
      description: t("library.template_blank_desc"),
      color: "var(--text-primary)",
      bg: "var(--bg-subtle)",
    },
  ];

  // Group stats per workspace
  const workspaceStats = useMemo(() => {
    const map: Record<string, { sourcesCount: number; deliverablesCount: number; hasVerified: boolean }> = {};
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
    return workspaces.filter((ws) => {
      const matchSearch =
        ws.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ws.kind && ws.kind.toLowerCase().includes(searchQuery.toLowerCase()));
      if (!matchSearch) return false;

      if (filterCategory === "proposals") {
        return ws.name.toLowerCase().includes("proposal");
      }
      if (filterCategory === "reports") {
        return ws.name.toLowerCase().includes("report");
      }
      return true;
    });
  }, [workspaces, searchQuery, filterCategory]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newWorkspaceName.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const id = await createWorkspace(newWorkspaceName.trim(), selectedTemplate);
      setIsCreateOpen(false);
      setNewWorkspaceName("");
      if (id) selectWorkspace(id);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSaveRename(wsId: string) {
    if (!renameValue.trim()) {
      setEditingWorkspaceId(null);
      return;
    }
    await renameWorkspace(wsId, renameValue.trim());
    setEditingWorkspaceId(null);
    setRenameValue("");
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      uploadToNewWorkspace(files[0]).catch(() => undefined);
    }
  }

  return (
    <div
      className="notebook-library-container workspace-library-container"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget || (e.relatedTarget as HTMLElement).nodeName === "HTML") {
          setIsDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        handleFileDrop(e);
      }}
    >
      {/* Full-Page Drag Overlay */}
      {isDragging && !isCreateOpen && (
        <div className="library-drag-overlay">
          <Upload size={36} />
          <strong>Drop file here to start new workspace</strong>
          <span>We'll automatically initialize and index your document</span>
        </div>
      )}

      {/* Top Navbar */}
      <header className="notebook-nav workspace-nav">
        <div className="notebook-brand-link">
          <BrandMark size={20} />
          <strong>Ground<span>work</span></strong>
          <span className="hub-beta">Workspace</span>
        </div>

        {/* Global search */}
        <div className="notebook-search-box">
          <Search size={15} />
          <input
            type="text"
            placeholder={t("nav.search_placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search workspaces"
          />
          <kbd>⌘K</kbd>
        </div>

        {/* Action Controls */}
        <div className="notebook-nav-actions">
          <button className="btn-theme-toggle" onClick={onToggleTheme} title={activeTheme === "dark" ? t("nav.light_mode") : t("nav.dark_mode")} aria-label="Toggle theme">
            {activeTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <button
            className="btn-primary-gradient"
            onClick={() => {
              setSelectedTemplate("proposal");
              setNewWorkspaceName("");
              setIsCreateOpen(true);
            }}
            title={t("nav.new_workspace")}
          >
            <Plus size={15} />
            <span>{t("nav.new_workspace")}</span>
          </button>

          <button
            className="btn-account-chip"
            onClick={onOpenAccount}
            title={t("nav.profile_settings")}
          >
            <UserIcon size={14} />
            <span>{auth.user.display_name}</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="notebook-library-body">

        {/* Recommended Workflows */}
        <section className="notebook-workflows-section">
          <div className="section-header-compact">
            <h2>{t("library.templates_heading")}</h2>
            <span>{t("library.templates_subheading")}</span>
          </div>

          <div className="notebook-templates-grid">
            {TEMPLATES.map((tmpl) => {
              const Icon = tmpl.icon;
              return (
                <div
                  key={tmpl.id}
                  className="notebook-template-card"
                  onClick={() => {
                    setSelectedTemplate(tmpl.id);
                    setNewWorkspaceName(tmpl.title);
                    setIsCreateOpen(true);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedTemplate(tmpl.id);
                      setNewWorkspaceName(tmpl.title);
                      setIsCreateOpen(true);
                    }
                  }}
                >
                  <div className="template-icon" style={{ background: tmpl.bg, color: tmpl.color }}>
                    <Icon size={20} />
                  </div>
                  <strong>{tmpl.title}</strong>
                  <p>{tmpl.description}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Workspace Library List Section */}
        <section className="notebook-list-section">
          <div className="notebook-section-header">
            <div className="notebook-header-title">
              <h2>{t("nav.workspaces")} ({filteredWorkspaces.length})</h2>
              <span className="notebook-header-meta">
                {documents.length} {t(documents.length === 1 ? "library.sources_count" : "library.sources_count_plural", { count: documents.length })} · {workspaces.length} {t("nav.workspaces").toLowerCase()}
              </span>
            </div>

            <div className="notebook-category-tabs">
              <button
                className={filterCategory === "all" ? "active" : ""}
                onClick={() => setFilterCategory("all")}
              >
                {t("library.category_all")}
              </button>
              <button
                className={filterCategory === "proposals" ? "active" : ""}
                onClick={() => setFilterCategory("proposals")}
              >
                {t("library.category_proposals")}
              </button>
              <button
                className={filterCategory === "reports" ? "active" : ""}
                onClick={() => setFilterCategory("reports")}
              >
                {t("library.category_reports")}
              </button>
            </div>
          </div>

          {/* Loading Banner when connecting/fetching */}
          {isLoading && (
            <div className="workspace-loading-banner" role="status" aria-live="polite">
              <RefreshCw size={15} className="spin" />
              <span>{t("library.loading_banner")}</span>
            </div>
          )}

          {/* Workspace Cards Grid */}
          {isLoading ? (
            <div className="notebook-grid workspace-grid" aria-busy="true" aria-label="Loading workspaces">
              {[1, 2, 3, 4].map((idx) => (
                <div key={idx} className="skeleton-workspace-card">
                  <div className="skeleton-card-top">
                    <div className="skeleton-shimmer skeleton-avatar" />
                    <div className="skeleton-text-group">
                      <div className="skeleton-shimmer skeleton-title-bar" />
                      <div className="skeleton-shimmer skeleton-subtitle-bar" />
                    </div>
                  </div>
                  <div className="skeleton-meta-row">
                    <div className="skeleton-shimmer skeleton-pill" />
                    <div className="skeleton-shimmer skeleton-pill" />
                  </div>
                  <div className="skeleton-shimmer skeleton-footer-bar" />
                </div>
              ))}
            </div>
          ) : filteredWorkspaces.length > 0 ? (
            <div className="notebook-grid workspace-grid">
              {filteredWorkspaces.map((ws) => {
                const stats = workspaceStats[ws.id] || { sourcesCount: 0, deliverablesCount: 0, hasVerified: false };
                const isEditing = editingWorkspaceId === ws.id;

                return (
                  <div key={ws.id} className="notebook-card workspace-card">
                    <div className="notebook-card-header">
                      <div className="notebook-card-info">
                        <div className="notebook-card-icon">
                          <FileCheck2 size={17} />
                        </div>
                        <div className="notebook-title-wrap">
                          {isEditing ? (
                            <div className="notebook-rename-form">
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveRename(ws.id);
                                  if (e.key === "Escape") setEditingWorkspaceId(null);
                                }}
                              />
                              <button className="btn-rename-save" onClick={() => handleSaveRename(ws.id)}>
                                {t("library.btn_save")}
                              </button>
                            </div>
                          ) : (
                            <div
                              className="notebook-card-title"
                              onClick={() => selectWorkspace(ws.id)}
                              title={ws.name}
                            >
                              {ws.name}
                            </div>
                          )}
                          <span className="notebook-type-tag">
                            {ws.kind === "personal" ? "Personal workspace" : ws.kind || "Research"}
                          </span>
                        </div>
                      </div>

                      <div className="notebook-actions-dropdown">
                        <button
                          className="btn-dropdown-trigger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveDropdownId(activeDropdownId === ws.id ? null : ws.id);
                          }}
                          aria-label="Workspace options"
                        >
                          <MoreVertical size={15} />
                        </button>

                        {activeDropdownId === ws.id && (
                          <div className="dropdown-menu">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingWorkspaceId(ws.id);
                                setRenameValue(ws.name);
                                setActiveDropdownId(null);
                              }}
                            >
                              <Edit3 size={13} />
                              <span>{t("library.action_rename")}</span>
                            </button>
                            <button
                              className="danger"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDropdownId(null);
                                deleteWorkspace(ws.id);
                              }}
                            >
                              <Trash2 size={13} />
                              <span>{t("library.action_delete")}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Metadata & Status */}
                    <div className="notebook-card-meta">
                      <div className="meta-stats">
                        <span><FileText size={13} /> {t(stats.sourcesCount === 1 ? "library.sources_count" : "library.sources_count_plural", { count: stats.sourcesCount })}</span>
                        <span><Layers size={13} /> {t(stats.deliverablesCount === 1 ? "library.deliverables_count" : "library.deliverables_count_plural", { count: stats.deliverablesCount })}</span>
                      </div>
                      {stats.hasVerified ? (
                        <span className="badge-verified-pill"><CheckCircle2 size={12} /> {t("library.badge_verified")}</span>
                      ) : (
                        <span className="badge-draft-pill"><ShieldCheck size={12} /> {t("library.badge_in_review")}</span>
                      )}
                    </div>

                    {/* Footer / Open Button */}
                    <div className="notebook-card-footer" onClick={() => selectWorkspace(ws.id)}>
                      <span>{t("library.open_workspace")}</span>
                      <ArrowRight size={14} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="notebook-empty-state">
              <FolderPlus size={36} className="empty-icon" />
              <h3>{searchQuery ? t("library.empty_search_title") : t("library.empty_title")}</h3>
              <p>
                {searchQuery
                  ? t("library.empty_search_desc")
                  : t("library.empty_desc")}
              </p>
              <button
                className="btn-primary-gradient"
                onClick={() => {
                  setNewWorkspaceName("");
                  setSelectedTemplate("proposal");
                  setIsCreateOpen(true);
                }}
              >
                <Plus size={15} />
                <span>{t("library.btn_create")}</span>
              </button>
            </div>
          )}
        </section>
      </main>

      {/* Create Workspace Modal Dialog */}
      {isCreateOpen && (
        <div className="modal-backdrop" onClick={() => setIsCreateOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="create-workspace-title">
            <header className="modal-header">
              <div>
                <p className="modal-eyebrow">{t("app.name")}</p>
                <h3 id="create-workspace-title">{t("library.create_modal_title")}</h3>
              </div>
              <button className="btn-modal-close" onClick={() => setIsCreateOpen(false)} aria-label="Close dialog">
                <X size={16} />
              </button>
            </header>

            <div className="modal-form">
              {/* Option A: Drop / Select Document to Start */}
              <div
                className={`notebook-dropzone modal-dropzone ${isDragging ? "dragging" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  handleFileDrop(e);
                  setIsCreateOpen(false);
                }}
              >
                <Upload size={18} className="dropzone-icon" />
                <div className="dropzone-text">
                  <strong>{t("library.drag_drop_title")}</strong>
                  <span>{t("library.drag_drop_desc")}</span>
                </div>
                <label className="btn-dropzone-browse">
                  Browse file
                  <input
                    type="file"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setIsCreateOpen(false);
                        uploadToNewWorkspace(f).catch(() => undefined);
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              <div className="modal-form-divider">
                <span>or configure manually</span>
              </div>

              <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <label className="form-field">
                  <span>{t("library.workspace_name_label")}</span>
                  <input
                    type="text"
                    placeholder={t("library.workspace_name_placeholder")}
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    autoFocus
                    required
                  />
                </label>

                <div className="form-field">
                  <span>{t("library.template_select_label")}</span>
                  <div className="template-selection-grid">
                    {TEMPLATES.map((tmpl) => (
                      <label
                        key={tmpl.id}
                        className={`template-option ${selectedTemplate === tmpl.id ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="template"
                          value={tmpl.id}
                          checked={selectedTemplate === tmpl.id}
                          onChange={() => setSelectedTemplate(tmpl.id)}
                        />
                        <div className="option-icon" style={{ background: tmpl.bg, color: tmpl.color }}>
                          <tmpl.icon size={16} />
                        </div>
                        <div className="option-text">
                          <strong>{tmpl.title}</strong>
                          <small>{tmpl.description}</small>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="modal-actions-footer">
                  <button type="button" className="btn-modal-cancel" onClick={() => setIsCreateOpen(false)}>
                    {t("library.btn_cancel")}
                  </button>
                  <button type="submit" className="btn-primary-gradient" disabled={!newWorkspaceName.trim() || isCreating}>
                    {isCreating ? t("library.btn_creating") : t("library.btn_create")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Backward-compatibility alias
export const NotebookLibrary = WorkspaceLibrary;
