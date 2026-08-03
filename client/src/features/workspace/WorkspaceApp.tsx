import { Activity, AlignLeft, AlertTriangle, ArrowRight, BarChart3, Bell, Check, CheckCircle2, ChevronRight, Clock3, Download, ExternalLink, Eye, FileImage, FileOutput, FileText, FolderOpen, FolderPlus, GitCompareArrows, History, Languages, LayoutDashboard, ListChecks, LogOut, MessageCircle, MoreVertical, PanelLeftClose, PanelLeftOpen, Pencil, PlayCircle, Presentation, Quote, RefreshCw, ScanText, Scissors, Search, Send, Settings, ShieldCheck, Sparkles, Trash2, Upload, UserRound, Users, X, ZoomIn, ZoomOut } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { AdminUser, AIResult, Artifact, ArtifactVersion, AuthResult, ChatMessage, Citation, Collection, Conversation, ConversationCommand, DocumentItem, DocumentReport, Job, NativeDocument, PersistedWorkflow, Stats, WorkflowPlan, Workspace } from "../../types";
import { BrandMark } from "../../components/common/BrandMark";
import { FormattedAnswer } from "../../components/common/FormattedAnswer";
import { NativeWorkspace } from "../deliverables/NativeWorkspace";
import { DocumentStudio } from "./DocumentStudio";
import { CommandPalette, type WorkspaceCommand } from "./CommandPalette";
import { API, AUTH_EXPIRED_EVENT, AUTH_REFRESHED_EVENT, api, authenticatedFetch, downloadTextFile, expireSession, queueOperation, waitForJob } from "../../api/client";
import { AccountPanel as AccountSettingsPanel } from "../account/AccountPanel";
import { NotificationCenter } from "../account/NotificationCenter";
import { applyPreferences, storedPreferences, type UserPreferences } from "../account/preferences";

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
const DOCUMENT_UPLOAD_ACCEPT = ".pdf,.docx,.pptx,.md,.markdown,.txt,.rtf,.png,.jpg,.jpeg,.webp";
const DOCUMENT_UPLOAD_TYPES = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain", "text/markdown", "text/rtf", "application/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const authSchema = z.object({
  display_name: z.string().trim().max(120).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
type AuthFields = z.infer<typeof authSchema>;

function PhaseFourResult({ value, documents, onPage }: { value: AIResult; documents: DocumentItem[]; onPage: (documentId: string, page: number) => void }) {
  const result = value.result;
  const references = (result.page_references ?? []) as Citation[];
  const sections = ["added_sections", "removed_sections", "changed_sections", "numerical_changes"] as const;
  const exportResult = () => downloadTextFile(
    `${documents.find((item) => item.id === value.document_ids[0])?.filename.replace(/\.pdf$/i, "") ?? "insightpdf"}-${value.feature}.md`,
    `# ${String(result.title ?? value.feature.replaceAll("_", " "))}\n\n${String(result.content ?? result.summary ?? "")}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`,
  );
  if (value.feature === "quiz") {
    const questions = (result.questions ?? []) as Array<{ question: string; options: string[]; correct_answer: string; explanation: string; page_references?: Citation[] }>;
    return <div className="ai-result"><h3>{String(result.title ?? "Quiz")}</h3>{questions.map((question, index) =>
      <details className="quiz-question" key={index}><summary><b>{index + 1}</b>{question.question}</summary>
        <ol>{question.options.map((option) => <li key={option}>{option}</li>)}</ol>
        <div className="quiz-answer"><strong>Answer: {question.correct_answer}</strong><p>{question.explanation}</p></div>
        <PageLinks references={question.page_references ?? []} onPage={onPage} />
      </details>)}</div>;
  }
  if (value.feature === "extraction") {
    const items = (result.items ?? []) as Array<{ field: string; value: string; context?: string; page_references?: Citation[] }>;
    return <div className="ai-result"><h3>Extracted information</h3><div className="extraction-grid">{items.map((item, index) =>
      <article key={index}><small>{item.field.replaceAll("_", " ")}</small><strong>{item.value}</strong>{item.context && <p>{item.context}</p>}<PageLinks references={item.page_references ?? []} onPage={onPage} /></article>
    )}</div></div>;
  }
  if (value.feature === "comparison") {
    const warnings = (result.warnings ?? []) as string[];
    return <div className="ai-result comparison-result"><div className="similarity"><strong>{String(result.similarity_percent)}%</strong><span>text similarity</span></div>
      <h3>Comparison overview</h3><p>{String(result.summary ?? "")}</p>
      {warnings.map((warning, index) => <div className="comparison-warning" role="alert" key={index}><ShieldCheck size={15} /><span>{warning}</span></div>)}
      {sections.map((name) => {
        const items = (result[name] ?? []) as Array<{ description: string; left_pages: number[]; right_pages: number[] }>;
        return items.length ? <section key={name}><h4>{name.replaceAll("_", " ")}</h4>{items.map((item, index) =>
          <article key={index}><p>{item.description}</p><div className="page-links">
            {item.left_pages.map((page) => <button key={`l${page}`} onClick={() => onPage(value.document_ids[0], page)}>Original · p{page}</button>)}
            {item.right_pages.map((page) => <button key={`r${page}`} onClick={() => onPage(value.document_ids[1], page)}>Compared · p{page}</button>)}
          </div></article>)}</section> : null;
      })}</div>;
  }
  return <div className="ai-result"><h3>{String(result.title ?? (value.feature === "translation" ? "Translation" : "Document insight"))}</h3>
    {value.cached && <span className="cached-badge">Saved result</span>}
    <FormattedAnswer content={String(result.content ?? "")} />
    <PageLinks references={references} onPage={onPage} />
    <button className="download-result" onClick={exportResult}><Download size={14} /> Export result</button>
    {value.feature === "translation" && <a className="download-result" href={`${API}/ai/results/${value.id}/download`} onClick={async (event) => {
      event.preventDefault();
      const saved = JSON.parse(localStorage.getItem("insightpdf-auth") ?? "null") as AuthResult | null;
      if (!saved?.access_token) return;
      const response = await authenticatedFetch(`${API}/ai/results/${value.id}/download`, saved.access_token);
      if (!response.ok) return;
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = window.document.createElement("a");
      link.href = url; link.download = `${documents.find((item) => item.id === value.document_ids[0])?.filename.replace(/\.pdf$/i, "") ?? "translation"}-translation.md`; link.click(); URL.revokeObjectURL(url);
    }}><Download size={14} /> Download translation</a>}
  </div>;
}

function PageLinks({ references, onPage }: { references: Citation[]; onPage: (documentId: string, page: number) => void }) {
  if (!references.length) return null;
  return <div className="page-links">{references.map((reference, index) =>
    <button key={`${reference.document_id}-${reference.page_number}-${index}`} onClick={() => onPage(reference.document_id, reference.page_number)}>
      {reference.document_name || "Document"} · Page {reference.page_number}
    </button>)}</div>;
}

function AIWorkspace({ document, documents, token, compareMode, onClose, onPage }: {
  document: DocumentItem | null; documents: DocumentItem[]; token: string; compareMode: boolean;
  onClose: () => void; onPage: (documentId: string, page: number) => void;
}) {
  const [tool, setTool] = useState<"summary" | "quiz" | "extract" | "translate" | "compare">(compareMode ? "compare" : "summary");
  const [style, setStyle] = useState("short");
  const [count, setCount] = useState(5);
  const [language, setLanguage] = useState("Vietnamese");
  const [pages, setPages] = useState("");
  const [customFields, setCustomFields] = useState("");
  const [left, setLeft] = useState(document?.id ?? documents[0]?.id ?? "");
  const [right, setRight] = useState(documents.find((item) => item.id !== left)?.id ?? "");
  const [result, setResult] = useState<AIResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!document && tool !== "compare") return;
    setBusy(true); setError(""); setResult(null);
    let body: Record<string, unknown> = {};
    if (tool === "summary") body = { style };
    if (tool === "quiz") body = { question_count: count };
    if (tool === "extract") body = { categories: ["people", "dates", "companies", "monetary_values", "deadlines", "action_items"], custom_fields: customFields.split(",").map((item) => item.trim()).filter(Boolean) };
    if (tool === "translate") body = { target_language: language, page_numbers: pages.trim() ? pages.split(",").map(Number).filter((item) => Number.isInteger(item) && item > 0) : null, format: "markdown" };
    if (tool === "compare") body = { left_document_id: left, right_document_id: right };
    try {
      const operation = tool === "extract" ? "extraction" : tool === "compare" ? "comparison" : tool;
      const parameters = tool === "compare" ? body : { document_id: document?.id, ...body };
      const job = await queueOperation(operation, parameters, token);
      setResult(await api<AIResult>(`/ai/results/${job.result_id}`, token));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI tool failed"); }
    finally { setBusy(false); }
  }

  return <div className="ai-workspace-wrap"><button className="history-backdrop" aria-label="Close AI tools" onClick={onClose} />
    <section className="ai-workspace">
      <header><div><p className="eyebrow">Document intelligence</p><h2>{tool === "compare" ? "Compare PDFs" : document?.filename}</h2></div><button aria-label="Close document intelligence" onClick={onClose}><X size={18} /></button></header>
      <div className="ai-tool-tabs">
        {!compareMode && <><button className={tool === "summary" ? "active" : ""} onClick={() => { setTool("summary"); setResult(null); }}><AlignLeft size={15} /> Summarize</button>
          <button className={tool === "quiz" ? "active" : ""} onClick={() => { setTool("quiz"); setResult(null); }}><ListChecks size={15} /> Quiz</button>
          <button className={tool === "extract" ? "active" : ""} onClick={() => { setTool("extract"); setResult(null); }}><ScanText size={15} /> Extract</button>
          <button className={tool === "translate" ? "active" : ""} onClick={() => { setTool("translate"); setResult(null); }}><Languages size={15} /> Translate</button></>}
        {compareMode && <button className="active"><RefreshCw size={15} /> Compare</button>}
      </div>
      <div className="ai-tool-body">
        <div className="ai-controls">
          {tool === "summary" && <label>Result type<select value={style} onChange={(event) => setStyle(event.target.value)}><option value="short">Short summary</option><option value="detailed">Detailed summary</option><option value="key_points">Key points</option><option value="action_items">Action items</option></select></label>}
          {tool === "quiz" && <label>Number of questions<input type="number" min={1} max={20} value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>}
          {tool === "extract" && <label>Custom fields <small>Optional, comma-separated</small><input value={customFields} onChange={(event) => setCustomFields(event.target.value)} placeholder="invoice number, project owner" /></label>}
          {tool === "translate" && <><label>Target language<input value={language} onChange={(event) => setLanguage(event.target.value)} /></label><label>Pages <small>Optional, comma-separated</small><input value={pages} onChange={(event) => setPages(event.target.value)} placeholder="1, 3, 5" /></label></>}
          {tool === "compare" && <><label>Original document<select value={left} onChange={(event) => { setLeft(event.target.value); if (event.target.value === right) setRight(""); }}>{documents.map((item) => <option key={item.id} value={item.id}>{item.filename}</option>)}</select></label>
            <label>Compare with<select value={right} onChange={(event) => setRight(event.target.value)}><option value="">Select a different PDF</option>{documents.filter((item) => item.id !== left).map((item) => <option key={item.id} value={item.id}>{item.filename}</option>)}</select></label></>}
          <button className="run-ai-tool" disabled={busy || (tool === "compare" && (!left || !right))} onClick={run}>{busy ? <RefreshCw className="spin" size={15} /> : <FileOutput size={15} />}{busy ? "Working…" : tool === "compare" ? "Compare documents" : "Generate"}</button>
        </div>
        {error && <div className="form-error">{error}</div>}
        {!result && !busy && <div className="ai-result-empty"><ScanText size={38} /><strong>Ready when you are</strong><span>Choose your options and generate a grounded result from the indexed document text.</span></div>}
        {busy && <div className="ai-result-empty"><RefreshCw className="spin" size={34} /><strong>InsightPDF is analyzing your documents</strong><span>This can take a few seconds. Repeating the same request will use the saved result.</span></div>}
        {result && <PhaseFourResult value={result} documents={documents} onPage={onPage} />}
      </div>
    </section>
  </div>;
}

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
      const viewport = pdfPage.getViewport({ scale: .2 });
      const context = canvas.current.getContext("2d");
      if (!context) return;
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      task = pdfPage.render({ canvas: canvas.current, canvasContext: context, viewport });
      await task.promise;
    })().catch(() => undefined);
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, pageNumber, visible]);

  return <button ref={button} className={`pdf-thumbnail ${current ? "current" : ""}`} onClick={onSelect}>
    <canvas ref={canvas} /><span>Page {pageNumber}</span>
  </button>;
}

function DocumentMiniPreview({ document, token, onOpen }: { document: DocumentItem; token: string; onOpen: () => void }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    authenticatedFetch(`${API}/documents/${document.id}/thumbnail`, token).then(async (response) => {
      if (!response.ok) throw new Error("Preview unavailable");
      objectUrl = URL.createObjectURL(await response.blob());
      if (!cancelled) setSource(objectUrl);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document.id, token]);

  return <button className="chat-document-preview" type="button" onClick={onOpen}>
    <span className="chat-preview-image">
      {source ? <img src={source} alt={`First page of ${document.filename}`} /> : failed ? <FileText size={24} /> : <RefreshCw className="spin" size={18} />}
    </span>
    <span><strong>{document.filename}</strong><small>{document.page_count ?? "—"} pages · Click to open</small></span>
  </button>;
}

function DocumentCardPreview({ document, token, onOpen }: { document: DocumentItem; token: string; onOpen: () => void }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (document.status !== "ready") return;
    let objectUrl = "";
    let cancelled = false;
    authenticatedFetch(`${API}/documents/${document.id}/thumbnail`, token).then(async (response) => {
      if (!response.ok) throw new Error("Preview unavailable");
      objectUrl = URL.createObjectURL(await response.blob());
      if (!cancelled) setSource(objectUrl);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document.id, document.status, token]);

  return <button className="document-card-preview" type="button" disabled={document.status !== "ready"} onClick={onOpen} aria-label={`Open ${document.filename}`}>
    {source
      ? <img src={source} alt={`First page of ${document.filename}`} />
      : <span className={document.status === "ready" && !failed ? "preview-loading" : ""}>
          {document.status === "ready" && !failed ? <RefreshCw className="spin" size={20} /> : <FileText size={27} />}
        </span>}
    {source && <i>Preview</i>}
  </button>;
}

