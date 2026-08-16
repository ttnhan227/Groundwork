import { Activity, ExternalLink, FileText, RefreshCw, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { AuthResult, DocumentItem, Job, NativeDocument, Stats, Workspace } from "../../types";
import { BrandMark } from "../../components/common/BrandMark";
import { CommandPalette, type WorkspaceCommand } from "./CommandPalette";
import { API, AUTH_EXPIRED_EVENT, AUTH_REFRESHED_EVENT, api, authenticatedFetch, expireSession, getStoredAuth, setStoredAuth } from "../../api/client";
import { AccountPanel as AccountSettingsPanel } from "../account/AccountPanel";
import { NotificationCenter } from "../account/NotificationCenter";
import { applyPreferences, storedPreferences, type UserPreferences } from "../account/preferences";
import { WorkspaceLibrary } from "./WorkspaceLibrary";
import { ResearchWorkspace } from "./ResearchWorkspace";

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
  const [initialAuth] = useState<AuthResult | null>(() => getStoredAuth());
  const [token, setToken] = useState(initialAuth?.access_token ?? "");
  const [user, setUser] = useState<AuthResult["user"] | null>(initialAuth?.user ?? null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<DocumentItem | null>(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerSearch, setViewerSearch] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [, setNotificationUnread] = useState(0);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [nativeDocs, setNativeDocs] = useState<NativeDocument[]>([]);
  const [workspaceView, setWorkspaceView] = useState<"library" | "workspace">("library");
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
    window.addEventListener("groundwork-preferences-changed", update);
    window.addEventListener("insightpdf-preferences-changed", update);
    return () => {
      window.removeEventListener("groundwork-preferences-changed", update);
      window.removeEventListener("insightpdf-preferences-changed", update);
    };
  }, []);

  useEffect(() => {
    function handleExpiredSession() {
      setToken("");
      setUser(null);
      setDocuments([]);
      setViewer(null);
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

  async function handleCreateWorkspace(name: string, template?: string): Promise<string | null> {
    try {
      const newWs = await api<Workspace>("/workspaces", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind: "personal", template }),
      });
      setWorkspaces((prev) => [newWs, ...prev]);
      setActiveWorkspaceId(newWs.id);
      setWorkspaceView("workspace");
      return newWs.id;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create workspace");
      return null;
    }
  }

  async function handleDeleteWorkspace(wsId: string): Promise<void> {
    if (!window.confirm("Delete this workspace? All attached deliverables and sources will be unlinked.")) return;
    try {
      await api(`/workspaces/${wsId}`, token, { method: "DELETE" });
      setWorkspaces((prev) => prev.filter((w) => w.id !== wsId));
      if (activeWorkspaceId === wsId) {
        setActiveWorkspaceId(null);
        setWorkspaceView("library");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete workspace");
    }
  }

  async function handleRenameWorkspace(wsId: string, newName: string): Promise<void> {
    try {
      const updated = await api<Workspace>(`/workspaces/${wsId}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      setWorkspaces((prev) => prev.map((w) => (w.id === wsId ? updated : w)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to rename workspace");
    }
  }

  async function handleUploadWorkspaceDocument(file: File, wsId: string): Promise<DocumentItem | null> {
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
        handleCreateWorkspace(pendingUpload.name.replace(/\.[^/.]+$/, "")).then((wsId) => {
          if (wsId) {
            handleUploadWorkspaceDocument(pendingUpload, wsId);
          }
        });
      }
      const pendingPrompt = sessionStorage.getItem("groundwork-pending-prompt") || sessionStorage.getItem("insightpdf-pending-prompt");
      if (pendingPrompt) {
        sessionStorage.removeItem("groundwork-pending-prompt");
        sessionStorage.removeItem("insightpdf-pending-prompt");
        handleCreateWorkspace(pendingPrompt.slice(0, 30) || "Research Workspace").then((wsId) => {
          if (wsId) {
            setActiveWorkspaceId(wsId);
            setWorkspaceView("workspace");
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
        setViewer(null); setCommandPaletteOpen(false);
      }
    }
    window.addEventListener("keydown", keyboardShortcuts);
    return () => window.removeEventListener("keydown", keyboardShortcuts);
  }, []);

  const workspaceCommands: WorkspaceCommand[] = user ? [
    { id: "library", label: "Open Workspace Library", detail: "Browse all research workspaces", icon: <FileText size={16} />, run: () => setWorkspaceView("library") },
    { id: "jobs", label: "View processing jobs", detail: "Inspect progress, retry failures, or cancel work", icon: <Activity size={16} />, run: () => setJobsOpen(true) },
    { id: "settings", label: "Open account settings", detail: "Profile, security, preferences, and usage", icon: <BrandMark />, run: () => setAccountOpen(true) },
  ] : [];

  async function completeAuthentication(result: AuthResult) {
    setStoredAuth(result);
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
    setStoredAuth(null);
    setToken(""); setUser(null); setDocuments([]); setNotificationsOpen(false); setNotificationUnread(0);
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
        <div className="auth-brand auth-brand-login"><BrandMark /><strong>Ground<b>work</b></strong></div>
        <p className="eyebrow">Document Intelligence Workspace</p>
        <h1>{mode === "login" ? "Welcome back" : "Create your workspace"}</h1>
        <p>Grounded research, document synthesis, and verified deliverable drafting.</p>
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
            <small>The demo server may take up to 30 seconds to wake if idle. Please keep this page open.</small>
          </div>
        </div>}
        {(REGISTRATION_ENABLED || mode === "register") && <button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "Need an account? Register" : "Already registered? Sign in"}
        </button>}
        <button className="auth-back-home" onClick={onExit}>← Back to home</button>
      </section>
    </main>
  );

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0] || null;

  return (
    <div className="groundwork-app-root insightpdf-app-root h-screen w-screen overflow-hidden">
      {workspaceView === "workspace" && activeWorkspace ? (
        <ResearchWorkspace
          auth={{ access_token: token, refresh_token: "", user }}
          workspace={activeWorkspace}
          documents={documents}
          nativeDocs={nativeDocs}
          activeTheme={activeTheme}
          onBackToLibrary={() => setWorkspaceView("library")}
          onUploadDocument={async (file, wsId) => {
            return handleUploadWorkspaceDocument(file, wsId);
          }}
          onDeleteDocument={async (docId) => {
            const doc = documents.find((d) => d.id === docId);
            if (doc) await removeDocument(doc);
          }}
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
        <WorkspaceLibrary
          auth={{ access_token: token, refresh_token: "", user }}
          workspaces={workspaces}
          documents={documents}
          nativeDocs={nativeDocs}
          activeTheme={activeTheme}
          onSelectWorkspace={(wsId) => {
            setActiveWorkspaceId(wsId);
            setWorkspaceView("workspace");
          }}
          onCreateWorkspace={handleCreateWorkspace}
          onDeleteWorkspace={handleDeleteWorkspace}
          onRenameWorkspace={handleRenameWorkspace}
          onUploadToNewWorkspace={async (file) => {
            const wsId = await handleCreateWorkspace(file.name.replace(/\.[^/.]+$/, ""));
            if (wsId) {
              await handleUploadWorkspaceDocument(file, wsId);
            }
          }}
          onOpenAccount={() => setAccountOpen(true)}
          onToggleTheme={() => toggleTheme()}
          onOpenTwoMinuteDemo={async () => {
            const existingDemo = workspaces.find(
              (w) => w.name.toLowerCase().includes("demo") || w.name.toLowerCase().includes("proposal"),
            );
            if (existingDemo) {
              setActiveWorkspaceId(existingDemo.id);
              setWorkspaceView("workspace");
            } else {
              const demoWsId = await handleCreateWorkspace("Technical Proposal & Audit Demo", "proposal");
              if (demoWsId) {
                setActiveWorkspaceId(demoWsId);
                setWorkspaceView("workspace");
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
      {accountOpen && (
        <AccountSettingsPanel
          user={user}
          token={token}
          stats={stats}
          onUser={(updated) => {
            setUser(updated);
            const saved = getStoredAuth();
            if (saved) setStoredAuth({ ...saved, user: updated });
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
