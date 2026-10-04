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
import { Button, Card, Badge, Modal, EmptyState } from "../ui";

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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");

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
      setError("");
      setProjects(projData);
      setSelectedNote((current) => noteData.find((note) => note.id === current?.id) || noteData[0] || null);
    } catch (err) {
      console.error("Failed to load notes:", err);
      setError(String(err));
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

      const created = editingId ? await api.updateNote(editingId, { title: newTitle.trim(), content: newContent, project_id: newProjectId || null, file_path: newFilePath || null, tags: tagsArray }) : await api.createNote(
        newTitle.trim(),
        newContent.trim(),
        newProjectId || undefined,
        newFilePath.trim() || undefined,
        tagsArray
      );

      setEditingId(null);
      setNewTitle("");
      setNewContent("");
      setNewProjectId("");
      setNewFilePath("");
      setNewTags("");
      setShowCreateModal(false);
      setSelectedNote(created);
      fetchNotes();
    } catch (err) {
      setError(String(err));
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
      setError(String(err));
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-[var(--paper)] text-[var(--ink)] font-sans w-full">
      {error && !showCreateModal && <p role="alert" className="absolute top-2 right-4 text-xs text-[var(--danger)]">{error}</p>}
      {/* Left List Column */}
      <div className="w-80 border-r border-[var(--hairline)] bg-[var(--surface)] flex flex-col h-full shrink-0">
        <div className="p-4 border-b border-[var(--hairline)] space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-serif font-bold text-[var(--ink)] flex items-center gap-2">
              <FileText className="w-4 h-4 text-[var(--ink-blue)]" />
              Local Notes
            </h1>
            <Button
              variant="primary"
              size="xs"
              onClick={() => {setEditingId(null); setNewTitle(""); setNewContent(""); setNewProjectId(selectedProjectId || ""); setNewFilePath(""); setNewTags(""); setError(""); setShowCreateModal(true);}}
              title="Add Note"
            >
              <Plus className="w-3.5 h-3.5" />
              New
            </Button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded-[var(--radius-sm)] pl-8 pr-3 py-1.5 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)]"
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
                  className={`p-3.5 cursor-pointer transition-all ${
                    isSelected ? "bg-[var(--surface-hover)] border-l-2 border-[var(--ink-blue)] shadow-[var(--shadow-subtle)]" : "hover:bg-[var(--surface-hover)]"
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
                      <Badge variant="neutral">
                        {n.project_name}
                      </Badge>
                    )}
                    {n.tags.map((t) => (
                      <Badge key={t} variant="human" className="text-[9px]">
                        #{t}
                      </Badge>
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
                  <Badge variant="neutral" className="font-mono text-[10px]">
                    {selectedNote.sync_status === "synced" ? (
                      <Cloud className="w-3 h-3 text-[var(--ink-blue)] mr-1 inline" />
                    ) : (
                      <HardDrive className="w-3 h-3 text-[var(--ink-muted)] mr-1 inline" />
                    )}
                    {selectedNote.sync_status}
                  </Badge>
                </div>
              </div>

              <Button variant="secondary" size="xs" onClick={() => { setEditingId(selectedNote.id); setNewTitle(selectedNote.title); setNewContent(selectedNote.content); setNewProjectId(selectedNote.project_id || ""); setNewFilePath(selectedNote.file_path || ""); setNewTags(selectedNote.tags.join(", ")); setError(""); setShowCreateModal(true); }}>Edit</Button>
              <Button
                variant="danger"
                size="xs"
                onClick={() => handleDeleteNote(selectedNote.id)}
                title="Delete Note"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </Button>
            </div>

            {/* Tags list */}
            {selectedNote.tags.length > 0 && (
              <div className="flex items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
                <div className="flex flex-wrap gap-1.5">
                  {selectedNote.tags.map((tag) => (
                    <Badge key={tag} variant="human">
                      #{tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Note Content Card */}
            <Card className="text-sm text-[var(--ink)] leading-relaxed font-sans whitespace-pre-wrap">
              {selectedNote.content}
            </Card>
          </div>
        ) : (
          <div className="m-auto text-center text-[var(--ink-muted)] text-xs">
            <EmptyState
              icon={<FileText size={32} />}
              title="No note selected"
              description="Select a note from the left or create a new one to inspect details."
            />
          </div>
        )}
      </div>

      {/* Create Note Modal */}
      {showCreateModal && (
        <Modal
          isOpen={true}
          onClose={() => { setShowCreateModal(false); setEditingId(null); setNewTitle(""); setNewContent(""); }}
          eyebrow="Local Note"
          title={editingId ? "Edit Workspace Note" : "Add Local Workspace Note"}
          maxWidth="md"
        >
          <form onSubmit={handleCreateNote} className="space-y-3.5">
            {error && <p role="alert" className="text-sm text-[var(--ink-sepia)]">{error}</p>}
            <div>
              <label className="block text-xs font-mono font-bold text-[var(--ink)] mb-1">Title *</label>
              <input
                type="text"
                required
                placeholder="e.g. SQLite connection pool issue note"
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
                className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded-[var(--radius-sm)] px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] font-mono focus:outline-none focus:border-[var(--ink-blue)]"
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
                className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded-[var(--radius-sm)] px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)] font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-mono font-bold text-[var(--ink)] mb-1">Content</label>
              <textarea
                rows={4}
                placeholder="Markdown formatted note content..."
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="w-full bg-[var(--paper)] border border-[var(--hairline)] rounded-[var(--radius-sm)] px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--hairline)]">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {setShowCreateModal(false); setEditingId(null);}}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
              >
                Save Note
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
export default NotesView;
