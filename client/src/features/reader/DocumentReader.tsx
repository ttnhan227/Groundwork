import React, { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Search,
  X,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  FileText,
  PanelLeftClose,
  PanelLeft,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Check,
  Download,
  Filter,
  BookOpen,
  FileCode,
  Globe,
  Video,
} from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "../../components/ui/Button";
import {
  API,
  authenticatedFetch,
  expireSession,
  fetchDocumentPages,
  retryDocumentProcessing,
} from "../../api/client";
import type { DocumentItem, DocumentPage } from "../../types";

const PDF_WORKER_URL = `${pdfWorkerUrl}?worker=v2`;

function getSourceIcon(doc: DocumentItem) {
  const name = (doc.filename || "").toLowerCase();
  if (name.endsWith(".html") || name.endsWith(".htm") || doc.tags?.includes("web")) {
    return <Globe size={15} className="text-emerald-600 flex-shrink-0" />;
  }
  if (name.endsWith(".mp4") || name.endsWith(".mov") || doc.tags?.includes("youtube") || doc.tags?.includes("video")) {
    return <Video size={15} className="text-rose-600 flex-shrink-0" />;
  }
  if (name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".json")) {
    return <FileCode size={15} className="text-amber-600 flex-shrink-0" />;
  }
  return <FileText size={15} className="text-[var(--ink-blue)] flex-shrink-0" />;
}

