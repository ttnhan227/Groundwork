import { Activity, Check, Download, ExternalLink, FileImage, FileText, RefreshCw, Scissors, Search, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Artifact, ArtifactVersion, AuthResult, DocumentItem, Job, NativeDocument, Stats, Workspace } from "../../types";
import { BrandMark } from "../../components/common/BrandMark";
import { CommandPalette, type WorkspaceCommand } from "./CommandPalette";
import { API, AUTH_EXPIRED_EVENT, AUTH_REFRESHED_EVENT, api, authenticatedFetch, expireSession, queueOperation, waitForJob } from "../../api/client";
import { AccountPanel as AccountSettingsPanel } from "../account/AccountPanel";
import { NotificationCenter } from "../account/NotificationCenter";
import { applyPreferences, storedPreferences, type UserPreferences } from "../account/preferences";
import { NotebookLibrary } from "./NotebookLibrary";
import { NotebookWorkspace } from "./NotebookWorkspace";

const PDF_WORKER_URL = `${pdfWorkerUrl}?worker=v2`;
const REGISTRATION_ENABLED = (import.meta.env.VITE_REGISTRATION_ENABLED ?? "true").toLowerCase() !== "false";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";

type GoogleCredentialResponse = { credential: string };
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void;
          renderButton: (element: HTMLElement, options: Record<string, string | number>) => void;
        };
      };
    };
  }
}

function GoogleSignInButton({ disabled, onCredential, onError }: {
  disabled: boolean;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || disabled) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !buttonRef.current || !window.google) return;
      buttonRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => onCredential(response.credential),
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        width: Math.min(360, buttonRef.current.clientWidth || 360),
      });
    };

    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      if (window.google) render();
      else existing.addEventListener("load", render, { once: true });
      return () => { cancelled = true; existing.removeEventListener("load", render); };
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = render;
    script.onerror = () => onError("Google sign-in could not be loaded. Check your connection and try again.");
    document.head.appendChild(script);
    return () => { cancelled = true; };
  }, [disabled, onCredential, onError]);

  if (!GOOGLE_CLIENT_ID) {
    return <button className="auth-google-disabled" type="button" disabled title="Add VITE_GOOGLE_CLIENT_ID to enable Google sign-in">Google sign-in is not configured</button>;
  }
  return <div className={`auth-google-button ${disabled ? "disabled" : ""}`} ref={buttonRef} aria-label="Continue with Google" />;
}

const authSchema = z.object({
  display_name: z.string().trim().max(120).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
type AuthFields = z.infer<typeof authSchema>;

function PdfThumbnail({ pdf, pageNumber, current, onSelect }: { pdf: PDFDocumentProxy; pageNumber: number; current: boolean; onSelect: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!button.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "160px" });
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
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, pageNumber, visible]);

  return (
    <button ref={button} className={`pdf-thumbnail ${current ? "current" : ""}`} onClick={onSelect}>
      <canvas ref={canvas} /><span>Page {pageNumber}</span>
    </button>
  );
}

function ArtifactViewer({ artifact, document, token, initialPage = 1, initialSearch = "", onClose }: {
  artifact?: Artifact;
  document?: DocumentItem;
  token: string;
  initialPage?: number;
  initialSearch?: string;
  onClose: () => void;
}) {
  const [source, setSource] = useState("");
  const [textPreview, setTextPreview] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [documentSearch, setDocumentSearch] = useState(initialSearch);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const filename = artifact?.filename ?? document?.filename ?? "Document";
  const contentType = artifact?.content_type ?? "application/pdf";
  const sizeBytes = artifact?.size_bytes ?? document?.size_bytes ?? 0;
  const description = artifact?.operation.replaceAll("_", " ") ?? `${document?.page_count ?? "—"} pages`;
  const isPdf = contentType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
  const isImage = contentType.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(filename);
  const isText = contentType.startsWith("text/") || /\.(md|txt)$/i.test(filename);

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    const endpoint = document
      ? `${API}/documents/${document.id}/content`
      : isPdf || isImage || isText
        ? `${API}/pdf-tools/artifacts/${artifact!.id}/download`
        : `${API}/pdf-tools/artifacts/${artifact!.id}/thumbnail`;
    authenticatedFetch(endpoint, token).then(async (response) => {
      if (!response.ok) throw new Error("Preview unavailable");
      if (isText) {
        const blob = await response.blob();
        const value = await blob.text();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setTextPreview(value);
          setSource(objectUrl);
        }
      } else {
        objectUrl = URL.createObjectURL(await response.blob());
        if (!cancelled) {
          const parameters = new URLSearchParams();
          if (initialPage > 1) parameters.set("page", String(initialPage));
          if (initialSearch.trim()) parameters.set("search", initialSearch.trim().slice(0, 180));
          setSource(isPdf && parameters.size ? `${objectUrl}#${parameters.toString()}` : objectUrl);
        }
      }
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Preview unavailable"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact, document, initialPage, initialSearch, isImage, isPdf, isText, token]);

  function searchOpenPDF(event: FormEvent) {
    event.preventDefault();
    if (!isPdf || !source || !documentSearch.trim()) return;
    const base = source.split("#")[0];
    const parameters = new URLSearchParams();
    parameters.set("page", String(initialPage));
    parameters.set("search", documentSearch.trim().slice(0, 180));
    setSource(`${base}#${parameters.toString()}`);
  }

  async function openVersions() {
    if (!artifact) return;
    setVersionsOpen((current) => !current);
    if (!versions.length) {
      setVersions(await api<ArtifactVersion[]>(`/pdf-tools/artifacts/${artifact.id}/versions`, token));
    }
  }

  async function restoreVersion(version: ArtifactVersion) {
    if (!artifact) return;
    const restored = await api<ArtifactVersion>(`/pdf-tools/artifacts/${artifact.id}/versions/restore`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version_id: version.id }),
    });
    setVersions((current) => [restored, ...current]);
    setVersionsOpen(false);
  }

  return (
    <div className="artifact-viewer-wrap">
      <button className="history-backdrop" aria-label="Close file preview" onClick={onClose} />
      <section className="artifact-viewer" role="dialog" aria-modal="true" aria-label={`Preview ${filename}`}>
        <header>
          <div><strong>{filename}</strong><small>{description} · {(sizeBytes / 1024 / 1024).toFixed(1)} MB</small></div>
          {isPdf && <form className="artifact-viewer-search" onSubmit={searchOpenPDF}><Search size={14} /><input aria-label="Search within document" value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} placeholder="Search this document" /><button type="submit">Find</button></form>}
          {artifact && <button onClick={() => openVersions().catch((reason) => setError(reason.message))}>Versions</button>}
          {source && <button onClick={() => window.open(source, "_blank", "noopener,noreferrer")}><ExternalLink size={15} /> Open in new tab</button>}
          <button aria-label="Close preview" onClick={onClose}><X size={18} /></button>
        </header>
        {versionsOpen && <aside className="artifact-version-popover"><header><strong>Version history</strong><span>{versions.length} versions</span></header>{versions.map((version) => <article key={version.id}><div><strong>Version {version.version_number}</strong><small>{version.change_prompt || "File created"} · {new Date(version.created_at).toLocaleString()}</small></div>{version.version_number !== versions[0]?.version_number && <button onClick={() => restoreVersion(version).catch((reason) => setError(reason.message))}>Restore</button>}</article>)}</aside>}
        <main className={isPdf ? "pdf" : isImage ? "image" : isText ? "text" : "generated"}>
          {loading && <div className="artifact-viewer-loading"><RefreshCw className="spin" size={22} /><strong>Opening preview…</strong></div>}
          {error && <div className="artifact-viewer-loading"><FileText size={28} /><strong>{error}</strong><span>Download the file to view it in its native application.</span></div>}
          {!loading && !error && isPdf && source && <iframe src={source} title={filename} />}
          {!loading && !error && isImage && source && <img src={source} alt={filename} />}
          {!loading && !error && isText && <pre>{textPreview}</pre>}
          {!loading && !error && !isPdf && !isImage && !isText && source && <div className="generated-preview-sheet"><img src={source} alt={`Generated preview of ${filename}`} /><small>Content preview · Download to edit or inspect the original file.</small></div>}
        </main>
      </section>
    </div>
  );
}

