import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  FileText,
  CheckSquare,
  Square as SquareOutline,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Check,
  Upload,
  Plus,
  Download,
  Globe,
  Video,
  FileCode,
  Sparkles,
  ChevronsUpDown,
  Search,
  BookOpen,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { API, formatDateTime } from "../../api/client";
import type { DocumentItem, NativeDocument } from "../../types";

function getDocTypeIcon(doc: DocumentItem) {
  const name = (doc.filename || "").toLowerCase();
  if (name.endsWith(".html") || name.endsWith(".htm") || doc.tags?.includes("web")) {
    return <Globe size={14} className="text-emerald-600 flex-shrink-0" />;
  }
  if (
    name.endsWith(".mp4") ||
    name.endsWith(".mov") ||
    doc.tags?.includes("youtube") ||
    doc.tags?.includes("video")
  ) {
    return <Video size={14} className="text-rose-600 flex-shrink-0" />;
  }
  if (name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".json")) {
    return <FileCode size={14} className="text-amber-600 flex-shrink-0" />;
  }
  return <FileText size={14} className="text-[var(--ink-blue)] flex-shrink-0" />;
}

export interface SourcesSidebarProps {
  // Response / Deliverable props
  responses?: NativeDocument[];
  activeResponseId?: string | null;
  onSelectResponse?: (id: string) => void;
  onCreateResponse?: () => void;
  onDeleteResponse?: (id: string) => void;
  onViewSources?: () => void;
  readinessScore?: number;
  readinessStatus?: "setup_needed" | "needs_review" | "ready" | null;

  // Source props
  sources: DocumentItem[];
  selectedSourceIds: string[];
  isUploading: boolean;
  activeSourceId?: string | null;
  evidenceSourceId?: string | null;
  onSelectSource?: (id: string) => void;
  onToggleSource: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onUploadFile: (file: File) => Promise<void>;
  onDeleteSource: (id: string) => void;
  onRetrySource: (id: string) => void;
  onOpenViewer: (id: string, page?: number) => void;
  onOpenAddSourceModal?: () => void;
}