// Lazy-loaded thumbnail component
function PdfThumbnail({
  pdf,
  pageNumber,
  current,
  hasMatches,
  isEvidencePage,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  current: boolean;
  hasMatches?: boolean;
  isEvidencePage?: boolean;
  onSelect: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!button.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(button.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    (async () => {
      try {
        const pdfPage = await pdf.getPage(pageNumber);
        if (cancelled || !canvas.current) return;
        const viewport = pdfPage.getViewport({ scale: 0.22 });
        const context = canvas.current.getContext("2d");
        if (!context) return;
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        task = pdfPage.render({
          canvas: canvas.current,
          canvasContext: context,
          viewport,
        });
        await task.promise;
      } catch {
        // Thumbnail render error ignored
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, visible]);

  return (
    <button
      ref={button}
      type="button"
      onClick={onSelect}
      className={`w-full p-1.5 rounded-[var(--radius-sm)] border transition-all text-left flex flex-col items-center gap-1 cursor-pointer relative group ${
        current
          ? "border-[var(--ink-blue)] bg-[var(--surface)] shadow-[var(--shadow-subtle)] ring-1 ring-[var(--ink-blue)]"
          : isEvidencePage
            ? "border-amber-500 bg-amber-50/50 hover:bg-amber-100/40"
            : "border-[var(--hairline)] bg-[var(--paper-subtle)] hover:bg-[var(--surface-hover)]"
      }`}
    >
      <canvas
        ref={canvas}
        className="w-full bg-white shadow-xs rounded-[2px]"
      />
      <div className="w-full flex items-center justify-between px-1 text-[10px] font-mono text-[var(--ink-muted)]">
        <span>p. {pageNumber}</span>
        {isEvidencePage && (
          <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1 rounded">
            Cited
          </span>
        )}
        {hasMatches && !isEvidencePage && (
          <span className="text-[9px] font-bold text-[var(--ink-blue)] bg-[var(--ink-blue-subtle)] px-1 rounded">
            Match
          </span>
        )}
      </div>
    </button>
  );
}

export interface DocumentReaderProps {
  document: DocumentItem | null;
  token: string;
  initialPage?: number;
  initialSearch?: string;
  evidenceSnippet?: string | null;
  evidencePage?: number | null;
  isScopedToSource?: boolean;
  onToggleScopeSource?: (docId: string) => void;
  onClose?: () => void;
  onRetryProcessing?: (docId: string) => Promise<void> | void;
  allSources?: DocumentItem[];
  onSelectSource?: (docId: string) => void;
}

export const DocumentReader: React.FC<DocumentReaderProps> = ({
  document,
  token,
  initialPage = 1,
  initialSearch = "",
  evidenceSnippet = null,
  evidencePage = null,
  isScopedToSource = false,
  onToggleScopeSource,
  onClose,
  onRetryProcessing,
  allSources = [],
  onSelectSource,
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pdfSource, setPdfSource] = useState("");
  const [page, setPage] = useState(initialPage);
  const [scale, setScale] = useState(0.9);
  const [hasAutoFitted, setHasAutoFitted] = useState(false);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState("");
  const [loadStage, setLoadStage] = useState<
    "idle" | "downloading" | "opening" | "rendering" | "ready"
  >("idle");
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);

  // Layout states
  const [isThumbnailsOpen, setIsThumbnailsOpen] = useState(true);
  const [viewMode, setViewMode] = useState<"pdf" | "text">("pdf");

  // Search & Navigation state
  const [activeSearch, setActiveSearch] = useState(initialSearch || evidenceSnippet || "");
  const [searchInput, setSearchInput] = useState(initialSearch || "");
  const [searchResults, setSearchResults] = useState<
    { page: number; snippet: string }[]
  >([]);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  // Evidence Highlight banner state
  const [currentEvidence, setCurrentEvidence] = useState<{
    snippet: string;
    page: number;
  } | null>(
    evidenceSnippet
      ? { snippet: evidenceSnippet, page: evidencePage || initialPage || 1 }
      : null,
  );
  const [highlightBoxes, setHighlightBoxes] = useState<
    { left: number; top: number; width: number; height: number }[]
  >([]);

  // Reflowed text pages
  const [textPages, setTextPages] = useState<DocumentPage[]>([]);
  const [isLoadingText, setIsLoadingText] = useState(false);

  // Retrying state
  const [isRetrying, setIsRetrying] = useState(false);

  // Sync with incoming props when document or evidence changes
  useEffect(() => {
    if (evidenceSnippet) {
      setCurrentEvidence({
        snippet: evidenceSnippet,
        page: evidencePage || initialPage || 1,
      });
      setActiveSearch(evidenceSnippet);
      setSearchInput(evidenceSnippet);
      if (evidencePage && evidencePage > 0) {
        setPage(evidencePage);
      }
    } else if (initialSearch) {
      setActiveSearch(initialSearch);
      setSearchInput(initialSearch);
    }
    if (initialPage && initialPage > 0) {
      setPage(initialPage);
    }
  }, [evidenceSnippet, evidencePage, initialPage, initialSearch]);

  // Calculate Fit-to-Width and Fit-to-Page
  const calculateFitScale = useCallback(
    (unscaledViewport: { width: number; height: number }, mode: "page" | "width" = "page") => {
      if (!stageContainerRef.current) return 0.9;
      const availW = Math.max(300, stageContainerRef.current.clientWidth - (isThumbnailsOpen ? 64 : 48));
      const availH = Math.max(300, stageContainerRef.current.clientHeight - 48);
      if (mode === "width") {
        return Math.max(0.4, Math.min(2.5, Math.round((availW / unscaledViewport.width) * 100) / 100));
      }
      const scaleFactor = Math.min(availW / unscaledViewport.width, availH / unscaledViewport.height);
      return Math.max(0.4, Math.min(2.0, Math.round(scaleFactor * 100) / 100));
    },
    [isThumbnailsOpen],
  );

  const handleFit = async (mode: "page" | "width") => {
    if (!pdf) return;
    try {
      const pdfPage = await pdf.getPage(page);
      const unscaled = pdfPage.getViewport({ scale: 1.0 });
      const fitScale = calculateFitScale(unscaled, mode);
      setScale(fitScale);
    } catch {
      setScale(mode === "width" ? 1.1 : 0.9);
    }
  };

  // Load PDF Binary Data
  useEffect(() => {
    if (!document || !document.id) {
      setPdf(null);
      setLoadStage("idle");
      return;
    }

    let cancelled = false;
    let objectUrl = "";
    setError("");
    setLoadStage("downloading");
    setDownloadPercent(0);
    setPdf(null);
    setHasAutoFitted(false);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

        const response = await authenticatedFetch(
          `${API}/documents/${document.id}/content`,
          token,
        );

        if (response.status === 401) {
          expireSession();
          return;
        }

        if (!response.ok) {
          // If PDF content is unavailable, try switching to text view
          if (response.status === 404) {
            setViewMode("text");
            setLoadStage("ready");
            return;
          }
          throw new Error(`Failed to load document content (${response.status})`);
        }

        const total = Number(response.headers.get("content-length")) || 0;
        let data: Uint8Array;

        if (response.body && total > 0) {
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (!cancelled) {
              setDownloadPercent(Math.round((received / total) * 100));
            }
          }
          data = new Uint8Array(received);
          let offset = 0;
          for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
          }
        } else {
          data = new Uint8Array(await response.arrayBuffer());
        }

        if (cancelled) return;

        objectUrl = URL.createObjectURL(
          new Blob([data.slice().buffer], { type: "application/pdf" }),
        );
        setPdfSource(objectUrl);
        setLoadStage("opening");

        const loaded = await pdfjs.getDocument({ data }).promise;
        if (!cancelled) {
          setPdf(loaded);
          setLoadStage("rendering");
          setPage(initialPage || 1);
        }
      } catch (reason) {
        if (!cancelled) {
          const msg = reason instanceof Error ? reason.message : "Could not load this document";
          // Fallback to text view if PDF failed to render
          setError(msg);
          setViewMode("text");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document, token, initialPage]);

  // Load reflowed text pages
  useEffect(() => {
    if (!document || !document.id) {
      setTextPages([]);
      return;
    }

    let active = true;
    setIsLoadingText(true);

    fetchDocumentPages(document.id, token)
      .then((pages) => {
        if (active) {
          setTextPages(pages || []);
          setIsLoadingText(false);
        }
      })
      .catch(() => {
        if (active) {
          setTextPages([]);
          setIsLoadingText(false);
        }
      });

    return () => {
      active = false;
    };
  }, [document, token]);

  // Auto-fit scale on first load
  useEffect(() => {
    if (!pdf || hasAutoFitted) return;
    let active = true;
    (async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        if (!active) return;
        const unscaled = pdfPage.getViewport({ scale: 1.0 });
        const fitScale = calculateFitScale(unscaled, "page");
        setScale(fitScale);
        setHasAutoFitted(true);
      } catch {
        // Ignored
      }
    })();
    return () => {
      active = false;
    };
  }, [pdf, hasAutoFitted, page, calculateFitScale]);

  // Render current PDF page on Canvas with devicePixelRatio support
  useEffect(() => {
    if (viewMode !== "pdf" || !pdf || !canvas.current) return;
    let task: RenderTask | undefined;

    (async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        const dpr = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale });
        const context = canvas.current?.getContext("2d");
        if (!context || !canvas.current) return;

        // Render at high-DPI
        canvas.current.width = Math.floor(viewport.width * dpr);
        canvas.current.height = Math.floor(viewport.height * dpr);
        canvas.current.style.width = `${viewport.width}px`;
        canvas.current.style.height = `${viewport.height}px`;

        context.setTransform(1, 0, 0, 1, 0, 0);
        context.scale(dpr, dpr);

        task = pdfPage.render({
          canvas: canvas.current,
          canvasContext: context,
          viewport,
        });
        await task.promise;

        // Compute highlight bounding boxes for search or evidence
        const content = await pdfPage.getTextContent();
        const items = content.items.filter(
          (
            item,
          ): item is typeof item & {
            str: string;
            transform: number[];
            width: number;
            height: number;
          } => "str" in item && Boolean(item.str),
        );

        const joined = items.map((item) => item.str).join(" ");
        const normalized = joined.replace(/\s+/g, " ").toLowerCase();
        const requested = activeSearch
          .replace(/^[\s\u2026.]+|[\s\u2026.]+$/g, "")
          .replace(/\s+/g, " ")
          .toLowerCase();

        let matchStart = requested ? normalized.indexOf(requested) : -1;
        let matchLength = requested.length;

        if (matchStart < 0 && requested) {
          const words = requested.split(" ").filter((word) => word.length > 2);
          for (
            let width = Math.min(10, words.length);
            width >= 3 && matchStart < 0;
            width -= 1
          ) {
            for (let start = 0; start + width <= words.length; start += 1) {
              const candidate = words.slice(start, start + width).join(" ");
              const found = normalized.indexOf(candidate);
              if (found >= 0) {
                matchStart = found;
                matchLength = candidate.length;
                break;
              }
            }
          }
        }

        const boxes: {
          left: number;
          top: number;
          width: number;
          height: number;
        }[] = [];

        if (matchStart >= 0) {
          let cursor = 0;
          for (const item of items) {
            const itemStart = cursor;
            const itemEnd = cursor + item.str.length;
            cursor = itemEnd + 1;
            if (itemEnd < matchStart || itemStart > matchStart + matchLength) {
              continue;
            }
            const transform = viewport.transform;
            const source = item.transform;
            const tx = [
              transform[0] * source[0] + transform[2] * source[1],
              transform[1] * source[0] + transform[3] * source[1],
              transform[0] * source[2] + transform[2] * source[3],
              transform[1] * source[2] + transform[3] * source[3],
              transform[0] * source[4] + transform[2] * source[5] + transform[4],
              transform[1] * source[4] + transform[3] * source[5] + transform[5],
            ];
            const height = Math.max(8, Math.hypot(tx[2], tx[3]));
            boxes.push({
              left: tx[4],
              top: tx[5] - height,
              width: Math.max(4, item.width * scale),
              height,
            });
          }
        }

        setPageSize({ width: viewport.width, height: viewport.height });
        setHighlightBoxes(boxes);
        setLoadStage("ready");
      } catch {
        // Ignored or cancelled
      }
    })();

    return () => task?.cancel();
  }, [activeSearch, page, scale, pdf, viewMode]);

  // Clean up PDF on unmount
  useEffect(() => {
    return () => {
      pdf?.destroy();
    };
  }, [pdf]);

  // Search across all pages in document
  async function performSearch(queryText: string) {
    const query = queryText.trim().toLowerCase();
    if (!query) {
      setSearchResults([]);
      setActiveMatchIndex(0);
      setActiveSearch("");
      return;
    }

    setActiveSearch(query);
    setIsSearching(true);
    const matches: { page: number; snippet: string }[] = [];

    try {
      if (pdf) {
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const pdfPage = await pdf.getPage(pageNumber);
          const content = await pdfPage.getTextContent();
          const text = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .replace(/\s+/g, " ");
          const position = text.toLowerCase().indexOf(query);
          if (position >= 0) {
            const start = Math.max(0, position - 60);
            matches.push({
              page: pageNumber,
              snippet: `${start ? "…" : ""}${text.slice(start, position + query.length + 80)}${
                position + query.length + 80 < text.length ? "…" : ""
              }`,
            });
          }
        }
      } else if (textPages.length > 0) {
        for (const p of textPages) {
          const position = p.text.toLowerCase().indexOf(query);
          if (position >= 0) {
            const start = Math.max(0, position - 60);
            matches.push({
              page: p.page_number,
              snippet: `${start ? "…" : ""}${p.text.slice(start, position + query.length + 80)}${
                position + query.length + 80 < p.text.length ? "…" : ""
              }`,
            });
          }
        }
      }
      setSearchResults(matches);
      if (matches.length > 0) {
        setActiveMatchIndex(0);
        setPage(matches[0].page);
      }
    } finally {
      setIsSearching(false);
    }
  }

  const handleSearchSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    performSearch(searchInput);
  };

  const handleNextMatch = () => {
    if (searchResults.length === 0) return;
    const nextIdx = (activeMatchIndex + 1) % searchResults.length;
    setActiveMatchIndex(nextIdx);
    setPage(searchResults[nextIdx].page);
  };

  const handlePrevMatch = () => {
    if (searchResults.length === 0) return;
    const prevIdx =
      (activeMatchIndex - 1 + searchResults.length) % searchResults.length;
    setActiveMatchIndex(prevIdx);
    setPage(searchResults[prevIdx].page);
  };

  const handleRetry = async () => {
    if (!document) return;
    setIsRetrying(true);
    try {
      if (onRetryProcessing) {
        await onRetryProcessing(document.id);
      } else {
        await retryDocumentProcessing(document.id, token);
      }
    } finally {
      setIsRetrying(false);
    }
  };

  // If no document is selected
  if (!document) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[var(--paper)] text-center">
        <div className="h-16 w-16 rounded-full bg-[var(--paper-subtle)] border border-[var(--hairline)] flex items-center justify-center text-[var(--ink-muted)] mb-4 shadow-sm">
          <BookOpen size={30} className="text-[var(--ink-secondary)]" />
        </div>
        <h3 className="font-serif text-lg font-semibold text-[var(--ink)] mb-1">
          Document Reader
        </h3>
        <p className="text-xs text-[var(--ink-muted)] max-w-sm leading-relaxed mb-4">
          Select any source from the left sidebar to read, search within the
          document, and verify cited AI evidence.
        </p>
        {allSources.length > 0 && onSelectSource && (
          <div className="flex flex-wrap gap-2 justify-center max-w-md">
            {allSources.slice(0, 4).map((s) => (
              <Button
                key={s.id}
                variant="outline"
                size="xs"
                onClick={() => onSelectSource(s.id)}
                className="text-xs gap-1.5"
              >
                {getSourceIcon(s)}
                <span className="truncate max-w-[140px]">{s.filename}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const totalPages = pdf?.numPages ?? document.page_count ?? textPages.length ?? 1;
  const isFailed = document.status === "failed";
  const isIndexing = [
    "processing",
    "uploaded",
    "extracting",
    "ocr_processing",
    "indexing",
  ].includes(document.status);

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full bg-[var(--paper)] overflow-hidden">
      {/* 1. Primary Reader Sub-Bar / Header */}
      <header className="h-12 border-b border-[var(--hairline)] bg-[var(--surface)] px-4 flex items-center justify-between text-xs flex-shrink-0 z-10 gap-2">
        {/* Left: Document Info & Status */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setIsThumbnailsOpen((v) => !v)}
            className={`p-1.5 rounded-[var(--radius-sm)] border text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors cursor-pointer ${
              isThumbnailsOpen
                ? "bg-[var(--paper-subtle)] border-[var(--hairline)]"
                : "border-transparent hover:bg-[var(--surface-hover)]"
            }`}
            title={isThumbnailsOpen ? "Hide thumbnails" : "Show thumbnails"}
            aria-label="Toggle thumbnails"
          >
            {isThumbnailsOpen ? <PanelLeftClose size={15} /> : <PanelLeft size={15} />}
          </button>

          <div className="flex items-center gap-2 truncate min-w-0">
            {getSourceIcon(document)}
            <strong
              className="font-medium text-[var(--ink)] truncate max-w-xs sm:max-w-sm md:max-w-md font-sans"
              title={document.filename}
            >
              {document.filename}
            </strong>
          </div>

          {/* Status badge */}
          {isFailed ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--danger)] bg-red-50 dark:bg-red-950/30 px-2 py-0.5 rounded border border-red-200 dark:border-red-900 flex-shrink-0">
              <AlertTriangle size={11} /> Extraction Failed
            </span>
          ) : isIndexing ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-700 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-900 flex-shrink-0">
              <RefreshCw size={11} className="spin" /> Indexing
            </span>
          ) : (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-900 flex-shrink-0">
              <Check size={11} /> Ready
            </span>
          )}

          {/* Scope AI toggle button */}
          {onToggleScopeSource && (
            <button
              type="button"
              onClick={() => onToggleScopeSource(document.id)}
              className={`hidden md:inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-[var(--radius-sm)] transition-all cursor-pointer ${
                isScopedToSource
                  ? "bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] border border-[var(--ink-blue-border)] font-semibold shadow-xs"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)] border border-[var(--hairline)] bg-[var(--paper-subtle)] hover:bg-[var(--surface-hover)]"
              }`}
              title={
                isScopedToSource
                  ? "AI queries will only search this document. Click to unscope."
                  : "Scope AI assistant exclusively to this document"
              }
            >
              <Filter size={11} className={isScopedToSource ? "text-[var(--ink-blue)]" : ""} />
              <span>{isScopedToSource ? "Scoped to Source" : "Scope AI"}</span>
            </button>
          )}
        </div>

        {/* Center/Right: Navigation, Zoom & Search */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Page Turn controls */}
          <div className="flex items-center gap-1 border border-[var(--hairline)] rounded-[var(--radius-sm)] bg-[var(--paper-subtle)] px-1 py-0.5">
            <Button
              variant="ghost"
              size="xs"
              disabled={page <= 1}
              onClick={() => setPage((v) => Math.max(1, v - 1))}
              className="h-6 w-6 p-0 text-[var(--ink-muted)] hover:text-[var(--ink)]"
              title="Previous page"
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </Button>
            <span className="font-mono text-xs text-[var(--ink-muted)] px-1.5 select-none">
              <strong className="text-[var(--ink)] font-semibold">{page}</strong>
              <span className="text-[var(--ink-faint)]"> / </span>
              {totalPages}
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={page >= totalPages}
              onClick={() => setPage((v) => Math.min(totalPages, v + 1))}
              className="h-6 w-6 p-0 text-[var(--ink-muted)] hover:text-[var(--ink)]"
              title="Next page"
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </Button>
          </div>

          {/* Zoom controls (visible in PDF mode) */}
          {viewMode === "pdf" && (
            <div className="hidden lg:flex items-center gap-1 border border-[var(--hairline)] rounded-[var(--radius-sm)] bg-[var(--paper-subtle)] px-1 py-0.5">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setScale((v) => Math.max(0.35, Number((v - 0.15).toFixed(2))))}
                className="h-6 w-6 p-0 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                title="Zoom out"
                aria-label="Zoom out"
              >
                <ZoomOut size={13} />
              </Button>
              <span className="font-mono text-[11px] text-[var(--ink-muted)] min-w-[3.5ch] text-center select-none">
                {Math.round(scale * 100)}%
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setScale((v) => Math.min(2.8, Number((v + 0.15).toFixed(2))))}
                className="h-6 w-6 p-0 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                title="Zoom in"
                aria-label="Zoom in"
              >
                <ZoomIn size={13} />
              </Button>
              <button
                type="button"
                onClick={() => handleFit("page")}
                className="text-[10px] font-mono px-1.5 py-0.5 text-[var(--ink-muted)] hover:text-[var(--ink)] rounded hover:bg-[var(--surface-hover)] cursor-pointer"
                title="Fit full page to view"
              >
                Fit
              </button>
              <button
                type="button"
                onClick={() => handleFit("width")}
                className="text-[10px] font-mono px-1.5 py-0.5 text-[var(--ink-muted)] hover:text-[var(--ink)] rounded hover:bg-[var(--surface-hover)] cursor-pointer"
                title="Fit page width"
              >
                Width
              </button>
            </div>
          )}

          {/* View mode toggle (PDF vs Reflowed Text) */}
          <div className="flex items-center border border-[var(--hairline)] rounded-[var(--radius-sm)] p-0.5 bg-[var(--paper-subtle)]">
            <button
              type="button"
              onClick={() => setViewMode("pdf")}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-all cursor-pointer ${
                viewMode === "pdf"
                  ? "bg-[var(--surface)] text-[var(--ink)] shadow-xs font-semibold"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
              title="Paginated PDF Canvas"
            >
              PDF
            </button>
            <button
              type="button"
              onClick={() => setViewMode("text")}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-all cursor-pointer ${
                viewMode === "text"
                  ? "bg-[var(--surface)] text-[var(--ink)] shadow-xs font-semibold"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
              title="Reflowed Reading Text"
            >
              Text
            </button>
          </div>

          {/* In-Document Search Form */}
          <form onSubmit={handleSearchSubmit} className="relative flex items-center">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Find in document…"
              className="h-7 w-32 sm:w-44 px-2 pl-6 pr-12 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] text-xs text-[var(--ink)] placeholder:text-[var(--ink-faint)] outline-none focus:border-[var(--ink-blue)] transition-all"
            />
            {isSearching ? (
              <RefreshCw
                size={11}
                className="spin absolute left-2 text-[var(--ink-blue)] pointer-events-none"
              />
            ) : (
              <Search
                size={12}
                className="absolute left-2 text-[var(--ink-muted)] pointer-events-none"
              />
            )}
            {searchResults.length > 0 && (
              <div className="absolute right-1 flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={handlePrevMatch}
                  className="p-0.5 text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
                  title="Previous match"
                >
                  <ChevronUp size={11} />
                </button>
                <button
                  type="button"
                  onClick={handleNextMatch}
                  className="p-0.5 text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
                  title="Next match"
                >
                  <ChevronDown size={11} />
                </button>
              </div>
            )}
            {searchInput && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setActiveSearch("");
                  setSearchResults([]);
                }}
                className="absolute right-6 text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer"
                title="Clear search"
              >
                <X size={11} />
              </button>
            )}
          </form>

          {/* Search match counter */}
          {searchResults.length > 0 && (
            <span className="hidden sm:inline-block text-[10px] font-mono text-[var(--ink-muted)] bg-[var(--paper-subtle)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">
              {activeMatchIndex + 1}/{searchResults.length}
            </span>
          )}

          {/* Open in new tab if PDF is loaded */}
          {pdfSource && (
            <Button
              variant="ghost"
              size="xs"
              className="h-7 w-7 p-0 text-[var(--ink-muted)] hover:text-[var(--ink)]"
              onClick={() =>
                window.open(pdfSource, "_blank", "noopener,noreferrer")
              }
              title="Open PDF in new tab"
              aria-label="Open PDF in new tab"
            >
              <ExternalLink size={14} />
            </Button>
          )}

          {/* Download Original */}
          <Button
            variant="ghost"
            size="xs"
            className="h-7 w-7 p-0 text-[var(--ink-muted)] hover:text-[var(--ink)]"
            onClick={() =>
              window.open(`${API}/documents/${document.id}/download`, "_blank")
            }
            title="Download original file"
            aria-label="Download original"
          >
            <Download size={14} />
          </Button>

          {/* Close button if provided */}
          {onClose && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onClose}
              className="h-7 w-7 p-0 text-[var(--ink-muted)] hover:text-[var(--ink)]"
              title="Close reader"
              aria-label="Close reader"
            >
              <X size={15} />
            </Button>
          )}
        </div>
      </header>

      {/* 2. Evidence Highlight Banner */}
      {currentEvidence && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/60 px-4 py-2 flex items-center justify-between text-xs gap-3 flex-shrink-0 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={14} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span className="font-semibold text-amber-900 dark:text-amber-200 flex-shrink-0">
              Cited Evidence · Page {currentEvidence.page}:
            </span>
            <span className="italic text-amber-800 dark:text-amber-300 truncate font-serif select-text">
              &ldquo;{currentEvidence.snippet}&rdquo;
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {page !== currentEvidence.page && (
              <button
                type="button"
                onClick={() => setPage(currentEvidence.page)}
                className="text-[11px] font-medium text-amber-900 dark:text-amber-200 underline hover:no-underline cursor-pointer"
              >
                Go to Page {currentEvidence.page}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setCurrentEvidence(null);
                setActiveSearch("");
              }}
              className="p-1 text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200 rounded cursor-pointer"
              title="Dismiss highlight banner"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* 3. Main Stage: Thumbnails (Left) + Document Stage (Center) */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Thumbnails Sidebar */}
        {isThumbnailsOpen && (
          <aside className="w-48 flex-shrink-0 border-r border-[var(--hairline)] bg-[var(--paper)] p-3 overflow-y-auto space-y-2 select-none">
            <div className="flex items-center justify-between text-[11px] text-[var(--ink-muted)] mb-1">
              <span className="font-mono uppercase tracking-wider text-[10px]">
                Pages ({totalPages})
              </span>
            </div>

            {pdf ? (
              Array.from({ length: pdf.numPages }, (_, idx) => {
                const pageNum = idx + 1;
                const isEv = currentEvidence?.page === pageNum;
                const hasMatch = searchResults.some((m) => m.page === pageNum);
                return (
                  <PdfThumbnail
                    key={pageNum}
                    pdf={pdf}
                    pageNumber={pageNum}
                    current={page === pageNum}
                    isEvidencePage={isEv}
                    hasMatches={hasMatch}
                    onSelect={() => setPage(pageNum)}
                  />
                );
              })
            ) : (
              // Fallback text page cards
              Array.from({ length: totalPages }, (_, idx) => {
                const pageNum = idx + 1;
                const isEv = currentEvidence?.page === pageNum;
                const hasMatch = searchResults.some((m) => m.page === pageNum);
                return (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setPage(pageNum)}
                    className={`w-full p-2.5 rounded-[var(--radius-sm)] border text-left flex items-center justify-between text-xs cursor-pointer transition-all ${
                      page === pageNum
                        ? "border-[var(--ink-blue)] bg-[var(--surface)] font-semibold text-[var(--ink)] shadow-xs ring-1 ring-[var(--ink-blue)]"
                        : isEv
                          ? "border-amber-500 bg-amber-50/50 text-amber-900"
                          : "border-[var(--hairline)] bg-[var(--paper-subtle)] text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    <span>Page {pageNum}</span>
                    {isEv && (
                      <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1 rounded">
                        Cited
                      </span>
                    )}
                    {hasMatch && !isEv && (
                      <span className="text-[9px] font-bold text-[var(--ink-blue)] bg-[var(--ink-blue-subtle)] px-1 rounded">
                        Match
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </aside>
        )}

        {/* Main Canvas / Reading Stage */}
        <div
          ref={stageContainerRef}
          className="flex-1 overflow-auto bg-[var(--paper-subtle)] p-4 sm:p-6 flex flex-col items-center min-w-0 min-h-0 relative"
        >
          {/* Loading Progress State */}
          {loadStage === "downloading" && downloadPercent !== null && (
            <div className="my-auto flex flex-col items-center justify-center p-8 text-center max-w-sm">
              <RefreshCw size={24} className="spin text-[var(--ink-blue)] mb-3" />
              <p className="font-medium text-xs text-[var(--ink)] mb-1">
                Loading document…
              </p>
              <div className="w-48 h-1.5 bg-[var(--paper)] rounded-full overflow-hidden border border-[var(--hairline)] mt-2">
                <div
                  className="h-full bg-[var(--ink-blue)] transition-all duration-150"
                  style={{ width: `${downloadPercent}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-[var(--ink-muted)] mt-1">
                {downloadPercent}%
              </span>
            </div>
          )}

          {/* Error message banner */}
          {error && !isFailed && (
            <div className="mb-4 w-full max-w-2xl p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-[var(--radius-sm)] flex items-center gap-2 text-xs text-rose-800 dark:text-rose-200">
              <AlertTriangle size={14} className="text-rose-600 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Indexing state message */}
          {isIndexing && loadStage !== "downloading" && (
            <div className="mb-4 w-full max-w-2xl p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-[var(--radius-sm)] flex items-center justify-between text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-2">
                <RefreshCw size={14} className="spin text-amber-600" />
                <span>
                  This document is being processed and indexed for grounded AI
                  research. Full-text search and citations will be available shortly.
                </span>
              </div>
            </div>
          )}

          {/* Failed state message with retry button */}
          {isFailed && (
            <div className="my-auto flex flex-col items-center justify-center p-8 text-center max-w-md bg-[var(--surface)] border border-red-200 dark:border-red-900 rounded-[var(--radius-lg)] shadow-sm">
              <AlertTriangle size={32} className="text-rose-600 mb-3" />
              <h4 className="font-serif text-sm font-semibold text-[var(--ink)] mb-1">
                Extraction &amp; Processing Failed
              </h4>
              <p className="text-xs text-[var(--ink-muted)] mb-4 leading-relaxed">
                {document.error_message ||
                  "Groundwork encountered an issue reading or parsing this document. You can retry processing or view the original."}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleRetry}
                  disabled={isRetrying}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw size={13} className={isRetrying ? "spin" : ""} />
                  <span>{isRetrying ? "Retrying…" : "Retry Processing"}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(`${API}/documents/${document.id}/download`, "_blank")
                  }
                  className="gap-1.5 text-xs"
                >
                  <Download size={13} />
                  <span>Download Original</span>
                </Button>
              </div>
            </div>
          )}

          {/* View Mode 1: Paginated PDF Canvas View */}
          {!isFailed && viewMode === "pdf" && (
            <div
              className="relative bg-white shadow-[var(--shadow-modal)] rounded-[2px] transition-transform duration-100 my-auto"
              style={{
                width: pageSize.width || undefined,
                height: pageSize.height || undefined,
              }}
            >
              <canvas ref={canvas} className="block select-none" />

              {/* PDF Highlight Layer */}
              <div
                className="pdf-highlight-layer absolute inset-0 pointer-events-none"
                aria-hidden="true"
              >
                {highlightBoxes.map((box, idx) => (
                  <mark
                    key={idx}
                    className="absolute bg-[rgba(217,119,6,0.32)] border-b-2 border-amber-600 shadow-[0_0_8px_rgba(217,119,6,0.35)] rounded-[1px] animate-pulse"
                    style={{
                      left: `${box.left}px`,
                      top: `${box.top}px`,
                      width: `${box.width}px`,
                      height: `${box.height}px`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* View Mode 2: Reflowed Text / Markdown Reader Mode */}
          {!isFailed && viewMode === "text" && (
            <div
              ref={textContainerRef}
              className="w-full max-w-3xl bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-md)] p-6 sm:p-8 shadow-sm space-y-6"
            >
              <div className="border-b border-[var(--hairline)] pb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-base font-semibold text-[var(--ink)]">
                    {document.filename}
                  </h2>
                  <p className="text-[11px] text-[var(--ink-muted)] mt-0.5 font-mono">
                    Reflowed reading mode · {textPages.length || document.page_count || 1} pages
                  </p>
                </div>
              </div>

              {isLoadingText ? (
                <div className="py-12 text-center text-xs text-[var(--ink-muted)]">
                  <RefreshCw size={20} className="spin mx-auto mb-2 text-[var(--ink-blue)]" />
                  <p>Loading document text…</p>
                </div>
              ) : textPages.length > 0 ? (
                <div className="space-y-8 divide-y divide-[var(--hairline-subtle)]">
                  {textPages.map((tp) => {
                    const isPageActive = page === tp.page_number;
                    const isEvidence = currentEvidence?.page === tp.page_number;

                    return (
                      <article
                        key={tp.id || tp.page_number}
                        id={`text-page-${tp.page_number}`}
                        className={`pt-6 first:pt-0 transition-colors ${
                          isPageActive ? "relative" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs text-[var(--ink-muted)] font-mono mb-3">
                          <span className="flex items-center gap-1.5 font-semibold text-[var(--ink)]">
                            <span>Page {tp.page_number}</span>
                            {isEvidence && (
                              <span className="text-[10px] font-bold text-amber-700 bg-amber-100 dark:bg-amber-950/50 dark:text-amber-300 px-1.5 py-0.2 rounded border border-amber-300 dark:border-amber-800">
                                Cited Evidence
                              </span>
                            )}
                          </span>
                        </div>

                        <div className="prose prose-sm font-serif text-[var(--ink)] leading-relaxed whitespace-pre-wrap select-text text-sm sm:text-base">
                          {activeSearch && tp.text.toLowerCase().includes(activeSearch.toLowerCase()) ? (
                            tp.text.split(new RegExp(`(${activeSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")).map((chunk, i) =>
                              chunk.toLowerCase() === activeSearch.toLowerCase() ? (
                                <mark
                                  key={i}
                                  className="bg-amber-200/90 dark:bg-amber-900/70 text-amber-950 dark:text-amber-100 font-medium px-0.5 rounded shadow-xs"
                                >
                                  {chunk}
                                </mark>
                              ) : (
                                chunk
                              ),
                            )
                          ) : (
                            tp.text
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-[var(--ink-muted)]">
                  <p>No extracted text available for this document.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentReader;
