import React, { useEffect, useState } from "react";
import {
  BookmarkCheck,
  Plus,
  Play,
  Pause,
  CheckCircle2,
  FileCode,
  ListTodo,
  Clock,
  Folder,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { api } from "../../services/api";
import type { ContextSession, Project } from "../../types/api";

interface ContextSessionsViewProps {
  selectedProjectId: string | null;
}

export const ContextSessionsView: React.FC<ContextSessionsViewProps> = ({
  selectedProjectId,
}) => {
  const [sessions, setSessions] = useState<ContextSession[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  // New session form
  const [newTitle, setNewTitle] = useState<string>("");
  const [newSummary, setNewSummary] = useState<string>("");
  const [newProjectId, setNewProjectId] = useState<string>("");

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const [sessionData, projectData] = await Promise.all([
        api.listSessions(selectedProjectId || undefined),
        api.listProjects(),
      ]);
      setSessions(sessionData);
      setProjects(projectData);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [selectedProjectId]);

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      await api.createSession(
        newTitle.trim(),
        newProjectId || undefined,
        newSummary.trim() || undefined
      );
      setNewTitle("");
      setNewSummary("");
      setNewProjectId("");
      setShowCreateModal(false);
      fetchSessions();
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  };

  const handleUpdateStatus = async (
    id: string,
    newStatus: "active" | "paused" | "completed"
  ) => {
    try {
      await api.updateSession(id, { status: newStatus });
      fetchSessions();
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const handleToggleTodo = async (
    session: ContextSession,
    todoIndex: number
  ) => {
    const todos = [...session.todos];
    const current = todos[todoIndex];
    if (current.startsWith("[x] ")) {
      todos[todoIndex] = current.replace("[x] ", "[ ] ");
    } else if (current.startsWith("[ ] ")) {
      todos[todoIndex] = current.replace("[ ] ", "[x] ");
    } else {
      todos[todoIndex] = `[x] ${current}`;
    }

    try {
      await api.updateSession(session.id, { todos });
      fetchSessions();
    } catch (err) {
      console.error("Failed to toggle todo:", err);
    }
  };

  const filteredSessions = sessions.filter((s) => {
    if (statusFilter === "all") return true;
    return s.status === statusFilter;
  });

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--paper)] text-[var(--ink)] font-sans w-full">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-[var(--hairline)]">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)] mb-1">
            Working Memory
          </p>
          <h1 className="text-xl font-serif font-bold tracking-tight text-[var(--ink)] flex items-center gap-2">
            <BookmarkCheck className="w-5 h-5 text-[var(--ink-blue)]" />
            Resume Work &amp; Context Sessions
          </h1>
          <p className="text-xs text-[var(--ink-secondary)] mt-1">
            "Continue where I left off" — Re-hydrate state, inspected files, notes, and task checklists.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Status Filter */}
          <div className="flex items-center bg-[var(--surface)] p-1 rounded border border-[var(--hairline)] text-xs">
            {["all", "active", "paused", "completed"].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded capitalize text-xs transition-colors font-mono font-bold ${
                  statusFilter === st
                    ? "bg-[var(--control-room)] text-white"
                    : "text-[var(--ink-secondary)] hover:text-[var(--ink)]"
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--control-room)] hover:bg-[var(--control-room-hover)] text-white text-xs font-semibold transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>
        </div>
      </div>

      {/* Sessions Grid / List */}
      {loading ? (
        <div className="text-center py-16 text-[var(--ink-muted)] text-xs">
          Loading context sessions...
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="text-center py-16 text-[var(--ink-muted)] text-xs bg-[var(--surface)] rounded border border-[var(--hairline)]">
          <BookmarkCheck className="w-8 h-8 text-[var(--ink-faint)] mx-auto mb-2 opacity-50" />
          No context sessions found. Click "New Session" to capture your current working memory!
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredSessions.map((session) => {
            const isExpanded = expandedSessionId === session.id;
            const completedTodos = session.todos.filter((t) => t.startsWith("[x] ")).length;

            return (
              <div
                key={session.id}
                className="bg-[var(--surface)] border border-[var(--hairline)] hover:border-[var(--ink-blue)] rounded p-4 transition-all shadow-xs"
              >
                {/* Header Row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-serif font-bold text-[var(--ink)]">
                        {session.title}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                          session.status === "active"
                            ? "bg-[var(--success-bg)] text-[var(--success)] border border-[var(--success-border)]"
                            : session.status === "paused"
                            ? "bg-[var(--warning-bg)] text-[var(--warning)] border border-[var(--warning-border)]"
                            : "bg-[var(--paper-subtle)] text-[var(--ink-muted)] border border-[var(--hairline)]"
                        }`}
                      >
                        {session.status}
                      </span>
                      {session.project_name && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-[var(--paper-subtle)] text-[var(--ink-secondary)] border border-[var(--hairline)] font-mono">
                          <Folder className="w-3 h-3 text-[var(--ink-blue)]" />
                          {session.project_name}
                        </span>
                      )}
                    </div>

                    {session.summary && (
                      <p className="text-xs text-[var(--ink-secondary)] leading-relaxed mt-1">
                        {session.summary}
                      </p>
                    )}
                  </div>

                  {/* Actions & Status toggles */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {session.status !== "active" ? (
                      <button
                        onClick={() => handleUpdateStatus(session.id, "active")}
                        title="Resume Session"
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--success-bg)] hover:bg-[var(--success-border)] text-[var(--success)] border border-[var(--success-border)] text-xs font-bold"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        Resume
                      </button>
                    ) : (
                      <button
                        onClick={() => handleUpdateStatus(session.id, "paused")}
                        title="Pause Session"
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--warning-bg)] hover:bg-[var(--warning-border)] text-[var(--warning)] border border-[var(--warning-border)] text-xs font-bold"
                      >
                        <Pause className="w-3 h-3" />
                        Pause
                      </button>
                    )}

                    {session.status !== "completed" && (
                      <button
                        onClick={() => handleUpdateStatus(session.id, "completed")}
                        title="Complete Session"
                        className="p-1 rounded bg-[var(--paper-subtle)] hover:bg-[var(--surface-active)] text-[var(--ink-secondary)] hover:text-[var(--success)] border border-[var(--hairline)]"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      onClick={() =>
                        setExpandedSessionId(isExpanded ? null : session.id)
                      }
                      className="p-1 rounded bg-[var(--paper-subtle)] hover:bg-[var(--surface-active)] text-[var(--ink-secondary)] border border-[var(--hairline)]"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Quick Info Bar */}
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[var(--hairline)] text-[11px] text-[var(--ink-secondary)]">
                  <span className="flex items-center gap-1 font-mono">
                    <FileCode className="w-3.5 h-3.5 text-[var(--ink-blue)]" />
                    {session.files_inspected.length} inspected files
                  </span>
                  {session.todos.length > 0 && (
                    <span className="flex items-center gap-1 font-mono">
                      <ListTodo className="w-3.5 h-3.5 text-[var(--ink-sepia)]" />
                      {completedTodos}/{session.todos.length} tasks done
                    </span>
                  )}
                  <span className="flex items-center gap-1 font-mono text-[var(--ink-muted)] ml-auto">
                    <Clock className="w-3 h-3" />
                    Last active: {new Date(session.last_active_at).toLocaleDateString()}
                  </span>
                </div>

                {/* Expanded Details Drawer */}
                {isExpanded && (
                  <div className="mt-4 pt-3 border-t border-[var(--hairline)] space-y-4">
                    {/* Inspected Files List */}
                    {session.files_inspected.length > 0 && (
                      <div>
                        <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--ink)] block mb-1.5">
                          Files Under Investigation
                        </span>
                        <div className="space-y-1">
                          {session.files_inspected.map((file) => (
                            <div
                              key={file}
                              onClick={() => api.openFile(file)}
                              className="flex items-center justify-between px-2.5 py-1 rounded bg-[var(--paper)] border border-[var(--hairline)] hover:border-[var(--ink-blue)] text-xs text-[var(--ink)] hover:text-[var(--ink-blue)] cursor-pointer font-mono group"
                            >
                              <span className="truncate">{file}</span>
                              <ExternalLink className="w-3 h-3 text-[var(--ink-muted)] group-hover:text-[var(--ink-blue)] shrink-0 ml-2" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Todos Checklist */}
                    {session.todos.length > 0 && (
                      <div>
                        <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--ink)] block mb-1.5">
                          Task Checklist
                        </span>
                        <div className="space-y-1.5">
                          {session.todos.map((todo, idx) => {
                            const isDone = todo.startsWith("[x] ");
                            const cleanText = todo.replace(/^\[[ x]\]\s*/, "");
                            return (
                              <div
                                key={idx}
                                onClick={() => handleToggleTodo(session, idx)}
                                className="flex items-center gap-2 text-xs text-[var(--ink)] hover:text-[var(--ink-blue)] cursor-pointer select-none"
                              >
                                <input
                                  type="checkbox"
                                  checked={isDone}
                                  onChange={() => {}}
                                  className="rounded border-[var(--hairline-strong)] text-[var(--ink-blue)] focus:ring-0 cursor-pointer"
                                />
                                <span className={isDone ? "line-through text-[var(--ink-muted)] font-mono" : "font-mono"}>
                                  {cleanText}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Notes preview */}
                    {session.notes.length > 0 && (
                      <div>
                        <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--ink)] block mb-1.5">
                          Session Notes
                        </span>
                        <div className="p-2.5 rounded bg-[var(--paper)] border border-[var(--hairline)] text-xs text-[var(--ink)] font-mono whitespace-pre-wrap">
                          {session.notes.join("\n")}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Session Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg max-w-lg w-full p-6 shadow-[var(--shadow-modal)]">
            <h2 className="text-base font-serif font-bold text-[var(--ink)] mb-3">Create Context Session</h2>
            <form onSubmit={handleCreateSession} className="space-y-3">
              <div>
                <label className="block text-xs font-mono font-bold text-[var(--ink)] mb-1">
                  Session Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Refactoring authentication middleware"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)]"
                />
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-[var(--ink)] mb-1">
                  Associated Project (Optional)
                </label>
                <select
                  value={newProjectId}
                  onChange={(e) => setNewProjectId(e.target.value)}
                  className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded px-3 py-2 text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
                >
                  <option value="">No specific project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-[var(--ink)] mb-1">
                  Summary / Working Objective (Optional)
                </label>
                <textarea
                  rows={3}
                  placeholder="What are you trying to accomplish in this session?"
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                  className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] text-[var(--ink-secondary)] hover:text-[var(--ink)] text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-[var(--control-room)] hover:bg-[var(--control-room-hover)] text-white text-xs font-bold shadow-xs"
                >
                  Create Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
