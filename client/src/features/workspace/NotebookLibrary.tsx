import { useState, useMemo } from "react";
import {
  BookOpen,
  Plus,
  Search,
  FileText,
  Sparkles,
  Layers,
  Trash2,
  Edit3,
  CheckCircle,
  FolderPlus,
  Upload,
  User as UserIcon,
  ShieldCheck,
  ArrowRight,
  Clock,
  MoreVertical,
  Scissors,
  PlayCircle,
  X,
  FileSpreadsheet,
} from "lucide-react";
import type { Workspace, DocumentItem, NativeDocument, AuthResult } from "../../types";
import { BrandMark } from "../../components/common/BrandMark";

interface NotebookLibraryProps {
  auth: AuthResult;
  workspaces: Workspace[];
  documents: DocumentItem[];
  nativeDocs: NativeDocument[];
  activeTheme: "light" | "dark";
  onSelectNotebook: (workspaceId: string) => void;
  onCreateNotebook: (name: string, template?: string) => Promise<string | null>;
  onDeleteNotebook: (workspaceId: string) => Promise<void>;
  onRenameNotebook: (workspaceId: string, newName: string) => Promise<void>;
  onUploadToNewNotebook: (file: File) => Promise<void>;
  onOpenAccount: () => void;
  onToggleTheme: () => void;
  onOpenPdfTools?: () => void;
  onOpenTwoMinuteDemo?: () => void;
}