function PdfViewer({ document, token, initialPage = 1, initialSearch = "", onClose }: { document: DocumentItem; token: string; initialPage?: number; initialSearch?: string; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pdfSource, setPdfSource] = useState("");
  const [page, setPage] = useState(initialPage);
  const [scale, setScale] = useState(1.2);
  const [activeSearch, setActiveSearch] = useState(initialSearch);
  const [highlightBoxes, setHighlightBoxes] = useState<{ left: number; top: number; width: number; height: number }[]>([]);
  const [citationStatus, setCitationStatus] = useState<"idle" | "matched" | "not-found">("idle");
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState("");
  const [searchResults, setSearchResults] = useState<{ page: number; snippet: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [sideMode, setSideMode] = useState<"pages" | "search">("pages");
  const [loadStage, setLoadStage] = useState<"downloading" | "opening" | "rendering" | "ready">("downloading");
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        const response = await authenticatedFetch(`${API}/documents/${document.id}/content`, token);
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
            if (!cancelled) setDownloadPercent(Math.round(received / total * 100));
          }
          data = new Uint8Array(received);
          let offset = 0;
          for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
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
      const items = content.items.filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => "str" in item && Boolean(item.str));
      const joined = items.map((item) => item.str).join(" ");
      const normalized = joined.replace(/\s+/g, " ").toLowerCase();
      const requested = activeSearch.replace(/^[\s\u2026.]+|[\s\u2026.]+$/g, "").replace(/\s+/g, " ").toLowerCase();
      let matchStart = requested ? normalized.indexOf(requested) : -1;
      let matchLength = requested.length;
      if (matchStart < 0 && requested) {
        const words = requested.split(" ").filter((word) => word.length > 2);
        for (let width = Math.min(10, words.length); width >= 3 && matchStart < 0; width -= 1) {
          for (let start = 0; start + width <= words.length; start += 1) {
            const candidate = words.slice(start, start + width).join(" ");
            const found = normalized.indexOf(candidate);
            if (found >= 0) { matchStart = found; matchLength = candidate.length; break; }
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

  useEffect(() => () => { pdf?.destroy(); }, [pdf]);

  async function searchPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pdf) return;
    const query = String(new FormData(event.currentTarget).get("query") ?? "").trim().toLowerCase();
    if (!query) { setSearchResults([]); setSideMode("pages"); return; }
    setActiveSearch(query);
    setSearching(true);
    setSideMode("search");
    const matches: { page: number; snippet: string }[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const pdfPage = await pdf.getPage(pageNumber);
        const content = await pdfPage.getTextContent();
        const text = content.items.map((item) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ");
        const position = text.toLowerCase().indexOf(query);
        if (position >= 0) {
          const start = Math.max(0, position - 70);
          matches.push({ page: pageNumber, snippet: `${start ? "…" : ""}${text.slice(start, position + query.length + 110)}${position + query.length + 110 < text.length ? "…" : ""}` });
        }
      }
      setSearchResults(matches);
    } finally { setSearching(false); }
  }

  return (
    <div className="viewer-wrap" role="dialog" aria-modal="true" aria-label={`Preview ${document.filename}`}>
      <div className="viewer-toolbar">
        <strong>{document.filename}</strong>
        <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
        <span>{page} / {pdf?.numPages ?? document.page_count ?? "…"}</span>
        <button disabled={page >= (pdf?.numPages ?? 1)} onClick={() => setPage((value) => value + 1)}>Next</button>
        <button aria-label="Zoom out" onClick={() => setScale((value) => Math.max(0.6, value - 0.2))}><ZoomOut size={18} /></button>
        <button aria-label="Zoom in" onClick={() => setScale((value) => Math.min(2.4, value + 0.2))}><ZoomIn size={18} /></button>
        <form className="viewer-search" onSubmit={searchPdf}><Search size={15} /><input name="query" placeholder="Search PDF" aria-label="Search PDF" /><button aria-label="Run search">Search</button></form>
        {activeSearch && citationStatus === "matched" && <span className="citation-locator matched">Source highlighted</span>}
        {activeSearch && citationStatus === "not-found" && <span className="citation-locator">Source page opened · exact text highlight unavailable</span>}
        {pdfSource && <button onClick={() => window.open(pdfSource, "_blank", "noopener,noreferrer")}><ExternalLink size={15} /> New tab</button>}
        <button className="viewer-close" aria-label="Close viewer" onClick={onClose}><X size={20} /></button>
      </div>
      <div className="viewer-body">
        <aside className="viewer-sidebar">
          <div className="viewer-side-tabs"><button className={sideMode === "pages" ? "active" : ""} onClick={() => setSideMode("pages")}>Pages</button><button className={sideMode === "search" ? "active" : ""} onClick={() => setSideMode("search")}>Results</button></div>
          {sideMode === "pages" && pdf && <div className="thumbnail-list">{Array.from({ length: pdf.numPages }, (_, index) => <PdfThumbnail key={index + 1} pdf={pdf} pageNumber={index + 1} current={page === index + 1} onSelect={() => setPage(index + 1)} />)}</div>}
          {sideMode === "search" && <div className="search-results">
            {searching && <p><RefreshCw className="spin" size={14} /> Searching all pages…</p>}
            {!searching && !searchResults.length && <p>No matches found.</p>}
            {searchResults.map((result) => <button key={result.page} onClick={() => setPage(result.page)}><b>Page {result.page}</b><span>{result.snippet}</span></button>)}
          </div>}
        </aside>
        <div className="viewer-stage">{error ? <p>{error}</p> : <>
          {loadStage !== "ready" && <div className="viewer-loading" role="status" aria-live="polite">
            <span className="viewer-loading-icon"><RefreshCw className="spin" size={22} /></span>
            <strong>{loadStage === "downloading" ? "Loading document" : loadStage === "opening" ? "Opening PDF" : "Rendering first page"}</strong>
            <small>{loadStage === "downloading" && downloadPercent !== null ? `${downloadPercent}% downloaded` : "Preparing a clear preview…"}</small>
            <i><b style={{ width: downloadPercent !== null && loadStage === "downloading" ? `${downloadPercent}%` : "38%" }} /></i>
          </div>}
          <div className="pdf-page-surface" style={{ width: pageSize.width || undefined, height: pageSize.height || undefined }}>
            <canvas ref={canvas} className={loadStage === "ready" ? "" : "viewer-canvas-loading"} />
            <div className="pdf-highlight-layer" aria-hidden="true">
              {highlightBoxes.map((box, index) => <mark key={index} style={box} />)}
            </div>
          </div>
        </>}</div>
      </div>
    </div>
  );
}

