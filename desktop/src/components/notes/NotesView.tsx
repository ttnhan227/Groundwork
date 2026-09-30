import React, { useEffect, useState } from "react";
import {
  FileText,
  Plus,
  Trash2,
  Folder,
  Tag,
  Search,
  ExternalLink,
  Cloud,
  HardDrive,
} from "lucide-react";
import { api } from "../../services/api";
import type { Note, Project } from "../../types/api";

interface NotesViewProps {
  selectedProjectId: string | null;
}

export const NotesView: React.FC<NotesViewProps> = ({ selectedProjectId }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);

  // New Note Form
  const [newTitle, setNewTitle] = useState<string>("");
  const [newContent, setNewContent] = useState<string>("");
  const [newProjectId, setNewProjectId] = useState<string>("");
  const [newFilePath, setNewFilePath] = useState<string>("");
  const [newTags, setNewTags] = useState<string>("");

  const fetchNotes = async () => {
    setLoading(true);
    try {
      const [noteData, projData] = await Promise.all([
        api.listNotes(searchQuery || undefined, selectedProjectId || undefined),
        api.listProjects(),
      ]);
      setNotes(noteData);
      setProjects(projData);
      if (noteData.length > 0 && !selectedNote) {
        setSelectedNote(noteData[0]);
      }
    } catch (err) {
      console.error("Failed to load notes:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();
  }, [searchQuery, selectedProjectId]);

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      const tagsArray = newTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const created = await api.createNote(
        newTitle.trim(),
        newContent.trim(),
        newProjectId || undefined,
        newFilePath.trim() || undefined,
        tagsArray
      );

      setNewTitle("");
      setNewContent("");
      setNewProjectId("");
      setNewFilePath("");
      setNewTags("");
      setShowCreateModal(false);
      setSelectedNote(created);
      fetchNotes();
    } catch (err) {
      console.error("Failed to create note:", err);
    }
  };

  const handleDeleteNote = async (id: string) => {
    if (!confirm("Are you sure you want to delete this note?")) return;
    try {
      await api.deleteNote(id);
      if (selectedNote?.id === id) {
        setSelectedNote(null);
      }
      fetchNotes();
    } catch (err) {
      console.error("Failed to delete note:", err);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-[var(--paper)] text-[var(--ink)] font-sans w-full">
      {/* Left List Column */}
      <div className="w-80 border-r border-[var(--hairline)] bg-[var(--surface)] flex flex-col h-full shrink-0">
        <div className="p-4 border-b border-[var(--hairline)] space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-serif font-bold text-[var(--ink)] flex items-center gap-2">
              <FileText className="w-4 h-4 text-[var(--ink-blue)]" />
              Local Notes
            </h1>
            <button
              onClick={() => setShowCreateModal(true)}
              className="p-1.5 rounded bg-[var(--control-room)] hover:bg-[var(--control-room-hover)] text-white transition-colors shadow-xs"
              title="Add Note"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Filter notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded pl-8 pr-3 py-1.5 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)]"
            />
          </div>
        </div>

        {/* Note List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--hairline-subtle)]">
          {loading ? (
            <div className="p-6 text-center text-xs text-[var(--ink-muted)]">Loading notes...</div>
          ) : notes.length === 0 ? (
            <div className="p-6 text-center text-xs text-[var(--ink-muted)]">
              No notes found. Create one to attach thoughts to code!
            </div>
          ) : (
            notes.map((n) => {
              const isSelected = selectedNote?.id === n.id;
              return (
                <div
                  key={n.id}
                  onClick={() => setSelectedNote(n)}
                  className={`p-3.5 cursor-pointer transition-colors ${
                    isSelected ? "bg-[var(--surface-hover)] border-l-2 border-[var(--ink-blue)]" : "hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-xs font-serif font-bold text-[var(--ink)] truncate max-w-[180px]">
                      {n.title}
                    </h3>
                    <span className="text-[10px] text-[var(--ink-muted)] font-mono">
                      {new Date(n.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <p className="text-[11px] text-[var(--ink-secondary)] line-clamp-2 mb-2 font-sans">
                    {n.content || "Empty note"}
                  </p>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {n.project_name && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--paper-subtle)] text-[var(--ink-secondary)] border border-[var(--hairline)] font-mono">
                        {n.project_name}
                      </span>
                    )}
                    {n.tags.map((t) => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded text-[9px] bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] text-[var(--ink-blue)] font-mono font-bold"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Detail / Editor Pane */}
      <div className="flex-1 flex flex-col h-full bg-[var(--paper)] overflow-y-auto">
        {selectedNote ? (
          <div className="p-6 max-w-3xl w-full mx-auto space-y-4">
            <div className="flex items-start justify-between pb-4 border-b border-[var(--hairline)]">
              <div>
                <h1 className="text-2xl font-serif font-bold text-[var(--ink)] mb-2">{selectedNote.title}</h1>
                <div className="flex items-center gap-3 text-xs text-[var(--ink-secondary)] flex-wrap">
                  {selectedNote.project_name && (
                    <span className="flex items-center gap-1 text-[var(--ink-blue)] font-mono">
                      <Folder className="w-3.5 h-3.5" />
                      {selectedNote.project_name}
                    </span>
                  )}
                  {selectedNote.file_path && (
                    <span
                      onClick={() => api.openFile(selectedNote.file_path!)}
                      className="flex items-center gap-1 text-[var(--ink-blue)] hover:underline cursor-pointer font-mono text-[11px]"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {selectedNote.file_path}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[var(--ink-muted)] font-mono text-[11px]">
                    {selectedNote.sync_status === "synced" ? (
                      <Cloud className="w-3.5 h-3.5 text-[var(--ink-blue)]" />
                    ) : (
                      <HardDrive className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
                    )}
                    {selectedNote.sync_status}
                  </span>
                </div>
              </div>

              <button
                onClick={() => handleDeleteNote(selectedNote.id)}
                className="p-2 rounded bg-[var(--surface)] hover:bg-[var(--danger-bg)] border border-[var(--hairline)] hover:border-[var(--danger-border)] text-[var(--ink-secondary)] hover:text-[var(--danger)] transition-colors shadow-xs"
                title="Delete Note"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Tags list */}
            {selectedNote.tags.length > 0 && (
              <div className="flex items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
                <div className="flex flex-wrap gap-1.5">
                  {selectedNote.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded text-xs bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] text-[var(--ink-blue)] font-mono font-bold"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Note Content */}
            <div className="bg-[var(--surface)] border border-[var(--hairline)] rounded-lg p-6 text-sm text-[var(--ink)] leading-relaxed font-sans whitespace-pre-wrap shadow-xs">
              {selectedNote.content}
            </div>
          </div>
        ) : (
          <div className="m-auto text-center text-[var(--ink-muted)] text-xs">
            Select a note or create a new one to view details.
          </div>
        )}
      </div>

      {/* Create Note Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg max-w-lg w-full p-6 shadow-[var(--shadow-modal)]">
            <h2 className="text-base font-serif font-bold text-[var(--ink)] mb-3">Add Local Note</h2>
            <form onSubmit={handleCreateNote} className="space-y-3">
              <div>
                <label className="block text-xs font-mono font-bold text-[var(--ink)] mb-1">Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SQLite connection pool issue note"
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
                  <option value="">None</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-[var(--ink)] mb-1">
                  File Path Attachment (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. server/app/database/local_db.py"
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] font-mono focus:outline-none focus:border-[var(--ink-blue)]"
                />
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-[var(--ink)] mb-1">
                  Tags (Comma separated)
                </label>
                <input
                  type="text"
                  placeholder="bug, sqlite, todo"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)] font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-[var(--ink)] mb-1">Content</label>
                <textarea
                  rows={4}
                  placeholder="Markdown formatted note content..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
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
                  Save Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