function ArtifactCardPreview({ artifact, token, onOpen }: { artifact: Artifact; token: string; onOpen: () => void }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    authenticatedFetch(`${API}/pdf-tools/artifacts/${artifact.id}/thumbnail`, token).then(async (response) => {
      if (!response.ok) throw new Error("Preview unavailable");
      objectUrl = URL.createObjectURL(await response.blob());
      if (!cancelled) setSource(objectUrl);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact.id, token]);

  return <button className="document-card-preview artifact-card-preview" type="button" onClick={onOpen} aria-label={`Open ${artifact.filename}`}>
    {source
      ? <img src={source} alt={`Preview of ${artifact.filename}`} />
      : <span className={!failed ? "preview-loading" : ""}>{!failed ? <RefreshCw className="spin" size={20} /> : <FileText size={27} />}</span>}
    {source && <i>Preview</i>}
  </button>;
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

  return <div className="artifact-viewer-wrap">
    <button className="history-backdrop" aria-label="Close file preview" onClick={onClose} />
    <section className="artifact-viewer" role="dialog" aria-modal="true" aria-label={`Preview ${filename}`}>
      <header>
        <div><strong>{filename}</strong><small>{description} · {(sizeBytes / 1024 / 1024).toFixed(1)} MB</small></div>
        {isPdf && <form className="artifact-viewer-search" onSubmit={searchOpenPDF}><Search size={14} /><input aria-label="Search within document" value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} placeholder="Search this document" /><button type="submit">Find</button></form>}
        {artifact && <button onClick={() => openVersions().catch((reason) => setError(reason.message))}><History size={15} /> Versions</button>}
        {source && <button onClick={() => window.open(source, "_blank", "noopener,noreferrer")}><ExternalLink size={15} /> Open in new tab</button>}
        {!isPdf && <button onClick={() => artifact ? downloadArtifact(artifact, token).catch(() => undefined) : document ? downloadDocumentFile(document, token).catch(() => undefined) : undefined}><Download size={15} /> Download</button>}
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
  </div>;
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
        <button aria-label="Zoom out" onClick={() => setScale((value) => Math.max(.6, value - .2))}><ZoomOut size={18} /></button>
        <button aria-label="Zoom in" onClick={() => setScale((value) => Math.min(2.4, value + .2))}><ZoomIn size={18} /></button>
        <form className="viewer-search" onSubmit={searchPdf}><Search size={15} /><input name="query" placeholder="Search PDF" aria-label="Search PDF" /><button aria-label="Run search">Search</button></form>
        {activeSearch && citationStatus === "matched" && <span className="citation-locator matched">Source highlighted</span>}
        {activeSearch && citationStatus === "not-found" && <span className="citation-locator">Source page opened · exact text highlight unavailable</span>}
        <button onClick={() => downloadDocumentFile(document, token)}><Download size={15} /> Download</button>
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
export function ChatPanel({
  document, documentIds, documentLabel, token, conversation, embedded = false, onClose, onCitation, onChanged, onHistory, onPreview,
}: {
  document: DocumentItem;
  documentIds: string[];
  documentLabel: string;
  token: string;
  conversation?: Conversation | null;
  embedded?: boolean;
  onClose: () => void;
  onCitation: (citation: Citation) => void;
  onChanged: () => void;
  onHistory: () => void;
  onPreview: () => void;
}) {
  const [conversationId, setConversationId] = useState(conversation?.id ?? "");
  const [messages, setMessages] = useState<ChatMessage[]>(conversation?.messages ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const starterPrompts = documentIds.length > 1
    ? ["What do these documents have in common?", "Summarize the key differences", "List important dates across all files"]
    : ["Summarize this document", "What are the key points?", "List important dates and action items"];
  const followUpPrompts = ["Explain that more simply", "What should I pay attention to?", "Turn this into an action checklist"];

  async function beginNewConversation() {
    setError("");
    setMessages([]);
    setConversationId("");
  }

  useEffect(() => {
    if (!conversation) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConversationId(conversation.id);
    setMessages(conversation.messages);
    setError("");
  }, [conversation]);

  async function askQuestion(question: string) {
    if (busy) return;
    question = question.trim();
    if (!question) return;
    setDraft("");
    setMessages((current) => [
      ...current,
      { role: "user", content: question },
      { role: "assistant", content: "", citations: [] },
    ]);
    setBusy(true); setError("");
    try {
      let id = conversationId;
      if (!id) {
        const created = await api<{ id: string }>("/conversations", token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: `Chat about ${documentLabel}`, document_ids: documentIds }),
        });
        id = created.id;
        setConversationId(id);
      }
      const response = await authenticatedFetch(`${API}/conversations/${id}/messages/stream`, token, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ question }),
      });
      if (!response.ok) {
        if (response.status === 401) expireSession();
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Could not answer");
      }
      if (!response.body) throw new Error("Streaming is unavailable in this browser");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const event = frame.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
          const data = frame.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
          if (!event || !data) continue;
          const payload = JSON.parse(data) as { text?: string; answer?: string; citations?: Citation[]; message?: string };
          if (event === "token" && payload.text) {
            setMessages((current) => current.map((message, position) =>
              position === current.length - 1
                ? { ...message, content: message.content + payload.text }
                : message
            ));
          } else if (event === "complete") {
            completed = true;
            setMessages((current) => current.map((message, position) =>
              position === current.length - 1
                ? { ...message, content: payload.answer ?? message.content, citations: payload.citations ?? [] }
                : message
            ));
          } else if (event === "error") {
            throw new Error(payload.message ?? "The response stream failed");
          }
        }
        if (done) break;
      }
      if (!completed) throw new Error("The response stream ended before completion");
      onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not answer"); }
    finally { setBusy(false); }
  }

  function exportConversation() {
    const markdown = [
      `# ${conversation?.title ?? `Chat about ${documentLabel}`}`, "",
      `Documents: ${documentLabel}`, "",
      ...messages.flatMap((message) => [
        `## ${message.role === "assistant" ? "InsightPDF" : "You"}`, "",
        message.content,
        ...(message.citations?.length ? ["", "Sources:", ...message.citations.map((citation) =>
          `- ${citation.document_name}, page ${citation.page_number}: ${citation.snippet}`
        )] : []),
        "",
      ]),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${document.filename.replace(/\.pdf$/i, "")}-chat.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <aside className={`chat-panel ${embedded ? "embedded" : ""}`}>
    <header><span className="chat-brand"><FileText size={18} /></span><div><strong>Ask InsightPDF</strong><small>{documentLabel}</small></div><button title="Export conversation" aria-label="Export conversation" onClick={exportConversation}><Download size={16} /></button><button className="new-chat-button" title="Start new conversation" onClick={beginNewConversation}><MessageCircle size={15} /><span>New chat</span></button><button aria-label="Workspace chat history" title="Workspace chat history" onClick={onHistory}><History size={17} /></button>{!embedded && <button aria-label="Close chat" onClick={onClose}><X size={18} /></button>}</header>
    <DocumentMiniPreview document={document} token={token} onOpen={onPreview} />
    <div className="chat-messages">
      {!messages.length && <div className="chat-empty"><MessageCircle size={30} /><strong>Ask about this PDF</strong><span>Answers are grounded in indexed pages and include source citations.</span><div className="suggested-prompts">{starterPrompts.map((prompt) => <button key={prompt} onClick={() => askQuestion(prompt)}>{prompt}</button>)}</div></div>}
      {messages.map((message, index) => <div className={`chat-message ${message.role}`} key={index}>
        {message.role === "assistant" ? <><div className="assistant-label"><BrandMark /> InsightPDF</div><FormattedAnswer content={message.content} /></> : <p>{message.content}</p>}
        {!!message.citations?.length && <div className="citation-list"><span className="citation-heading">Sources</span>{message.citations.map((citation, citationIndex) => <button key={citationIndex} onClick={() => onCitation(citation)}>
          <b>{citation.document_name}</b><em>Page {citation.page_number}</em><span>{citation.snippet}</span>
        </button>)}</div>}
      </div>)}
      {busy && <div className="chat-thinking"><RefreshCw className="spin" size={14} /> Searching indexed pages…</div>}
      {!busy && messages.at(-1)?.role === "assistant" && <div className="follow-up-prompts"><span>Continue with</span>{followUpPrompts.map((prompt) => <button key={prompt} onClick={() => askQuestion(prompt)}>{prompt}</button>)}</div>}
    </div>
    {error && <div className="chat-error">{error}</div>}
    <form onSubmit={(event) => { event.preventDefault(); askQuestion(draft); }}><div className="chat-input"><textarea name="question" aria-label="Question" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask a follow-up question…" rows={1} disabled={busy} onKeyDown={(event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
    }} /><small>Enter to send · Shift+Enter for a new line</small></div><button aria-label="Send" disabled={busy || !draft.trim()}><Send size={17} /></button></form>
  </aside>;
}