async function downloadArtifact(artifact: Artifact, token: string) {
  const response = await authenticatedFetch(`${API}/pdf-tools/artifacts/${artifact.id}/download`, token);
  if (!response.ok) throw new Error("Could not download generated file");
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = window.document.createElement("a");
  link.href = url; link.download = artifact.filename; link.click(); URL.revokeObjectURL(url);
}

function PDFToolsWorkspace({ documents, token, initialDocument, onClose }: { documents: DocumentItem[]; token: string; initialDocument: DocumentItem | null; onClose: () => void }) {
  const [tool, setTool] = useState("merge");
  const [documentId, setDocumentId] = useState(initialDocument?.id ?? documents[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>(initialDocument ? [initialDocument.id] : []);
  const [pages, setPages] = useState("1");
  const [ranges, setRanges] = useState("1");
  const [degrees, setDegrees] = useState(90);
  const [splitMode, setSplitMode] = useState("ranges");
  const [imageFormat, setImageFormat] = useState("png");
  const [dpi, setDpi] = useState(144);
  const [images, setImages] = useState<File[]>([]);
  const [saveSourceImages, setSaveSourceImages] = useState(false);
  const [wordFile, setWordFile] = useState<File | null>(null);
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
  const [watermarkImage, setWatermarkImage] = useState<File | null>(null);
  const [position, setPosition] = useState("center");
  const [opacity, setOpacity] = useState(0.25);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pageNumbers = () => pages.split(",").map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0);

  useEffect(() => {
    api<Artifact[]>("/pdf-tools/artifacts", token).then(setArtifacts).catch(() => undefined);
  }, [token]);

  async function run() {
    setBusy(true); setError(""); setArtifact(null);
    try {
      let generated: Artifact;
      if (tool === "images-to-pdf") {
        const data = new FormData(); images.forEach((image) => data.append("files", image));
        data.append("save_sources", String(saveSourceImages));
        const queued = await api<Job>("/jobs/images-to-pdf", token, { method: "POST", body: data });
        const job = await waitForJob(queued, token);
        generated = await api<Artifact>(`/pdf-tools/artifacts/${job.result_id}`, token);
      } else if (tool === "word-to-pdf" || tool === "word-to-markdown") {
        const data = new FormData();
        if (wordFile) data.append("file", wordFile);
        data.append("target", tool === "word-to-pdf" ? "pdf" : "markdown");
        const queued = await api<Job>("/jobs/convert-docx", token, { method: "POST", body: data });
        const job = await waitForJob(queued, token);
        generated = await api<Artifact>(`/pdf-tools/artifacts/${job.result_id}`, token);
      } else if (tool === "watermark" && watermarkImage) {
        const data = new FormData(); data.append("document_id", documentId); data.append("text", watermarkText);
        data.append("page_numbers", pages); data.append("position", position); data.append("opacity", String(opacity)); data.append("rotation", "0");
        if (watermarkImage) data.append("image", watermarkImage);
        const queued = await api<Job>("/jobs/watermark", token, { method: "POST", body: data });
        const job = await waitForJob(queued, token);
        generated = await api<Artifact>(`/pdf-tools/artifacts/${job.result_id}`, token);
      } else {
        let body: Record<string, unknown> = { document_id: documentId };
        if (tool === "merge") body = { document_ids: selected };
        if (["extract", "delete-pages"].includes(tool)) body.page_numbers = pageNumbers();
        if (tool === "rotate") body = { ...body, page_numbers: pageNumbers(), degrees };
        if (tool === "split") body = { ...body, mode: splitMode, ranges: ranges.split(",").map((item) => item.trim()).filter(Boolean), page_numbers: pageNumbers() };
        if (tool === "pdf-to-images") body = { ...body, page_numbers: pages.trim() ? pageNumbers() : null, format: imageFormat, dpi };
        if (tool === "watermark") body = { ...body, text: watermarkText, page_numbers: pageNumbers(), position, opacity, rotation: 0 };
        const operationNames: Record<string, string> = {
          extract: "extract_pages",
          "delete-pages": "delete_pages",
          "pdf-to-images": "pdf_to_images",
          "pdf-to-word": "pdf_to_docx",
        };
        const job = await queueOperation(operationNames[tool] ?? tool, body, token);
        generated = await api<Artifact>(`/pdf-tools/artifacts/${job.result_id}`, token);
      }
      setArtifact(generated); setArtifacts((current) => [generated, ...current.filter((item) => item.id !== generated.id)]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "PDF operation failed"); }
    finally { setBusy(false); }
  }

  const tools = [
    ["merge", "Merge"], ["split", "Split"], ["extract", "Extract pages"], ["delete-pages", "Delete pages"],
    ["rotate", "Rotate"], ["pdf-to-images", "PDF to images"], ["images-to-pdf", "Images to PDF"], ["watermark", "Watermark"],
    ["pdf-to-word", "PDF to Word"], ["word-to-pdf", "Word to PDF"], ["word-to-markdown", "Word to Markdown"],
  ];
  const needsWordFile = tool === "word-to-pdf" || tool === "word-to-markdown";
  const needsDocument = tool !== "merge" && tool !== "images-to-pdf" && !needsWordFile;
  const canRun = !busy && (tool === "merge" ? selected.length >= 2 : tool === "images-to-pdf" ? images.length > 0 : needsWordFile ? Boolean(wordFile) : Boolean(documentId));

  return (
    <div className="pdf-tools-wrap">
      <button className="history-backdrop" aria-label="Close PDF tools" onClick={onClose} />
      <section className="pdf-tools-panel">
        <header><div><p className="eyebrow">Document workflows</p><h2>Document tools</h2></div><button aria-label="Close document tools" onClick={onClose}><X size={18} /></button></header>
        <div className="pdf-tools-layout">
          <nav>{tools.map(([id, label]) => <button className={tool === id ? "active" : ""} key={id} onClick={() => { setTool(id); setArtifact(null); setError(""); }}>{id.includes("image") ? <FileImage size={15} /> : <Scissors size={15} />}{label}</button>)}</nav>
          <main>
            <div className="tool-heading"><h3>{tools.find(([id]) => id === tool)?.[1]}</h3><p>Outputs are stored securely and available for download.</p></div>
            <div className="tool-form">
              {needsDocument && <label>PDF<select value={documentId} onChange={(event) => setDocumentId(event.target.value)}>{documents.map((item) => <option key={item.id} value={item.id}>{item.filename} · {item.page_count} pages</option>)}</select></label>}
              {tool === "merge" && <div className="merge-picker">{documents.map((item) => <label key={item.id} className={selected.includes(item.id) ? "selected" : ""}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><FileText size={16} /><span>{item.filename}</span></label>)}</div>}
              {["extract", "delete-pages", "rotate"].includes(tool) && <label>Pages <small>Comma-separated, e.g. 1, 3, 5</small><input value={pages} onChange={(event) => setPages(event.target.value)} /></label>}
              {tool === "rotate" && <label>Rotation<select value={degrees} onChange={(event) => setDegrees(Number(event.target.value))}><option value={90}>90° clockwise</option><option value={180}>180°</option><option value={270}>270° clockwise</option></select></label>}
              {tool === "split" && <><label>Split mode<select value={splitMode} onChange={(event) => setSplitMode(event.target.value)}><option value="ranges">Page ranges</option><option value="every_page">One PDF per page</option><option value="selected">Selected pages</option></select></label>{splitMode === "ranges" ? <label>Ranges <small>Comma-separated, e.g. 1-3, 4-7</small><input value={ranges} onChange={(event) => setRanges(event.target.value)} /></label> : splitMode === "selected" ? <label>Selected pages<input value={pages} onChange={(event) => setPages(event.target.value)} /></label> : null}</>}
              {tool === "pdf-to-images" && <><label>Pages <small>Leave blank for all pages</small><input value={pages} onChange={(event) => setPages(event.target.value)} placeholder="All pages" /></label><label>Format<select value={imageFormat} onChange={(event) => setImageFormat(event.target.value)}><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label><label>Resolution<select value={dpi} onChange={(event) => setDpi(Number(event.target.value))}><option value={96}>96 DPI</option><option value={144}>144 DPI</option><option value={216}>216 DPI</option><option value={300}>300 DPI</option></select></label></>}
              {tool === "images-to-pdf" && <><label className="image-drop"><Upload size={24} />Choose PNG/JPEG images<input type="file" accept="image/png,image/jpeg" multiple onChange={(event) => setImages(Array.from(event.target.files ?? []))} /><small>{images.length ? `${images.length} image(s)` : "Up to 50 images"}</small></label>
                {images.length > 0 && <><label className="save-source-images"><input type="checkbox" checked={saveSourceImages} onChange={(event) => setSaveSourceImages(event.target.checked)} /><span><strong>Save source images to workspace</strong><small>Off by default to avoid clutter and extra storage.</small></span></label><div className="image-order-list" aria-label="Image order">{images.map((image, index) => <article key={`${image.name}-${image.lastModified}-${index}`}><span>{index + 1}. {image.name}</span><button disabled={index === 0} onClick={() => setImages((current) => current.map((item, itemIndex) => itemIndex === index - 1 ? current[index] : itemIndex === index ? current[index - 1] : item))}>Up</button><button disabled={index === images.length - 1} onClick={() => setImages((current) => current.map((item, itemIndex) => itemIndex === index + 1 ? current[index] : itemIndex === index ? current[index + 1] : item))}>Down</button><button onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></article>)}</div></>}</>}
              {needsWordFile && <label className="image-drop"><Upload size={24} />Choose a Word document<input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setWordFile(event.target.files?.[0] ?? null)} /><small>{wordFile?.name ?? "DOCX files up to 50 MB"}</small></label>}
              {tool === "watermark" && <><label>Watermark text <small>Optional when using an image</small><input value={watermarkText} onChange={(event) => setWatermarkText(event.target.value)} /></label><label>Watermark image <small>Optional PNG/JPEG</small><input type="file" accept="image/png,image/jpeg" onChange={(event) => setWatermarkImage(event.target.files?.[0] ?? null)} /></label><label>Pages <small>Leave blank for every page</small><input value={pages} onChange={(event) => setPages(event.target.value)} /></label><label>Position<select value={position} onChange={(event) => setPosition(event.target.value)}><option value="center">Center</option><option value="top_left">Top left</option><option value="top_right">Top right</option><option value="bottom_left">Bottom left</option><option value="bottom_right">Bottom right</option></select></label><label>Opacity<input type="range" min="0.05" max="1" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /><small>{Math.round(opacity * 100)}%</small></label></>}
              <button className="run-pdf-tool" disabled={!canRun} onClick={run}>{busy ? <RefreshCw className="spin" size={15} /> : <Scissors size={15} />}{busy ? "Processing…" : "Create file"}</button>
            </div>
            {error && <div className="form-error">{error}</div>}
            {artifact && <div className="artifact-ready"><Check size={25} /><div><strong>{artifact.filename}</strong><span>{(artifact.size_bytes / 1024).toFixed(1)} KB · Ready to download</span></div><button onClick={() => downloadArtifact(artifact, token).catch((reason) => setError(reason.message))}><Download size={15} /> Download</button></div>}
            <section className="artifact-history"><h4>Recent generated files</h4>{artifacts.slice(0, 8).map((item) => <article key={item.id}><FileText size={17} /><div><strong>{item.filename}</strong><span>{item.operation.replaceAll("_", " ")} · {new Date(item.created_at).toLocaleString()}</span></div><button onClick={() => downloadArtifact(item, token).catch((reason) => setError(reason.message))}><Download size={14} /></button></article>)}</section>
          </main>
        </div>
      </section>
    </div>
  );
}