export const SourcesSidebar: React.FC<SourcesSidebarProps> = ({
  responses = [],
  activeResponseId = null,
  onSelectResponse,
  onCreateResponse,
  onDeleteResponse,
  onViewSources,
  readinessScore,
  readinessStatus: _readinessStatus,
  sources,
  selectedSourceIds,
  isUploading,
  activeSourceId = null,
  evidenceSourceId = null,
  onSelectSource,
  onToggleSource,
  onSelectAll,
  onDeselectAll,
  onUploadFile,
  onDeleteSource,
  onRetrySource,
  onOpenViewer,
  onOpenAddSourceModal,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [isResponseDropdownOpen, setIsResponseDropdownOpen] = useState(false);
  const [sourceSearchFilter, setSourceSearchFilter] = useState("");

  const activeResponse = useMemo(() => {
    if (!responses || responses.length === 0) return null;
    return responses.find((r) => r.id === activeResponseId) || responses[0];
  }, [responses, activeResponseId]);

  useEffect(() => {
    if (!isResponseDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsResponseDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsResponseDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isResponseDropdownOpen]);

  const handleAddClick = () => {
    if (onOpenAddSourceModal) {
      onOpenAddSourceModal();
    } else {
      fileInputRef.current?.click();
    }
  };

  const filteredSources = useMemo(() => {
    if (!sourceSearchFilter.trim()) return sources;
    const q = sourceSearchFilter.toLowerCase();
    return sources.filter((s) => (s.filename || "").toLowerCase().includes(q));
  }, [sources, sourceSearchFilter]);

  return (
    <aside className="w-72 flex-shrink-0 flex flex-col bg-[var(--paper)] border-r border-[var(--hairline)] groundwork-col-sources min-w-0">
      {/* 1. Combined Response / Deliverable Selector */}
      <div
        className="p-3 border-b border-[var(--hairline)] bg-[var(--surface)] relative min-w-0"
        ref={dropdownRef}
      >
        <div className="flex items-center justify-between mb-1.5 min-w-0">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
            Response Deliverable
          </span>
          {responses.length > 1 && (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--paper-subtle)] text-[var(--ink-muted)] flex-shrink-0">
              {responses.length} responses
            </span>
          )}
        </div>

        {activeResponse ? (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setIsResponseDropdownOpen((prev) => !prev)}
              className={`w-full flex items-center justify-between p-2 rounded-[var(--radius-sm)] border text-left transition-all cursor-pointer group min-w-0 ${
                isResponseDropdownOpen
                  ? "border-[var(--ink-blue)] bg-[var(--paper)] shadow-[var(--shadow-subtle)] ring-1 ring-[var(--ink-blue)]"
                  : "border-[var(--hairline)] bg-[var(--paper)] hover:border-[var(--ink-secondary)] hover:bg-[var(--surface-hover)]"
              }`}
              title="Click to switch responses or create a new response"
              aria-expanded={isResponseDropdownOpen}
              aria-haspopup="listbox"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)]">
                  <FileText size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-xs text-[var(--ink)] truncate group-hover:text-[var(--ink-blue)] transition-colors">
                    {activeResponse.title || "Untitled response"}
                  </p>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--ink-muted)]">
                    <span>v{activeResponse.revision || 1}</span>
                    {readinessScore !== undefined && (
                      <>
                        <span>·</span>
                        <span
                          className={
                            readinessScore >= 80
                              ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                              : "text-amber-600 dark:text-amber-400 font-semibold"
                          }
                        >
                          {readinessScore}% ready
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <ChevronsUpDown
                size={14}
                className="text-[var(--ink-muted)] group-hover:text-[var(--ink)] shrink-0 ml-1.5 transition-transform"
              />
            </button>

            {/* Quick Actions Bar for Deliverable */}
            <div className="flex items-center gap-1.5 pt-0.5">
              {onViewSources && (
                <Button
                  variant="secondary"
                  size="xs"
                  className="flex-1 text-[11px] font-medium text-[var(--ink-blue)] hover:bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)]"
                  onClick={onViewSources}
                  title="View and read grounded research sources for this response"
                >
                  <BookOpen size={11} />
                  <span>View Sources</span>
                </Button>
              )}
              {onCreateResponse && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-[11px] text-[var(--ink-secondary)] hover:text-[var(--ink)]"
                  onClick={onCreateResponse}
                  title="Create another response deliverable"
                >
                  <Plus size={11} />
                  <span>New</span>
                </Button>
              )}
              {onDeleteResponse && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-6 w-6 p-0 text-[var(--ink-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-bg)]"
                  onClick={() => onDeleteResponse(activeResponse.id)}
                  title="Delete this response draft"
                  aria-label="Delete response"
                >
                  <Trash2 size={12} />
                </Button>
              )}
            </div>

            {/* Dropdown Menu */}
            {isResponseDropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-md)] shadow-[var(--shadow-popover)] overflow-hidden animate-in fade-in zoom-in-95">
                <div className="px-2.5 py-1.5 border-b border-[var(--hairline-subtle)] bg-[var(--paper-subtle)] flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                    Switch Response
                  </span>
                  <span className="text-[10px] font-mono text-[var(--ink-muted)]">
                    {responses.length} total
                  </span>
                </div>

                <div className="max-h-56 overflow-y-auto p-1 space-y-0.5" role="listbox">
                  {responses.map((resp) => {
                    const isCurrent = resp.id === activeResponse.id;
                    return (
                      <div
                        key={resp.id}
                        className={`w-full flex items-center justify-between p-1.5 rounded-[var(--radius-xs)] text-left text-xs transition-colors ${
                          isCurrent
                            ? "bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] font-medium"
                            : "text-[var(--ink)] hover:bg-[var(--surface-hover)]"
                        }`}
                        role="option"
                        aria-selected={isCurrent}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectResponse?.(resp.id);
                            setIsResponseDropdownOpen(false);
                          }}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <FileText
                            size={13}
                            className={`shrink-0 ${
                              isCurrent ? "text-[var(--ink-blue)]" : "text-[var(--ink-muted)]"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium">
                              {resp.title || "Untitled response"}
                            </p>
                            <p className="text-[10px] font-mono text-[var(--ink-muted)]">
                              v{resp.revision || 1}
                              {resp.updated_at
                                ? ` · ${formatDateTime(resp.updated_at)}`
                                : ""}
                            </p>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          {isCurrent && (
                            <Check
                              size={13}
                              className="text-[var(--ink-blue)] shrink-0"
                            />
                          )}
                          {onDeleteResponse && responses.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsResponseDropdownOpen(false);
                                onDeleteResponse(resp.id);
                              }}
                              className="p-1 text-[var(--ink-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-bg)] rounded transition-colors cursor-pointer"
                              title={`Delete ${resp.title}`}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {onCreateResponse && (
                  <div className="p-1 border-t border-[var(--hairline-subtle)] bg-[var(--paper-subtle)]">
                    <button
                      type="button"
                      onClick={() => {
                        setIsResponseDropdownOpen(false);
                        onCreateResponse();
                      }}
                      className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-xs)] text-xs font-semibold text-[var(--ink-blue)] hover:bg-[var(--ink-blue-subtle)] transition-colors cursor-pointer"
                    >
                      <Plus size={13} />
                      <span>New Response</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="p-2.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--hairline)] bg-[var(--paper-subtle)] text-center">
            <p className="text-xs text-[var(--ink-muted)] mb-2">No response drafted yet</p>
            {onCreateResponse && (
              <Button
                variant="secondary"
                size="xs"
                className="w-full text-xs text-[var(--ink-blue)]"
                onClick={onCreateResponse}
              >
                <Plus size={12} /> New Response
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 2. Sources Header */}
      <div className="p-3 border-b border-[var(--hairline)] flex items-center justify-between min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileText
            size={14}
            className="text-[var(--ink-blue)] flex-shrink-0"
          />
          <strong className="font-serif text-xs font-semibold text-[var(--ink)] truncate">
            Sources
          </strong>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--paper-subtle)] text-[var(--ink-muted)] flex-shrink-0">
            {sources.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {onViewSources && sources.length > 0 && (
            <button
              type="button"
              onClick={onViewSources}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-blue)] flex-shrink-0 cursor-pointer"
              title="Open reader and view sources"
            >
              <BookOpen size={12} />
              <span>View all</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleAddClick}
            className={`inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ink-blue)] hover:text-[var(--ink-blue-hover)] bg-[var(--ink-blue-subtle)] px-2 py-0.5 rounded flex-shrink-0 cursor-pointer ${
              isUploading ? "opacity-50 pointer-events-none" : ""
            }`}
            title="Add a source document, web URL, or notes"
          >
            <Plus size={12} />
            <span>{isUploading ? "Uploading…" : "Add"}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            disabled={isUploading}
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onUploadFile(file).catch(() => undefined);
                e.target.value = "";
              }
            }}
          />
        </div>
      </div>

      {/* Search Filter if sources >= 3 */}
      {sources.length >= 3 && (
        <div className="px-3 py-1.5 border-b border-[var(--hairline-subtle)]">
          <div className="relative flex items-center">
            <Search
              size={11}
              className="absolute left-2 text-[var(--ink-muted)] pointer-events-none"
            />
            <input
              type="text"
              placeholder="Filter sources…"
              value={sourceSearchFilter}
              onChange={(e) => setSourceSearchFilter(e.target.value)}
              className="w-full pl-6 pr-2 py-1 text-[11px] rounded-[var(--radius-xs)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)]"
            />
          </div>
        </div>
      )}

      {/* Source Context Scoping */}
      <div className="px-3 py-2 border-b border-[var(--hairline-subtle)] flex items-center justify-between text-[11px] text-[var(--ink-muted)] min-w-0">
        <span
          className="truncate"
          title={`${selectedSourceIds.length} of ${sources.length} sources active in context`}
        >
          {selectedSourceIds.length} active in context
        </span>
        <div className="flex items-center gap-1 font-mono flex-shrink-0 ml-1">
          <button
            type="button"
            onClick={onSelectAll}
            className="hover:text-[var(--ink)] cursor-pointer"
          >
            All
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={onDeselectAll}
            className="hover:text-[var(--ink)] cursor-pointer"
          >
            None
          </button>
        </div>
      </div>

      {/* Sources List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-w-0">
        {filteredSources.map((doc) => {
          const isSelected = selectedSourceIds.includes(doc.id);
          const isActive = activeSourceId === doc.id;
          const isEvidence = evidenceSourceId === doc.id;

          return (
            <div
              key={doc.id}
              className={`p-2 rounded-[var(--radius-sm)] border transition-all text-xs group flex items-start gap-2 min-w-0 relative ${
                isActive
                  ? "bg-[var(--surface)] border-[var(--ink-blue)] shadow-[var(--shadow-subtle)] ring-1 ring-[var(--ink-blue)]"
                  : isEvidence
                    ? "bg-amber-50/60 dark:bg-amber-950/30 border-amber-400 dark:border-amber-700 shadow-xs"
                    : isSelected
                      ? "bg-[var(--surface)] border-[var(--ink-blue-border)] shadow-[var(--shadow-subtle)]"
                      : "bg-transparent border-transparent hover:bg-[var(--surface-hover)]"
              }`}
            >
              <button
                type="button"
                onClick={() => onToggleSource(doc.id)}
                className="mt-0.5 text-[var(--ink-muted)] hover:text-[var(--ink-blue)] cursor-pointer flex-shrink-0"
                aria-label={`${isSelected ? "Exclude" : "Include"} ${doc.filename} in AI actions`}
              >
                {isSelected ? (
                  <CheckSquare size={13} className="text-[var(--ink-blue)]" />
                ) : (
                  <SquareOutline size={13} />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  onSelectSource?.(doc.id);
                  onOpenViewer(doc.id, 1);
                }}
                className="flex items-start gap-2 flex-1 min-w-0 text-left cursor-pointer group/title"
                title={`View and read ${doc.filename}`}
              >
                <div
                  className={`flex h-9 w-7 shrink-0 items-center justify-center rounded border bg-[var(--surface)] group-hover/title:border-[var(--ink-blue)] transition-colors ${
                    isActive
                      ? "border-[var(--ink-blue)] bg-[var(--ink-blue-subtle)]"
                      : isEvidence
                        ? "border-amber-400 bg-amber-100/50"
                        : "border-[var(--hairline)]"
                  }`}
                >
                  {getDocTypeIcon(doc)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p
                      className={`font-medium truncate text-xs select-text transition-colors ${
                        isActive
                          ? "text-[var(--ink-blue)] font-semibold"
                          : "text-[var(--ink)] group-hover/title:text-[var(--ink-blue)]"
                      }`}
                      title={doc.filename}
                    >
                      {doc.filename}
                    </p>
                  </div>

                  {isEvidence && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 px-1 py-0.2 rounded border border-amber-300 dark:border-amber-800">
                        <Sparkles size={8} /> Evidence source
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-[var(--ink-muted)] font-mono flex-wrap">
                    <span>
                      {doc.page_count ? `${doc.page_count} pgs` : "1 pg"}
                    </span>
                    {doc.status === "failed" ? (
                      <span className="text-[var(--danger)] flex items-center gap-0.5 truncate">
                        <AlertTriangle size={9} /> Failed
                      </span>
                    ) : ["processing", "uploaded", "extracting", "ocr_processing", "indexing"].includes(doc.status) ? (
                      <span className="text-amber-600 dark:text-amber-400 flex items-center gap-0.5 truncate">
                        <RefreshCw size={9} className="spin" /> Indexing
                      </span>
                    ) : (
                      <span className="text-emerald-700 dark:text-emerald-400 flex items-center gap-0.5 truncate font-semibold">
                        <Check size={9} /> Ready
                      </span>
                    )}
                    {doc.created_at && (
                      <span
                        title={`Uploaded: ${new Date(doc.created_at).toLocaleString()}`}
                        className="truncate text-[var(--ink-faint)]"
                      >
                        • {formatDateTime(doc.created_at)}
                      </span>
                    )}
                  </div>
                </div>
              </button>

              {/* Quick actions: View button, download original, retry and delete */}
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="secondary"
                  size="xs"
                  className="h-6 px-1.5 text-[10px] font-semibold text-[var(--ink-blue)] hover:bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] shadow-2xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSource?.(doc.id);
                    onOpenViewer(doc.id, 1);
                  }}
                  title={`View and read ${doc.filename}`}
                  aria-label={`View ${doc.filename}`}
                >
                  <BookOpen size={11} />
                  <span>View</span>
                </Button>

                <Button
                  variant="ghost"
                  size="xs"
                  className="h-6 w-6 p-0 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(`${API}/documents/${doc.id}/download`, "_blank");
                  }}
                  title="Download original"
                  aria-label={`Download ${doc.filename}`}
                >
                  <Download size={13} />
                </Button>

                {doc.status === "failed" && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-6 w-6 p-0 text-[var(--warning)] hover:text-[var(--ink)]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetrySource(doc.id);
                    }}
                    title="Retry processing"
                    aria-label={`Retry ${doc.filename}`}
                  >
                    <RefreshCw size={13} />
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="xs"
                  className="h-6 w-6 p-0 text-[var(--danger)] hover:bg-[var(--danger-bg)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSource(doc.id);
                  }}
                  title="Delete source"
                  aria-label={`Delete ${doc.filename}`}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          );
        })}

        {filteredSources.length === 0 && sources.length > 0 && (
          <div className="p-4 text-center text-xs text-[var(--ink-muted)]">
            <p>No sources match &ldquo;{sourceSearchFilter}&rdquo;</p>
            <button
              type="button"
              onClick={() => setSourceSearchFilter("")}
              className="mt-1 text-[var(--ink-blue)] hover:underline cursor-pointer"
            >
              Clear filter
            </button>
          </div>
        )}

        {sources.length === 0 && (
          <div className="p-4 text-center text-xs text-[var(--ink-muted)]">
            <Upload size={20} className="mx-auto mb-1 opacity-50" />
            <p className="font-medium text-[var(--ink)]">Add source documents</p>
            <p className="mt-1 leading-relaxed">
              Add reference PDFs, notes, or research papers here to ground the
              AI assistant and cite verified evidence.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
};

export default SourcesSidebar;