function HomeChat({
  token, documents, conversation, initialDocumentIds, onChanged, onHistory, onPreview, onCitation, onUploadFile, onArtifactCreated, onNewChat,
}: {
  token: string;
  documents: DocumentItem[];
  conversation?: Conversation | null;
  initialDocumentIds: string[];
  onChanged: () => void;
  onHistory: () => void;
  onPreview: (document: DocumentItem) => void;
  onCitation: (citation: Citation) => void;
  onUploadFile: (file: File) => Promise<void>;
  onArtifactCreated: (artifact: Artifact) => void;
  onNewChat: () => void;
}) {
  const [conversationId, setConversationId] = useState(conversation?.id ?? "");
  const [messages, setMessages] = useState<ChatMessage[]>(conversation?.messages ?? []);
  const [selectedIds, setSelectedIds] = useState<string[]>(conversation?.document_ids ?? initialDocumentIds);
  const [draft, setDraft] = useState(() => {
    const pendingPrompt = sessionStorage.getItem("insightpdf-pending-prompt") ?? "";
    sessionStorage.removeItem("insightpdf-pending-prompt");
    return pendingPrompt;
  });
  const [busy, setBusy] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState("");
  const [createFormat, setCreateFormat] = useState<"chat" | "docx" | "pdf" | "pptx">("chat");
  const [createTheme, setCreateTheme] = useState("minimal");
  const [sourceId, setSourceId] = useState("");
  const [createdArtifacts, setCreatedArtifacts] = useState<Artifact[]>([]);
  const [reportTab, setReportTab] = useState<"report" | "conversation">("report");
  const [report, setReport] = useState<DocumentReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState<PersistedWorkflow | null>(null);
  useEffect(() => {
    if (!conversation) return;
    // Restore the complete global conversation, including every attached document.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConversationId(conversation.id);
    setMessages(conversation.messages);
    setSelectedIds(conversation.document_ids);
    setError("");
  }, [conversation]);

  async function ensureConversation() {
    if (conversationId) return conversationId;
    const conversation = await api<Conversation>("/conversations", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: selectedIds.length ? "Document conversation" : "New conversation", document_ids: selectedIds }),
    });
    setConversationId(conversation.id);
    onChanged();
    return conversation.id;
  }

  async function sendQuestion(value: string) {
    const question = value.trim();
    if (!question || busy) return;
    const isToolCommand = selectedIds.length > 0 && /\b(delete|remove|extract|keep only|rotate|compress|smaller|reduce file size|watermark|page numbers?|number the pages?|summari[sz]e|summary|quiz|flashcards?|study guide|translate|compare|differences?|merge|combine|convert to word|docx)\b/i.test(question);
    if (isToolCommand) {
      setDraft("");
      setMessages((current) => [...current, { role: "user", content: question }]);
      setBusy(true);
      setError("");
      try {
        const id = await ensureConversation();
        const command = await api<ConversationCommand>(`/workflows/conversations/${id}/commands`, token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_message_id: crypto.randomUUID(),
            command: question,
            document_ids: selectedIds,
          }),
        });
        setActiveWorkflow(command.workflow);
        if (command.workflow.confirmation_required) {
          setMessages((current) => [...current, {
            role: "assistant",
            content: "I prepared a safe execution plan. Review the steps below and confirm before I modify a copy of your document.",
          }]);
        } else if (command.job) await finishWorkflow(command.workflow, command.job);
        onChanged();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not execute the document workflow");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (createFormat !== "chat") {
      setDraft("");
      setMessages((current) => [...current, { role: "user", content: question }]);
      setBusy(true);
      setError("");
      try {
        const artifact = await api<Artifact>("/create", token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: question, output_format: createFormat, theme: createTheme, source_document_id: sourceId || null }),
        });
        setCreatedArtifacts((current) => [artifact, ...current]);
        setMessages((current) => [...current, { role: "assistant", content: `Created **${artifact.filename}** as a **${String(artifact.parameters.document_type ?? "document")}** with a ${String(artifact.parameters.layout ?? createTheme)} layout. It is saved in your workspace and ready to download.` }]);
        onArtifactCreated(artifact);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not create the file");
      } finally {
        setBusy(false);
      }
      return;
    }
    setDraft("");
    setMessages((current) => [...current, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setBusy(true);
    setError("");
    try {
      const id = await ensureConversation();
      const response = await authenticatedFetch(`${API}/conversations/${id}/messages/stream`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ question }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? "Could not answer");
      }
      if (!response.body) throw new Error("Streaming is unavailable in this browser");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value: chunk } = await reader.read();
        buffer += decoder.decode(chunk, { stream: !done }).replace(/\r\n/g, "\n");
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const event = frame.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
          const data = frame.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
          if (!event || !data) continue;
          const payload = JSON.parse(data) as { text?: string; answer?: string; citations?: Citation[]; message?: string };
          if (event === "token" && payload.text) {
            setMessages((current) => current.map((message, index) =>
              index === current.length - 1 ? { ...message, content: message.content + payload.text } : message
            ));
          } else if (event === "complete" && payload.answer) {
            setMessages((current) => current.map((message, index) =>
              index === current.length - 1 ? { ...message, content: payload.answer ?? message.content, citations: payload.citations ?? [] } : message
            ));
          } else if (event === "error") throw new Error(payload.message ?? "The response stream failed");
        }
        if (done) break;
      }
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not answer");
    } finally {
      setBusy(false);
    }
  }

  async function finishWorkflow(workflow: PersistedWorkflow, job: Job) {
    const completed = await waitForJob(job, token);
    setActiveWorkflow({ ...workflow, status: "completed", steps: workflow.steps.map((step) => ({ ...step, status: "completed" })) });
    if (completed.result_kind === "artifact") {
      const artifact = await api<Artifact>(`/pdf-tools/artifacts/${completed.result_id}`, token);
      setCreatedArtifacts((current) => [artifact, ...current]);
      onArtifactCreated(artifact);
      setMessages((current) => [...current, {
        role: "assistant",
        content: `Done — I ran **${workflow.steps.map((step) => step.title).join(" → ")}**, verified the output, and saved **${artifact.filename}** as a created file.`,
      }]);
      return;
    }
    const result = await api<AIResult>(`/ai/results/${completed.result_id}`, token);
    const body = String(result.result.content ?? result.result.summary ?? result.result.overview ?? "");
    setMessages((current) => [...current, {
      role: "assistant",
      content: body || `Completed **${workflow.steps.map((step) => step.title).join(" → ")}**.\n\n${JSON.stringify(result.result, null, 2)}`,
    }]);
  }

  async function confirmActiveWorkflow() {
    if (!activeWorkflow || busy) return;
    setBusy(true);
    setError("");
    try {
      const command = await api<ConversationCommand>(`/workflows/${activeWorkflow.id}/confirm`, token, { method: "POST" });
      setActiveWorkflow(command.workflow);
      if (!command.job) throw new Error("The confirmed workflow did not start");
      await finishWorkflow(command.workflow, command.job);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not execute the workflow");
    } finally {
      setBusy(false);
    }
  }

  async function cancelActiveWorkflow() {
    if (!activeWorkflow) return;
    try {
      const cancelled = await api<PersistedWorkflow>(`/workflows/${activeWorkflow.id}/cancel`, token, { method: "POST" });
      setActiveWorkflow(cancelled);
      setMessages((current) => [...current, { role: "assistant", content: "The workflow was cancelled. No source document was changed." }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not cancel the workflow");
    }
  }

  function newChat() {
    setConversationId("");
    setMessages([]);
    setDraft("");
    setError("");
    setSelectedIds([]);
    onNewChat();
  }

  async function updateSources(documentId: string, checked: boolean) {
    const next = checked
      ? [...selectedIds, documentId]
      : selectedIds.filter((id) => id !== documentId);
    setSelectedIds(next);
    setReport(null);
    if (!conversationId) return;
    try {
      await api(`/conversations/${conversationId}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_ids: next }),
      });
      onChanged();
    } catch (reason) {
      setSelectedIds(selectedIds);
      setError(reason instanceof Error ? reason.message : "Could not update chat sources");
    }
  }

  async function analyzeDocument() {
    if (selectedIds.length !== 1 || reportBusy) return;
    setReportTab("report");
    setReportBusy(true);
    setError("");
    setReport(null);
    try {
      const result = await api<AIResult>(`/ai/documents/${selectedIds[0]}/report`, token, { method: "POST" });
      setReport(result.result as DocumentReport);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not analyze the document");
    } finally {
      setReportBusy(false);
    }
  }

  const selectedDocuments = documents.filter((document) => selectedIds.includes(document.id));
  const latestAnswer = [...messages].reverse().find((message) => message.role === "assistant" && message.content);
  const reportCitations = latestAnswer?.citations ?? [];
  const reportLines = (latestAnswer?.content ?? "").split("\n")
    .map((line) => line.replace(/^#{1,4}\s+|^[-*]\s+|^\d+\.\s+/, "").trim())
    .filter((line) => line.length > 24);
  const reportTitle = selectedDocuments.length === 1
    ? (selectedDocuments[0].display_title || selectedDocuments[0].filename)
    : selectedDocuments.length > 1 ? `${selectedDocuments.length}-document analysis` : "Document analysis";
  const pageTotal = selectedDocuments.reduce((sum, document) => sum + (document.page_count ?? 0), 0);

  return <section className={`agent-workspace ${report || reportBusy ? "has-report" : ""}`}>
    <aside className="agent-sources">
      <header><span>Attached documents</span><b>{selectedIds.length}</b></header>
      <div className="agent-source-list">
        {!documents.length && <div className="agent-source-empty"><FileText size={22} /><span>Your documents will appear here.</span></div>}
        {documents.map((document) => <label className={selectedIds.includes(document.id) ? "selected" : ""} key={document.id}>
          <input type="checkbox" checked={selectedIds.includes(document.id)} onChange={(event) => updateSources(document.id, event.target.checked)} />
          <span className="source-file-icon"><FileText size={15} /></span>
          <span><strong>{document.display_title || document.filename}</strong><small>{document.status === "ready" ? `${document.page_count ?? "—"} pages · Ready` : document.status.replaceAll("_", " ")}</small></span>
          <button type="button" aria-label={`Preview ${document.filename}`} onClick={(event) => { event.preventDefault(); onPreview(document); }}><Eye size={13} /></button>
        </label>)}
      </div>
    </aside>

    <main className="report-canvas">
      <header className="report-toolbar">
        <div><span className="report-status"><i /> {reportBusy ? "Analysis in progress" : report ? "Analysis complete" : "Ready to analyze"}</span><h1>{report?.title || reportTitle}</h1></div>
      </header>
      {reportTab === "report" ? <div className="report-scroll">
        {!selectedIds.length && <section className="report-welcome">
          <span><Sparkles size={25} /></span><p className="eyebrow">PDF analysis agent</p>
          <h2>Turn a document into a decision-ready report.</h2>
          <p>Select a source or upload a PDF. InsightPDF will read it, extract the important facts, verify citations, and build a structured report here.</p>
          <div><article><ScanText size={18} /><strong>Reads every page</strong><small>OCR, tables, entities and dates</small></article><article><ShieldCheck size={18} /><strong>Checks its work</strong><small>Claims link back to sources</small></article><article><FileOutput size={18} /><strong>Creates outputs</strong><small>PDF, Word and presentations</small></article></div>
        </section>}
        {!!selectedIds.length && !report && !reportBusy && <section className="report-start">
          <span className="report-document-mark"><FileText size={28} /></span><p className="eyebrow">Document ready</p><h2>Build a complete analysis</h2>
          <p>I’ll identify the document type, extract its important facts, check for risks and inconsistencies, and create a cited report.</p>
          <div className="report-plan">
            {[[ScanText, "Read and classify", "Understand structure, purpose and audience"], [BarChart3, "Extract key evidence", "Find metrics, dates, entities and changes"], [AlertTriangle, "Check for risk", "Surface contradictions and missing information"], [CheckCircle2, "Verify and report", "Connect important claims to their pages"]].map(([Icon, title, copy], index) => {
              const StepIcon = Icon as typeof ScanText;
              return <article key={String(title)}><b>0{index + 1}</b><StepIcon size={17} /><span><strong>{String(title)}</strong><small>{String(copy)}</small></span></article>;
            })}
          </div>
          <button className="run-analysis" disabled={selectedDocuments.length !== 1} onClick={analyzeDocument}><Sparkles size={16} /> {selectedDocuments.length === 1 ? "Analyze document" : "Select one document to analyze"}</button>
        </section>}
        {reportBusy && <section className="analysis-running">
          <div className="analysis-orbit"><BrandMark /><i /><i /><i /></div><p className="eyebrow">Agent working</p><h2>Building your report</h2>
          <div className="analysis-steps">
            <article className="done"><Check size={14} /><span><strong>Sources attached</strong><small>{pageTotal} pages available</small></span></article>
            <article className="done"><Check size={14} /><span><strong>Document structure mapped</strong><small>Sections and relationships identified</small></span></article>
            <article className="active"><RefreshCw className="spin" size={14} /><span><strong>Extracting and verifying findings</strong><small>Reading evidence and building citations</small></span></article>
            <article><span className="step-dot" /><span><strong>Assemble decision-ready report</strong><small>Summary, risks, timeline and next actions</small></span></article>
          </div>
        </section>}
        {report && <div className="report-grid structured-report">
          <section className="report-hero-card"><div><p className="eyebrow">{report.document_type}</p><h2>{report.title}</h2><span>{pageTotal} pages reviewed · {report.findings.length} findings · {report.metrics.length} metrics</span></div><ShieldCheck size={25} /></section>
          <section className="report-summary-card"><header><span><AlignLeft size={16} /></span><div><p className="eyebrow">Executive summary</p><h3>{report.purpose}</h3></div></header><p className="report-executive-copy">{report.executive_summary}</p></section>
          {!!report.metrics.length && <section className="landing-style-metrics">
            <header><div><p className="eyebrow">Key metrics</p><h3>Numbers extracted from the source</h3></div><span>{report.metrics.length} verified</span></header>
            <div>{report.metrics.map((metric, index) => <article key={`${metric.label}-${index}`}><small>{metric.label}</small><strong>{metric.value}</strong>{metric.change && <em className={metric.trend}>{metric.trend === "up" ? "↑" : metric.trend === "down" ? "↓" : "→"} {metric.change}</em>}<p>{metric.context}</p>{metric.page_references[0] && <button onClick={() => onCitation({ ...metric.page_references[0], snippet: metric.context })}>Page {metric.page_references[0].page_number}</button>}</article>)}</div>
          </section>}
          <section className="report-findings-card"><header><div><p className="eyebrow">Key findings</p><h3>What matters most</h3></div><span>{report.findings.length} findings</span></header>{report.findings.map((finding, index) => <article key={`${finding.title}-${index}`}><b>{index + 1}</b><div><strong>{finding.title}</strong><p>{finding.detail}</p><div className="finding-references">{finding.page_references.map((reference, referenceIndex) => <button key={referenceIndex} onClick={() => onCitation({ ...reference, snippet: finding.detail })}>Page {reference.page_number}</button>)}</div></div><span className={`importance ${finding.importance}`}>{finding.importance}</span></article>)}</section>
          <div className="report-detail-row">
            <section className="report-risk-card"><header><AlertTriangle size={16} /><strong>Risks & review points</strong></header>{report.risks.length ? report.risks.map((risk, index) => <article key={`${risk.title}-${index}`}><span className={`severity ${risk.severity}`} /> <div><strong>{risk.title}</strong><p>{risk.detail}</p></div></article>) : <p>No material risks were supported by the source.</p>}</section>
            <section><header><Clock3 size={16} /><strong>Timeline</strong></header>{report.timeline.length ? report.timeline.map((event, index) => <article className="timeline-event" key={`${event.date}-${index}`}><b>{event.date}</b><p>{event.event}</p>{event.page_references[0] && <button onClick={() => onCitation({ ...event.page_references[0], snippet: event.event })}>p. {event.page_references[0].page_number}</button>}</article>) : <p>No explicit timeline was found in this document.</p>}</section>
          </div>
          <div className="report-detail-row">
            <section><header><Users size={16} /><strong>People & organizations</strong></header>{report.entities.length ? report.entities.map((entity, index) => <article className="entity-row" key={`${entity.name}-${index}`}><span>{entity.name.slice(0, 1).toUpperCase()}</span><div><strong>{entity.name}</strong><p>{entity.role}</p></div></article>) : <p>No named people or organizations were found.</p>}</section>
            <section><header><ListChecks size={16} /><strong>Recommended next actions</strong></header>{report.next_actions.map((action, index) => <article className="action-row" key={`${action}-${index}`}><b>{index + 1}</b><p>{action}</p></article>)}</section>
          </div>
          {!!report.missing_information.length && <section className="report-missing-card"><header><AlertTriangle size={16} /><div><p className="eyebrow">Information gaps</p><h3>What the source does not establish</h3></div></header><ul>{report.missing_information.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section>}
        </div>}
        {!report && latestAnswer && <div className="report-grid">
          <section className="report-hero-card"><div><p className="eyebrow">Executive analysis</p><h2>{reportTitle}</h2><span>{pageTotal} pages reviewed · {reportCitations.length} cited sources</span></div><ShieldCheck size={25} /></section>
          <section className="report-summary-card"><header><span><AlignLeft size={16} /></span><div><p className="eyebrow">Executive summary</p><h3>What decision-makers should know</h3></div></header><FormattedAnswer content={latestAnswer.content} /></section>
          <div className="report-insight-row">
            <section><span className="card-icon blue"><BarChart3 size={16} /></span><small>Evidence found</small><strong>{Math.max(reportLines.length, reportCitations.length)}</strong><p>Material findings extracted from the selected sources.</p></section>
            <section><span className="card-icon amber"><AlertTriangle size={16} /></span><small>Review focus</small><strong>{reportLines.filter((line) => /risk|missing|declin|concern|unclear|inconsisten/i.test(line)).length}</strong><p>Items that may need closer human attention.</p></section>
            <section><span className="card-icon green"><ShieldCheck size={16} /></span><small>Source coverage</small><strong>{new Set(reportCitations.map((citation) => citation.page_number)).size}</strong><p>Unique pages linked directly from the analysis.</p></section>
          </div>
          {!!reportLines.length && <section className="report-findings-card"><header><div><p className="eyebrow">Key findings</p><h3>Evidence ranked for review</h3></div><span>{Math.min(reportLines.length, 6)} findings</span></header>{reportLines.slice(0, 6).map((line, index) => <article key={`${line}-${index}`}><b>{index + 1}</b><p>{line}</p><ChevronRight size={15} /></article>)}</section>}
          <div className="report-detail-row">
            <section><header><Clock3 size={16} /><strong>Dates & timeline</strong></header><p>{reportLines.find((line) => /\b(19|20)\d{2}\b|date|deadline|quarter|month|year/i.test(line)) ?? "Ask the agent to extract a complete chronology of events and deadlines."}</p><button onClick={() => setDraft("Extract every important date and build a chronological timeline.")}>Build timeline <ChevronRight size={13} /></button></section>
            <section><header><Users size={16} /><strong>People & organizations</strong></header><p>{reportLines.find((line) => /company|team|author|employee|customer|vendor|party|organization/i.test(line)) ?? "Ask the agent to map the people, companies, and responsibilities."}</p><button onClick={() => setDraft("Map every person and organization, including their responsibilities.")}>Map entities <ChevronRight size={13} /></button></section>
          </div>
          {!!reportCitations.length && <section className="report-sources-card"><header><div><p className="eyebrow">Verified evidence</p><h3>Source trail</h3></div><span>{reportCitations.length} citations</span></header><div>{reportCitations.map((citation, index) => <button key={`${citation.document_id}-${citation.page_number}-${index}`} onClick={() => onCitation(citation)}><span><FileText size={14} /></span><div><strong>{citation.document_name}</strong><p>{citation.snippet}</p></div><b>Page {citation.page_number}</b></button>)}</div></section>}
        </div>}
      </div> : <div className="report-conversation"><div className="report-chat-messages">
        {!messages.length && <div className="report-chat-empty"><MessageCircle size={23} /><strong>Ask the analysis agent</strong><span>Questions use the selected documents and include page citations.</span></div>}
        {messages.map((message, index) => <article className={message.role} key={index}>{message.role === "assistant" && <BrandMark />}<div>{message.role === "assistant" ? <FormattedAnswer content={message.content} /> : <p>{message.content}</p>}</div></article>)}
        {busy && <div className="home-chat-thinking"><RefreshCw className="spin" size={14} /> Working through the source pages…</div>}
        {createdArtifacts.map((artifact) => <article className="home-created-file" key={artifact.id}><span>{artifact.filename.endsWith(".pptx") ? <Presentation size={18} /> : <FileText size={18} />}</span><div><strong>{artifact.filename}</strong><small>{artifact.filename.split(".").pop()?.toUpperCase()} · ready in your workspace</small></div><button onClick={() => downloadArtifact(artifact, token)}><Download size={15} /></button></article>)}
      </div></div>}
      {error && <div className="chat-error">{error}</div>}
    </main>

    <aside className="agent-panel">
      <header><BrandMark /><div><strong>InsightPDF agent</strong><small>{reportBusy || busy ? "Working now" : selectedIds.length ? `${selectedIds.length} source${selectedIds.length === 1 ? "" : "s"} connected` : "Ask anything or attach a source"}</small></div><div className="agent-header-actions">{selectedIds.length === 1 && <button disabled={reportBusy} onClick={analyzeDocument}>{reportBusy ? <RefreshCw className="spin" size={13} /> : <LayoutDashboard size={13} />}{report ? "Refresh report" : "Build report"}</button>}{!!messages.length && <button aria-label="New chat" title="New chat" onClick={newChat}><RefreshCw size={13} /></button>}</div><span className={reportBusy || busy ? "active" : ""} /></header>
      <div className="agent-chat-thread">
        {!messages.length && <div className="agent-chat-welcome"><span className="agent-demo-badge"><Sparkles size={12} /> AI document workspace</span><BrandMark /><strong>Turn documents into decisions.</strong><p>{selectedIds.length ? "Ask about your sources, uncover risks, or build a cited report in seconds." : "Connect a source to summarize, compare, verify, and create polished outputs from one workspace."}</p><div>{(selectedIds.length ? ["Surface the key findings", "What needs my attention?", "Create an action plan"] : ["Show me what InsightPDF can do", "Create an executive brief"]).map((prompt) => <button key={prompt} onClick={() => setDraft(prompt)}>{prompt}</button>)}</div><small className="agent-capability-line"><ShieldCheck size={12} /> Page-level citations <i /> <ScanText size={12} /> OCR ready <i /> <FileOutput size={12} /> Export to PDF, Word &amp; Slides</small></div>}
        {messages.map((message, index) => <article className={message.role} key={`${message.role}-${index}`}>
          {message.role === "assistant" && <BrandMark />}
          <div>{message.role === "assistant" ? <FormattedAnswer content={message.content} /> : <p>{message.content}</p>}</div>
        </article>)}
        {activeWorkflow && <section className={`conversation-workflow-card ${activeWorkflow.status}`}>
          <header><span><Sparkles size={14} /> Execution plan</span><b>{activeWorkflow.status.replaceAll("_", " ")}</b></header>
          <ol>{activeWorkflow.steps.map((step) => <li key={step.id}><span>{step.status === "completed" ? <Check size={13} /> : <span>{step.position}</span>}</span><div><strong>{step.title}</strong><small>{step.verification.replaceAll("_", " ")} verification · {step.risk} risk</small></div></li>)}</ol>
          {activeWorkflow.status === "awaiting_confirmation" && <div className="workflow-confirm"><small>The source file is preserved. A new file will be created.</small><button disabled={busy} onClick={confirmActiveWorkflow}><ShieldCheck size={14} /> Confirm and run</button></div>}
          {["queued", "running"].includes(activeWorkflow.status) && <div className="workflow-confirm"><small>Execution is durable and can resume if you leave this chat.</small><button className="workflow-cancel" onClick={cancelActiveWorkflow}><X size={14} /> Cancel</button></div>}
        </section>}
        {busy && <div className="agent-chat-working"><RefreshCw className="spin" size={12} /> InsightPDF is working…</div>}
      </div>
      <div className="agent-activity"><p className="eyebrow">Activity</p>
        {selectedIds.length ? <>
          <article className="done"><Check size={12} /><span><strong>Sources connected</strong><small>{selectedDocuments.length} document{selectedDocuments.length === 1 ? "" : "s"}</small></span></article>
          <article className={report || reportBusy ? "done" : ""}>{report || reportBusy ? <Check size={12} /> : <span className="activity-dot" />}<span><strong>Pages indexed</strong><small>{pageTotal} pages searchable</small></span></article>
          <article className={reportBusy ? "working" : report ? "done" : ""}>{reportBusy ? <RefreshCw className="spin" size={12} /> : report ? <Check size={12} /> : <span className="activity-dot" />}<span><strong>{reportBusy ? "Analyzing evidence" : report ? "Report assembled" : "Awaiting analysis"}</strong><small>{reportBusy ? "Checking claims and citations" : report ? `${report.findings.length} findings verified` : "Run the report when ready"}</small></span></article>
        </> : <div className="agent-idle"><Activity size={18} /><span>Attach a document to begin.</span></div>}
      </div>
      {!!report && <div className="agent-quick-actions"><p className="eyebrow">Continue working</p>{["Explain the biggest risk", "Create an action checklist", "Check every important deadline"].map((prompt) => <button key={prompt} onClick={() => { setCreateFormat("chat"); sendQuestion(prompt); }}>{prompt}<ChevronRight size={13} /></button>)}</div>}
      <div className="agent-output"><p className="eyebrow">Create from analysis</p><div>{([["pdf", FileText, "PDF"], ["docx", FileOutput, "Word"], ["pptx", Presentation, "Slides"]] as const).map(([format, Icon, label]) => <button key={format} className={createFormat === format ? "active" : ""} onClick={() => setCreateFormat((current) => current === format ? "chat" : format)}><Icon size={15} />{label}</button>)}</div></div>
      <form className="agent-composer" onSubmit={(event) => { event.preventDefault(); sendQuestion(draft); }}>
        <textarea aria-label="Instruct the analysis agent" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={createFormat === "chat" ? "Ask a follow-up…" : `Describe the ${createFormat === "pptx" ? "presentation" : createFormat === "docx" ? "Word file" : "PDF"} to create…`} rows={3} disabled={busy} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <div><span>{selectedIds.length} source{selectedIds.length === 1 ? "" : "s"}</span><button aria-label="Send instruction" disabled={busy || !draft.trim()}><Send size={15} /></button></div>
      </form>
      <small className="agent-grounding"><ShieldCheck size={12} /> Answers are grounded in selected sources.</small>
    </aside>
  </section>;

  return <section className="home-chat">
    <header>
      <div className="home-chat-agent"><BrandMark /><span><strong>InsightPDF agent</strong><small>Ask, analyze, or create</small></span></div>
      <div className="home-chat-header-actions"><button onClick={onHistory}><History size={15} /> History</button>{!!messages.length && <button onClick={newChat}><MessageCircle size={15} /> New chat</button>}</div>
    </header>
    <div className="home-chat-messages">
      {!messages.length && <div className="home-chat-empty">
        <span className="home-chat-logo"><BrandMark /></span>
        <h1>What can I help you with?</h1>
        <p>Ask generally, or attach one or more documents for answers grounded in their pages.</p>
        <div className="home-chat-starters">{["Summarize a document", "Compare key findings", "Create an executive report"].map((prompt) => <button type="button" key={prompt} onClick={() => setDraft(prompt)}>{prompt}</button>)}</div>
      </div>}
      {messages.map((message, index) => <article className={message.role} key={index}>
        {message.role === "assistant" && <span><BrandMark /></span>}
        <div>{message.role === "assistant" ? <><FormattedAnswer content={message.content} />{!!message.citations?.length && <div className="citation-list"><span className="citation-heading">Sources</span>{message.citations.map((citation, citationIndex) => <button key={citationIndex} onClick={() => onCitation(citation)}><b>{citation.document_name}</b><em>Page {citation.page_number}</em><span>{citation.snippet}</span></button>)}</div>}</> : <p>{message.content}</p>}</div>
      </article>)}
      {createdArtifacts.map((artifact) => <article className="home-created-file" key={artifact.id}>
        <span>{artifact.filename.endsWith(".pptx") ? <Presentation size={18} /> : <FileText size={18} />}</span>
        <div><strong>{artifact.filename}</strong><small>{artifact.filename.split(".").pop()?.toUpperCase()} · {String(artifact.parameters.document_type ?? "document")} · {String(artifact.parameters.layout ?? createTheme)} layout · {(artifact.size_bytes / 1024).toFixed(1)} KB</small></div>
        <button onClick={() => downloadArtifact(artifact, token)}><Download size={15} /> Download</button>
      </article>)}
      {busy && <div className="home-chat-thinking"><RefreshCw className="spin" size={14} /> {createFormat === "chat" ? "InsightPDF is thinking…" : "InsightPDF is writing your document…"}</div>}
    </div>
    {error && <div className="chat-error">{error}</div>}
    <details className="home-chat-sources">
      <summary><FolderOpen size={14} /><span>{selectedIds.length ? `${selectedIds.length} document${selectedIds.length === 1 ? "" : "s"} attached` : "Attach documents"}</span></summary>
      <div>
        {!documents.length && <p>Upload and index a document to use it as chat context.</p>}
        {documents.map((document) => <label key={document.id}>
          <input type="checkbox" checked={selectedIds.includes(document.id)} onChange={(event) => updateSources(document.id, event.target.checked)} />
          <FileText size={14} />
          <span><strong>{document.display_title || document.filename}</strong><small>{document.page_count ?? "—"} pages</small></span>
          <button type="button" onClick={(event) => { event.preventDefault(); onPreview(document); }}><Eye size={14} /></button>
        </label>)}
      </div>
    </details>
    <div className="home-create-controls">
      <div className="home-create-types" aria-label="AI action">
        <button className={createFormat === "docx" ? "active" : ""} onClick={() => setCreateFormat("docx")}><FileText size={14} /> Word</button>
        <button className={createFormat === "pdf" ? "active" : ""} onClick={() => setCreateFormat("pdf")}><FileText size={14} /> PDF</button>
        <button className={createFormat === "pptx" ? "active" : ""} onClick={() => setCreateFormat("pptx")}><Presentation size={14} /> Slides</button>
      </div>
      {createFormat !== "chat" && <div className="home-create-options">
        <select aria-label="Creation theme" value={createTheme} onChange={(event) => setCreateTheme(event.target.value)}>
          <option value="minimal">Minimal theme</option><option value="executive">Executive theme</option><option value="modern">Modern theme</option><option value="warm">Warm theme</option>
        </select>
        <select aria-label="Source document" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
          <option value="">Create from prompt</option>{documents.map((document) => <option key={document.id} value={document.id}>Use {document.filename}</option>)}
        </select>
      </div>}
    </div>
    <form onSubmit={(event) => { event.preventDefault(); sendQuestion(draft); }}>
      <label className={`home-chat-attach ${attaching ? "busy" : ""}`} title="Attach a PDF or image" aria-label="Attach a PDF or image">
        {attaching ? <RefreshCw className="spin" size={17} /> : <Upload size={17} />}
        <input type="file" accept={DOCUMENT_UPLOAD_ACCEPT} disabled={busy || attaching} onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setAttaching(true);
          setError("");
          try {
            await onUploadFile(file);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Upload failed");
          } finally {
            setAttaching(false);
            event.target.value = "";
          }
        }} />
      </label>
      <textarea aria-label="Message InsightPDF AI" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={createFormat === "chat" ? "Message InsightPDF AI…" : `Describe the ${createFormat === "pptx" ? "presentation" : createFormat === "docx" ? "Word document" : "PDF"} you want to create…`} rows={1} disabled={busy} onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
      }} />
      <button aria-label="Send message" disabled={busy || !draft.trim()}><Send size={18} /></button>
    </form>
    <small>{createFormat === "chat" ? `${selectedIds.length ? "Answers use the attached document context and include citations." : "General chat · attach documents whenever you need grounded answers."}` : `InsightPDF will create and save a real ${createFormat.toUpperCase()} file.`}</small>
  </section>;
}

function ConversationHistory({
  conversations, documents, busy, onRefresh, onOpen, onClose,
}: {
  conversations: Conversation[];
  documents: DocumentItem[];
  busy: boolean;
  onRefresh: () => Promise<void>;
  onOpen: (conversation: Conversation) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function rename(conversation: Conversation, title: string) {
    if (!title.trim()) return;
    try {
      const auth = JSON.parse(localStorage.getItem("insightpdf-auth") ?? "{}") as AuthResult;
      await api(`/conversations/${conversation.id}`, auth.access_token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      setEditing(null);
      await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Rename failed"); }
  }

  async function remove(conversation: Conversation) {
    if (!window.confirm(`Delete "${conversation.title}"?`)) return;
    try {
      const auth = JSON.parse(localStorage.getItem("insightpdf-auth") ?? "{}") as AuthResult;
      await api(`/conversations/${conversation.id}`, auth.access_token, { method: "DELETE" });
      await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Delete failed"); }
  }

  return <div className="history-wrap" role="dialog" aria-modal="true" aria-label="Conversation history">
    <button className="history-backdrop" aria-label="Close conversation history" onClick={onClose} />
    <section className="history-panel">
      <header><div><p className="eyebrow">Workspace history</p><h2>Conversations</h2></div><button aria-label="Close" onClick={onClose}><X size={19} /></button></header>
      {error && <div className="chat-error">{error}</div>}
      <div className="history-list">
        {busy && <div className="history-empty"><RefreshCw className="spin" size={18} /> Loading conversations…</div>}
        {!busy && !conversations.length && <div className="history-empty"><History size={30} /><strong>No conversations yet</strong><span>Start a chat and attach one or more documents when you need grounded answers.</span></div>}
        {conversations.map((conversation) => {
          const attachedDocuments = documents.filter((item) => conversation.document_ids.includes(item.id));
          return <article className="history-item" key={conversation.id}>
            <div className="history-title">
              {editing === conversation.id
                ? <form onSubmit={(event) => { event.preventDefault(); rename(conversation, String(new FormData(event.currentTarget).get("title"))); }}>
                    <input name="title" defaultValue={conversation.title} autoFocus maxLength={160} />
                    <button>Save</button>
                  </form>
                : <><strong>{conversation.title}</strong><span>{conversation.messages.length} messages · {attachedDocuments.length ? attachedDocuments.map((item) => item.filename).join(", ") : "No available attachments"} · {new Date(conversation.updated_at).toLocaleString()}</span></>}
            </div>
            <div className="history-actions">
              <button aria-label="Rename conversation" onClick={() => setEditing(conversation.id)}><Pencil size={14} /></button>
              <button aria-label="Delete conversation" onClick={() => remove(conversation)}><Trash2 size={14} /></button>
              <button onClick={() => onOpen(conversation)}>Open</button>
            </div>
          </article>;
        })}
      </div>
    </section>
  </div>;
}

function MultiDocumentChat({
  documents, onSelected, onClose,
}: {
  documents: DocumentItem[];
  onSelected: (selected: DocumentItem[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected.length < 2) { setError("Select at least two ready PDFs."); return; }
    const chosen = documents.filter((document) => selected.includes(document.id));
    onSelected(chosen);
  }

  return <div className="multi-chat-wrap" role="dialog" aria-modal="true" aria-label="Ask multiple PDFs">
    <button className="history-backdrop" aria-label="Close" onClick={onClose} />
    <form className="multi-chat-panel" onSubmit={create}>
      <button className="modal-x" type="button" aria-label="Close" onClick={onClose}><X size={18} /></button>
      <span className="multi-chat-icon"><GitCompareArrows size={23} /></span>
      <p className="eyebrow">Cross-document chat</p>
      <h2>Ask across documents</h2>
      <p>Select two or more indexed sources. Answers retrieve and cite the most relevant pages across them.</p>
      <div className="multi-doc-list">
        {documents.map((document) => <label key={document.id} className={selected.includes(document.id) ? "selected" : ""}>
          <input type="checkbox" checked={selected.includes(document.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, document.id] : current.filter((id) => id !== document.id))} />
          <FileText size={18} /><span><strong>{document.filename}</strong><small>{document.page_count ?? "—"} pages</small></span>
        </label>)}
      </div>
      {error && <div className="form-error">{error}</div>}
      <button className="multi-submit" disabled={selected.length < 2}><MessageCircle size={16} /> Attach {selected.length || 0} documents</button>
    </form>
  </div>;
}

async function downloadArtifact(artifact: Artifact, token: string) {
  const response = await authenticatedFetch(`${API}/pdf-tools/artifacts/${artifact.id}/download`, token);
  if (!response.ok) throw new Error("Could not download generated file");
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = window.document.createElement("a");
  link.href = url; link.download = artifact.filename; link.click(); URL.revokeObjectURL(url);
}

async function downloadDocumentFile(document: DocumentItem, token: string) {
  const response = await authenticatedFetch(`${API}/documents/${document.id}/content`, token);
  if (!response.ok) throw new Error("Could not download PDF");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = document.filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadOriginalSource(document: DocumentItem, token: string) {
  const response = await authenticatedFetch(`${API}/documents/${document.id}/original`, token);
  if (!response.ok) throw new Error("Original source download failed");
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = window.document.createElement("a");
  link.href = url; link.download = document.original_filename || document.filename; link.click(); URL.revokeObjectURL(url);
}

async function downloadDocumentArchive(documents: DocumentItem[], token: string, artifacts: Artifact[] = []) {
  const response = await authenticatedFetch(`${API}/documents/download-zip`, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      files: [
        ...documents.map((document) => ({ kind: "document", id: document.id })),
        ...artifacts.map((artifact) => ({ kind: "artifact", id: artifact.id })),
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? "Could not prepare the ZIP download");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `insightpdf-documents-${date}.zip`;
  link.click();
  URL.revokeObjectURL(url);
}

// Kept temporarily for migration reference until the unified workspace rollout is finalized.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function MyFolder({ documents, token, onDocuments, onClose }: {
  documents: DocumentItem[];
  token: string;
  onDocuments: (documents: DocumentItem[]) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"documents" | "generated">("documents");
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [archiveBusy, setArchiveBusy] = useState(false);

  useEffect(() => {
    api<Artifact[]>("/pdf-tools/artifacts", token).then(setArtifacts).catch((reason) => setError(reason.message));
  }, [token]);

  async function renameDocumentItem(document: DocumentItem) {
    const filename = window.prompt("Rename PDF", document.filename)?.trim();
    if (!filename || filename === document.filename) return;
    setBusyId(document.id); setError("");
    try {
      const updated = await api<DocumentItem>(`/documents/${document.id}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      onDocuments(documents.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not rename PDF"); }
    finally { setBusyId(""); }
  }

  async function deleteDocumentItem(document: DocumentItem) {
    if (!window.confirm(`Delete "${document.filename}"?`)) return;
    setBusyId(document.id); setError("");
    try {
      await api(`/documents/${document.id}`, token, { method: "DELETE" });
      onDocuments(documents.filter((item) => item.id !== document.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete PDF"); }
    finally { setBusyId(""); }
  }

  async function renameArtifact(item: Artifact) {
    const filename = window.prompt("Rename generated file", item.filename)?.trim();
    if (!filename || filename === item.filename) return;
    setBusyId(item.id); setError("");
    try {
      const updated = await api<Artifact>(`/pdf-tools/artifacts/${item.id}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      setArtifacts((current) => current.map((artifact) => artifact.id === updated.id ? updated : artifact));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not rename generated file"); }
    finally { setBusyId(""); }
  }

  async function deleteArtifact(item: Artifact) {
    if (!window.confirm(`Delete "${item.filename}"?`)) return;
    setBusyId(item.id); setError("");
    try {
      await api(`/pdf-tools/artifacts/${item.id}`, token, { method: "DELETE" });
      setArtifacts((current) => current.filter((artifact) => artifact.id !== item.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete generated file"); }
    finally { setBusyId(""); }
  }

  const normalized = query.trim().toLowerCase();
  const visibleDocuments = documents.filter((item) => item.filename.toLowerCase().includes(normalized));
  const visibleArtifacts = artifacts.filter((item) => item.filename.toLowerCase().includes(normalized));
  const selectedDocuments = documents.filter((item) => selectedIds.includes(item.id));

  async function downloadSelectedDocuments() {
    setArchiveBusy(true); setError("");
    try {
      await downloadDocumentArchive(selectedDocuments, token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare the ZIP download");
    } finally {
      setArchiveBusy(false);
    }
  }

  return <div className="folder-wrap"><button className="history-backdrop" aria-label="Close my folder" onClick={onClose} />
    <section className="folder-panel" role="dialog" aria-label="My folder">
      <header><div><p className="eyebrow">File library</p><h2>My folder</h2></div><button aria-label="Close my folder" onClick={onClose}><X size={18} /></button></header>
      <nav>
        <button className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}><FileText size={15} /> Source documents <span>{documents.length}</span></button>
        <button className={tab === "generated" ? "active" : ""} onClick={() => setTab("generated")}><FileOutput size={15} /> Generated files <span>{artifacts.length}</span></button>
      </nav>
      <div className="folder-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" /></div>
      {tab === "documents" && visibleDocuments.length > 0 && <div className="folder-bulk-actions">
        <label><input type="checkbox" checked={visibleDocuments.every((item) => selectedIds.includes(item.id))} onChange={(event) => {
          const visibleIds = visibleDocuments.map((item) => item.id);
          setSelectedIds((current) => event.target.checked
            ? [...new Set([...current, ...visibleIds])]
            : current.filter((id) => !visibleIds.includes(id)));
        }} /> Select all shown</label>
        <span>{selectedIds.length ? `${selectedIds.length} selected` : "Select PDFs to download together"}</span>
        <button disabled={selectedDocuments.length < 2 || archiveBusy} onClick={downloadSelectedDocuments}>
          {archiveBusy ? <RefreshCw size={14} className="spin" /> : <Download size={14} />}
          {archiveBusy ? `Preparing ${selectedDocuments.length} PDFs…` : "Download ZIP"}
        </button>
      </div>}
      {error && <div className="form-error">{error}</div>}
      <main>
        {tab === "documents" && visibleDocuments.map((item) => <article className="folder-item" key={item.id}>
          <label className="folder-select" title={`Select ${item.filename}`}><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></label>
          <div className="folder-file-icon pdf"><FileText size={19} /></div>
          <div><strong>{item.filename}</strong><span>{(item.size_bytes / 1024 / 1024).toFixed(1)} MB · {item.page_count ?? "—"} pages · {item.status.replaceAll("_", " ")}</span></div>
          <div className="folder-actions">
            <button disabled={busyId === item.id} title="Download" onClick={() => downloadDocumentFile(item, token).catch((reason) => setError(reason.message))}><Download size={14} /></button>
            <button disabled={busyId === item.id} title="Rename" onClick={() => renameDocumentItem(item)}><Pencil size={14} /></button>
            <button disabled={busyId === item.id} title="Delete" onClick={() => deleteDocumentItem(item)}><Trash2 size={14} /></button>
          </div>
        </article>)}
        {tab === "generated" && visibleArtifacts.map((item) => <article className="folder-item no-select" key={item.id}>
          <div className="folder-file-icon generated"><FileOutput size={18} /></div>
          <div><strong>{item.filename}</strong><span>{(item.size_bytes / 1024).toFixed(1)} KB · {item.operation.replaceAll("_", " ")} · {new Date(item.created_at).toLocaleDateString()}</span></div>
          <div className="folder-actions">
            <button disabled={busyId === item.id} title="Download" onClick={() => downloadArtifact(item, token).catch((reason) => setError(reason.message))}><Download size={14} /></button>
            <button disabled={busyId === item.id} title="Rename" onClick={() => renameArtifact(item)}><Pencil size={14} /></button>
            <button disabled={busyId === item.id} title="Delete" onClick={() => deleteArtifact(item)}><Trash2 size={14} /></button>
          </div>
        </article>)}
        {((tab === "documents" && !visibleDocuments.length) || (tab === "generated" && !visibleArtifacts.length)) &&
          <div className="folder-empty"><FolderOpen size={34} /><strong>No files found</strong><span>{query ? "Try another search." : tab === "documents" ? "Uploaded PDFs will appear here." : "Converted and generated files will appear here."}</span></div>}
      </main>
    </section>
  </div>;
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
  const [opacity, setOpacity] = useState(.25);
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

  return <div className="pdf-tools-wrap"><button className="history-backdrop" aria-label="Close PDF tools" onClick={onClose} />
    <section className="pdf-tools-panel"><header><div><p className="eyebrow">Document workflows</p><h2>Document tools</h2></div><button aria-label="Close document tools" onClick={onClose}><X size={18} /></button></header>
      <div className="pdf-tools-layout"><nav>{tools.map(([id, label]) => <button className={tool === id ? "active" : ""} key={id} onClick={() => { setTool(id); setArtifact(null); setError(""); }}>{id.includes("image") ? <FileImage size={15} /> : <Scissors size={15} />}{label}</button>)}</nav>
        <main><div className="tool-heading"><h3>{tools.find(([id]) => id === tool)?.[1]}</h3><p>Outputs are stored securely and available for download.</p></div>
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
            {tool === "watermark" && <><label>Watermark text <small>Optional when using an image</small><input value={watermarkText} onChange={(event) => setWatermarkText(event.target.value)} /></label><label>Watermark image <small>Optional PNG/JPEG</small><input type="file" accept="image/png,image/jpeg" onChange={(event) => setWatermarkImage(event.target.files?.[0] ?? null)} /></label><label>Pages <small>Leave blank for every page</small><input value={pages} onChange={(event) => setPages(event.target.value)} /></label><label>Position<select value={position} onChange={(event) => setPosition(event.target.value)}><option value="center">Center</option><option value="top_left">Top left</option><option value="top_right">Top right</option><option value="bottom_left">Bottom left</option><option value="bottom_right">Bottom right</option></select></label><label>Opacity<input type="range" min=".05" max="1" step=".05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /><small>{Math.round(opacity * 100)}%</small></label></>}
            <button className="run-pdf-tool" disabled={!canRun} onClick={run}>{busy ? <RefreshCw className="spin" size={15} /> : <Scissors size={15} />}{busy ? "Processing…" : "Create file"}</button>
          </div>
          {error && <div className="form-error">{error}</div>}
          {artifact && <div className="artifact-ready"><Check size={25} /><div><strong>{artifact.filename}</strong><span>{(artifact.size_bytes / 1024).toFixed(1)} KB · Ready to download</span></div><button onClick={() => downloadArtifact(artifact, token).catch((reason) => setError(reason.message))}><Download size={15} /> Download</button></div>}
          <section className="artifact-history"><h4>Recent generated files</h4>{artifacts.slice(0, 8).map((item) => <article key={item.id}><FileText size={17} /><div><strong>{item.filename}</strong><span>{item.operation.replaceAll("_", " ")} · {new Date(item.created_at).toLocaleString()}</span></div><button onClick={() => downloadArtifact(item, token).catch((reason) => setError(reason.message))}><Download size={14} /></button></article>)}</section>
        </main>
      </div>
    </section>
  </div>;
}

// Kept temporarily for compatibility with older workspace snapshots while the full settings panel is loaded above.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AccountPanel({ user, token, stats, onUser, onClose, onSignOut }: {
  user: AuthResult["user"]; token: string; stats: Stats | null; onUser: (user: AuthResult["user"]) => void; onClose: () => void; onSignOut: () => void;
}) {
  const [tab, setTab] = useState<"profile" | "admin">("profile");
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preferences, setPreferences] = useState<UserPreferences>(storedPreferences);
  const onUserRef = useRef(onUser);
  useEffect(() => { onUserRef.current = onUser; }, [onUser]);
  useEffect(() => {
    api<AuthResult["user"]>("/auth/me", token).then((updated) => onUserRef.current(updated)).catch((reason) => setError(reason.message));
    api<UserPreferences>("/profile/preferences", token).then((value) => { setPreferences(value); applyPreferences(value); }).catch((reason) => setError(reason.message));
  }, [token]);
  useEffect(() => {
    if (tab === "admin" && user.role === "admin") api<AdminUser[]>("/admin/users", token).then(setAdmins).catch((reason) => setError(reason.message));
  }, [tab, token, user.role]);
  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const updated = await api<AuthResult["user"]>("/profile", token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ display_name: form.get("display_name") }) });
      onUser(updated); setMessage("Profile updated.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Update failed"); }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/profile/password", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_password: form.get("current_password"), new_password: form.get("new_password") }) });
      setMessage("Password changed. Existing refresh sessions were revoked."); event.currentTarget.reset();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Password change failed"); }
  }
  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    try {
      const updated = await api<UserPreferences>("/profile/preferences", token, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preferences),
      });
      setPreferences(updated); applyPreferences(updated); setMessage("Workspace preferences saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Preferences update failed"); }
  }
  async function toggleAccount(item: AdminUser) {
    const updated = await api<AuthResult["user"]>(`/admin/users/${item.id}/status`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !item.is_active }) });
    setAdmins((current) => current.map((value) => value.id === item.id ? { ...value, is_active: updated.is_active } : value));
  }
  return <div className="account-wrap"><button className="history-backdrop" aria-label="Close profile" onClick={onClose} /><section className="account-panel">
    <header><div><p className="eyebrow">Account workspace</p><h2>{user.display_name}</h2></div><button aria-label="Close account settings" onClick={onClose}><X size={18} /></button></header>
    {user.role === "admin" && <nav><button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}><UserRound size={15} /> Profile</button><button className={tab === "admin" ? "active" : ""} onClick={() => setTab("admin")}><ShieldCheck size={15} /> Admin</button></nav>}
    <main>{error && <div className="form-error">{error}</div>}{message && <div className="success-note">{message}</div>}
      {tab === "profile" ? <><div className="account-stats">{stats && <><article><strong>{stats.document_count}</strong><span>Documents</span></article><article><strong>{stats.page_count}</strong><span>Pages</span></article><article><strong>{(stats.storage_bytes / 1024 / 1024).toFixed(1)} MB</strong><span>Storage</span></article><article><strong>{stats.ai_requests}</strong><span>AI requests</span></article><article><strong>{stats.generated_files}</strong><span>Generated</span></article><article className={stats.failed_jobs ? "warn" : ""}><strong>{stats.failed_jobs}</strong><span>Failed jobs</span></article></>}</div>
        <section className={`account-identity-status ${user.google_linked ? "linked" : "unlinked"}`}><span>{user.google_linked ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}</span><div><strong>Google account</strong><small>{user.google_linked ? `Linked to ${user.email}` : "Not linked"}</small></div><b>{user.google_linked ? "Linked" : "Not linked"}</b></section>
        <div className="profile-forms"><form onSubmit={updateProfile}><h3>Profile</h3><label>Email<input value={user.email} disabled /></label><label>Display name<input name="display_name" defaultValue={user.display_name} minLength={2} required /></label><button>Save profile</button></form>
          <form onSubmit={changePassword}><h3>Change password</h3><label>Current password<input name="current_password" type="password" required /></label><label>New password<input name="new_password" type="password" minLength={8} required /></label><button>Update password</button></form>
          <form onSubmit={savePreferences}><h3>Workspace preferences</h3><label className="preference-check"><input type="checkbox" checked={preferences.compact_sidebar} onChange={(event) => setPreferences((value) => ({ ...value, compact_sidebar: event.target.checked }))} /> Compact sidebar by default</label><label className="preference-check"><input type="checkbox" checked={preferences.reduced_motion} onChange={(event) => setPreferences((value) => ({ ...value, reduced_motion: event.target.checked }))} /> Reduce interface motion</label><label>Default export<select value={preferences.default_export_format} onChange={(event) => setPreferences((value) => ({ ...value, default_export_format: event.target.value as UserPreferences["default_export_format"] }))}><option value="pdf">PDF</option><option value="docx">Word</option><option value="markdown">Markdown</option></select></label><button>Save preferences</button></form></div></>
        : <div className="admin-users"><h3>User management</h3>{admins.map((item) => <article key={item.id}><div><strong>{item.display_name}</strong><span>{item.email} · {item.role}</span></div><small>{item.document_count} docs · {item.ai_requests} AI</small><button className={item.is_active ? "" : "enable"} onClick={() => toggleAccount(item)}>{item.is_active ? "Disable" : "Enable"}</button></article>)}</div>}
    </main><footer className="account-footer"><button onClick={onSignOut}><LogOut size={15} /> Sign out of InsightPDF</button></footer></section></div>;
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
  return <div className="jobs-wrap"><button className="history-backdrop" aria-label="Close processing jobs" onClick={onClose} /><section className="jobs-panel" role="dialog" aria-label="Processing jobs">
    <header><div><p className="eyebrow">Background activity</p><h2>Processing jobs</h2></div><button aria-label="Close processing jobs" onClick={onClose}><X size={18} /></button></header>
    <main>{error && <div className="form-error">{error}</div>}{items.map((job) => <article key={job.id}><div><strong>{(job.operation ?? "document processing").replaceAll("_", " ")}</strong><span>{job.created_at ? new Date(job.created_at).toLocaleString() : ""} · {job.progress}%</span></div><b className={`job-state ${job.status}`}>{job.status}</b>{["queued", "running"].includes(job.status) && <button onClick={() => cancel(job)}>Cancel</button>}{job.status === "failed" && job.operation !== "document_processing" && <button onClick={() => retry(job)}>Retry</button>}{job.error_message && <small>{job.error_message}</small>}</article>)}{!items.length && !error && <div className="empty-workspace"><RefreshCw size={30} /><h3>No processing jobs yet</h3></div>}</main>
  </section></div>;
}

// Legacy safe-workflow planner retained for a future dedicated automation screen.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CopilotWorkspace({ documents, token, onClose }: { documents: DocumentItem[]; token: string; onClose: () => void }) {
  const [documentId, setDocumentId] = useState(documents[0]?.id ?? "");
  const [command, setCommand] = useState("");
  const [plan, setPlan] = useState<WorkflowPlan | null>(null);
  const [approved, setApproved] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function propose(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setPlan(null); setArtifact(null); setApproved(false);
    try {
      setPlan(await api<WorkflowPlan>("/workflows/plan", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, document_id: documentId }),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create a safe plan");
    } finally { setBusy(false); }
  }

  async function execute() {
    if (!plan) return;
    setBusy(true); setError("");
    try {
      const queued = await api<Job>("/workflows/execute", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: plan.command, document_id: plan.document_id, approved }),
      });
      const completed = await waitForJob(queued, token);
      setArtifact(await api<Artifact>(`/pdf-tools/artifacts/${completed.result_id}`, token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Workflow execution failed");
    } finally { setBusy(false); }
  }

  return <div className="copilot-shell">
    <button className="history-backdrop" aria-label="Close document copilot" onClick={onClose} />
    <section className="copilot-panel" role="dialog" aria-modal="true" aria-label="Document copilot">
      <header>
        <div><p className="eyebrow">InsightPDF 2</p><h2>Document copilot</h2><span>Describe the outcome. Review every step before anything runs.</span></div>
        <button aria-label="Close document copilot" onClick={onClose}><X size={18} /></button>
      </header>
      <form onSubmit={propose}>
        <label>Work on<select value={documentId} onChange={(event) => setDocumentId(event.target.value)} required>
          {documents.map((document) => <option key={document.id} value={document.id}>{document.filename}</option>)}
        </select></label>
        <label>What do you want to do?<textarea value={command} onChange={(event) => setCommand(event.target.value)} minLength={3} required placeholder="Rotate pages 2-3, add page numbers, then compress the PDF strongly" /></label>
        <div className="copilot-examples"><button type="button" onClick={() => setCommand("Compress the PDF with balanced quality")}>Compress</button><button type="button" onClick={() => setCommand("Add page numbers at the bottom")}>Number pages</button><button type="button" onClick={() => setCommand("Summarize the key points")}>Summarize</button></div>
        {error && <div className="form-error">{error}</div>}
        <button className="copilot-primary" disabled={busy}>{busy ? "Inspecting request…" : "Create safe plan"}<ListChecks size={16} /></button>
      </form>
      {plan && <section className="plan-preview">
        <div className="plan-heading"><div><span>PROPOSED PLAN</span><strong>{plan.steps.length} step{plan.steps.length === 1 ? "" : "s"}</strong></div><b>{plan.estimated_ai_calls ? `${plan.estimated_ai_calls} AI call` : "No AI cost"}</b></div>
        <ol>{plan.steps.map((step) => <li key={step.id}>
          <i>{step.id.replace("step-", "")}</i><div><strong>{step.title}</strong><span>{Object.entries(step.parameters).filter(([key]) => key !== "document_id").map(([key, value]) => `${key.replaceAll("_", " ")}: ${Array.isArray(value) ? value.join(", ") || "all" : String(value)}`).join(" · ") || "Default settings"}</span><small><ShieldCheck size={12} /> Verify: {step.verification.replaceAll("_", " ")}{step.confirmation_required ? " · Confirmation required" : ""}</small></div><b className={`risk-${step.risk}`}>{step.risk}</b>
        </li>)}</ol>
        {plan.confirmation_required && <label className="approval-check"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span>I reviewed and approve the destructive steps above.</span></label>}
        <button className="execute-plan" disabled={busy || (plan.confirmation_required && !approved)} onClick={execute}>{busy ? <><RefreshCw size={15} className="spin" /> Running workflow…</> : <><Check size={15} /> Approve and run</>}</button>
        <p>InsightPDF validates ownership and parameters again, executes each step in order, and verifies the PDF after every change.</p>
      </section>}
      {artifact && <section className="workflow-result"><Check size={24} /><div><strong>Workflow verified</strong><span>{artifact.filename} · {(artifact.size_bytes / 1024).toFixed(1)} KB</span></div><button onClick={() => downloadArtifact(artifact, token).catch((reason) => setError(reason.message))}><Download size={15} /> Download</button></section>}
    </section>
  </div>;
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
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [workspaceArtifacts, setWorkspaceArtifacts] = useState<Artifact[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<DocumentItem | null>(null);
  const [artifactViewer, setArtifactViewer] = useState<Artifact | null>(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerSearch, setViewerSearch] = useState("");
  const [chatDocuments, setChatDocuments] = useState<DocumentItem[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [multiChatOpen, setMultiChatOpen] = useState(false);
  const [aiDocument, setAIDocument] = useState<DocumentItem | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [pdfToolsOpen, setPDFToolsOpen] = useState(false);
  const [pdfToolsDocument, setPDFToolsDocument] = useState<DocumentItem | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationUnread, setNotificationUnread] = useState(0);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [draggingUpload, setDraggingUpload] = useState(false);
  const [hubView, setHubView] = useState<"overview" | "research" | "documents" | "deliverables">("overview");
  const [workspaceSection, setWorkspaceSection] = useState<"deliverables" | "search" | "activity">("deliverables");
  const [nativeDocumentCount, setNativeDocumentCount] = useState(0);
  const [startGuidedDemo, setStartGuidedDemo] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => storedPreferences().compact_sidebar);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "pdfs" | "converted" | "images">("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "name" | "size" | "type">("newest");
  const [selectedFileKeys, setSelectedFileKeys] = useState<string[]>([]);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ kind: "document"; item: DocumentItem } | { kind: "artifact"; item: Artifact } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [openActionMenu, setOpenActionMenu] = useState("");
  const [preparingArtifactId, setPreparingArtifactId] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const workspaceSearchRef = useRef<HTMLInputElement>(null);
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
      setSidebarCollapsed(preferences.compact_sidebar);
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
      setWorkspaceLoaded(false);
      setWorkspaceArtifacts([]);
      setCollections([]);
      setConversations([]);
      setViewer(null);
      setArtifactViewer(null);
      setRenameTarget(null);
      setChatDocuments([]);
      setHistoryOpen(false);
      setAIDocument(null);
      setCompareOpen(false);
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
    await Promise.all(items.filter((item) => !["ready", "failed"].includes(item.status)).map(async (item) => {
      try {
        const job = await api<Job>(`/documents/${item.id}/job`, accessToken);
        setJobs((current) => ({ ...current, [item.id]: job }));
      } catch { /* job may not exist for legacy documents */ }
    }));
  }, []);

  const loadStats = useCallback(async (accessToken: string) => {
    setStats(await api<Stats>("/profile/stats", accessToken));
  }, []);

  const loadWorkspaceArtifacts = useCallback(async (accessToken: string) => {
    setWorkspaceArtifacts(await api<Artifact[]>("/pdf-tools/artifacts", accessToken));
  }, []);

  const loadCollections = useCallback(async (accessToken: string) => {
    setCollections(await api<Collection[]>("/collections", accessToken));
  }, []);

  const loadNativeDocumentCount = useCallback(async (accessToken: string) => {
    const workspaces = await api<Workspace[]>("/workspaces", accessToken);
    if (!workspaces[0]) { setNativeDocumentCount(0); return; }
    const items = await api<NativeDocument[]>(`/workspaces/${workspaces[0].id}/native-documents`, accessToken);
    setNativeDocumentCount(items.length);
  }, []);

  const loadConversations = useCallback(async (): Promise<Conversation[]> => {
    if (!token) return [];
    setHistoryBusy(true);
    try {
      const items = await api<Conversation[]>("/conversations", token);
      setConversations(items);
      return items;
    }
    finally { setHistoryBusy(false); }
  }, [token]);

  function openDocumentChat(document: DocumentItem) {
    setActiveConversation(null);
    setChatDocuments([document]);
    setHubView("research");
  }

  useEffect(() => {
    if (!initialAuth) return;
    const timer = window.setTimeout(() => {
      Promise.all([
        loadDocuments(initialAuth.access_token), loadStats(initialAuth.access_token),
        loadWorkspaceArtifacts(initialAuth.access_token), loadCollections(initialAuth.access_token),
        loadNativeDocumentCount(initialAuth.access_token),
        api<Conversation[]>("/conversations", initialAuth.access_token).then(setConversations),
      ]).catch(() => undefined).finally(() => setWorkspaceLoaded(true));
      if (pendingUpload) {
        onPendingUploadHandled();
        upload(pendingUpload, initialAuth.access_token);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  // Initial authentication is immutable for this mounted workspace.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAuth, loadCollections, loadDocuments, loadNativeDocumentCount, loadStats, loadWorkspaceArtifacts]);

  useEffect(() => {
    if (!token || !documents.some((item) => !["ready", "failed"].includes(item.status))) return;
    const timer = window.setInterval(() => loadDocuments(token).catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, [token, documents, loadDocuments]);

  useEffect(() => {
    function keyboardShortcuts(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable=true]");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandPaletteOpen((value) => !value); return; }
      if (event.key === "Escape") {
        setViewer(null); setArtifactViewer(null); setHistoryOpen(false);
        setAIDocument(null); setCompareOpen(false); setPDFToolsOpen(false); setOpenActionMenu(""); setCommandPaletteOpen(false);
        return;
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "/") { event.preventDefault(); workspaceSearchRef.current?.focus(); }
      if (event.key.toLowerCase() === "u") { event.preventDefault(); uploadInputRef.current?.click(); }
    }
    window.addEventListener("keydown", keyboardShortcuts);
    return () => window.removeEventListener("keydown", keyboardShortcuts);
  }, []);

  const workspaceCommands: WorkspaceCommand[] = user ? [
    { id: "overview", label: "Open workspace overview", detail: "Return to the source-to-deliverable workflow", icon: <LayoutDashboard size={16} />, run: () => setHubView("overview") },
    { id: "sources", label: "Open source library", detail: "Browse uploads, metadata, and processing state", icon: <FileText size={16} />, run: () => setHubView("documents") },
    { id: "research", label: "Research sources", detail: "Ask grounded questions with page citations", icon: <Search size={16} />, run: () => setHubView("research") },
    { id: "deliverables", label: "Open deliverables", detail: "Draft, review, version, and export documents", icon: <FileOutput size={16} />, run: () => { setWorkspaceSection("deliverables"); setHubView("deliverables"); } },
    { id: "workspace-search", label: "Search the workspace", detail: "Find source content and native documents", icon: <ScanText size={16} />, shortcut: "/", run: () => { setWorkspaceSection("search"); setHubView("deliverables"); } },
    { id: "upload", label: "Upload a source", detail: "Add PDF, Word, or supported image evidence", icon: <Upload size={16} />, shortcut: "U", run: () => uploadInputRef.current?.click() },
    { id: "pdf-tools", label: "Open PDF tools", detail: "Merge, split, rotate, convert, or watermark", icon: <Scissors size={16} />, run: () => setPDFToolsOpen(true) },
    { id: "jobs", label: "View processing jobs", detail: "Inspect progress, retry failures, or cancel work", icon: <Activity size={16} />, run: () => setJobsOpen(true) },
    { id: "settings", label: "Open account settings", detail: "Profile, security, preferences, and usage", icon: <Settings size={16} />, run: () => setAccountOpen(true) },
  ] : [];

  async function completeAuthentication(result: AuthResult) {
    localStorage.setItem("insightpdf-auth", JSON.stringify(result));
    setToken(result.access_token);
    setUser(result.user);
    await Promise.all([
      loadDocuments(result.access_token), loadStats(result.access_token), loadWorkspaceArtifacts(result.access_token),
      loadCollections(result.access_token), loadNativeDocumentCount(result.access_token), api<Conversation[]>("/conversations", result.access_token).then(setConversations),
    ]);
    setWorkspaceLoaded(true);
    if (pendingUpload) {
      const file = pendingUpload;
      onPendingUploadHandled();
      await upload(file, result.access_token);
    }
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

  async function upload(file?: File, accessToken = token) {
    if (!file || !accessToken) return;
    const extension = file.name.toLowerCase().split(".").pop();
    if ((file.type && !DOCUMENT_UPLOAD_TYPES.has(file.type)) || !["pdf", "docx", "pptx", "md", "markdown", "txt", "rtf", "png", "jpg", "jpeg", "webp"].includes(extension ?? "")) {
      setError("Upload a PDF, DOCX, PPTX, Markdown, text, RTF, PNG, JPEG, or WebP file.");
      return;
    }
    setBusy(true); setError("");
    const data = new FormData(); data.append("file", file);
    try {
      await api("/documents", accessToken, { method: "POST", body: data });
      await Promise.all([loadDocuments(accessToken), loadStats(accessToken)]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed"); }
    finally { setBusy(false); }
  }

  async function createCollection(event: FormEvent) {
    event.preventDefault();
    const name = newCollectionName.trim();
    if (!name) return;
    try {
      const created = await api<Collection>("/collections", token, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: "#3154d8" }),
      });
      setCollections((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCollectionFilter(created.id);
      setNewCollectionName("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create collection"); }
  }

  async function renameCollection(collection: Collection) {
    const name = window.prompt("Rename collection", collection.name)?.trim();
    if (!name || name === collection.name) return;
    try {
      const updated = await api<Collection>(`/collections/${collection.id}`, token, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: collection.color }),
      });
      setCollections((current) => current
        .map((item) => item.id === updated.id ? updated : item)
        .sort((a, b) => a.name.localeCompare(b.name)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not rename collection"); }
  }

  async function removeCollection(collection: Collection) {
    if (!window.confirm(`Delete the collection "${collection.name}"? Files will be kept and moved to Unfiled.`)) return;
    try {
      await api(`/collections/${collection.id}`, token, { method: "DELETE" });
      setCollections((current) => current.filter((item) => item.id !== collection.id));
      setDocuments((current) => current.map((item) =>
        item.collection_id === collection.id ? { ...item, collection_id: null } : item
      ));
      setWorkspaceArtifacts((current) => current.map((item) =>
        item.collection_id === collection.id ? { ...item, collection_id: null } : item
      ));
      if (collectionFilter === collection.id) setCollectionFilter("all");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete collection"); }
  }

  async function assignDocumentCollection(document: DocumentItem, collectionId: string | null) {
    try {
      const updated = await api<DocumentItem>(`/documents/${document.id}/metadata`, token, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_title: document.display_title, tags: document.tags, collection_id: collectionId }),
      });
      setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not move document"); }
  }

  async function assignArtifactCollection(artifact: Artifact, collectionId: string | null) {
    try {
      await api(`/pdf-tools/artifacts/${artifact.id}/collection`, token, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_title: null, tags: [], collection_id: collectionId }),
      });
      setWorkspaceArtifacts((current) => current.map((item) =>
        item.id === artifact.id ? { ...item, collection_id: collectionId } : item
      ));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not move generated file"); }
  }

  function signOut() {
    localStorage.removeItem("insightpdf-auth");
    setToken(""); setUser(null); setDocuments([]); setWorkspaceArtifacts([]); setCollections([]); setConversations([]); setArtifactViewer(null); setRenameTarget(null); setNotificationsOpen(false); setNotificationUnread(0);
    onExit();
  }

  function renameDocument(document: DocumentItem) {
    setRenameTarget({ kind: "document", item: document });
    setRenameValue(document.filename);
  }

  async function removeDocument(document: DocumentItem) {
    if (!window.confirm(`Delete ${document.filename}? This removes its chats and indexed content.`)) return;
    try {
      await api(`/documents/${document.id}`, token, { method: "DELETE" });
      setSelectedFileKeys((current) => current.filter((key) => key !== `document:${document.id}`));
      await Promise.all([loadDocuments(token), loadStats(token)]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Delete failed"); }
  }

  async function retryDocument(document: DocumentItem) {
    try {
      await api(`/documents/${document.id}/retry`, token, { method: "POST" });
      await loadDocuments(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Retry failed"); }
  }

  function renameWorkspaceArtifact(artifact: Artifact) {
    setRenameTarget({ kind: "artifact", item: artifact });
    setRenameValue(artifact.filename);
  }

  async function saveWorkspaceRename(event: FormEvent) {
    event.preventDefault();
    const filename = renameValue.trim();
    if (!renameTarget || !filename) return;
    if (filename === renameTarget.item.filename) {
      setRenameTarget(null);
      return;
    }
    setRenameBusy(true); setError("");
    try {
      if (renameTarget.kind === "document") {
        const updated = await api<DocumentItem>(`/documents/${renameTarget.item.id}`, token, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename }),
        });
        setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item));
      } else {
        const updated = await api<Artifact>(`/pdf-tools/artifacts/${renameTarget.item.id}`, token, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename }),
        });
        setWorkspaceArtifacts((current) => current.map((item) => item.id === updated.id ? updated : item));
      }
      setRenameTarget(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Rename failed"); }
    finally { setRenameBusy(false); }
  }

  async function removeWorkspaceArtifact(artifact: Artifact) {
    if (!window.confirm(`Delete ${artifact.filename}?`)) return;
    try {
      await api(`/pdf-tools/artifacts/${artifact.id}`, token, { method: "DELETE" });
      setSelectedFileKeys((current) => current.filter((key) => key !== `artifact:${artifact.id}`));
      setWorkspaceArtifacts((current) => current.filter((item) => item.id !== artifact.id));
      if (artifact.linked_document_id) {
        setDocuments((current) => current.filter((item) => item.id !== artifact.linked_document_id));
      }
      if (artifactViewer?.id === artifact.id) setArtifactViewer(null);
      await loadStats(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Delete failed"); }
  }

  async function duplicateWorkspaceArtifact(artifact: Artifact) {
    try {
      const duplicate = await api<Artifact>(`/pdf-tools/artifacts/${artifact.id}/duplicate`, token, { method: "POST" });
      setWorkspaceArtifacts((current) => [duplicate, ...current]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not duplicate file");
    }
  }

  async function ensureArtifactDocument(artifact: Artifact): Promise<DocumentItem> {
    setPreparingArtifactId(artifact.id);
    setError("");
    try {
      let document = await api<DocumentItem>(`/pdf-tools/artifacts/${artifact.id}/index`, token, { method: "POST" });
      setWorkspaceArtifacts((current) => current.map((item) =>
        item.id === artifact.id ? { ...item, linked_document_id: document.id } : item
      ));
      if (document.status === "failed") {
        await api(`/documents/${document.id}/retry`, token, { method: "POST" });
        document = await api<DocumentItem>(`/documents/${document.id}`, token);
      }
      const deadline = Date.now() + 180_000;
      while (!["ready", "failed"].includes(document.status)) {
        if (Date.now() >= deadline) throw new Error("Indexing is still running. Try again from this file in a moment.");
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        document = await api<DocumentItem>(`/documents/${document.id}`, token);
      }
      if (document.status === "failed") throw new Error(document.error_message ?? "This file could not be prepared for AI.");
      setDocuments((current) => [document, ...current.filter((item) => item.id !== document.id)]);
      return document;
    } finally {
      setPreparingArtifactId("");
    }
  }

  async function openArtifactPDFTools(artifact: Artifact) {
    try {
      const document = await ensureArtifactDocument(artifact);
      setPDFToolsDocument(document);
      setPDFToolsOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare this file for PDF tools");
    }
  }

  async function openArtifactAI(artifact: Artifact, feature: "workspace" | "chat") {
    try {
      const document = await ensureArtifactDocument(artifact);
      if (feature === "workspace") setAIDocument(document);
      else await openDocumentChat(document);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare this file for AI");
    }
  }

  async function downloadSelectedWorkspaceFiles() {
    const selectedDocuments = documents.filter((document) => selectedFileKeys.includes(`document:${document.id}`));
    const selectedArtifacts = workspaceArtifacts.filter((artifact) => selectedFileKeys.includes(`artifact:${artifact.id}`));
    const selectedCount = selectedDocuments.length + selectedArtifacts.length;
    if (!selectedCount) return;
    setArchiveBusy(true); setError("");
    try {
      if (selectedCount === 1) {
        if (selectedDocuments[0]) await downloadDocumentFile(selectedDocuments[0], token);
        else await downloadArtifact(selectedArtifacts[0], token);
      } else {
        await downloadDocumentArchive(selectedDocuments, token, selectedArtifacts);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare the ZIP download");
    } finally {
      setArchiveBusy(false);
    }
  }

  const isImageArtifact = (artifact: Artifact) =>
    artifact.content_type.startsWith("image/") || artifact.operation === "pdf_to_images";
  const artifactDocumentIds = new Set(workspaceArtifacts.flatMap((artifact) => artifact.linked_document_id ? [artifact.linked_document_id] : []));
  const sourceFileCount = documents.filter((document) => !artifactDocumentIds.has(document.id)).length;
  const createdFileCount = workspaceArtifacts.filter((item) => !isImageArtifact(item)).length;
  const imageFileCount = workspaceArtifacts.filter(isImageArtifact).length;
  const workspaceFileCount = sourceFileCount + workspaceArtifacts.length;
  const visibleDocuments = documents.filter((document) =>
    !artifactDocumentIds.has(document.id) &&
    [document.filename, document.display_title ?? "", ...document.tags].join(" ").toLowerCase().includes(query.toLowerCase()) &&
    (collectionFilter === "all" ? true : collectionFilter === "none" ? !document.collection_id : document.collection_id === collectionFilter) &&
    (statusFilter === "all" ? true : statusFilter === "processing"
      ? !["ready", "failed"].includes(document.status)
      : document.status === statusFilter)
  );
  const visibleArtifacts = workspaceArtifacts.filter((artifact) =>
    artifact.filename.toLowerCase().includes(query.toLowerCase()) &&
    (collectionFilter === "all" ? true : collectionFilter === "none" ? !artifact.collection_id : artifact.collection_id === collectionFilter)
  );
  const workspaceItems = [
    ...(typeFilter === "converted" || typeFilter === "images" ? [] : visibleDocuments.map((item) => ({ kind: "pdf" as const, item }))),
    ...(typeFilter === "pdfs" ? [] : visibleArtifacts
      .filter((item) =>
        typeFilter === "images" ? isImageArtifact(item)
          : typeFilter === "converted" ? !isImageArtifact(item)
            : true
      )
      .map((item) => ({ kind: "artifact" as const, item }))),
  ].sort((left, right) => {
    if (sortOrder === "name") return left.item.filename.localeCompare(right.item.filename);
    if (sortOrder === "size") return right.item.size_bytes - left.item.size_bytes;
    if (sortOrder === "type") {
      const leftType = left.kind === "pdf" ? "pdf" : left.item.content_type;
      const rightType = right.kind === "pdf" ? "pdf" : right.item.content_type;
      return leftType.localeCompare(rightType);
    }
    return new Date(right.item.created_at).getTime() - new Date(left.item.created_at).getTime();
  });
  const visibleFileKeys = workspaceItems.map((entry) => `${entry.kind === "pdf" ? "document" : "artifact"}:${entry.item.id}`);
  const recentActivity = [
    ...documents.map((item) => ({ id: `document-${item.id}`, icon: "document", title: item.display_title || item.filename, detail: item.status === "ready" ? "Document ready" : item.status.replaceAll("_", " "), date: item.created_at })),
    ...workspaceArtifacts.map((item) => ({ id: `artifact-${item.id}`, icon: "artifact", title: item.filename, detail: item.operation.replaceAll("_", " "), date: item.created_at })),
    ...conversations.map((item) => ({ id: `chat-${item.id}`, icon: "chat", title: item.title, detail: `${item.messages.length} chat messages`, date: item.updated_at })),
  ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()).slice(0, 6);

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

  return (
    <main className={`workspace-page hub-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} data-hub-view={hubView === "research" ? "home" : hubView === "deliverables" ? "presentations" : hubView}>
      <aside className="hub-sidebar">
        <div className="hub-brand">
          <BrandMark className="hub-brand-mark" />
          <strong>Insight<span>PDF</span><small className="hub-beta">Beta</small></strong>
          <button aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setSidebarCollapsed((current) => !current)}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
        </div>
        <nav aria-label="Workspace navigation">
          <button className="hub-new-chat" onClick={() => uploadInputRef.current?.click()}><Upload size={18} /><span>Add source</span></button>
          <span className="hub-nav-label">Brief workspace</span>
          <button className={hubView === "overview" ? "active" : ""} onClick={() => setHubView("overview")}><LayoutDashboard size={18} /><span>Overview</span></button>
          <button className={hubView === "documents" ? "active" : ""} onClick={() => { setTypeFilter("pdfs"); setHubView("documents"); }}><FolderOpen size={18} /><span>Sources</span><i>{sourceFileCount}</i></button>
          <button className={hubView === "research" ? "active" : ""} disabled={!readyDocuments.length} onClick={() => setHubView("research")}><Search size={18} /><span>Research</span></button>
          <button className={hubView === "deliverables" && workspaceSection === "deliverables" ? "active" : ""} onClick={() => { setWorkspaceSection("deliverables"); setHubView("deliverables"); }}><FileOutput size={18} /><span>Deliverables</span><i>{createdFileCount + nativeDocumentCount}</i></button>
          <span className="hub-nav-label">Workspace</span>
          <button onClick={() => setJobsOpen(true)}><Activity size={18} /><span>Processing</span></button>
          <button className={hubView === "deliverables" && workspaceSection === "activity" ? "active" : ""} onClick={() => { setWorkspaceSection("activity"); setHubView("deliverables"); }}><Activity size={18} /><span>Activity</span></button>
          <button onClick={() => { setHistoryOpen(true); loadConversations().catch(() => undefined); }}><History size={18} /><span>Research history</span></button>
          <button onClick={() => { setAccountOpen(true); loadStats(token).catch(() => undefined); }}><Settings size={18} /><span>Settings</span></button>
        </nav>
        <div className="hub-sidebar-footer">
          <button onClick={() => { setAccountOpen(true); loadStats(token).catch(() => undefined); }}><UserRound size={17} /><span className="hub-user"><strong>{user.display_name}</strong><small>{user.email}</small></span><Settings size={14} /></button>
          <button onClick={signOut}><LogOut size={17} /><span>Sign out</span></button>
        </div>
      </aside>
      <header className="hub-topbar">
        <div><strong>{hubView === "overview" ? "Research brief workspace" : hubView === "research" ? (activeConversation?.title ?? "Research sources") : hubView === "deliverables" ? (workspaceSection === "search" ? "Workspace search" : workspaceSection === "activity" ? "Activity timeline" : "Deliverables") : "Source library"}</strong><small>{hubView === "overview" ? "Collect evidence, synthesize findings, and ship a reviewed deliverable" : hubView === "research" ? "Answers stay grounded in the sources you select" : hubView === "deliverables" ? "Create, review, version, and export your final work" : `${sourceFileCount} source files · ${readyDocuments.length} ready`}</small></div>
        <button className="hub-global-search" title="Open command palette" aria-label="Open command palette" onClick={() => setCommandPaletteOpen(true)}><Search size={16} /><span>Search or jump anywhere</span><kbd>⌘K</kbd></button>
        <button className="hub-processing-button" onClick={() => setJobsOpen(true)} aria-label="Processing jobs" title="Processing jobs"><RefreshCw size={16} /></button>
        <button className="hub-notification-button" onClick={() => setNotificationsOpen(true)} aria-label={`Notifications${notificationUnread ? `, ${notificationUnread} unread` : ""}`} title="Notifications"><Bell size={17} />{notificationUnread > 0 && <b>{notificationUnread > 99 ? "99+" : notificationUnread}</b>}</button>
        <button className="hub-mobile-account" onClick={() => { setAccountOpen(true); loadStats(token).catch(() => undefined); }} aria-label="Account settings"><UserRound size={16} /><span>{user.display_name}</span></button>
        <label className={`hub-upload ${busy ? "disabled" : ""}`}><Upload size={16} /> Upload<input ref={uploadInputRef} type="file" accept={DOCUMENT_UPLOAD_ACCEPT} disabled={busy} onChange={(event) => upload(event.target.files?.[0])} /></label>
      </header>
      <section className="workspace-content hub-content">
        {hubView === "overview" ? <div className="workflow-overview">
          {workspaceLoaded && !busy && !documents.length && !workspaceArtifacts.length && !nativeDocumentCount && <section className="first-run-welcome">
            <div><span><Sparkles size={14} /> First time here?</span><h1>Turn sources into a report that is ready to send.</h1><p>InsightPDF extracts the brief, drafts from your evidence, checks every requirement and claim, then unlocks export.</p><div><button onClick={() => { setWorkspaceSection("deliverables"); setHubView("deliverables"); }}>Create your first verified report <ArrowRight size={15} /></button><button className="secondary" onClick={() => { setStartGuidedDemo(true); setWorkspaceSection("deliverables"); setHubView("deliverables"); }}><PlayCircle size={15} /> Try a finished demo</button></div></div><ol><li><b>1</b> Add a brief and evidence</li><li><b>2</b> Draft with guided AI actions</li><li><b>3</b> Verify, fix, and export</li></ol>
          </section>}
          <header className="workflow-hero">
            <div className="workflow-hero-copy">
              <span className="workflow-ai-label"><Sparkles size={14} /> AI research workspace</span>
              <h1>From source files to a finished point of view.</h1>
              <p>Collect the evidence, ask grounded questions, shape a clear argument, and deliver work you can trace back to the source.</p>
              <div className="workflow-hero-actions">
                <button onClick={() => uploadInputRef.current?.click()}><Upload size={16} /> Add source material</button>
                <button className="secondary" disabled={!readyDocuments.length} onClick={() => setHubView("research")}><Sparkles size={16} /> Start researching</button>
              </div>
            </div>
            <aside className="workflow-pulse" aria-label="Workspace pulse">
              <header><span>Workspace pulse</span><b><i /> Live</b></header>
              <div><strong>{readyDocuments.length}</strong><span>Ready sources</span></div>
              <div><strong>{workspaceArtifacts.length + nativeDocumentCount}</strong><span>Deliverables</span></div>
              <footer>{readyDocuments.length ? "Your evidence is ready for research." : "Add a source to begin the workflow."}</footer>
            </aside>
          </header>
          <div className="workflow-stages" aria-label="Document workflow">
            <button className="complete" onClick={() => { setTypeFilter("pdfs"); setHubView("documents"); }}><span><Check size={14} /></span><small>01 · Collect</small><strong>{sourceFileCount ? `${sourceFileCount} sources added` : "Add your first source"}</strong><p>Original evidence and reference files</p></button>
            <button className={readyDocuments.length ? "current" : ""} disabled={!readyDocuments.length} onClick={() => setHubView("research")}><span>{readyDocuments.length ? <Search size={14} /> : <Clock3 size={14} />}</span><small>02 · Understand</small><strong>{readyDocuments.length ? "Research your sources" : "Waiting for a ready source"}</strong><p>Grounded answers with page citations</p></button>
            <button className={workspaceArtifacts.length + nativeDocumentCount ? "complete" : ""} onClick={() => { setWorkspaceSection("deliverables"); setHubView("deliverables"); }}><span><Pencil size={14} /></span><small>03 · Create</small><strong>{workspaceArtifacts.length + nativeDocumentCount ? `${workspaceArtifacts.length + nativeDocumentCount} deliverables` : "Create a first draft"}</strong><p>Editable briefs, reports, and presentations</p></button>
            <button onClick={() => { setWorkspaceSection("deliverables"); setHubView("deliverables"); }}><span><Download size={14} /></span><small>04 · Review & ship</small><strong>Review versions and export</strong><p>Restore, comment, approve, or continue editing</p></button>
          </div>
          <div className="workflow-grid">
            <section className="workflow-panel"><header><div><strong>Source readiness</strong><span>Processing is visible and recoverable</span></div><button onClick={() => { setTypeFilter("pdfs"); setHubView("documents"); }}>Open library</button></header>
              <div className="source-readiness">{documents.slice(0, 4).map((item) => <button key={item.id} onClick={() => { setViewerPage(1); setViewerSearch(""); setViewer(item); }}><FileText size={17} /><span><strong>{item.display_title || item.filename}</strong><small>{item.status === "ready" ? `${item.page_count ?? "—"} pages · Searchable` : item.status === "failed" ? (item.error_message || "Processing failed") : `Processing · ${jobs[item.id]?.progress ?? 0}%`}</small></span><i className={item.status}>{item.status === "ready" ? <Check size={12} /> : item.status === "failed" ? <AlertTriangle size={12} /> : <RefreshCw className="spin" size={12} />}</i></button>)}</div>
              {!documents.length && <div className="workflow-empty"><Upload size={25} /><strong>No source material yet</strong><p>Add a PDF, Word file, presentation, note, or image. Scanned pages use OCR automatically.</p><button onClick={() => uploadInputRef.current?.click()}>Choose a file</button></div>}
            </section>
            <section className="workflow-panel next-action"><header><div><strong>Recommended next step</strong><span>Based on workspace state</span></div></header>
              {!readyDocuments.length ? <><span className="next-icon"><Upload size={20} /></span><h2>Add a research source</h2><p>Upload evidence to begin. You can leave this screen while ingestion continues.</p><button onClick={() => uploadInputRef.current?.click()}>Upload source</button></> : !(workspaceArtifacts.length + nativeDocumentCount) ? <><span className="next-icon"><Search size={20} /></span><h2>Find the key evidence</h2><p>Ask across selected sources, inspect page citations, then turn the findings into a draft.</p><button onClick={() => setHubView("research")}>Research {readyDocuments.length} ready source{readyDocuments.length === 1 ? "" : "s"}</button></> : <><span className="next-icon"><Eye size={20} /></span><h2>Review your latest deliverable</h2><p>Open the output, inspect its version history, and export when it is ready.</p><button onClick={() => { setWorkspaceSection("deliverables"); setHubView("deliverables"); }}>Review deliverables</button></>}
            </section>
          </div>
          {!!recentActivity.length && <section className="workflow-activity"><header><strong>Recent workspace activity</strong><button onClick={() => setJobsOpen(true)}>View processing</button></header><div>{recentActivity.slice(0, 4).map((item) => <article key={item.id}>{item.icon === "artifact" ? <FileOutput size={15} /> : item.icon === "chat" ? <Search size={15} /> : <FileText size={15} />}<span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{new Date(item.date).toLocaleDateString()}</time></article>)}</div></section>}
        </div> : hubView === "research" ? <div className="hub-home">
          <HomeChat
            key={`${activeConversation?.id ?? "new"}:${chatDocuments.map((item) => item.id).join(",")}`}
            token={token}
            documents={readyDocuments}
            conversation={activeConversation}
            initialDocumentIds={activeConversation?.document_ids ?? chatDocuments.map((item) => item.id)}
            onChanged={() => loadConversations().catch(() => undefined)}
            onHistory={() => { setHistoryOpen(true); loadConversations().catch(() => undefined); }}
            onPreview={(document) => { setViewerPage(1); setViewerSearch(""); setViewer(document); }}
            onCitation={(citation) => {
              const cited = documents.find((item) => item.id === citation.document_id);
              if (cited) { setViewerPage(citation.page_number); setViewerSearch(citation.snippet); setViewer(cited); }
            }}
            onNewChat={() => { setActiveConversation(null); setChatDocuments([]); }}
            onArtifactCreated={(artifact) => { setWorkspaceArtifacts((current) => [artifact, ...current.filter((item) => item.id !== artifact.id)]); loadStats(token).catch(() => undefined); }}
            onUploadFile={async (file) => {
              await upload(file);
            }}
          />
          <section className="hub-conversation">
            <div className="hub-ai-brand"><span className="hub-brand-mark"><FileText size={20} /></span><strong>Insight<span>PDF</span> <i>AI</i></strong></div>
            <h1>What can I help you understand?</h1>
            <button className="hub-prompt" disabled={!readyDocuments.length} onClick={() => readyDocuments[0] && openDocumentChat(readyDocuments[0])}>
              <span>{readyDocuments.length ? "Ask anything about your documents…" : "Upload a document to start asking questions"}</span>
              <i><Send size={17} /></i>
            </button>
            <div className="hub-prompt-hints"><span>Try:</span><button disabled={!readyDocuments.length} onClick={() => readyDocuments[0] && setAIDocument(readyDocuments[0])}>Summarize latest</button><button disabled={readyDocuments.length < 2} onClick={() => setCompareOpen(true)}>Compare files</button><button disabled={!readyDocuments.length} onClick={() => readyDocuments[0] && openDocumentChat(readyDocuments[0])}>Find across documents</button></div>
          </section>
          <section className="hub-quick-tools">
            <header><div><strong>Quick tools</strong><span>Open a specialized workflow</span></div></header>
            <div>
              <button disabled={!readyDocuments.length} onClick={() => readyDocuments[0] && openDocumentChat(readyDocuments[0])}><span><MessageCircle size={19} /></span><strong>Ask documents</strong><small>Attach files in the main chat</small></button>
              <button disabled={!readyDocuments.length} onClick={() => readyDocuments[0] && setAIDocument(readyDocuments[0])}><span><AlignLeft size={19} /></span><strong>Summarize</strong><small>Turn long files into key points</small></button>
              <button disabled={readyDocuments.length < 2} onClick={() => setCompareOpen(true)}><span><RefreshCw size={19} /></span><strong>Compare</strong><small>Find changes and differences</small></button>
              <button onClick={() => { setWorkspaceSection("deliverables"); setHubView("deliverables"); }}><span><Sparkles size={19} /></span><strong>Create a deliverable</strong><small>Write a brief or generate a formatted file</small></button>
            </div>
          </section>
          <div className="hub-home-grid">
            <section className="hub-recent">
              <header><div><strong>Recent</strong><span>Your latest work</span></div><button onClick={() => setHubView("documents")}>View all</button></header>
              <div>{recentActivity.slice(0, 5).map((item) => <article key={item.id}>{item.icon === "chat" ? <MessageCircle size={16} /> : item.icon === "artifact" ? <FileOutput size={16} /> : <FileText size={16} />}<span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{new Date(item.date).toLocaleDateString()}</time></article>)}</div>
            </section>
            <section className="hub-overview">
              <header><strong>Workspace</strong><span>At a glance</span></header>
              <div><article><strong>{documents.length + workspaceArtifacts.length}</strong><span>Files</span></article><article><strong>{stats?.page_count ?? 0}</strong><span>Pages</span></article><article><strong>{stats?.ai_requests ?? 0}</strong><span>AI requests</span></article></div>
              <button onClick={() => { setTypeFilter("all"); setHubView("documents"); }}><FolderOpen size={15} /> Open files</button>
            </section>
          </div>
        </div> : hubView === "deliverables" ? <NativeWorkspace token={token} sources={documents} section={workspaceSection} onSection={setWorkspaceSection} onCount={setNativeDocumentCount} onSourcesChanged={() => loadDocuments(token)} onUploadSource={() => uploadInputRef.current?.click()} autoDemo={startGuidedDemo} onDemoHandled={() => setStartGuidedDemo(false)} onOpenSource={(document, page = 1, snippet = "") => { setViewerPage(page); setViewerSearch(snippet); setViewer(document); }} studio={(openGenerated) => <DocumentStudio documents={readyDocuments} artifacts={workspaceArtifacts} token={token} conversation={activeConversation} onOpenGenerated={openGenerated} onCreated={(artifact) => { setWorkspaceArtifacts((current) => [artifact, ...current.filter((item) => item.id !== artifact.id)]); loadStats(token).catch(() => undefined); }} />} /> : <header className="documents-heading"><div><span>SOURCE LIBRARY</span><h1>Your evidence, organized.</h1><p>Keep originals, processing state, metadata, and previews together before research begins.</p></div><aside><strong>{sourceFileCount}</strong><small>source files</small></aside></header>}
        <div className="workspace-title">
          <div><p className="eyebrow">AI-first document workspace</p><h1>What do you want to understand?</h1><p>Upload a PDF or image, ask grounded questions, compare versions, or transform it into something useful.</p></div>
          <div className="workspace-actions">
            <button className="copilot-launch" disabled={!documents.some((item) => item.status === "ready")} onClick={() => readyDocuments[0] && openDocumentChat(readyDocuments[0])}><Quote size={16} /> Ask documents</button>
            <button disabled={!documents.some((item) => item.status === "ready")} onClick={() => { setPDFToolsDocument(null); setPDFToolsOpen(true); }}><Scissors size={16} /> PDF tools</button>
            <button disabled={documents.filter((item) => item.status === "ready").length < 2} onClick={() => setCompareOpen(true)}><RefreshCw size={16} /> Compare PDFs</button>
            <button disabled={documents.filter((item) => item.status === "ready").length < 2} onClick={() => setMultiChatOpen(true)}><GitCompareArrows size={16} /> Ask multiple PDFs</button>
            <label className={`real-upload ${busy ? "disabled" : ""}`}><Upload size={17} /> Upload file<input type="file" accept={DOCUMENT_UPLOAD_ACCEPT} disabled={busy} onChange={(event) => upload(event.target.files?.[0])} /></label>
          </div>
        </div>
        <button className={`ai-upload-dropzone ${draggingUpload ? "dragging" : ""}`} type="button" onClick={() => uploadInputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDraggingUpload(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDraggingUpload(false)} onDrop={(event) => {
          event.preventDefault(); setDraggingUpload(false); upload(event.dataTransfer.files[0]);
        }}>
          {busy ? <RefreshCw className="spin" size={25} /> : <Upload size={25} />}
          <span><strong>{busy ? "Uploading and preparing your document…" : "Drop source material here to begin"}</strong><small>PDF, DOCX, PPTX, Markdown, text, RTF, or an image · U opens the file picker</small></span>
          <FileOutput size={19} />
        </button>
        {error && <div className="form-error">{error}</div>}
        <div className="dashboard-cards">{stats && <><article><LayoutDashboard size={17} /><div><strong>{documents.length + workspaceArtifacts.length}</strong><span>All files</span></div></article><article><FileText size={17} /><div><strong>{stats.page_count}</strong><span>Pages indexed</span></div></article><article><Quote size={17} /><div><strong>{stats.ai_requests}</strong><span>Document requests</span></div></article><article><Download size={17} /><div><strong>{stats.generated_files}</strong><span>Generated files</span></div></article></>}</div>
        {!!recentActivity.length && <section className="recent-activity"><header><Activity size={16} /><div><strong>Recent activity</strong><span>Your latest documents, results, and conversations</span></div></header><div>{recentActivity.map((item) => <article key={item.id}>{item.icon === "chat" ? <MessageCircle size={15} /> : item.icon === "artifact" ? <FileOutput size={15} /> : <FileText size={15} />}<span><strong>{item.title}</strong><small>{item.detail} · {new Date(item.date).toLocaleDateString()}</small></span></article>)}</div></section>}
        <div className="collection-bar">
          <FolderOpen size={16} />
          <button className={collectionFilter === "all" ? "active" : ""} onClick={() => setCollectionFilter("all")}>All files</button>
          <button className={collectionFilter === "none" ? "active" : ""} onClick={() => setCollectionFilter("none")}>Unfiled</button>
          {collections.map((collection) => <div className={`collection-chip ${collectionFilter === collection.id ? "active" : ""}`} key={collection.id}>
            <button className="collection-filter-button" onClick={() => setCollectionFilter(collection.id)}><i style={{ background: collection.color }} />{collection.name}</button>
            {collectionFilter === collection.id && <span className="collection-chip-actions">
              <button aria-label={`Rename collection ${collection.name}`} title="Rename collection" onClick={() => renameCollection(collection)}><Pencil size={12} /></button>
              <button className="danger" aria-label={`Delete collection ${collection.name}`} title="Delete collection" onClick={() => removeCollection(collection)}><Trash2 size={12} /></button>
            </span>}
          </div>)}
          <form onSubmit={createCollection}><FolderPlus size={14} /><input aria-label="New collection name" value={newCollectionName} onChange={(event) => setNewCollectionName(event.target.value)} placeholder="New collection" /><button disabled={!newCollectionName.trim()}>Add</button></form>
        </div>
        <div className="document-type-tabs" role="tablist" aria-label="Document types">
          <button role="tab" aria-selected={typeFilter === "all"} className={typeFilter === "all" ? "active" : ""} onClick={() => setTypeFilter("all")}>All <span>{workspaceFileCount}</span></button>
          <button role="tab" aria-selected={typeFilter === "pdfs"} className={typeFilter === "pdfs" ? "active" : ""} onClick={() => setTypeFilter("pdfs")}>Source files <span>{sourceFileCount}</span></button>
          <button role="tab" aria-selected={typeFilter === "converted"} className={typeFilter === "converted" ? "active" : ""} onClick={() => setTypeFilter("converted")}>Created files <span>{createdFileCount}</span></button>
          <button role="tab" aria-selected={typeFilter === "images"} className={typeFilter === "images" ? "active" : ""} onClick={() => setTypeFilter("images")}>Images <span>{imageFileCount}</span></button>
        </div>
        <div className="document-filters">
          <label><Search size={15} /><input ref={workspaceSearchRef} aria-label="Search documents" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles, filenames, and tags · /" /></label>
          {(typeFilter === "all" || typeFilter === "pdfs") && <select aria-label="PDF processing status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All PDF statuses</option><option value="ready">Ready</option><option value="processing">Processing</option><option value="failed">Failed</option></select>}
          <select aria-label="Sort documents" value={sortOrder} onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}><option value="newest">Newest first</option><option value="name">Name</option><option value="size">File size</option><option value="type">File type</option></select>
        </div>
        {workspaceItems.length > 0 && <div className="workspace-bulk-actions">
          <label><input type="checkbox" checked={visibleFileKeys.every((key) => selectedFileKeys.includes(key))} onChange={(event) => {
            setSelectedFileKeys((current) => event.target.checked
              ? [...new Set([...current, ...visibleFileKeys])]
              : current.filter((key) => !visibleFileKeys.includes(key)));
          }} /><span>{selectedFileKeys.length ? "Select all shown" : `${workspaceItems.length} item${workspaceItems.length === 1 ? "" : "s"}`}</span></label>
          {selectedFileKeys.length > 0 && <>
            <strong>{selectedFileKeys.length > 25 ? `${selectedFileKeys.length} selected · choose 25 or fewer` : `${selectedFileKeys.length} selected`}</strong>
            <button className="selection-clear" title="Clear selection" aria-label="Clear selection" onClick={() => setSelectedFileKeys([])}><X size={15} /></button>
            <button className="selection-download" disabled={selectedFileKeys.length > 25 || archiveBusy} onClick={downloadSelectedWorkspaceFiles}>
              {archiveBusy ? <RefreshCw size={14} className="spin" /> : <Download size={14} />}
              {archiveBusy ? (selectedFileKeys.length === 1 ? "Downloading…" : "Preparing ZIP…") : "Download"}
            </button>
          </>}
        </div>}
        <div className="document-grid">
          {workspaceItems.map((entry) => {
            if (entry.kind === "artifact") {
              const artifact = entry.item;
              return <article className={`document-card generated-document-card ${openActionMenu === `artifact:${artifact.id}` ? "menu-open" : ""}`} key={`artifact-${artifact.id}`}>
                <label className="workspace-document-select" title={`Select ${artifact.filename}`}><input type="checkbox" checked={selectedFileKeys.includes(`artifact:${artifact.id}`)} onChange={(event) => setSelectedFileKeys((current) => event.target.checked ? [...current, `artifact:${artifact.id}`] : current.filter((key) => key !== `artifact:${artifact.id}`))} /></label>
                <ArtifactCardPreview artifact={artifact} token={token} onOpen={() => setArtifactViewer(artifact)} />
                <div className="document-info">
                  <strong>{artifact.filename}</strong>
                  <span>{(artifact.size_bytes / 1024 / 1024).toFixed(1)} MB · {artifact.filename.split(".").pop()?.toUpperCase() ?? "FILE"} · {new Date(artifact.created_at).toLocaleDateString()}</span>
                  <div className="phase-status ready">
                    {preparingArtifactId === artifact.id ? <RefreshCw size={13} className="spin" /> : <Check size={13} />}
                    {preparingArtifactId === artifact.id ? "Preparing for tools…" : artifact.operation.replaceAll("_", " ")}
                  </div>
                </div>
                <div className="document-actions">
                  <button className="more-actions-button" aria-label={`More actions for ${artifact.filename}`} title="More actions" onClick={() => setOpenActionMenu((current) => current === `artifact:${artifact.id}` ? "" : `artifact:${artifact.id}`)}><MoreVertical size={17} /></button>
                  {openActionMenu === `artifact:${artifact.id}` && <><button className="action-menu-backdrop" aria-label="Close actions menu" onClick={() => setOpenActionMenu("")} /><nav className="file-action-menu" aria-label={`Actions for ${artifact.filename}`}>
                    <button onClick={() => { setArtifactViewer(artifact); setOpenActionMenu(""); }}><Eye size={14} /> Preview</button>
                  <button onClick={() => { renameWorkspaceArtifact(artifact); setOpenActionMenu(""); }}><Pencil size={14} /> Rename</button>
                  <button onClick={() => { duplicateWorkspaceArtifact(artifact); setOpenActionMenu(""); }}><FileOutput size={14} /> Duplicate</button>
                    <button onClick={() => { downloadArtifact(artifact, token).catch((reason) => setError(reason.message)); setOpenActionMenu(""); }}><Download size={14} /> Download</button>
                    <button disabled={preparingArtifactId === artifact.id} onClick={() => { openArtifactPDFTools(artifact); setOpenActionMenu(""); }}><Scissors size={14} /> {preparingArtifactId === artifact.id ? "Preparing…" : "PDF tools"}</button>
                    <button disabled={preparingArtifactId === artifact.id} onClick={() => { openArtifactAI(artifact, "chat"); setOpenActionMenu(""); }}><MessageCircle size={14} /> Open in AI</button>
                    <label className="action-menu-select"><FolderOpen size={14} /><span>Move to</span><select aria-label={`Move ${artifact.filename} to collection`} value={artifact.collection_id ?? ""} onChange={(event) => { assignArtifactCollection(artifact, event.target.value || null); setOpenActionMenu(""); }}><option value="">Unfiled</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label>
                    <button className="danger" onClick={() => { removeWorkspaceArtifact(artifact); setOpenActionMenu(""); }}><Trash2 size={14} /> Delete</button>
                  </nav></>}
                </div>
              </article>;
            }
            const document = entry.item;
            const job = jobs[document.id];
            const ready = document.status === "ready";
            return <article className={`document-card ${openActionMenu === `document:${document.id}` ? "menu-open" : ""}`} key={document.id}>
              <label className="workspace-document-select" title={`Select ${document.filename}`}><input type="checkbox" checked={selectedFileKeys.includes(`document:${document.id}`)} onChange={(event) => setSelectedFileKeys((current) => event.target.checked ? [...current, `document:${document.id}`] : current.filter((key) => key !== `document:${document.id}`))} /></label>
              <DocumentCardPreview document={document} token={token} onOpen={() => { setViewerPage(1); setViewerSearch(""); setViewer(document); }} />
              <div className="document-info">
                <strong>{document.display_title || document.filename}</strong>
                {document.display_title && <small className="document-original-name">{document.filename}</small>}
                <span>{(document.size_bytes / 1024 / 1024).toFixed(1)} MB · {(document.original_filename || document.filename).split(".").pop()?.toUpperCase()} source · {new Date(document.created_at).toLocaleDateString()}</span>
                {!!document.tags.length && <div className="document-tags">{document.tags.map((tag) => <i key={tag}>{tag}</i>)}</div>}
                <div className={`phase-status ${ready ? "ready" : document.status === "failed" ? "failed" : ""}`}>
                  {ready ? <Check size={13} /> : <RefreshCw size={13} className="spin" />}
                  {ready ? `Uploaded · Ready · ${document.page_count ?? "—"} ${document.page_count === 1 ? "page" : "pages"}` : document.status.replaceAll("_", " ")}
                </div>
                {!ready && document.status !== "failed" && <div className="job-progress"><i style={{ width: `${job?.progress ?? 0}%` }} /></div>}
                {(document.error_message || job?.error_message) && <small className="document-error">{document.error_message || job?.error_message}</small>}
              </div>
              <div className="document-actions">
                <button className="more-actions-button" aria-label={`More actions for ${document.filename}`} title="More actions" onClick={() => setOpenActionMenu((current) => current === `document:${document.id}` ? "" : `document:${document.id}`)}><MoreVertical size={17} /></button>
                {openActionMenu === `document:${document.id}` && <><button className="action-menu-backdrop" aria-label="Close actions menu" onClick={() => setOpenActionMenu("")} /><nav className="file-action-menu" aria-label={`Actions for ${document.filename}`}>
                  <button disabled={!ready} onClick={() => { setViewerPage(1); setViewerSearch(""); setViewer(document); setOpenActionMenu(""); }}><Eye size={14} /> Preview</button>
                  <button onClick={() => { renameDocument(document); setOpenActionMenu(""); }}><Pencil size={14} /> Rename</button>
                  <button onClick={() => { downloadOriginalSource(document, token).catch((reason) => setError(reason.message)); setOpenActionMenu(""); }}><Download size={14} /> Download original</button>
                  {document.status === "failed" && <button onClick={() => { retryDocument(document); setOpenActionMenu(""); }}><RefreshCw size={14} /> Retry processing</button>}
                  <label className="action-menu-select"><FolderOpen size={14} /><span>Move to</span><select aria-label={`Move ${document.filename} to collection`} value={document.collection_id ?? ""} onChange={(event) => { assignDocumentCollection(document, event.target.value || null); setOpenActionMenu(""); }}><option value="">Unfiled</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label>
                  <button className="danger" onClick={() => { removeDocument(document); setOpenActionMenu(""); }}><Trash2 size={14} /> Delete</button>
                </nav></>}
              </div>
            </article>;
          })}
          {!workspaceItems.length && <div className="empty-workspace">{typeFilter === "images" ? <FileImage size={34} /> : <Upload size={34} />}<h2>No documents found</h2><p>{query ? "Try another search or filter." : typeFilter === "images" ? "Uploaded images are converted into searchable documents; image conversion outputs also appear here." : "Upload a source file to start building your evidence library."}</p></div>}
        </div>
      </section>
      {viewer && <PdfViewer key={`${viewer.id}-${viewerPage}-${viewerSearch}`} document={viewer} token={token} initialPage={viewerPage} initialSearch={viewerSearch} onClose={() => setViewer(null)} />}
      {artifactViewer && <ArtifactViewer key={artifactViewer.id} artifact={artifactViewer} token={token} onClose={() => setArtifactViewer(null)} />}
      {renameTarget && <div className="rename-dialog-wrap">
        <button className="history-backdrop" aria-label="Cancel rename" onClick={() => setRenameTarget(null)} />
        <form className="rename-dialog" role="dialog" aria-modal="true" aria-label="Rename file" onSubmit={saveWorkspaceRename}>
          <header><div><p className="eyebrow">File details</p><h2>Rename file</h2></div><button type="button" aria-label="Cancel rename" onClick={() => setRenameTarget(null)}><X size={17} /></button></header>
          <label>Filename<input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={180} required /></label>
          <div><button type="button" onClick={() => setRenameTarget(null)}>Cancel</button><button type="submit" disabled={renameBusy || !renameValue.trim()}>{renameBusy ? <RefreshCw size={14} className="spin" /> : <Pencil size={14} />} {renameBusy ? "Saving…" : "Save name"}</button></div>
        </form>
      </div>}
      {historyOpen && <ConversationHistory conversations={conversations} documents={documents} busy={historyBusy} onRefresh={async () => { await loadConversations(); }} onClose={() => setHistoryOpen(false)} onOpen={(conversation) => {
        const attached = documents.filter((item) => conversation.document_ids.includes(item.id));
        setHistoryOpen(false); setViewer(null); setActiveConversation(conversation); setChatDocuments(attached); setHubView("research");
      }} />}
      {multiChatOpen && <MultiDocumentChat documents={documents.filter((item) => item.status === "ready")} onClose={() => setMultiChatOpen(false)} onSelected={(selected) => {
        setMultiChatOpen(false); setActiveConversation(null); setChatDocuments(selected); setHubView("research");
      }} />}
      {aiDocument && <AIWorkspace document={aiDocument} documents={documents.filter((item) => item.status === "ready")} token={token} compareMode={false} onClose={() => setAIDocument(null)} onPage={(documentId, page) => {
        const selected = documents.find((item) => item.id === documentId);
        if (selected) { setViewerPage(page); setViewerSearch(""); setViewer(selected); }
      }} />}
      {compareOpen && <AIWorkspace document={null} documents={documents.filter((item) => item.status === "ready")} token={token} compareMode onClose={() => setCompareOpen(false)} onPage={(documentId, page) => {
        const selected = documents.find((item) => item.id === documentId);
        if (selected) { setViewerPage(page); setViewerSearch(""); setViewer(selected); }
      }} />}
      {pdfToolsOpen && <PDFToolsWorkspace documents={documents.filter((item) => item.status === "ready")} token={token} initialDocument={pdfToolsDocument} onClose={() => {
        setPDFToolsOpen(false);
        loadWorkspaceArtifacts(token).catch(() => undefined);
        loadStats(token).catch(() => undefined);
      }} />}
      {accountOpen && <AccountSettingsPanel user={user} token={token} stats={stats} onUser={(updated) => {
        setUser(updated);
        const saved = JSON.parse(localStorage.getItem("insightpdf-auth") ?? "{}");
        localStorage.setItem("insightpdf-auth", JSON.stringify({ ...saved, user: updated }));
      }} onClose={() => setAccountOpen(false)} onSignOut={signOut} />}
      {notificationsOpen && <NotificationCenter token={token} onClose={() => setNotificationsOpen(false)} onUnread={setNotificationUnread} onNavigate={(action) => {
        if (action === "processing") setJobsOpen(true);
        else if (action === "deliverables") { setWorkspaceSection("deliverables"); setHubView("deliverables"); }
        else if (action === "sources" || action === "documents") { setTypeFilter("pdfs"); setHubView("documents"); }
        setNotificationsOpen(false);
      }} />}
      {jobsOpen && <ProcessingJobs token={token} onClose={() => setJobsOpen(false)} />}
      {commandPaletteOpen && <CommandPalette commands={workspaceCommands} onClose={() => setCommandPaletteOpen(false)} />}
    </main>
  );
}

