import React, { FormEvent, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  RefreshCw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  FileText,
} from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "../../components/ui/Button";
import { API, authenticatedFetch, expireSession } from "../../api/client";
import type { DocumentItem } from "../../types";

const PDF_WORKER_URL = `${pdfWorkerUrl}?worker=v2`;

function PdfThumbnail({
  pdf,
  pageNumber,
  current,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  current: boolean;
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
      { rootMargin: "160px" },
    );
    observer.observe(button.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    (async () => {
      const pdfPage = await pdf.getPage(pageNumber);
      if (cancelled || !canvas.current) return;
      const viewport = pdfPage.getViewport({ scale: 0.2 });
      const context = canvas.current.getContext("2d");
      if (!context) return;
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      task = pdfPage.render({ canvas: canvas.current, canvasContext: context, viewport });
      await task.promise;
    })().catch(() => undefined);
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
      className={`w-full p-2 rounded-[var(--radius-sm)] border transition-all text-left flex flex-col items-center gap-1.5 cursor-pointer ${
        current
          ? "border-[var(--ink-blue)] bg-[var(--surface)] shadow-[var(--shadow-subtle)]"
          : "border-[var(--hairline)] bg-[var(--paper-subtle)] hover:bg-[var(--surface-hover)]"
      }`}
    >
      <canvas ref={canvas} className="w-full bg-white shadow-xs rounded-[2px]" />
      <span className="text-[11px] font-mono text-[var(--ink-muted)]">Page {pageNumber}</span>
    </button>
  );
}

export interface PdfViewerModalProps {
  document: DocumentItem;
  token: string;
  initialPage?: number;
  initialSearch?: string;
  onClose: () => void;
}