export function NotebookLibrary({
  auth,
  workspaces,
  documents,
  nativeDocs,
  activeTheme,
  onSelectNotebook,
  onCreateNotebook,
  onDeleteNotebook,
  onRenameNotebook,
  onUploadToNewNotebook,
  onOpenAccount,
  onToggleTheme,
  onOpenPdfTools,
  onOpenTwoMinuteDemo,
}: NotebookLibraryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("proposal");
  const [isCreating, setIsCreating] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const TEMPLATES = [
    {
      id: "proposal",
      title: "Technical Proposal",
      icon: ShieldCheck,
      description: "Extract brief requirements and draft a verified, grounded proposal.",
      color: "var(--purple)",
      bg: "var(--purple-soft)",
    },
    {
      id: "report",
      title: "Client Research Report",
      icon: FileText,
      description: "Analyze market/project sources into an executive brief with key metrics.",
      color: "#2d9366",
      bg: "#e8f6ef",
    },
    {
      id: "presentation",
      title: "Executive Presentation",
      icon: Layers,
      description: "Structure source content into an audience-tailored presentation outline.",
      color: "var(--violet)",
      bg: "#f4efff",
    },
    {
      id: "blank",
      title: "Blank Notebook",
      icon: BookOpen,
      description: "Start fresh and ground the agent on your uploaded sources.",
      color: "var(--navy)",
      bg: "#f0f2f7",
    },
  ];

  // Group stats per workspace
  const workspaceStats = useMemo(() => {
    const map: Record<string, { sourcesCount: number; deliverablesCount: number; hasVerified: boolean }> = {};
    for (const ws of workspaces) {
      const wsDocs = documents.filter((d) => (d as any).workspace_id === ws.id);
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
    if (!newNotebookName.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const id = await onCreateNotebook(newNotebookName.trim(), selectedTemplate);
      setIsCreateOpen(false);
      setNewNotebookName("");
      if (id) onSelectNotebook(id);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSaveRename(wsId: string) {
    if (!renameValue.trim()) {
      setEditingWorkspaceId(null);
      return;
    }
    await onRenameNotebook(wsId, renameValue.trim());
    setEditingWorkspaceId(null);
    setRenameValue("");
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      onUploadToNewNotebook(files[0]);
    }
  }

  return (
    <div className="notebook-library-container">
      {/* Top Navbar matching Landing Page & InsightPDF brand */}
      <header className="notebook-nav">
        <div className="notebook-brand-link">
          <BrandMark />
          <strong>Insight<span>PDF</span><small className="hub-beta">Beta</small></strong>
        </div>

        {/* Global search */}
        <div className="notebook-search-box">
          <Search size={16} color="var(--muted)" />
          <input
            type="text"
            placeholder="Search notebooks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <kbd>⌘K</kbd>
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {onOpenPdfTools && (
            <button className="btn-secondary-white" onClick={onOpenPdfTools} title="PDF intelligence tools">
              <Scissors size={15} color="var(--purple)" />
              <span>PDF Tools</span>
            </button>
          )}

          {onOpenTwoMinuteDemo && (
            <button className="btn-secondary-white" onClick={onOpenTwoMinuteDemo} title="Try a finished demo">
              <PlayCircle size={15} color="#2d9366" />
              <span>Try Demo</span>
            </button>
          )}

          <button
            className="btn-primary-gradient"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus size={16} />
            <span>New Notebook</span>
          </button>

          <button
            className="btn-secondary-white"
            style={{ padding: "0 12px" }}
            onClick={onOpenAccount}
            title="Account Settings"
          >
            <UserIcon size={15} color="var(--navy)" />
            <span>{auth.user.display_name}</span>
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="notebook-hero">
        <div>
          <div className="ai-eyebrow">
            <Sparkles size={14} /> AI Document Workspace
          </div>
          <h1>
            Your source material,<br />
            <span>ready to answer.</span>
          </h1>
          <p>
            Create focused research notebooks grounded on your PDFs, reports, and evidence packs. Draft verified deliverables with full source traceability.
          </p>
        </div>

        <button
          className="btn-primary-gradient"
          style={{ height: "46px", padding: "0 24px", fontSize: "14px" }}
          onClick={() => setIsCreateOpen(true)}
        >
          <FolderPlus size={18} />
          <span>Create Notebook</span>
        </button>
      </section>

      {/* Template Workflows */}
      <section style={{ maxWidth: "1240px", margin: "0 auto", padding: "0 32px 12px" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 14px" }}>
          Recommended Workflows
        </h2>
      </section>

      <div className="notebook-templates-grid">
        {TEMPLATES.map((tmpl) => {
          const Icon = tmpl.icon;
          return (
            <div
              key={tmpl.id}
              className="notebook-template-card"
              onClick={() => {
                setSelectedTemplate(tmpl.id);
                setNewNotebookName(tmpl.title);
                setIsCreateOpen(true);
              }}
            >
              <div className="template-icon" style={{ background: tmpl.bg, color: tmpl.color }}>
                <Icon size={22} />
              </div>
              <strong>{tmpl.title}</strong>
              <p>{tmpl.description}</p>
            </div>
          );
        })}
      </div>

      {/* Notebook Library Section */}
      <div className="notebook-section-header">
        <h2>Notebook Library ({filteredWorkspaces.length})</h2>
        <div className="notebook-category-tabs">
          <button
            className={filterCategory === "all" ? "active" : ""}
            onClick={() => setFilterCategory("all")}
          >
            All Notebooks
          </button>
          <button
            className={filterCategory === "proposals" ? "active" : ""}
            onClick={() => setFilterCategory("proposals")}
          >
            Proposals
          </button>
          <button
            className={filterCategory === "reports" ? "active" : ""}
            onClick={() => setFilterCategory("reports")}
          >
            Reports
          </button>
        </div>
      </div>

      {/* Notebook Cards Grid */}
      {filteredWorkspaces.length > 0 ? (
        <div className="notebook-grid">
          {filteredWorkspaces.map((ws) => {
            const stats = workspaceStats[ws.id] || { sourcesCount: 0, deliverablesCount: 0, hasVerified: false };
            const isEditing = editingWorkspaceId === ws.id;

            return (
              <div key={ws.id} className="notebook-card">
                <div className="notebook-card-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                    <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "var(--purple-soft)", color: "var(--purple)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                      <BookOpen size={18} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isEditing ? (
                        <div style={{ display: "flex", gap: "6px" }}>
                          <input
                            autoFocus
                            style={{ padding: "4px 8px", border: "1px solid var(--purple)", borderRadius: "6px", fontSize: "13px", width: "100%" }}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSaveRename(ws.id)}
                          />
                          <button className="btn-primary-gradient" style={{ height: "28px", padding: "0 10px", fontSize: "11px" }} onClick={() => handleSaveRename(ws.id)}>
                            Save
                          </button>
                        </div>
                      ) : (
                        <div
                          className="notebook-card-title"
                          onClick={() => onSelectNotebook(ws.id)}
                          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        >
                          {ws.name}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ position: "relative" }}>
                    <button
                      style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--muted)", padding: "4px" }}
                      onClick={() => setActiveDropdownId(activeDropdownId === ws.id ? null : ws.id)}
                      aria-label="Notebook menu"
                    >
                      <MoreVertical size={16} />
                    </button>

                    {activeDropdownId === ws.id && (
                      <>
                        <div
                          style={{ position: "fixed", inset: 0, zIndex: 60 }}
                          onClick={() => setActiveDropdownId(null)}
                        />
                        <div
                          style={{
                            position: "absolute",
                            right: 0,
                            top: "28px",
                            zIndex: 70,
                            background: "#fff",
                            border: "1px solid #e2e7f0",
                            borderRadius: "10px",
                            boxShadow: "0 10px 25px rgba(10, 24, 61, 0.1)",
                            padding: "6px",
                            minWidth: "140px",
                          }}
                        >
                          <button
                            style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "8px 10px", border: 0, background: "transparent", color: "var(--ink)", fontSize: "12px", cursor: "pointer", borderRadius: "6px" }}
                            onClick={() => {
                              setEditingWorkspaceId(ws.id);
                              setRenameValue(ws.name);
                              setActiveDropdownId(null);
                            }}
                          >
                            <Edit3 size={14} color="var(--muted)" /> Rename
                          </button>
                          <button
                            style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "8px 10px", border: 0, background: "transparent", color: "var(--red)", fontSize: "12px", cursor: "pointer", borderRadius: "6px" }}
                            onClick={() => {
                              setActiveDropdownId(null);
                              onDeleteNotebook(ws.id);
                            }}
                          >
                            <Trash2 size={14} color="var(--red)" /> Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "8px 0 16px" }}>
                  <span style={{ fontSize: "12px", color: "var(--muted)", display: "flex", alignItems: "center", gap: "5px" }}>
                    <FileText size={13} /> {stats.sourcesCount} {stats.sourcesCount === 1 ? "source" : "sources"}
                  </span>
                  <span style={{ fontSize: "12px", color: "var(--muted)", display: "flex", alignItems: "center", gap: "5px" }}>
                    <FileSpreadsheet size={13} /> {stats.deliverablesCount} {stats.deliverablesCount === 1 ? "deliverable" : "deliverables"}
                  </span>
                  {stats.hasVerified && (
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#2d9366", background: "#e8f6ef", padding: "2px 8px", borderRadius: "999px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      <CheckCircle size={12} /> Verified
                    </span>
                  )}
                </div>

                <div className="notebook-card-meta">
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <Clock size={12} /> Modified {new Date(ws.created_at).toLocaleDateString()}
                  </span>

                  <button
                    style={{
                      marginLeft: "auto",
                      border: 0,
                      background: "transparent",
                      color: "var(--purple)",
                      fontWeight: 750,
                      fontSize: "12px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    onClick={() => onSelectNotebook(ws.id)}
                  >
                    Open Notebook <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)" }}>
          <BookOpen size={40} color="#cbd5e7" style={{ margin: "0 auto 12px" }} />
          <strong style={{ display: "block", color: "var(--ink)", fontSize: "15px", marginBottom: "4px" }}>No notebooks found</strong>
          <p style={{ fontSize: "13px", margin: 0 }}>Create a new notebook or drop a document below to get started.</p>
        </div>
      )}

      {/* Quick Dropzone */}
      <div
        className={`notebook-dropzone ${isDragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleFileDrop}
      >
        <Upload size={28} color="var(--purple)" />
        <strong style={{ fontSize: "14px", color: "var(--ink)" }}>Drop file here to start new notebook</strong>
        <span style={{ fontSize: "12px", color: "var(--muted)" }}>Supports PDF, Word (.docx), PPTX, Markdown, Text, or images</span>
      </div>

      {/* Create Notebook Modal */}
      {isCreateOpen && (
        <div className="history-backdrop" style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", background: "rgba(10, 24, 61, 0.4)", backdropFilter: "blur(4px)" }}>
          <form
            onSubmit={handleCreate}
            style={{
              width: "min(500px, calc(100% - 32px))",
              background: "#ffffff",
              borderRadius: "18px",
              padding: "28px",
              boxShadow: "0 20px 60px rgba(10, 24, 61, 0.18)",
              border: "1px solid #e2e7f0",
              display: "flex",
              flexDirection: "column",
              gap: "18px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <span className="ai-eyebrow" style={{ fontSize: "10px" }}><Sparkles size={12} /> New Project</span>
                <h3 style={{ margin: "4px 0 0", fontSize: "18px", fontWeight: 750, color: "var(--ink)" }}>Create Research Notebook</h3>
              </div>
              <button
                type="button"
                style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--muted)" }}
                onClick={() => setIsCreateOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--ink)", marginBottom: "6px" }}>
                Notebook Name
              </label>
              <input
                autoFocus
                type="text"
                placeholder="e.g. Q3 Competitive Analysis, Vendor Security Assessment"
                value={newNotebookName}
                onChange={(e) => setNewNotebookName(e.target.value)}
                style={{
                  width: "100%",
                  height: "42px",
                  padding: "0 14px",
                  border: "1px solid #dfe4ed",
                  borderRadius: "10px",
                  fontSize: "13px",
                  color: "var(--ink)",
                  outline: 0,
                  boxSizing: "border-box",
                }}
                required
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "var(--ink)", marginBottom: "8px" }}>
                Starter Workflow
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {TEMPLATES.map((tmpl) => (
                  <div
                    key={tmpl.id}
                    onClick={() => {
                      setSelectedTemplate(tmpl.id);
                      if (!newNotebookName || TEMPLATES.some((t) => t.title === newNotebookName)) {
                        setNewNotebookName(tmpl.title);
                      }
                    }}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "10px",
                      border: selectedTemplate === tmpl.id ? "2px solid var(--purple)" : "1px solid #dfe4ed",
                      background: selectedTemplate === tmpl.id ? "var(--purple-soft)" : "#ffffff",
                      cursor: "pointer",
                    }}
                  >
                    <strong style={{ display: "block", fontSize: "12px", color: "var(--ink)" }}>{tmpl.title}</strong>
                    <small style={{ fontSize: "10px", color: "var(--muted)" }}>{tmpl.description.slice(0, 45)}...</small>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
              <button
                type="button"
                className="btn-secondary-white"
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary-gradient"
                disabled={!newNotebookName.trim() || isCreating}
              >
                {isCreating ? "Creating..." : "Create Notebook"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
