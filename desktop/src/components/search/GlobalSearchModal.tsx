import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  FileCode,
  FileText,
  File,
  ExternalLink,
  FolderOpen,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "../../services/api";
import type {
  Project,
  SearchResponse,
  SearchResultItem,
} from "../../types/api";
import { Button, Badge, EmptyState } from "../ui";

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
  const [mode, setMode] = useState<
    "hybrid" | "lexical" | "semantic" | "filename"
  >("hybrid");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [category, setCategory] = useState<"files" | "projects" | "git">(
    "files",
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [commits, setCommits] = useState<
    Awaited<ReturnType<typeof api.getGitCommits>>
  >([]);
  const [error, setError] = useState("");
  const [fileType, setFileType] = useState("");
  const [recentOnly, setRecentOnly] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("groundwork.recentQueries") || "[]",
      );
    } catch {
      return [];
    }
  });

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const nodes = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input,select,[tabindex="0"]',
        ) || [],
      ).filter((node) => node.getClientRects().length > 0);
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    dialogRef.current
      ?.querySelector(`[data-result-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    let cancelled = false;
    if (!isOpen) {
      setResults([]);
      setDuration(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        if (category === "projects") {
          const data = await api.listProjects();
          if (!cancelled)
            setProjects(
              data.filter((project) =>
                `${project.name} ${project.path} ${project.detected_type}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              ),
            );
          return;
        }
        if (category === "git") {
          const data = await api.getGitCommits(
            query,
            selectedProjectId || undefined,
          );
          if (!cancelled) setCommits(data);
          return;
        }
        const resp: SearchResponse = await api.searchWorkspace(
          query,
          query.trim() ? mode : "filename",
          selectedProjectId || undefined,
          25,
          fileType || undefined,
          recentOnly ? Date.now() / 1000 - 7 * 86400 : undefined,
        );
        if (cancelled) return;
        setResults(
          resp.results.filter(
            (item) =>
              (!fileType || item.file_type === fileType) &&
              (!recentOnly ||
                (item.last_modified &&
                  Date.now() - Date.parse(item.last_modified) < 7 * 86400000)),
          ),
        );
        setDuration(resp.duration_ms);
        setSelectedIndex(0);
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, mode, selectedProjectId, isOpen, category, fileType, recentOnly]);

  const rememberQuery = () => {
    if (!query.trim()) return;
    const next = [
      query.trim(),
      ...recentQueries.filter((item) => item !== query.trim()),
    ].slice(0, 8);
    setRecentQueries(next);
    localStorage.setItem("groundwork.recentQueries", JSON.stringify(next));
  };

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
    } else if (
      e.key === "Enter" &&
      category === "files" &&
      results[selectedIndex]
    ) {
      e.preventDefault();
      rememberQuery();
      api
        .openFile(results[selectedIndex].path)
        .catch((err) => setError(String(err)));
    }
  };

  if (!isOpen) return null;

  const getFileIcon = (fileType: string) => {
    if (fileType === "code")
      return <FileCode className="w-4 h-4 text-[var(--ink-blue)] shrink-0" />;
    if (fileType === "document")
      return <FileText className="w-4 h-4 text-[var(--ink-sepia)] shrink-0" />;
    return <File className="w-4 h-4 text-[var(--ink-muted)] shrink-0" />;
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-start justify-center pt-16 px-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search your files"
        className="w-full max-w-5xl bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-[var(--radius-lg)] shadow-[var(--shadow-modal)] overflow-hidden flex flex-col max-h-[82vh] animate-in fade-in zoom-in-95 duration-100"
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
            aria-label="Search your files"
            placeholder={`Search ${category}...`}
            className="w-full bg-transparent text-sm text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none font-sans"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-[var(--ink-blue)] border-t-transparent rounded-full animate-spin mr-2 shrink-0" />
          )}
          <Button
            variant="ghost"
            size="xs"
            onClick={onClose}
            className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            <X size={16} />
          </Button>
        </div>

        {/* Mode Selector & Meta */}
        <div className="px-4 py-2 flex items-center gap-3 border-b border-[var(--hairline)] text-xs">
          {(["files", "projects", "git"] as const).map((item) => (
            <button
              key={item}
              onClick={() => {
                setCategory(item);
                setSelectedIndex(0);
              }}
              className={`capitalize cursor-pointer ${category === item ? "text-[var(--ink-blue)] font-bold" : "text-[var(--ink-muted)]"}`}
            >
              {item}
            </button>
          ))}
          {category === "files" && (
            <>
              <select
                aria-label="File type"
                value={fileType}
                onChange={(event) => setFileType(event.target.value)}
                className="ml-auto bg-transparent"
              >
                <option value="">All file types</option>
                <option value="code">Code</option>
                <option value="document">Documents</option>
                <option value="text">Text</option>
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={recentOnly}
                  onChange={(event) => setRecentOnly(event.target.checked)}
                />{" "}
                Last 7 days
              </label>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="px-4 py-2 text-xs text-[var(--danger)]">
            {error}
          </p>
        )}
        {!query.trim() && recentQueries.length > 0 && (
          <div className="p-4 space-y-2">
            <p className="text-xs text-[var(--ink-muted)]">Recent searches</p>
            {recentQueries.map((item) => (
              <button
                key={item}
                onClick={() => setQuery(item)}
                className="block text-sm text-[var(--ink-blue)]"
              >
                {item}
              </button>
            ))}
          </div>
        )}
        {category !== "files" && (
          <div className="p-4 space-y-3 overflow-auto">
            {category === "projects" &&
              projects.map((project) => (
                <div
                  key={project.id}
                  className="border-b border-[var(--hairline)] pb-3"
                >
                  <p className="font-serif font-bold">
                    {project.name} <Badge>{project.detected_type}</Badge>
                  </p>
                  <p className="text-xs font-mono text-[var(--ink-muted)]">
                    {project.path}
                  </p>
                  <Button
                    size="xs"
                    onClick={() => {
                      rememberQuery();
                      api
                        .openFolder(project.path)
                        .catch((err) => setError(String(err)));
                    }}
                  >
                    Open project
                  </Button>
                </div>
              ))}
            {category === "git" &&
              commits.map((commit) => (
                <div
                  key={commit.hash}
                  className="border-b border-[var(--hairline)] pb-3"
                >
                  <p className="text-sm">{commit.message}</p>
                  <p className="text-xs font-mono text-[var(--ink-muted)]">
                    {commit.short_hash} · {commit.project_name} ·{" "}
                    {commit.author} · {new Date(commit.date).toLocaleString()}
                  </p>
                </div>
              ))}
            {query.trim() &&
              !loading &&
              !(category === "projects" ? projects.length : commits.length) && (
                <p className="text-sm text-[var(--ink-muted)]">
                  No matching {category} found.
                </p>
              )}
          </div>
        )}
        {category === "files" && (
          <>
            <div className="px-4 py-2 bg-[var(--paper-subtle)] border-b border-[var(--hairline)] flex items-center justify-between text-xs text-[var(--ink-secondary)]">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[var(--ink-muted)] font-mono font-bold mr-1">
                  RETRIEVAL:
                </span>
                {(["hybrid", "lexical", "semantic", "filename"] as const).map(
                  (m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`px-2 py-0.5 rounded-[var(--radius-xs)] text-sm capitalize transition-all font-mono font-semibold cursor-pointer ${
                        mode === m
                          ? "bg-[var(--control-room)] text-white shadow-[var(--shadow-subtle)]"
                          : "hover:bg-[var(--surface-hover)] text-[var(--ink-secondary)]"
                      }`}
                    >
                      {m}
                    </button>
                  ),
                )}
              </div>
              {duration !== null && (
                <span className="text-sm font-mono text-[var(--ink-muted)]">
                  {results.length} matches in {duration} ms
                </span>
              )}
            </div>

            <div className="flex flex-1 min-h-0">
              {/* Search Results List */}
              <div className="overflow-y-auto flex-1 divide-y divide-[var(--hairline-subtle)] p-1 bg-[var(--surface)]">
                {results.length === 0 && !loading && (
                  <EmptyState
                    icon={<Search size={28} />}
                    title={
                      query.trim()
                        ? "No matching files found"
                        : "What are you looking for?"
                    }
                    description={
                      query.trim()
                        ? "Try adjusting terms, switching to lexical mode, or indexing additional directories."
                        : "Type code tokens, class names, or plain-English concepts to locate scattered work."
                    }
                    compact
                  />
                )}

                {results.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      data-result-index={idx}
                      key={item.file_id + idx}
                      onClick={() => {
                        setSelectedIndex(idx);
                        rememberQuery();
                      }}
                      className={`p-3 rounded-[var(--radius-sm)] cursor-pointer transition-all group ${
                        isSelected
                          ? "bg-[var(--surface-hover)] border border-[var(--ink-blue)] shadow-[var(--shadow-subtle)]"
                          : "hover:bg-[var(--surface-hover)] border border-transparent"
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
                            <Badge variant="human" className="font-mono">
                              L{item.line_number}
                            </Badge>
                          )}
                          {item.project_name && (
                            <Badge variant="neutral">{item.project_name}</Badge>
                          )}
                        </div>

                        {/* Score Breakdown Badge */}
                        <Badge variant="success" className="font-mono">
                          Rank {idx + 1}
                        </Badge>
                      </div>

                      {/* Relative Path */}
                      <p className="text-sm font-mono text-[var(--ink-muted)] mb-2 truncate">
                        {item.path}
                      </p>

                      <p className="text-xs text-[var(--ink-secondary)] line-clamp-2 font-mono">
                        {item.snippet}
                      </p>
                    </div>
                  );
                })}
              </div>

              {results[selectedIndex] && (
                <aside className="hidden md:flex w-[44%] shrink-0 flex-col border-l border-[var(--hairline)] bg-[var(--paper)] p-4 overflow-y-auto gap-3">
                  <p className="text-xs font-mono uppercase tracking-widest text-[var(--ink-blue)]">
                    Selected evidence
                  </p>
                  <h2 className="font-serif font-bold text-lg">
                    {results[selectedIndex].filename}
                  </h2>
                  <p className="font-mono text-xs text-[var(--ink-muted)] break-all">
                    {results[selectedIndex].relative_path}
                    {results[selectedIndex].line_number
                      ? `:${results[selectedIndex].line_number}`
                      : ""}
                  </p>
                  <pre className="whitespace-pre-wrap break-words text-xs font-mono leading-relaxed border border-[var(--hairline)] rounded bg-[var(--surface)] p-3">
                    {results[selectedIndex].snippet}
                  </pre>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="xs"
                      variant="primary"
                      onClick={() =>
                        api
                          .openFile(results[selectedIndex].path)
                          .catch((error) => alert(String(error)))
                      }
                    >
                      <ExternalLink size={12} />
                      Open file
                    </Button>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() =>
                        api
                          .revealFile(results[selectedIndex].path)
                          .catch((error) => alert(String(error)))
                      }
                    >
                      <FolderOpen size={12} />
                      Reveal
                    </Button>
                    {onAskAIWithContext && (
                      <Button
                        size="xs"
                        variant="agent"
                        onClick={() =>
                          onAskAIWithContext(query, results[selectedIndex])
                        }
                      >
                        <Sparkles size={12} />
                        Ask about this file
                      </Button>
                    )}
                  </div>
                  <details className="text-xs text-[var(--ink-muted)]">
                    <summary>Ranking details</summary>
                    <pre className="mt-2 font-mono">
                      {JSON.stringify(
                        results[selectedIndex].score_breakdown,
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </aside>
              )}
            </div>

            {/* Footer Shortcut Help */}
          </>
        )}
        <div className="px-4 py-2 border-t border-[var(--hairline)] bg-[var(--paper-subtle)] flex items-center justify-between text-sm text-[var(--ink-muted)]">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 rounded bg-[var(--surface)] border border-[var(--hairline)] font-mono text-xs text-[var(--ink)]">
                ↑↓
              </kbd>{" "}
              Navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-[var(--surface)] border border-[var(--hairline)] font-mono text-xs text-[var(--ink)]">
                Enter
              </kbd>{" "}
              Open
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-[var(--surface)] border border-[var(--hairline)] font-mono text-xs text-[var(--ink)]">
                Esc
              </kbd>{" "}
              Close
            </span>
          </div>
          <span className="text-[var(--ink-muted)]">
            Searching on this computer
          </span>
        </div>
      </div>
    </div>
  );
};
export default GlobalSearchModal;
