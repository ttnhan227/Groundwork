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
import { Button, Card, Badge, Modal, EmptyState } from "../ui";

interface ContextSessionsViewProps {
  selectedProjectId: string | null;
  onResume?: (session: ContextSession) => void;
}

export const ContextSessionsView: React.FC<ContextSessionsViewProps> = ({
  selectedProjectId,
  onResume,
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
            Re-hydrate state, inspected files, notes, and task checklists without losing your place.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Status Filter */}
          <div className="flex items-center bg-[var(--surface)] p-1 rounded-[var(--radius-sm)] border border-[var(--hairline)] text-xs">
            {["all", "active", "paused", "completed"].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded-[var(--radius-xs)] capitalize text-xs transition-all font-mono font-semibold cursor-pointer ${
                  statusFilter === st
                    ? "bg-[var(--control-room)] text-white shadow-[var(--shadow-subtle)]"
                    : "text-[var(--ink-secondary)] hover:text-[var(--ink)]"
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus className="w-4 h-4" />
            New Session
          </Button>
        </div>
      </div>

      {/* Sessions Grid / List */}
      {loading ? (
        <EmptyState
          icon={<BookmarkCheck size={32} className="animate-pulse" />}
          title="Loading context sessions..."
          compact
        />
      ) : filteredSessions.length === 0 ? (
        <EmptyState
          icon={<BookmarkCheck size={36} />}
          title="No context sessions found"
          description="Click 'New Session' to capture your active files, goals, and working memory."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredSessions.map((session) => {
            const isExpanded = expandedSessionId === session.id;
            const completedTodos = session.todos.filter((t) => t.startsWith("[x] ")).length;

            return (
              <Card
                key={session.id}
                className="hover:border-[var(--ink-blue)]"
              >
                {/* Header Row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-serif font-bold text-[var(--ink)]">
                        {session.title}
                      </span>
                      <Badge
                        variant={
                          session.status === "active"
                            ? "success"
                            : session.status === "paused"
                            ? "warning"
                            : "neutral"
                        }
                        className="font-mono uppercase font-bold"
                      >
                        {session.status}
                      </Badge>
                      {session.project_name && (
                        <Badge variant="human">
                          <Folder className="w-3 h-3 text-[var(--ink-blue)] mr-1" />
                          {session.project_name}
                        </Badge>
                      )}
                    </div>

                    {session.summary && (
                      <p className="text-xs text-[var(--ink-secondary)] leading-relaxed mt-1 font-sans">
                        {session.summary}
                      </p>
                    )}
                  </div>

                  {/* Actions & Status toggles */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {session.status === "active" && onResume && <Button variant="primary" size="xs" onClick={() => onResume(session)}><Play className="w-3 h-3" />Continue</Button>}
                    {session.status !== "active" ? (
                      <Button
                        variant="primary"
                        size="xs"
                        onClick={async () => { await handleUpdateStatus(session.id, "active"); onResume?.(session); }}
                        title="Resume Session"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        Resume
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => handleUpdateStatus(session.id, "paused")}
                        title="Pause Session"
                      >
                        <Pause className="w-3 h-3" />
                        Pause
                      </Button>
                    )}

                    {session.status !== "completed" && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => handleUpdateStatus(session.id, "completed")}
                        title="Complete Session"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)]" />
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        setExpandedSessionId(isExpanded ? null : session.id)
                      }
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </Button>
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
                    <form className="space-y-2" onSubmit={async (event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      try { await api.updateSession(session.id, {summary: String(data.get("summary") || ""), notes: String(data.get("notes") || "").split("\n").filter(Boolean), todos: String(data.get("todos") || "").split("\n").filter(Boolean)}); await fetchSessions(); }
                      catch (error) { alert(String(error)); }
                    }}>
                      <label className="block text-xs">Findings and decisions<textarea name="summary" defaultValue={session.summary || ""} className="block w-full min-h-20 border border-[var(--hairline)] bg-[var(--paper)] p-2 text-xs" /></label>
                      <label className="block text-xs">Notes<textarea name="notes" defaultValue={session.notes.join("\n")} className="block w-full border border-[var(--hairline)] bg-[var(--paper)] p-2 text-xs" /></label>
                      <label className="block text-xs">Remaining tasks · one per line<textarea name="todos" defaultValue={session.todos.join("\n")} className="block w-full border border-[var(--hairline)] bg-[var(--paper)] p-2 text-xs" /></label>
                      <Button size="xs" type="submit">Save working context</Button>
                    </form>
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
                              className="flex items-center justify-between px-2.5 py-1 rounded-[var(--radius-xs)] bg-[var(--paper)] border border-[var(--hairline)] hover:border-[var(--ink-blue)] text-xs text-[var(--ink)] hover:text-[var(--ink-blue)] cursor-pointer font-mono group"
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
                                  className="rounded-[var(--radius-xs)] border-[var(--hairline-strong)] text-[var(--ink-blue)] focus:ring-0 cursor-pointer"
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
                        <div className="p-2.5 rounded-[var(--radius-xs)] bg-[var(--paper)] border border-[var(--hairline)] text-xs text-[var(--ink)] font-mono whitespace-pre-wrap">
                          {session.notes.join("\n")}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Session Modal */}
      {showCreateModal && (
        <Modal
          isOpen={true}
          onClose={() => setShowCreateModal(false)}
          eyebrow="Context Session"
          title="Create New Context Session"
          maxWidth="md"
        >
          <form onSubmit={handleCreateSession} className="space-y-3.5">
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
                className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded-[var(--radius-sm)] px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)]"
              />
            </div>

            <div>
              <label className="block text-xs font-mono font-bold text-[var(--ink)] mb-1">
                Associated Project (Optional)
              </label>
              <select
                value={newProjectId}
                onChange={(e) => setNewProjectId(e.target.value)}
                className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded-[var(--radius-sm)] px-3 py-2 text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
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
                className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded-[var(--radius-sm)] px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--hairline)]">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
              >
                Create Session
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
export default ContextSessionsView;
