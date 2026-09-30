import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  FileCode,
  FileText,
  File,
  ExternalLink,
  FolderOpen,
  Sparkles,
  BookmarkPlus,
  X,
  Layers,
} from "lucide-react";
import { api } from "../../services/api";
import type { SearchResponse, SearchResultItem } from "../../types/api";

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProjectId: string | null;
  onAskAIWithContext?: (query: string, file: SearchResultItem) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  selectedProjectId,
  onAskAIWithContext,
}) => {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"hybrid" | "lexical" | "semantic" | "filename">("hybrid");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setDuration(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const resp: SearchResponse = await api.searchWorkspace(
          query,
          mode,
          selectedProjectId || undefined,
          20
        );
        setResults(resp.results);
        setDuration(resp.duration_ms);
        setSelectedIndex(0);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query, mode, selectedProjectId]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      api.openFile(results[selectedIndex].path);
    }
  };

  if (!isOpen) return null;

  const getFileIcon = (fileType: string) => {
    if (fileType === "code") return <FileCode className="w-4 h-4 text-[var(--ink-blue)] shrink-0" />;
    if (fileType === "document") return <FileText className="w-4 h-4 text-[var(--ink-sepia)] shrink-0" />;
    return <File className="w-4 h-4 text-[var(--ink-muted)] shrink-0" />;
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-start justify-center pt-20"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg shadow-[var(--shadow-modal)] overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Bar Input */}
        <div className="flex items-center px-4 py-3.5 border-b border-[var(--hairline)] bg-[var(--surface)]">
          <Search className="w-5 h-5 text-[var(--ink-blue)] mr-3 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code, files, symbols, Git, or notes (e.g. 'PostgreSQL migration')..."
            className="w-full bg-transparent text-sm text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none font-sans"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-[var(--ink-blue)] border-t-transparent rounded-full animate-spin mr-2 shrink-0" />
          )}
          <button onClick={onClose} className="text-[var(--ink-muted)] hover:text-[var(--ink)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Selector & Meta */}
        <div className="px-4 py-2 bg-[var(--paper-subtle)] border-b border-[var(--hairline)] flex items-center justify-between text-xs text-[var(--ink-secondary)]">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--ink-muted)] font-mono font-bold mr-1">MODE:</span>
            {(["hybrid", "lexical", "semantic", "filename"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 rounded text-[11px] capitalize transition-colors font-mono font-bold ${
                  mode === m
                    ? "bg-[var(--control-room)] text-white"
                    : "hover:bg-[var(--surface-hover)] text-[var(--ink-secondary)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {duration !== null && (
            <span className="text-[11px] font-mono text-[var(--ink-muted)]">
              {results.length} results ({duration} ms)
            </span>
          )}
        </div>

        {/* Search Results List */}
        <div className="overflow-y-auto flex-1 divide-y divide-[var(--hairline-subtle)] p-1 bg-[var(--surface)]">
          {results.length === 0 && !loading && (
            <div className="py-16 text-center text-[var(--ink-muted)] text-xs">
              {query.trim()
                ? "No matching files or symbols found in workspace."
                : "Type keywords to search across files, code AST, and Git history."}
            </div>
          )}

          {results.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={item.file_id + idx}
                onClick={() => setSelectedIndex(idx)}
                className={`p-3 rounded cursor-pointer transition-colors group ${
                  isSelected ? "bg-[var(--surface-hover)] border border-[var(--ink-blue)] shadow-xs" : "hover:bg-[var(--surface-hover)] border border-transparent"
                }`}
              >
                {/* Result Header */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {getFileIcon(item.file_type)}
                    <span className="font-serif font-bold text-sm text-[var(--ink)] truncate">
                      {item.filename}
                    </span>
                    {item.line_number && (
                      <span className="text-[11px] font-mono text-[var(--ink-blue)] bg-[var(--ink-blue-subtle)] px-1.5 py-0.2 rounded border border-[var(--ink-blue-border)] font-bold">
                        line {item.line_number}
                      </span>
                    )}
                    {item.project_name && (
                      <span className="text-[10px] text-[var(--ink-secondary)] bg-[var(--paper-subtle)] px-1.5 py-0.2 rounded border border-[var(--hairline)] font-mono">
                        {item.project_name}
                      </span>
                    )}
                  </div>

                  {/* Score Breakdown Badge */}
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--ink-muted)] shrink-0">
                    <span className="text-[var(--success)] font-bold">
                      {Math.round(item.score * 100)}% match
                    </span>
                  </div>
                </div>

                {/* Relative Path */}
                <p className="text-[11px] font-mono text-[var(--ink-muted)] mb-2 truncate">
                  {item.path}
                </p>

                {/* Snippet Preview */}
                <div className="bg-[var(--paper)] border border-[var(--hairline)] rounded p-2.5 font-mono text-xs text-[var(--ink)] overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {item.snippet}
                </div>

                {/* Quick Action Toolbar on Selected */}
                <div className="mt-2.5 flex items-center justify-between text-xs pt-1 border-t border-[var(--hairline-subtle)]">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        api.openFile(item.path);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--control-room)] hover:bg-[var(--control-room-hover)] text-white transition-colors text-[11px] font-semibold"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open File
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        api.revealFile(item.path);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--paper-subtle)] hover:bg-[var(--surface-active)] text-[var(--ink)] border border-[var(--hairline)] transition-colors text-[11px] font-medium"
                    >
                      <FolderOpen className="w-3 h-3" />
                      Reveal in Explorer
                    </button>
                    {onAskAIWithContext && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAskAIWithContext(query, item);
                          onClose();
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--ink-blue-subtle)] hover:bg-[var(--ink-blue-border)] border border-[var(--ink-blue-border)] text-[var(--ink-blue)] text-[11px] font-semibold"
                      >
                        <Sparkles className="w-3 h-3 text-[var(--ink-blue)]" />
                        Ask AI About This
                      </button>
                    )}
                  </div>

                  <span className="text-[10px] text-[var(--ink-muted)] font-mono">
                    Lex: {(item.score_breakdown.lexical * 100).toFixed(0)}% • Sem:{" "}
                    {(item.score_breakdown.semantic * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Shortcut Help */}
        <div className="px-4 py-2 border-t border-[var(--hairline)] bg-[var(--paper-subtle)] flex items-center justify-between text-[11px] text-[var(--ink-muted)]">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 rounded bg-[var(--surface)] border border-[var(--hairline)] font-mono text-[10px] text-[var(--ink)]">
                ↑↓
              </kbd>{" "}
              Navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-[var(--surface)] border border-[var(--hairline)] font-mono text-[10px] text-[var(--ink)]">
                Enter
              </kbd>{" "}
              Open
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-[var(--surface)] border border-[var(--hairline)] font-mono text-[10px] text-[var(--ink)]">
                Esc
              </kbd>{" "}
              Close
            </span>
          </div>
          <span className="text-[var(--ink-muted)] font-mono">Groundwork Hybrid Engine</span>
        </div>
      </div>
    </div>
  );
};
