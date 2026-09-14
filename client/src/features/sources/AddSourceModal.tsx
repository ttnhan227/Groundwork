import React, { useState } from "react";
import {
  Upload,
  Globe,
  Video,
  Clipboard,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import {
  createTextSource,
  createUrlSource,
  createYouTubeSource,
} from "../../api/client";
import type { DocumentItem } from "../../types";

export interface AddSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  token?: string;
  onUploadFile: (file: File) => Promise<void>;
  onSourceAdded: (source: DocumentItem) => void;
}

type TabType = "file" | "url" | "youtube" | "text";

export const AddSourceModal: React.FC<AddSourceModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
  token = "",
  onUploadFile,
  onSourceAdded,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>("file");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form states
  const [webUrl, setWebUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");

  const resetForm = () => {
    setError(null);
    setSuccess(null);
    setWebUrl("");
    setYoutubeUrl("");
    setTextTitle("");
    setTextContent("");
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      await onUploadFile(file);
      setSuccess(`Added ${file.name}`);
      setTimeout(() => {
        handleClose();
      }, 500);
    } catch (err: unknown) {
      setError((err as Error)?.message || "Failed to upload file");
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      await onUploadFile(file);
      setSuccess(`Added ${file.name}`);
      setTimeout(() => {
        handleClose();
      }, 500);
    } catch (err: unknown) {
      setError((err as Error)?.message || "Failed to upload file");
    } finally {
      setLoading(false);
    }
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webUrl.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const doc = await createUrlSource(
        { url: webUrl.trim(), workspace_id: workspaceId },
        token,
      );
      onSourceAdded(doc);
      setSuccess("Web page imported successfully");
      setTimeout(() => {
        handleClose();
      }, 600);
    } catch (err: unknown) {
      setError((err as Error)?.message || "Failed to import web page");
    } finally {
      setLoading(false);
    }
  };

  const handleYouTubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!youtubeUrl.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const doc = await createYouTubeSource(
        { url: youtubeUrl.trim(), workspace_id: workspaceId },
        token,
      );
      onSourceAdded(doc);
      setSuccess("YouTube video imported successfully");
      setTimeout(() => {
        handleClose();
      }, 600);
    } catch (err: unknown) {
      setError((err as Error)?.message || "Failed to import YouTube video");
    } finally {
      setLoading(false);
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textContent.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const title = textTitle.trim() || "Pasted Research Note";
      const doc = await createTextSource(
        { title, content: textContent.trim(), workspace_id: workspaceId },
        token,
      );
      onSourceAdded(doc);
      setSuccess("Note saved as source document");
      setTimeout(() => {
        handleClose();
      }, 600);
    } catch (err: unknown) {
      setError((err as Error)?.message || "Failed to save note as source");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Sources"
      eyebrow="Grounding Materials"
      maxWidth="lg"
    >
      <div className="p-6 space-y-5">
        <p className="text-xs text-[var(--ink-muted)] leading-relaxed">
          Sources ground Groundwork AI&apos;s responses and Studio outputs in your
          materials. Every answer will be cited with verifiable page links.
        </p>

        {/* Tab Navigation */}
        <div className="flex border-b border-[var(--hairline)] gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab("file");
              setError(null);
            }}
            className={`flex items-center gap-1.5 pb-2.5 px-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "file"
                ? "border-[var(--ink-blue)] text-[var(--ink-blue)]"
                : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Upload size={14} />
            <span>Upload Files</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("url");
              setError(null);
            }}
            className={`flex items-center gap-1.5 pb-2.5 px-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "url"
                ? "border-[var(--ink-blue)] text-[var(--ink-blue)]"
                : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Globe size={14} />
            <span>Web URL</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("youtube");
              setError(null);
            }}
            className={`flex items-center gap-1.5 pb-2.5 px-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "youtube"
                ? "border-[var(--ink-blue)] text-[var(--ink-blue)]"
                : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Video size={14} />
            <span>YouTube</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("text");
              setError(null);
            }}
            className={`flex items-center gap-1.5 pb-2.5 px-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "text"
                ? "border-[var(--ink-blue)] text-[var(--ink-blue)]"
                : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Clipboard size={14} />
            <span>Copied Text / Notes</span>
          </button>
        </div>

        {/* Notifications */}
        {error && (
          <div className="flex items-center gap-2 p-3 text-xs bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger)]/20 rounded-[var(--radius-sm)]">
            <AlertCircle size={14} className="shrink-0" />
            <span className="flex-1">{error}</span>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 p-3 text-xs bg-[var(--success-bg)] text-[var(--success)] border border-[var(--success)]/20 rounded-[var(--radius-sm)] font-medium">
            <CheckCircle2 size={14} className="shrink-0" />
            <span className="flex-1">{success}</span>
          </div>
        )}

        {/* Tab 1: File Upload */}
        {activeTab === "file" && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="border-2 border-dashed border-[var(--hairline)] hover:border-[var(--ink-blue)] rounded-[var(--radius-md)] p-8 text-center bg-[var(--surface-hover)]/30 transition-colors"
          >
            <Upload
              size={32}
              className="mx-auto mb-3 text-[var(--ink-blue)] opacity-80"
            />
            <p className="text-sm font-medium text-[var(--ink)]">
              Drag and drop source files here
            </p>
            <p className="text-xs text-[var(--ink-muted)] mt-1 mb-4">
              Supported formats: PDF, Word (.docx), PowerPoint (.pptx), Markdown
              (.md), Plain Text (.txt)
            </p>
            <label className="inline-block cursor-pointer">
              <Button
                variant="primary"
                size="sm"
                type="button"
                disabled={loading}
                className="pointer-events-none"
              >
                {loading ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={14} className="spin" /> Uploading...
                  </span>
                ) : (
                  "Choose File"
                )}
              </Button>
              <input
                type="file"
                disabled={loading}
                className="hidden"
                accept=".pdf,.docx,.pptx,.txt,.md,.rtf"
                onChange={handleFileUpload}
              />
            </label>
          </div>
        )}

        {/* Tab 2: Web URL */}
        {activeTab === "url" && (
          <form onSubmit={handleUrlSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="web-url-input"
                className="block text-xs font-medium text-[var(--ink)] mb-1"
              >
                Website or Article URL
              </label>
              <div className="relative flex items-center">
                <Globe
                  size={14}
                  className="absolute left-3 text-[var(--ink-muted)]"
                />
                <input
                  id="web-url-input"
                  type="url"
                  placeholder="https://en.wikipedia.org/wiki/Artificial_intelligence"
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                  disabled={loading}
                  required
                  className="w-full pl-9 pr-3 py-2 text-xs border border-[var(--hairline)] rounded-[var(--radius-sm)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)]"
                />
              </div>
              <p className="text-[11px] text-[var(--ink-muted)] mt-1.5">
                Groundwork extracts article text, preserves headers, and turns
                the web page into a cited source document.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={handleClose}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="submit"
                disabled={loading || !webUrl.trim()}
              >
                {loading ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={14} className="spin" /> Importing...
                  </span>
                ) : (
                  "Import Web Source"
                )}
              </Button>
            </div>
          </form>
        )}

        {/* Tab 3: YouTube */}
        {activeTab === "youtube" && (
          <form onSubmit={handleYouTubeSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="yt-url-input"
                className="block text-xs font-medium text-[var(--ink)] mb-1"
              >
                YouTube Video Link
              </label>
              <div className="relative flex items-center">
                <Video
                  size={14}
                  className="absolute left-3 text-[var(--ink-muted)]"
                />
                <input
                  id="yt-url-input"
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=FOs4RDTC52Q"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  disabled={loading}
                  required
                  className="w-full pl-9 pr-3 py-2 text-xs border border-[var(--hairline)] rounded-[var(--radius-sm)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)]"
                />
              </div>
              <p className="text-[11px] text-[var(--ink-muted)] mt-1.5">
                Groundwork pulls video information and generates an educational
                transcript synopsis to ground your notebook.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={handleClose}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="submit"
                disabled={loading || !youtubeUrl.trim()}
              >
                {loading ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={14} className="spin" /> Importing...
                  </span>
                ) : (
                  "Import YouTube Source"
                )}
              </Button>
            </div>
          </form>
        )}

        {/* Tab 4: Copied Text / Notes */}
        {activeTab === "text" && (
          <form onSubmit={handleTextSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="text-title-input"
                className="block text-xs font-medium text-[var(--ink)] mb-1"
              >
                Document Title (Optional)
              </label>
              <input
                id="text-title-input"
                type="text"
                placeholder="e.g. Field Research Notes, Google Doc Excerpt"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                disabled={loading}
                className="w-full px-3 py-2 text-xs border border-[var(--hairline)] rounded-[var(--radius-sm)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] mb-3"
              />

              <label
                htmlFor="text-content-input"
                className="block text-xs font-medium text-[var(--ink)] mb-1"
              >
                Paste Text / Research Notes
              </label>
              <textarea
                id="text-content-input"
                rows={6}
                placeholder="Paste copied text, study materials, or meeting notes here..."
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                disabled={loading}
                required
                className="w-full px-3 py-2 text-xs border border-[var(--hairline)] rounded-[var(--radius-sm)] bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:border-[var(--ink-blue)] font-sans"
              />
              <p className="text-[11px] text-[var(--ink-muted)] mt-1.5">
                Pastes become native PDF-indexed sources that can be cited by
                page in the Assistant and Studio.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={handleClose}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="submit"
                disabled={loading || !textContent.trim()}
              >
                {loading ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={14} className="spin" /> Saving...
                  </span>
                ) : (
                  "Save as Source Document"
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
export default AddSourceModal;
