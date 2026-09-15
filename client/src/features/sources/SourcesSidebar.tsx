import React from "react";
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
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { API, formatDateTime } from "../../api/client";
import type { DocumentItem } from "../../types";

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
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const handleAddClick = () => {
    if (onOpenAddSourceModal) {
      onOpenAddSourceModal();
    } else {
      fileInputRef.current?.click();
    }
  };

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-[var(--paper)] border-r border-[var(--hairline)] groundwork-col-sources min-w-0">
      {/* Header */}
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

        <div className="flex items-center">
          <button
            type="button"
            onClick={handleAddClick}
            className={`inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ink-blue)] hover:text-[var(--ink-blue-hover)] flex-shrink-0 cursor-pointer ${
              isUploading ? "opacity-50 pointer-events-none" : ""
            }`}
            title="Add a source document, web URL, or notes"
          >
            <Plus size={13} />
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

      {/* Source selection */}
      <div className="px-3 py-2 border-b border-[var(--hairline-subtle)] flex items-center justify-between text-[11px] text-[var(--ink-muted)] min-w-0">
        <span
          className="truncate"
          title={`${selectedSourceIds.length} of ${sources.length} sources active in context`}
        >
          {selectedSourceIds.length} active in context
        </span>
        <div className="flex items-center gap-1 font-mono flex-shrink-0 ml-1">
          <button
            onClick={onSelectAll}
            className="hover:text-[var(--ink)] cursor-pointer"
          >
            All
          </button>
          <span>·</span>
          <button
            onClick={onDeselectAll}
            className="hover:text-[var(--ink)] cursor-pointer"
          >
            None
          </button>
        </div>
      </div>

      {/* Sources List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-w-0">
        {sources.map((doc) => {
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
                title={`View ${doc.filename}`}
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

              {/* Quick actions: download original, retry and delete */}
              <div className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-6 w-6 p-0 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  onClick={() =>
                    window.open(`${API}/documents/${doc.id}/download`, "_blank")
                  }
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
                    onClick={() => onRetrySource(doc.id)}
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
                  onClick={() => onDeleteSource(doc.id)}
                  title="Delete source"
                  aria-label={`Delete ${doc.filename}`}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          );
        })}

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
