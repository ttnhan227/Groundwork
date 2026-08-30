import React, { useState } from "react";
import {
  FileText,
  CheckSquare,
  Square as SquareOutline,
  Eye,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Check,
  Upload,
  Plus,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { API } from "../../api/client";
import type { DocumentItem } from "../../types";

export interface SourcesSidebarProps {
  sources: DocumentItem[];
  selectedSourceIds: string[];
  isUploading: boolean;
  onToggleSource: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onUploadFile: (file: File) => Promise<void>;
  onDeleteSource: (id: string) => void;
  onRetrySource: (id: string) => void;
  onOpenViewer: (id: string, page?: number) => void;
}

export const SourcesSidebar: React.FC<SourcesSidebarProps> = ({
  sources,
  selectedSourceIds,
  isUploading,
  onToggleSource,
  onSelectAll,
  onDeselectAll,
  onUploadFile,
  onDeleteSource,
  onRetrySource,
  onOpenViewer,
}) => {
  return (
    <aside className="w-64 flex-shrink-0 flex flex-col bg-[var(--paper)] border-r border-[var(--hairline)] select-none groundwork-col-sources min-w-0">
      {/* Header */}
      <div className="p-3 border-b border-[var(--hairline)] flex items-center justify-between min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileText
            size={14}
            className="text-[var(--ink-blue)] flex-shrink-0"
          />
          <strong className="font-serif text-xs font-semibold text-[var(--ink)] truncate">
            Evidence Sources
          </strong>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--paper-subtle)] text-[var(--ink-muted)] flex-shrink-0">
            {sources.length}
          </span>
        </div>

        <label
          className={`cursor-pointer inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ink-blue)] hover:text-[var(--ink-blue-hover)] flex-shrink-0 ${
            isUploading ? "opacity-50 pointer-events-none" : ""
          }`}
          title="Upload new source document"
        >
          <Plus size={13} />
          <span>{isUploading ? "Uploading…" : "Add"}</span>
          <input
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
        </label>
      </div>

      {/* Grounding Toggle Bar */}
      <div className="px-3 py-2 border-b border-[var(--hairline-subtle)] flex items-center justify-between text-[11px] text-[var(--ink-muted)] min-w-0">
        <span className="truncate">
          {selectedSourceIds.length} active in grounding
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

          return (
            <div
              key={doc.id}
              className={`p-2 rounded-[var(--radius-sm)] border transition-all text-xs group flex items-start gap-2 min-w-0 ${
                isSelected
                  ? "bg-[var(--surface)] border-[var(--ink-blue-border)] shadow-[var(--shadow-subtle)]"
                  : "bg-transparent border-transparent hover:bg-[var(--surface-hover)]"
              }`}
            >
              <button
                type="button"
                onClick={() => onToggleSource(doc.id)}
                className="mt-0.5 text-[var(--ink-muted)] hover:text-[var(--ink-blue)] cursor-pointer flex-shrink-0"
              >
                {isSelected ? (
                  <CheckSquare size={13} className="text-[var(--ink-blue)]" />
                ) : (
                  <SquareOutline size={13} />
                )}
              </button>

              {/* Document Cover Thumbnail */}
              <img
                src={
                  doc.filename.toLowerCase().includes("rfp") ||
                  doc.filename.toLowerCase().includes("horizon")
                    ? "/doc-dod-rfp.jpg"
                    : doc.filename.toLowerCase().includes("security") ||
                        doc.filename.toLowerCase().includes("soc")
                      ? "/doc-audit-soc2.jpg"
                      : "/doc-sec-10k.jpg"
                }
                alt="Doc Cover"
                className="w-7 h-9 object-cover rounded shadow-xs border border-[var(--hairline)] shrink-0 bg-white"
              />

              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => onToggleSource(doc.id)}
              >
                <p
                  className="font-medium text-[var(--ink)] truncate text-xs"
                  title={doc.filename}
                >
                  {doc.filename}
                </p>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[var(--ink-muted)] font-mono">
                  <span>
                    {doc.page_count ? `${doc.page_count} pgs` : "1 pg"}
                  </span>
                  {doc.status === "failed" ? (
                    <span className="text-[var(--danger)] flex items-center gap-0.5 truncate">
                      <AlertTriangle size={9} /> Failed
                    </span>
                  ) : doc.status === "processing" ? (
                    <span className="text-[var(--warning)] flex items-center gap-0.5 truncate">
                      <RefreshCw size={9} className="spin" /> Indexing
                    </span>
                  ) : (
                    <span className="text-[var(--success)] flex items-center gap-0.5 truncate font-semibold">
                      <Check size={9} /> Grounded
                    </span>
                  )}
                </div>
              </div>

              {/* Actions on Hover */}
              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity flex-shrink-0">
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-5 w-5 p-0 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  onClick={() => onOpenViewer(doc.id, 1)}
                  title="Inspect document in viewer"
                >
                  <Eye size={12} />
                </Button>

                <Button
                  variant="ghost"
                  size="xs"
                  className="h-5 w-5 p-0 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  onClick={() =>
                    window.open(`${API}/documents/${doc.id}/download`, "_blank")
                  }
                  title="Download original"
                  aria-label="Download original"
                >
                  <FileText size={12} />
                </Button>

                {doc.status === "failed" && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-5 w-5 p-0 text-[var(--warning)] hover:text-[var(--ink)]"
                    onClick={() => onRetrySource(doc.id)}
                    title="Retry processing"
                  >
                    <RefreshCw size={12} />
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="xs"
                  className="h-5 w-5 p-0 text-[var(--danger)] hover:bg-[var(--danger-bg)]"
                  onClick={() => onDeleteSource(doc.id)}
                  title="Delete source"
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
          );
        })}

        {sources.length === 0 && (
          <div className="p-4 text-center text-xs text-[var(--ink-faint)]">
            <Upload size={20} className="mx-auto mb-1 opacity-50" />
            <p>No source documents attached yet.</p>
          </div>
        )}
      </div>
    </aside>
  );
};

export default SourcesSidebar;