export const PdfViewerModal: React.FC<PdfViewerModalProps> = ({
  document,
  token,
  initialPage = 1,
  initialSearch = "",
  onClose,
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pdfSource, setPdfSource] = useState("");
  const [page, setPage] = useState(initialPage);
  const [scale, setScale] = useState(1.2);
  const [activeSearch, setActiveSearch] = useState(initialSearch);
  const [highlightBoxes, setHighlightBoxes] = useState<
    { left: number; top: number; width: number; height: number }[]
  >([]);
  const [citationStatus, setCitationStatus] = useState<"idle" | "matched" | "not-found">("idle");
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState("");
  const [searchResults, setSearchResults] = useState<{ page: number; snippet: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [sideMode, setSideMode] = useState<"pages" | "search">("pages");
  const [loadStage, setLoadStage] = useState<"downloading" | "opening" | "rendering" | "ready">(
    "downloading",
  );
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        const response = await authenticatedFetch(
          `${API}/documents/${document.id}/content`,
          token,
        );
        if (response.status === 401) expireSession();
        if (!response.ok) throw new Error("Could not load this PDF");
        const total = Number(response.headers.get("content-length")) || 0;
        let data: Uint8Array;
        if (response.body && total) {
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (!cancelled) setDownloadPercent(Math.round((received / total) * 100));
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
        objectUrl = URL.createObjectURL(new Blob([data.slice().buffer], { type: "application/pdf" }));
        if (!cancelled) setPdfSource(objectUrl);
        if (!cancelled) setLoadStage("opening");
        const loaded = await pdfjs.getDocument({ data }).promise;
        if (!cancelled) setPdf(loaded);
        if (!cancelled) setLoadStage("rendering");
        setPage(initialPage);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not load this PDF");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document.id, token, initialPage]);

  useEffect(() => {
    let task: RenderTask | undefined;
    (async () => {
      if (!pdf || !canvas.current) return;
      const pdfPage = await pdf.getPage(page);
      const viewport = pdfPage.getViewport({ scale });
      const context = canvas.current.getContext("2d");
      if (!context) return;
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      task = pdfPage.render({ canvas: canvas.current, canvasContext: context, viewport });
      await task.promise;
      const content = await pdfPage.getTextContent();
      const items = content.items.filter(
        (item): item is typeof item & { str: string; transform: number[]; width: number; height: number } =>
          "str" in item && Boolean(item.str),
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
        for (let width = Math.min(10, words.length); width >= 3 && matchStart < 0; width -= 1) {
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
      const boxes: { left: number; top: number; width: number; height: number }[] = [];
      if (matchStart >= 0) {
        let cursor = 0;
        for (const item of items) {
          const itemStart = cursor;
          const itemEnd = cursor + item.str.length;
          cursor = itemEnd + 1;
          if (itemEnd < matchStart || itemStart > matchStart + matchLength) continue;
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
      setCitationStatus(activeSearch ? (boxes.length ? "matched" : "not-found") : "idle");
      setLoadStage("ready");
    })();
    return () => task?.cancel();
  }, [activeSearch, page, scale, pdf]);

  useEffect(() => () => {
    pdf?.destroy();
  }, [pdf]);

  async function searchPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pdf) return;
    const query = String(new FormData(event.currentTarget).get("query") ?? "")
      .trim()
      .toLowerCase();
    if (!query) {
      setSearchResults([]);
      setSideMode("pages");
      return;
    }
    setActiveSearch(query);
    setSearching(true);
    setSideMode("search");
    const matches: { page: number; snippet: string }[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const pdfPage = await pdf.getPage(pageNumber);
        const content = await pdfPage.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ");
        const position = text.toLowerCase().indexOf(query);
        if (position >= 0) {
          const start = Math.max(0, position - 70);
          matches.push({
            page: pageNumber,
            snippet: `${start ? "…" : ""}${text.slice(start, position + query.length + 110)}${
              position + query.length + 110 < text.length ? "…" : ""
            }`,
          });
        }
      }
      setSearchResults(matches);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(22,21,20,0.6)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${document.filename}`}
    >
      <div className="relative w-full max-w-5xl h-[88vh] bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-lg)] shadow-[var(--shadow-modal)] flex flex-col overflow-hidden">
        {/* Toolbar */}
        <header className="h-12 border-b border-[var(--hairline)] bg-[var(--surface)] px-4 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 truncate">
              <FileText size={15} className="text-[var(--ink-blue)] flex-shrink-0" />
              <strong className="font-semibold text-[var(--ink)] truncate max-w-xs font-sans">
                {document.filename}
              </strong>
            </div>

            <div className="flex items-center gap-1 border-l border-[var(--hairline)] pl-3">
              <Button
                variant="ghost"
                size="xs"
                disabled={page <= 1}
                onClick={() => setPage((v) => v - 1)}
              >
                <ChevronLeft size={14} />
              </Button>
              <span className="font-mono text-xs text-[var(--ink-muted)]">
                {page} / {pdf?.numPages ?? document.page_count ?? "…"}
              </span>
              <Button
                variant="ghost"
                size="xs"
                disabled={page >= (pdf?.numPages ?? 1)}
                onClick={() => setPage((v) => v + 1)}
              >
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setScale((v) => Math.max(0.6, v - 0.2))}
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setScale((v) => Math.min(2.4, v + 0.2))}
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </Button>

            <form onSubmit={searchPdf} className="relative flex items-center">
              <input
                name="query"
                placeholder="Search text…"
                className="h-7 px-2 pl-6 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] text-xs text-[var(--ink)] placeholder:text-[var(--ink-faint)] outline-none focus:border-[var(--ink-blue)]"
              />
              <Search size={12} className="absolute left-2 text-[var(--ink-muted)] pointer-events-none" />
            </form>

            {citationStatus === "matched" && (
              <span className="text-[11px] font-mono text-[var(--success)] bg-[var(--success-bg)] px-2 py-0.5 rounded border border-[var(--success-border)]">
                Evidence highlighted
              </span>
            )}

            {pdfSource && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => window.open(pdfSource, "_blank", "noopener,noreferrer")}
                title="Open in new tab"
              >
                <ExternalLink size={14} />
              </Button>
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
        </header>

        {/* Body Stage */}
        <div className="flex-1 flex overflow-hidden">
          {/* Thumbnails Sidebar */}
          <aside className="w-48 border-r border-[var(--hairline)] bg-[var(--paper)] p-3 overflow-y-auto space-y-2">
            {pdf &&
              Array.from({ length: pdf.numPages }, (_, idx) => (
                <PdfThumbnail
                  key={idx + 1}
                  pdf={pdf}
                  pageNumber={idx + 1}
                  current={page === idx + 1}
                  onSelect={() => setPage(idx + 1)}
                />
              ))}
          </aside>

          {/* Main Canvas Stage */}
          <div className="flex-1 overflow-auto bg-[var(--paper-subtle)] p-6 flex items-center justify-center">
            {error ? (
              <p className="text-xs text-[var(--danger)]">{error}</p>
            ) : (
              <div
                className="relative bg-white shadow-[var(--shadow-modal)] rounded-[2px]"
                style={{ width: pageSize.width || undefined, height: pageSize.height || undefined }}
              >
                <canvas ref={canvas} className="block" />
                <div className="pdf-highlight-layer absolute inset-0 pointer-events-none" aria-hidden="true">
                  {highlightBoxes.map((box, idx) => (
                    <mark
                      key={idx}
                      className="absolute bg-[rgba(138,109,75,0.3)] border-b border-[var(--ink-sepia)]"
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default PdfViewerModal;
