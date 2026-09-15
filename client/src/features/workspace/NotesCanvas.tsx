import React, { useState, useMemo } from "react";
import {
  FileText,
  Plus,
  Trash2,
  Edit3,
  Copy,
  Check,
  Search,
  BookOpen,
  Sparkles,
  Bot,
  Download,
  RefreshCw,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { copyTextToClipboard, downloadTextFile, formatDateTime } from "../../api/client";
import type { Note, NoteType } from "../../types";

export interface NotesCanvasProps {
  notes: Note[];
  isLoading?: boolean;
  onCreateNote: (title: string, content: string, noteType?: NoteType) => Promise<Note | null>;
  onUpdateNote: (noteId: string, title: string, content: string) => Promise<Note | null>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onOpenViewer?: (docId: string, pageNumber?: number, snippet?: string) => void;
}

export const NotesCanvas: React.FC<NotesCanvasProps> = ({
  notes,
  isLoading = false,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onOpenViewer,
}) => {
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const filteredNotes = useMemo(() => {
    return notes.filter((n) => {
      const matchesType = filterType === "all" || n.note_type === filterType;
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        n.title.toLowerCase().includes(query) ||
        n.content.toLowerCase().includes(query) ||
        (n.source_title && n.source_title.toLowerCase().includes(query));
      return matchesType && matchesSearch;
    });
  }, [notes, filterType, searchQuery]);

  const handleCopy = async (id: string, text: string) => {
    const success = await copyTextToClipboard(text);
    if (success) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() && !newContent.trim()) return;
    setIsSaving(true);
    try {
      const res = await onCreateNote(
        newTitle.trim() || "Untitled Note",
        newContent,
        "user",
      );
      if (res) {
        setNewTitle("");
        setNewContent("");
        setIsCreateModalOpen(false);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNote) return;
    setIsSaving(true);
    try {
      const res = await onUpdateNote(editingNote.id, editTitle.trim() || "Untitled Note", editContent);
      if (res) {
        setEditingNote(null);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const getNoteBadge = (type: NoteType) => {
    switch (type) {
      case "saved_answer":
        return <Badge variant="agent" className="gap-1 text-[10px]"><Bot size={11} /> Saved Answer</Badge>;
      case "excerpt":
        return <Badge variant="human" className="gap-1 text-[10px]"><BookOpen size={11} /> Excerpt</Badge>;
      case "studio_output":
        return <Badge variant="agent" className="gap-1 text-[10px]"><Sparkles size={11} /> Studio Output</Badge>;
      default:
        return <Badge variant="neutral" className="gap-1 text-[10px]"><FileText size={11} /> User Note</Badge>;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--paper)]">
      {/* Top action bar */}
      <div className="p-4 border-b border-[var(--hairline)] flex flex-wrap items-center justify-between gap-3 bg-[var(--paper)]">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" />
            <input
              type="text"
              placeholder="Search notes & excerpts…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--ink-blue)] w-48 sm:w-60"
            />
          </div>

          <div className="flex items-center gap-1 font-sans text-xs bg-[var(--surface)] p-0.5 rounded-[var(--radius-sm)] border border-[var(--hairline)]">
            {[
              { id: "all", label: "All" },
              { id: "user", label: "My Notes" },
              { id: "saved_answer", label: "Saved Answers" },
              { id: "excerpt", label: "Excerpts" },
              { id: "studio_output", label: "Studio" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterType(tab.id)}
                className={`px-2.5 py-1 text-xs rounded-[var(--radius-xs)] font-medium cursor-pointer transition-colors ${
                  filterType === tab.id
                    ? "bg-[var(--paper)] text-[var(--ink)] shadow-[var(--shadow-subtle)]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setNewTitle("");
              setNewContent("");
              setIsCreateModalOpen(true);
            }}
            className="gap-1.5"
          >
            <Plus size={14} />
            <span>New Note</span>
          </Button>
        </div>
      </div>

      {/* Notes Grid */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 text-xs text-[var(--ink-muted)]">
            <RefreshCw size={20} className="spin mb-2 text-[var(--ink-blue)]" />
            <p>Loading research notes…</p>
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="max-w-md mx-auto my-12 text-center p-8 rounded-[var(--radius-md)] border border-dashed border-[var(--hairline)] bg-[var(--surface)]">
            <BookOpen size={32} className="mx-auto text-[var(--ink-muted)] mb-3 opacity-60" />
            <h3 className="font-serif text-sm font-semibold text-[var(--ink)]">
              {searchQuery ? "No matching notes found" : "No notes yet"}
            </h3>
            <p className="text-xs text-[var(--ink-muted)] mt-1.5 leading-relaxed">
              Save useful answers, excerpts, or your own ideas while you research your sources.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-4 gap-1.5"
              onClick={() => {
                setNewTitle("");
                setNewContent("");
                setIsCreateModalOpen(true);
              }}
            >
              <Plus size={13} />
              <span>Create first note</span>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredNotes.map((note) => (
              <div
                key={note.id}
                className="flex flex-col justify-between p-4 rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] hover:border-[var(--ink-blue-border)] transition-all shadow-[var(--shadow-subtle)] group"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {getNoteBadge(note.note_type)}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleCopy(note.id, `${note.title}\n\n${note.content}`)}
                        className="p-1 rounded text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-subtle)] cursor-pointer"
                        title="Copy note"
                      >
                        {copiedId === note.id ? <Check size={13} className="text-[var(--success)]" /> : <Copy size={13} />}
                      </button>
                      <button
                        onClick={() => {
                          setEditingNote(note);
                          setEditTitle(note.title);
                          setEditContent(note.content);
                        }}
                        className="p-1 rounded text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-subtle)] cursor-pointer"
                        title="Edit note"
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        onClick={() => onDeleteNote(note.id)}
                        className="p-1 rounded text-[var(--danger)] hover:bg-[var(--danger-bg)] cursor-pointer"
                        title="Delete note"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  <h4 className="font-serif font-semibold text-sm text-[var(--ink)] mb-1.5 leading-snug line-clamp-2">
                    {note.title}
                  </h4>

                  <p className="text-xs text-[var(--ink-light)] font-sans line-clamp-5 whitespace-pre-wrap leading-relaxed">
                    {note.content}
                  </p>

                  {/* Citations / Source Provenance */}
                  {note.citations && note.citations.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-[var(--hairline-subtle)] flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] font-mono text-[var(--ink-muted)]">Citations:</span>
                      {note.citations.map((c, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            if (onOpenViewer && c.document_id) {
                              onOpenViewer(c.document_id, c.page_number, c.snippet);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] hover:bg-[var(--ink-blue)] hover:text-white transition-colors cursor-pointer border border-[var(--ink-blue-border)]"
                          title={`${c.document_name || "Document"}, p. ${c.page_number}: ${c.snippet || ""}`}
                        >
                          <span>[{idx + 1}]</span>
                          <span className="truncate max-w-[80px]">{c.document_name || "Doc"}</span>
                          <span>p.{c.page_number}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Single source excerpt tag */}
                  {note.source_title && (
                    <div className="mt-2 text-[10px] text-[var(--ink-muted)] font-mono flex items-center gap-1">
                      <span>Source:</span>
                      <button
                        onClick={() => {
                          if (onOpenViewer && note.source_id) {
                            onOpenViewer(note.source_id, note.page_number || 1);
                          }
                        }}
                        className="text-[var(--ink-blue)] hover:underline truncate max-w-[150px] cursor-pointer"
                      >
                        {note.source_title} {note.page_number ? `(p. ${note.page_number})` : ""}
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-2 text-[10px] font-mono text-[var(--ink-faint)] flex items-center justify-between">
                  <span>{formatDateTime(note.created_at)}</span>
                  <button
                    onClick={() => downloadTextFile(`${note.title.toLowerCase().replace(/\s+/g, "_")}.md`, note.content)}
                    className="hover:text-[var(--ink-muted)] cursor-pointer inline-flex items-center gap-0.5"
                    title="Export Markdown"
                  >
                    <Download size={10} />
                    <span>Export</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Note Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create Research Note"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--ink)] mb-1">
              Title
            </label>
            <input
              type="text"
              placeholder="e.g. Key Takeaways on Section 3"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full h-9 px-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)]"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--ink)] mb-1">
              Content (Markdown supported)
            </label>
            <textarea
              rows={8}
              placeholder="Draft your thoughts, synthesize findings, or paste quotes…"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              className="w-full p-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans resize-y"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--hairline)]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsCreateModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save Note"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Note Modal */}
      <Modal
        isOpen={!!editingNote}
        onClose={() => setEditingNote(null)}
        title="Edit Research Note"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--ink)] mb-1">
              Title
            </label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full h-9 px-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--ink)] mb-1">
              Content
            </label>
            <textarea
              rows={8}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full p-3 text-xs rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans resize-y"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--hairline)]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setEditingNote(null)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