function ProcessingJobs({ token, onClose }: { token: string; onClose: () => void }) {
  const [items, setItems] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(() => api<Job[]>("/jobs", token).then(setItems).catch((reason) => setError(reason.message)), [token]);
  useEffect(() => { load(); const timer = window.setInterval(load, 2500); return () => window.clearInterval(timer); }, [load]);
  async function retry(job: Job) {
    if (!job.id) return;
    try {
      await api(`/jobs/status/${job.id}/retry`, token, { method: "POST" });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Retry failed"); }
  }
  async function cancel(job: Job) {
    if (!job.id) return;
    try {
      await api(`/jobs/status/${job.id}/cancel`, token, { method: "POST" });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Cancellation failed"); }
  }
  return (
    <div className="jobs-wrap">
      <button className="history-backdrop" aria-label="Close processing jobs" onClick={onClose} />
      <section className="jobs-panel" role="dialog" aria-label="Processing jobs">
        <header><div><p className="eyebrow">Background activity</p><h2>Processing jobs</h2></div><button aria-label="Close processing jobs" onClick={onClose}><X size={18} /></button></header>
        <main>
          {error && <div className="form-error">{error}</div>}
          {items.map((job) => (
            <article key={job.id}>
              <div><strong>{(job.operation ?? "document processing").replaceAll("_", " ")}</strong><span>{job.created_at ? new Date(job.created_at).toLocaleString() : ""} · {job.progress}%</span></div>
              <b className={`job-state ${job.status}`}>{job.status}</b>
              {["queued", "running"].includes(job.status) && <button onClick={() => cancel(job)}>Cancel</button>}
              {job.status === "failed" && job.operation !== "document_processing" && <button onClick={() => retry(job)}>Retry</button>}
              {job.error_message && <small>{job.error_message}</small>}
            </article>
          ))}
          {!items.length && !error && <div className="empty-workspace"><RefreshCw size={30} /><h3>No processing jobs yet</h3></div>}
        </main>
      </section>
    </div>
  );
}

export function WorkspaceApp({
  pendingUpload,
  onPendingUploadHandled,
  onExit,
}: {
  pendingUpload: File | null;
  onPendingUploadHandled: () => void;
  onExit: () => void;
}) {
  const [initialAuth] = useState<AuthResult | null>(() => {
    if (typeof window === "undefined") return null;
    const saved = localStorage.getItem("insightpdf-auth");
    return saved ? JSON.parse(saved) as AuthResult : null;
  });
  const [token, setToken] = useState(initialAuth?.access_token ?? "");
  const [user, setUser] = useState<AuthResult["user"] | null>(initialAuth?.user ?? null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<DocumentItem | null>(null);
  const [artifactViewer, setArtifactViewer] = useState<Artifact | null>(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerSearch, setViewerSearch] = useState("");
  const [pdfToolsOpen, setPDFToolsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [, setNotificationUnread] = useState(0);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [nativeDocs, setNativeDocs] = useState<NativeDocument[]>([]);
  const [notebookView, setNotebookView] = useState<"library" | "workspace">("library");
  const [activeTheme, setActiveTheme] = useState<"light" | "dark">(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
  );

  const authForm = useForm<AuthFields>({
    resolver: zodResolver(authSchema),
    defaultValues: { display_name: "", email: "", password: "" },
  });

  useEffect(() => {
    applyPreferences(storedPreferences());
  }, []);

  useEffect(() => {
    if (!token || !user) return;
    const loadUnread = () => api<{ unread: number }>("/notifications/unread-count", token).then((value) => setNotificationUnread(value.unread)).catch(() => undefined);
    loadUnread();
    const timer = window.setInterval(loadUnread, 10_000);
    return () => window.clearInterval(timer);
  }, [token, user]);

  useEffect(() => {
    const update = (event: Event) => {
      const preferences = (event as CustomEvent<UserPreferences>).detail;
      document.documentElement.toggleAttribute("data-reduced-motion", preferences.reduced_motion);
    };
    window.addEventListener("insightpdf-preferences-changed", update);
    return () => window.removeEventListener("insightpdf-preferences-changed", update);
  }, []);

  useEffect(() => {
    function handleExpiredSession() {
      setToken("");
      setUser(null);
      setDocuments([]);
      setViewer(null);
      setArtifactViewer(null);
      setPDFToolsOpen(false);
      setAccountOpen(false);
      setNotificationsOpen(false);
      setNotificationUnread(0);
      setError("Your session expired. Please log in again.");
    }
    function handleRefreshedSession(event: Event) {
      const refreshed = (event as CustomEvent<AuthResult>).detail;
      setToken(refreshed.access_token);
      setUser(refreshed.user);
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
    window.addEventListener(AUTH_REFRESHED_EVENT, handleRefreshedSession);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
      window.removeEventListener(AUTH_REFRESHED_EVENT, handleRefreshedSession);
    };
  }, []);

  const loadDocuments = useCallback(async (accessToken: string) => {
    const items = await api<DocumentItem[]>("/documents", accessToken);
    setDocuments(items);
  }, []);

  const loadStats = useCallback(async (accessToken: string) => {
    setStats(await api<Stats>("/profile/stats", accessToken));
  }, []);

  const loadWorkspaces = useCallback(async (accessToken: string) => {
    try {
      const items = await api<Workspace[]>("/workspaces", accessToken);
      setWorkspaces(items);
      return items;
    } catch {
      return [];
    }
  }, []);

  const loadAllNativeDocs = useCallback(async (accessToken: string) => {
    try {
      const wsList = await api<Workspace[]>("/workspaces", accessToken);
      const allDocs: NativeDocument[] = [];
      for (const ws of wsList) {
        const docs = await api<NativeDocument[]>(`/workspaces/${ws.id}/native-documents`, accessToken).catch(() => []);
        allDocs.push(...docs);
      }
      setNativeDocs(allDocs);
      return allDocs;
    } catch {
      return [];
    }
  }, []);

  function toggleTheme() {
    const next = activeTheme === "dark" ? "light" : "dark";
    setActiveTheme(next);
    if (next === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  async function handleCreateNotebook(name: string, _template?: string): Promise<string | null> {
    try {
      const newWs = await api<Workspace>("/workspaces", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind: "personal" }),
      });
      setWorkspaces((prev) => [newWs, ...prev]);
      setActiveWorkspaceId(newWs.id);
      setNotebookView("workspace");
      return newWs.id;
    } catch (err: any) {
      setError(err.message || "Could not create notebook");
      return null;
    }
  }

  async function handleDeleteNotebook(wsId: string): Promise<void> {
    if (!window.confirm("Delete this notebook? All attached deliverables and sources will be unlinked.")) return;
    try {
      await api(`/workspaces/${wsId}`, token, { method: "DELETE" });
      setWorkspaces((prev) => prev.filter((w) => w.id !== wsId));
      if (activeWorkspaceId === wsId) {
        setActiveWorkspaceId(null);
        setNotebookView("library");
      }
    } catch (err: any) {
      setError(err.message || "Failed to delete notebook");
    }
  }

  async function handleRenameNotebook(wsId: string, newName: string): Promise<void> {
    try {
      const updated = await api<Workspace>(`/workspaces/${wsId}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      setWorkspaces((prev) => prev.map((w) => (w.id === wsId ? updated : w)));
    } catch (err: any) {
      setError(err.message || "Failed to rename notebook");
    }
  }

  async function handleUploadNotebookDocument(file: File, wsId: string): Promise<DocumentItem | null> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("workspace_id", wsId);

    const response = await authenticatedFetch(`${API}/documents`, token, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message =
        typeof body?.detail === "string"
          ? body.detail
          : body?.detail?.message ?? body?.error?.message ?? "Upload failed";
      if (response.status === 409 && body?.detail?.document_id) {
        const existing = documents.find((d) => d.id === body.detail.document_id);
        if (existing) {
          return existing;
        }
      }
      throw new Error(message);
    }
    const uploaded = (await response.json()) as DocumentItem;
    setDocuments((prev) => [uploaded, ...prev]);
    return uploaded;
  }

  useEffect(() => {
    if (!initialAuth) return;
    const timer = window.setTimeout(() => {
      Promise.all([
        loadDocuments(initialAuth.access_token),
        loadStats(initialAuth.access_token),
        loadWorkspaces(initialAuth.access_token),
        loadAllNativeDocs(initialAuth.access_token),
      ]).catch(() => undefined);
      if (pendingUpload) {
        onPendingUploadHandled();
        handleCreateNotebook(pendingUpload.name.replace(/\.[^/.]+$/, "")).then((wsId) => {
          if (wsId) {
            handleUploadNotebookDocument(pendingUpload, wsId);
          }
        });
      }
      const pendingPrompt = sessionStorage.getItem("insightpdf-pending-prompt");
      if (pendingPrompt) {
        sessionStorage.removeItem("insightpdf-pending-prompt");
        handleCreateNotebook(pendingPrompt.slice(0, 30) || "Research Notebook").then((wsId) => {
          if (wsId) {
            setActiveWorkspaceId(wsId);
            setNotebookView("workspace");
          }
        });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAuth, loadDocuments, loadStats, loadWorkspaces, loadAllNativeDocs]);

  useEffect(() => {
    if (!token || !documents.some((item) => !["ready", "failed"].includes(item.status))) return;
    const timer = window.setInterval(() => loadDocuments(token).catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, [token, documents, loadDocuments]);

  useEffect(() => {
    function keyboardShortcuts(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandPaletteOpen((value) => !value); return; }
      if (event.key === "Escape") {
        setViewer(null); setArtifactViewer(null); setPDFToolsOpen(false); setCommandPaletteOpen(false);
      }
    }
    window.addEventListener("keydown", keyboardShortcuts);
    return () => window.removeEventListener("keydown", keyboardShortcuts);
  }, []);

  const workspaceCommands: WorkspaceCommand[] = user ? [
    { id: "library", label: "Open Notebook Library", detail: "Browse all research notebooks", icon: <FileText size={16} />, run: () => setNotebookView("library") },
    { id: "pdf-tools", label: "Open PDF tools", detail: "Merge, split, rotate, convert, or watermark", icon: <Scissors size={16} />, run: () => setPDFToolsOpen(true) },
    { id: "jobs", label: "View processing jobs", detail: "Inspect progress, retry failures, or cancel work", icon: <Activity size={16} />, run: () => setJobsOpen(true) },
    { id: "settings", label: "Open account settings", detail: "Profile, security, preferences, and usage", icon: <BrandMark />, run: () => setAccountOpen(true) },
  ] : [];

  async function completeAuthentication(result: AuthResult) {
    localStorage.setItem("insightpdf-auth", JSON.stringify(result));
    setToken(result.access_token);
    setUser(result.user);
    await Promise.all([
      loadDocuments(result.access_token),
      loadStats(result.access_token),
      loadWorkspaces(result.access_token),
      loadAllNativeDocs(result.access_token),
    ]);
  }

  async function authenticateGoogle(credential: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api<AuthResult>("/auth/google", undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      await completeAuthentication(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function authenticate(values: AuthFields) {
    setBusy(true); setError("");
    if (mode === "register" && !values.display_name?.trim()) {
      setError("Display name must contain at least two characters.");
      setBusy(false);
      return;
    }
    try {
      const result = await api<AuthResult>(`/auth/${mode}`, undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          ...(mode === "register" ? { display_name: values.display_name } : {}),
        }),
      });
      await completeAuthentication(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Authentication failed"); }
    finally { setBusy(false); }
  }

  function signOut() {
    localStorage.removeItem("insightpdf-auth");
    setToken(""); setUser(null); setDocuments([]); setArtifactViewer(null); setNotificationsOpen(false); setNotificationUnread(0);
    onExit();
  }

  async function removeDocument(document: DocumentItem) {
    if (!window.confirm(`Delete ${document.filename}?`)) return;
    try {
      await api(`/documents/${document.id}`, token, { method: "DELETE" });
      await Promise.all([loadDocuments(token), loadStats(token)]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Delete failed"); }
  }

  if (!token || !user) return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand auth-brand-login"><BrandMark /><strong>Insight<b>PDF</b></strong></div>
        <p className="eyebrow">AI-powered document workspace</p>
        <h1>{mode === "login" ? "Welcome back" : "Create your workspace"}</h1>
        <p>Understand source files and create polished Word, PDF, and PowerPoint outputs securely.</p>
        {pendingUpload && <div className="pending-upload-note">
          <FileText size={16} />
          <span><strong>{pendingUpload.name}</strong><small>Ready to upload securely after you sign in.</small></span>
        </div>}
        <GoogleSignInButton
          disabled={busy}
          onCredential={(credential) => { authenticateGoogle(credential).catch(() => undefined); }}
          onError={setError}
        />
        <div className="auth-divider"><span>or continue with email</span></div>
        <form onSubmit={authForm.handleSubmit(authenticate)}>
          {mode === "register" && <label>Display name<input {...authForm.register("display_name")} minLength={2} required /></label>}
          <label>Email<input {...authForm.register("email")} type="email" required /></label>
          <label>Password<input {...authForm.register("password")} type="password" minLength={8} required /></label>
          {error && <div className="form-error">{error}</div>}
          <button disabled={busy}>{busy ? <><RefreshCw size={15} className="spin" /> {mode === "login" ? "Logging you in…" : "Creating your account…"}</> : mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
        {busy && <div className="auth-loading" role="status" aria-live="polite">
          <span className="auth-loading-spinner"><RefreshCw size={18} className="spin" /></span>
          <div>
            <strong>{mode === "login" ? "Connecting to your workspace" : "Preparing your workspace"}</strong>
            <small>The free demo server may take up to 30 seconds to wake. Please keep this page open.</small>
          </div>
        </div>}
        {(REGISTRATION_ENABLED || mode === "register") && <button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "Need an account? Register" : "Already registered? Sign in"}
        </button>}
        <button className="auth-back-home" onClick={onExit}>← Back to home</button>
      </section>
    </main>
  );

  const readyDocuments = documents.filter((item) => item.status === "ready");
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0] || null;

  return (
    <div className="insightpdf-app-root h-screen w-screen overflow-hidden">
      {notebookView === "workspace" && activeWorkspace ? (
        <NotebookWorkspace
          auth={{ access_token: token, refresh_token: "", user }}
          workspace={activeWorkspace}
          documents={documents}
          nativeDocs={nativeDocs}
          activeTheme={activeTheme}
          onBackToLibrary={() => setNotebookView("library")}
          onUploadDocument={async (file, wsId) => {
            return handleUploadNotebookDocument(file, wsId);
          }}
          onDeleteDocument={async (docId) => {
            const doc = documents.find((d) => d.id === docId);
            if (doc) await removeDocument(doc);
          }}
          onOpenPdfTools={() => setPDFToolsOpen(true)}
          onOpenAccount={() => setAccountOpen(true)}
          onToggleTheme={() => toggleTheme()}
          onOpenViewer={(docId, pageNumber) => {
            const doc = documents.find((d) => d.id === docId);
            if (doc) {
              setViewerPage(pageNumber || 1);
              setViewerSearch("");
              setViewer(doc);
            }
          }}
        />
      ) : (
        <NotebookLibrary
          auth={{ access_token: token, refresh_token: "", user }}
          workspaces={workspaces}
          documents={documents}
          nativeDocs={nativeDocs}
          activeTheme={activeTheme}
          onSelectNotebook={(wsId) => {
            setActiveWorkspaceId(wsId);
            setNotebookView("workspace");
          }}
          onCreateNotebook={handleCreateNotebook}
          onDeleteNotebook={handleDeleteNotebook}
          onRenameNotebook={handleRenameNotebook}
          onUploadToNewNotebook={async (file) => {
            const wsId = await handleCreateNotebook(file.name.replace(/\.[^/.]+$/, ""));
            if (wsId) {
              await handleUploadNotebookDocument(file, wsId);
            }
          }}
          onOpenAccount={() => setAccountOpen(true)}
          onToggleTheme={() => toggleTheme()}
          onOpenPdfTools={() => setPDFToolsOpen(true)}
          onOpenTwoMinuteDemo={async () => {
            const existingDemo = workspaces.find(
              (w) => w.name.toLowerCase().includes("demo") || w.name.toLowerCase().includes("proposal"),
            );
            if (existingDemo) {
              setActiveWorkspaceId(existingDemo.id);
              setNotebookView("workspace");
            } else {
              const demoWsId = await handleCreateNotebook("Technical Proposal & Audit Demo", "proposal");
              if (demoWsId) {
                setActiveWorkspaceId(demoWsId);
                setNotebookView("workspace");
              }
            }
          }}
        />
      )}

      {/* Dialog Overlays */}
      {viewer && (
        <PdfViewer
          document={viewer}
          token={token}
          initialPage={viewerPage}
          initialSearch={viewerSearch}
          onClose={() => setViewer(null)}
        />
      )}
      {artifactViewer && (
        <ArtifactViewer
          artifact={artifactViewer}
          token={token}
          onClose={() => setArtifactViewer(null)}
        />
      )}
      {pdfToolsOpen && (
        <PDFToolsWorkspace
          documents={readyDocuments}
          token={token}
          initialDocument={null}
          onClose={() => {
            setPDFToolsOpen(false);
            loadStats(token).catch(() => undefined);
          }}
        />
      )}
      {accountOpen && (
        <AccountSettingsPanel
          user={user}
          token={token}
          stats={stats}
          onUser={(updated) => {
            setUser(updated);
            const saved = JSON.parse(localStorage.getItem("insightpdf-auth") ?? "{}");
            localStorage.setItem("insightpdf-auth", JSON.stringify({ ...saved, user: updated }));
          }}
          onClose={() => setAccountOpen(false)}
          onSignOut={signOut}
        />
      )}
      {notificationsOpen && (
        <NotificationCenter
          token={token}
          onClose={() => setNotificationsOpen(false)}
          onUnread={setNotificationUnread}
          onNavigate={(action) => {
            if (action === "processing") setJobsOpen(true);
            setNotificationsOpen(false);
          }}
        />
      )}
      {jobsOpen && <ProcessingJobs token={token} onClose={() => setJobsOpen(false)} />}
      {commandPaletteOpen && (
        <CommandPalette commands={workspaceCommands} onClose={() => setCommandPaletteOpen(false)} />
      )}
    </div>
  );
}
