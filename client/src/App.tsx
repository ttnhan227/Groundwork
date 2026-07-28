import { Activity, BrainCircuit, Check, Download, ExternalLink, Eye, FileImage, FileText, FolderOpen, FolderPlus, History, Keyboard, Languages, LayoutDashboard, ListChecks, LogOut, MessageCircle, MoreVertical, PanelLeftClose, PanelLeftOpen, Pencil, RefreshCw, Scissors, Search, Send, Settings, ShieldCheck, Sparkles, Tag, Trash2, Upload, UserRound, X, ZoomIn, ZoomOut } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const PDF_WORKER_URL = `${pdfWorkerUrl}?worker=v2`;

const API = import.meta.env.VITE_API_URL ?? "/api/v1";
const DEMO_ENABLED = (import.meta.env.VITE_DEMO_ENABLED ?? "true").toLowerCase() !== "false";
const REGISTRATION_ENABLED = (import.meta.env.VITE_REGISTRATION_ENABLED ?? "true").toLowerCase() !== "false";

type DocumentItem = {
  id: string;
  filename: string;
  size_bytes: number;
  status: string;
  page_count: number | null;
  error_message: string | null;
  display_title: string | null;
  tags: string[];
  collection_id: string | null;
  created_at: string;
};

type Job = {
  id?: string;
  status: string;
  progress: number;
  error_message: string | null;
  result_kind?: string | null;
  result_id?: string | null;
  operation?: string;
  retry_count?: number;
  created_at?: string;
};
type AuthResult = { access_token: string; refresh_token: string; user: { id: string; display_name: string; email: string; role: "user" | "admin"; is_active: boolean } };
type Citation = { document_id: string; document_name: string; page_number: number; snippet: string };
type ChatMessage = { id?: string; role: "user" | "assistant"; content: string; citations?: Citation[]; created_at?: string };
type Conversation = {
  id: string;
  title: string;
  document_ids: string[];
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
};
type AIResult = {
  id: string;
  feature: string;
  document_ids: string[];
  parameters: Record<string, unknown>;
  result: Record<string, unknown>;
  cached: boolean;
  created_at: string;
};
type Artifact = { id: string; operation: string; filename: string; content_type: string; size_bytes: number; parameters: Record<string, unknown>; linked_document_id: string | null; collection_id: string | null; created_at: string };
type Collection = { id: string; name: string; color: string; created_at: string };
type WorkflowPlan = {
  id: string;
  status: string;
  command: string;
  document_id: string;
  confirmation_required: boolean;
  estimated_ai_calls: number;
  steps: Array<{ id: string; tool: string; title: string; parameters: Record<string, unknown>; risk: string; confirmation_required: boolean; verification: string }>;
};
type Stats = { document_count: number; page_count: number; storage_bytes: number; ai_requests: number; generated_files: number; failed_jobs: number };
type AdminUser = AuthResult["user"] & Stats & { created_at: string };
const authSchema = z.object({
  display_name: z.string().trim().max(120).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
type AuthFields = z.infer<typeof authSchema>;

const AUTH_EXPIRED_EVENT = "insightpdf-auth-expired";

function expireSession() {
  localStorage.removeItem("insightpdf-auth");
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

async function api<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
  });
  if (!response.ok) {
    if (response.status === 401 && token) expireSession();
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? body?.error?.message ?? "Request failed");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function downloadTextFile(filename: string, content: string, contentType = "text/markdown") {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function waitForJob(job: Job, token: string): Promise<Job> {
  if (!job.id) throw new Error("The server did not return a job ID");
  const deadline = Date.now() + 180_000;
  let current = job;
  while (!["completed", "failed"].includes(current.status)) {
    if (Date.now() >= deadline) throw new Error("The operation is still running. Check Processing jobs shortly.");
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    current = await api<Job>(`/jobs/status/${job.id}`, token);
  }
  if (current.status === "failed") throw new Error(current.error_message ?? "Background operation failed");
  if (!current.result_id) throw new Error("The job completed without a result");
  return current;
}

async function queueOperation(
  operation: string,
  parameters: Record<string, unknown>,
  token: string,
): Promise<Job> {
  const job = await api<Job>("/jobs", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, parameters }),
  });
  return waitForJob(job, token);
}

function InlineText({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <span key={index}>{part}</span>,
  )}</>;
}

function FormattedAnswer({ content }: { content: string }) {
  const clean = content.replace(/\s*\[Source\s+\d+\]/gi, "").trim();
  return <div className="formatted-answer">{clean.split("\n").map((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return <div className="answer-space" key={index} />;
    if (line.startsWith("### ")) return <h4 key={index}><InlineText text={line.slice(4)} /></h4>;
    if (line.startsWith("## ")) return <h3 key={index}><InlineText text={line.slice(3)} /></h3>;
    if (line.startsWith("# ")) return <h3 key={index}><InlineText text={line.slice(2)} /></h3>;
    if (/^[-*]\s/.test(line)) return <div className="answer-bullet" key={index}><i /><span><InlineText text={line.slice(2)} /></span></div>;
    if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.*)$/);
      return <div className="answer-number" key={index}><b>{match?.[1]}</b><span><InlineText text={match?.[2] ?? line} /></span></div>;
    }
    return <p key={index}><InlineText text={line} /></p>;
  })}</div>;
}

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
      const response = await fetch(`${API}/ai/results/${value.id}/download`, { headers: { Authorization: `Bearer ${localStorage.getItem("insightpdf-auth") ? (JSON.parse(localStorage.getItem("insightpdf-auth")!).access_token) : ""}` } });
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
      <header><div><p className="eyebrow">Document intelligence</p><h2>{tool === "compare" ? "Compare PDFs" : document?.filename}</h2></div><button onClick={onClose}><X size={18} /></button></header>
      <div className="ai-tool-tabs">
        {!compareMode && <><button className={tool === "summary" ? "active" : ""} onClick={() => { setTool("summary"); setResult(null); }}><Sparkles size={15} /> Summarize</button>
          <button className={tool === "quiz" ? "active" : ""} onClick={() => { setTool("quiz"); setResult(null); }}><ListChecks size={15} /> Quiz</button>
          <button className={tool === "extract" ? "active" : ""} onClick={() => { setTool("extract"); setResult(null); }}><BrainCircuit size={15} /> Extract</button>
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
          <button className="run-ai-tool" disabled={busy || (tool === "compare" && (!left || !right))} onClick={run}>{busy ? <RefreshCw className="spin" size={15} /> : <Sparkles size={15} />}{busy ? "Working…" : tool === "compare" ? "Compare documents" : "Generate"}</button>
        </div>
        {error && <div className="form-error">{error}</div>}
        {!result && !busy && <div className="ai-result-empty"><BrainCircuit size={38} /><strong>Ready when you are</strong><span>Choose your options and generate a grounded result from the indexed document text.</span></div>}
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
    fetch(`${API}/documents/${document.id}/thumbnail`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (response) => {
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
    fetch(`${API}/documents/${document.id}/thumbnail`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (response) => {
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
    fetch(`${API}/pdf-tools/artifacts/${artifact.id}/thumbnail`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (response) => {
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

function ArtifactViewer({ artifact, document, token, initialPage = 1, initialSearch = "", onHistory, onClose }: {
  artifact?: Artifact;
  document?: DocumentItem;
  token: string;
  initialPage?: number;
  initialSearch?: string;
  onHistory?: () => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState("");
  const [textPreview, setTextPreview] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [documentSearch, setDocumentSearch] = useState(initialSearch);
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
    fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => {
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

  return <div className="artifact-viewer-wrap">
    <button className="history-backdrop" aria-label="Close file preview" onClick={onClose} />
    <section className="artifact-viewer" role="dialog" aria-modal="true" aria-label={`Preview ${filename}`}>
      <header>
        <div><strong>{filename}</strong><small>{description} · {(sizeBytes / 1024 / 1024).toFixed(1)} MB</small></div>
        {isPdf && <form className="artifact-viewer-search" onSubmit={searchOpenPDF}><Search size={14} /><input aria-label="Search within document" value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} placeholder="Search this document" /><button type="submit">Find</button></form>}
        {onHistory && <button onClick={onHistory}><History size={15} /> History</button>}
        {source && <button onClick={() => window.open(source, "_blank", "noopener,noreferrer")}><ExternalLink size={15} /> Open in new tab</button>}
        {!isPdf && <button onClick={() => artifact ? downloadArtifact(artifact, token).catch(() => undefined) : document ? downloadDocumentFile(document, token).catch(() => undefined) : undefined}><Download size={15} /> Download</button>}
        <button aria-label="Close preview" onClick={onClose}><X size={18} /></button>
      </header>
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

function PdfViewer({ document, token, initialPage = 1, initialSearch = "", onHistory, onClose }: { document: DocumentItem; token: string; initialPage?: number; initialSearch?: string; onHistory: () => void; onClose: () => void }) {
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
        const response = await fetch(`${API}/documents/${document.id}/content`, {
          headers: { Authorization: `Bearer ${token}` },
        });
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
        {pdfSource && <button onClick={() => window.open(pdfSource, "_blank", "noopener,noreferrer")}><ExternalLink size={15} /> Open in new tab</button>}
        <button className="viewer-history" onClick={onHistory}><History size={17} /> Chat history</button>
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

function ChatPanel({
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
  const documentIdKey = documentIds.join(",");
  const starterPrompts = documentIds.length > 1
    ? ["What do these documents have in common?", "Summarize the key differences", "List important dates across all files"]
    : ["Summarize this document", "What are the key points?", "List important dates and action items"];
  const followUpPrompts = ["Explain that more simply", "What should I pay attention to?", "Turn this into an action checklist"];

  async function beginNewConversation() {
    setBusy(true);
    setError("");
    setMessages([]);
    setConversationId("");
    try {
      const result = await api<{ id: string }>("/conversations", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Chat about ${documentLabel}`, document_ids: documentIds }),
      });
      setConversationId(result.id);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start a new conversation");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!conversation) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConversationId(conversation.id);
    setMessages(conversation.messages);
    setError("");
  }, [conversation]);

  // documentIdKey tracks changes without depending on the caller's array identity.
  useEffect(() => {
    if (conversation) return;
    api<{ id: string }>("/conversations", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `Chat about ${documentLabel}`, document_ids: documentIds }),
    }).then((result) => { setConversationId(result.id); onChanged(); }).catch((reason) => setError(reason.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation, document.id, document.filename, documentIdKey, documentLabel, token]);

  async function askQuestion(question: string) {
    if (!conversationId || busy) return;
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
      const response = await fetch(`${API}/conversations/${conversationId}/messages/stream`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
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
    <header><span className="chat-brand"><FileText size={18} /></span><div><strong>Ask InsightPDF</strong><small>{documentLabel}</small></div><button title="Export conversation" aria-label="Export conversation" onClick={exportConversation}><Download size={16} /></button><button className="new-chat-button" title="Start new conversation" onClick={beginNewConversation}><MessageCircle size={15} /><span>New chat</span></button><button aria-label="Document chat history" title="Chat history" onClick={onHistory}><History size={17} /></button>{!embedded && <button aria-label="Close chat" onClick={onClose}><X size={18} /></button>}</header>
    <DocumentMiniPreview document={document} token={token} onOpen={onPreview} />
    <div className="chat-messages">
      {!messages.length && <div className="chat-empty"><MessageCircle size={30} /><strong>Ask about this PDF</strong><span>Answers are grounded in indexed pages and include source citations.</span><div className="suggested-prompts">{starterPrompts.map((prompt) => <button key={prompt} onClick={() => askQuestion(prompt)}>{prompt}</button>)}</div></div>}
      {messages.map((message, index) => <div className={`chat-message ${message.role}`} key={index}>
        {message.role === "assistant" ? <><div className="assistant-label"><Sparkles size={13} /> InsightPDF</div><FormattedAnswer content={message.content} /></> : <p>{message.content}</p>}
        {!!message.citations?.length && <div className="citation-list"><span className="citation-heading">Sources</span>{message.citations.map((citation, citationIndex) => <button key={citationIndex} onClick={() => onCitation(citation)}>
          <b>{citation.document_name}</b><em>Page {citation.page_number}</em><span>{citation.snippet}</span>
        </button>)}</div>}
      </div>)}
      {busy && <div className="chat-thinking"><RefreshCw className="spin" size={14} /> Searching indexed pages…</div>}
      {!busy && messages.at(-1)?.role === "assistant" && <div className="follow-up-prompts"><span>Continue with</span>{followUpPrompts.map((prompt) => <button key={prompt} onClick={() => askQuestion(prompt)}>{prompt}</button>)}</div>}
    </div>
    {error && <div className="chat-error">{error}</div>}
    <form onSubmit={(event) => { event.preventDefault(); askQuestion(draft); }}><div className="chat-input"><textarea name="question" aria-label="Question" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask a follow-up question…" rows={1} disabled={!conversationId || busy} onKeyDown={(event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
    }} /><small>Enter to send · Shift+Enter for a new line</small></div><button aria-label="Send" disabled={!conversationId || busy}><Send size={17} /></button></form>
  </aside>;
}

function IntegratedChatHub({
  documents, token, onChanged, onHistory, onPreview, onCitation,
}: {
  documents: DocumentItem[];
  token: string;
  onChanged: () => void;
  onHistory: () => void;
  onPreview: (document: DocumentItem) => void;
  onCitation: (citation: Citation) => void;
}) {
  const [selected, setSelected] = useState<string[]>(documents[0] ? [documents[0].id] : []);
  const [activeIds, setActiveIds] = useState<string[]>(documents[0] ? [documents[0].id] : []);
  const [filter, setFilter] = useState("");
  const chosen = documents.filter((document) => activeIds.includes(document.id));
  const visible = documents.filter((document) =>
    [document.display_title ?? "", document.filename, ...document.tags].join(" ").toLowerCase().includes(filter.toLowerCase())
  );

  useEffect(() => {
    if (!documents[0] || selected.length || activeIds.length) return;
    // Documents can arrive after authentication while this view is already mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected([documents[0].id]);
    setActiveIds([documents[0].id]);
  }, [activeIds.length, documents, selected.length]);

  return <section className="integrated-chat-hub">
    <aside className="chat-source-picker">
      <header><div><strong>Chat sources</strong><span>Select one or more documents</span></div><b>{selected.length}</b></header>
      <label><Search size={14} /><input aria-label="Search chat documents" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search files" /></label>
      <div>{visible.map((document) => <label key={document.id} className={selected.includes(document.id) ? "selected" : ""}>
        <input type="checkbox" checked={selected.includes(document.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, document.id] : current.filter((id) => id !== document.id))} />
        <FileText size={16} /><span><strong>{document.display_title || document.filename}</strong><small>{document.page_count ?? "—"} pages</small></span>
      </label>)}</div>
      <button disabled={!selected.length || selected.join(",") === activeIds.join(",")} onClick={() => setActiveIds(selected)}><MessageCircle size={15} /> Start chat with {selected.length || 0} {selected.length === 1 ? "file" : "files"}</button>
    </aside>
    <main>
      {chosen.length ? <ChatPanel
        key={activeIds.join(",")}
        embedded
        document={chosen[0]}
        documentIds={activeIds}
        documentLabel={chosen.length === 1 ? chosen[0].filename : `${chosen.length} selected documents`}
        token={token}
        conversation={null}
        onChanged={onChanged}
        onHistory={onHistory}
        onPreview={() => onPreview(chosen[0])}
        onCitation={onCitation}
        onClose={() => undefined}
      /> : <div className="integrated-chat-empty"><MessageCircle size={30} /><strong>Select a document to begin</strong><span>Your answers will be grounded only in the files you choose.</span></div>}
    </main>
  </section>;
}

function HomeChat({
  token, onChanged, onOpenDocuments,
}: {
  token: string;
  onChanged: () => void;
  onOpenDocuments: () => void;
}) {
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState(() => {
    const pendingPrompt = sessionStorage.getItem("insightpdf-pending-prompt") ?? "";
    sessionStorage.removeItem("insightpdf-pending-prompt");
    return pendingPrompt;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ensureConversation() {
    if (conversationId) return conversationId;
    const conversation = await api<Conversation>("/conversations", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "InsightPDF AI chat", document_ids: [] }),
    });
    setConversationId(conversation.id);
    onChanged();
    return conversation.id;
  }

  async function sendQuestion(value: string) {
    const question = value.trim();
    if (!question || busy) return;
    setDraft("");
    setMessages((current) => [...current, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setBusy(true);
    setError("");
    try {
      const id = await ensureConversation();
      const response = await fetch(`${API}/conversations/${id}/messages/stream`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
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
          const payload = JSON.parse(data) as { text?: string; answer?: string; message?: string };
          if (event === "token" && payload.text) {
            setMessages((current) => current.map((message, index) =>
              index === current.length - 1 ? { ...message, content: message.content + payload.text } : message
            ));
          } else if (event === "complete" && payload.answer) {
            setMessages((current) => current.map((message, index) =>
              index === current.length - 1 ? { ...message, content: payload.answer ?? message.content } : message
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

  function newChat() {
    setConversationId("");
    setMessages([]);
    setDraft("");
    setError("");
  }

  return <section className="home-chat">
    <header>
      <div className="hub-ai-brand"><span className="hub-brand-mark"><FileText size={20} /></span><strong>Insight<span>PDF</span> <i>AI</i></strong></div>
      {!!messages.length && <button onClick={newChat}><MessageCircle size={15} /> New chat</button>}
    </header>
    <div className="home-chat-messages">
      {!messages.length && <div className="home-chat-empty">
        <span className="home-chat-logo"><FileText size={27} /></span>
        <h1>What can I help you with?</h1>
        <p>Chat with InsightPDF AI, or switch to document chat when you need answers grounded in your files.</p>
        <button onClick={onOpenDocuments}><FolderOpen size={15} /> Chat with documents</button>
      </div>}
      {messages.map((message, index) => <article className={message.role} key={index}>
        {message.role === "assistant" && <span><Sparkles size={14} /></span>}
        <div>{message.role === "assistant" ? <FormattedAnswer content={message.content} /> : <p>{message.content}</p>}</div>
      </article>)}
      {busy && <div className="home-chat-thinking"><RefreshCw className="spin" size={14} /> InsightPDF is thinking…</div>}
    </div>
    {error && <div className="chat-error">{error}</div>}
    <form onSubmit={(event) => { event.preventDefault(); sendQuestion(draft); }}>
      <textarea aria-label="Message InsightPDF AI" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message InsightPDF AI…" rows={1} disabled={busy} onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
      }} />
      <button aria-label="Send message" disabled={busy || !draft.trim()}><Send size={18} /></button>
    </form>
    <small>General AI chat does not read your documents. Use Ask AI to chat with selected files.</small>
  </section>;
}

function ConversationHistory({
  conversations, documents, busy, documentFilter, onRefresh, onOpen, onClose,
}: {
  conversations: Conversation[];
  documents: DocumentItem[];
  busy: boolean;
  documentFilter?: DocumentItem | null;
  onRefresh: () => Promise<void>;
  onOpen: (conversation: Conversation, document: DocumentItem) => void;
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

  const visibleConversations = documentFilter
    ? conversations.filter((conversation) => conversation.document_ids.includes(documentFilter.id))
    : conversations;

  return <div className="history-wrap" role="dialog" aria-modal="true" aria-label="Conversation history">
    <button className="history-backdrop" aria-label="Close conversation history" onClick={onClose} />
    <section className="history-panel">
      <header><div><p className="eyebrow">{documentFilter ? "Document chats" : "Saved chats"}</p><h2>{documentFilter ? documentFilter.filename : "Conversations"}</h2></div><button aria-label="Close" onClick={onClose}><X size={19} /></button></header>
      {error && <div className="chat-error">{error}</div>}
      <div className="history-list">
        {busy && <div className="history-empty"><RefreshCw className="spin" size={18} /> Loading conversations…</div>}
        {!busy && !visibleConversations.length && <div className="history-empty"><History size={30} /><strong>No conversations yet</strong><span>{documentFilter ? "Choose Ask AI to start a chat about this PDF." : "Open a ready PDF and choose Ask AI."}</span></div>}
        {visibleConversations.map((conversation) => {
          const document = documents.find((item) => conversation.document_ids.includes(item.id));
          return <article className="history-item" key={conversation.id}>
            <div className="history-title">
              {editing === conversation.id
                ? <form onSubmit={(event) => { event.preventDefault(); rename(conversation, String(new FormData(event.currentTarget).get("title"))); }}>
                    <input name="title" defaultValue={conversation.title} autoFocus maxLength={160} />
                    <button>Save</button>
                  </form>
                : <><strong>{conversation.title}</strong><span>{conversation.messages.length} messages · {new Date(conversation.updated_at).toLocaleString()}</span></>}
            </div>
            <div className="history-actions">
              <button aria-label="Rename conversation" onClick={() => setEditing(conversation.id)}><Pencil size={14} /></button>
              <button aria-label="Delete conversation" onClick={() => remove(conversation)}><Trash2 size={14} /></button>
              <button disabled={!document} onClick={() => document && onOpen(conversation, document)}>Open</button>
            </div>
          </article>;
        })}
      </div>
    </section>
  </div>;
}

function MultiDocumentChat({
  documents, token, onCreated, onClose,
}: {
  documents: DocumentItem[];
  token: string;
  onCreated: (conversation: Conversation, selected: DocumentItem[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected.length < 2) { setError("Select at least two ready PDFs."); return; }
    setBusy(true); setError("");
    const chosen = documents.filter((document) => selected.includes(document.id));
    try {
      const conversation = await api<Conversation>("/conversations", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(new FormData(event.currentTarget).get("title") ?? "").trim() || `Compare ${chosen.length} PDFs`,
          document_ids: selected,
        }),
      });
      onCreated(conversation, chosen);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create conversation"); }
    finally { setBusy(false); }
  }

  return <div className="multi-chat-wrap" role="dialog" aria-modal="true" aria-label="Ask multiple PDFs">
    <button className="history-backdrop" aria-label="Close" onClick={onClose} />
    <form className="multi-chat-panel" onSubmit={create}>
      <button className="modal-x" type="button" aria-label="Close" onClick={onClose}><X size={18} /></button>
      <span className="multi-chat-icon"><Sparkles size={23} /></span>
      <p className="eyebrow">Cross-document chat</p>
      <h2>Ask multiple PDFs</h2>
      <p>Select two or more indexed documents. Answers may retrieve and cite relevant pages from any selected PDF.</p>
      <label className="multi-title">Conversation name<input name="title" placeholder="e.g. Compare résumé versions" maxLength={160} /></label>
      <div className="multi-doc-list">
        {documents.map((document) => <label key={document.id} className={selected.includes(document.id) ? "selected" : ""}>
          <input type="checkbox" checked={selected.includes(document.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, document.id] : current.filter((id) => id !== document.id))} />
          <FileText size={18} /><span><strong>{document.filename}</strong><small>{document.page_count ?? "—"} pages</small></span>
        </label>)}
      </div>
      {error && <div className="form-error">{error}</div>}
      <button className="multi-submit" disabled={busy || selected.length < 2}><MessageCircle size={16} /> {busy ? "Creating…" : `Start chat with ${selected.length || 0} PDFs`}</button>
    </form>
  </div>;
}

async function downloadArtifact(artifact: Artifact, token: string) {
  const response = await fetch(`${API}/pdf-tools/artifacts/${artifact.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) expireSession();
  if (!response.ok) throw new Error("Could not download generated file");
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = window.document.createElement("a");
  link.href = url; link.download = artifact.filename; link.click(); URL.revokeObjectURL(url);
}

async function downloadDocumentFile(document: DocumentItem, token: string) {
  const response = await fetch(`${API}/documents/${document.id}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) expireSession();
  if (!response.ok) throw new Error("Could not download PDF");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = document.filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadDocumentArchive(documents: DocumentItem[], token: string, artifacts: Artifact[] = []) {
  const response = await fetch(`${API}/documents/download-zip`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      files: [
        ...documents.map((document) => ({ kind: "document", id: document.id })),
        ...artifacts.map((artifact) => ({ kind: "artifact", id: artifact.id })),
      ],
    }),
  });
  if (response.status === 401) expireSession();
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
        <button className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}><FileText size={15} /> Uploaded PDFs <span>{documents.length}</span></button>
        <button className={tab === "generated" ? "active" : ""} onClick={() => setTab("generated")}><Sparkles size={15} /> Generated files <span>{artifacts.length}</span></button>
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
          <div className="folder-file-icon generated"><Sparkles size={18} /></div>
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
    <section className="pdf-tools-panel"><header><div><p className="eyebrow">Phase 5 workspace</p><h2>PDF tools</h2></div><button onClick={onClose}><X size={18} /></button></header>
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

function AccountPanel({ user, token, stats, onUser, onClose }: {
  user: AuthResult["user"]; token: string; stats: Stats | null; onUser: (user: AuthResult["user"]) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<"profile" | "admin">("profile");
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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
  async function toggleAccount(item: AdminUser) {
    const updated = await api<AuthResult["user"]>(`/admin/users/${item.id}/status`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !item.is_active }) });
    setAdmins((current) => current.map((value) => value.id === item.id ? { ...value, is_active: updated.is_active } : value));
  }
  return <div className="account-wrap"><button className="history-backdrop" aria-label="Close profile" onClick={onClose} /><section className="account-panel">
    <header><div><p className="eyebrow">Account workspace</p><h2>{user.display_name}</h2></div><button onClick={onClose}><X size={18} /></button></header>
    {user.role === "admin" && <nav><button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}><UserRound size={15} /> Profile</button><button className={tab === "admin" ? "active" : ""} onClick={() => setTab("admin")}><ShieldCheck size={15} /> Admin</button></nav>}
    <main>{error && <div className="form-error">{error}</div>}{message && <div className="success-note">{message}</div>}
      {tab === "profile" ? <><div className="account-stats">{stats && <><article><strong>{stats.document_count}</strong><span>Documents</span></article><article><strong>{stats.page_count}</strong><span>Pages</span></article><article><strong>{(stats.storage_bytes / 1024 / 1024).toFixed(1)} MB</strong><span>Storage</span></article><article><strong>{stats.ai_requests}</strong><span>AI requests</span></article><article><strong>{stats.generated_files}</strong><span>Generated</span></article><article className={stats.failed_jobs ? "warn" : ""}><strong>{stats.failed_jobs}</strong><span>Failed jobs</span></article></>}</div>
        <div className="profile-forms"><form onSubmit={updateProfile}><h3>Profile</h3><label>Email<input value={user.email} disabled /></label><label>Display name<input name="display_name" defaultValue={user.display_name} minLength={2} required /></label><button>Save profile</button></form>
          <form onSubmit={changePassword}><h3>Change password</h3><label>Current password<input name="current_password" type="password" required /></label><label>New password<input name="new_password" type="password" minLength={8} required /></label><button>Update password</button></form></div></>
        : <div className="admin-users"><h3>User management</h3>{admins.map((item) => <article key={item.id}><div><strong>{item.display_name}</strong><span>{item.email} · {item.role}</span></div><small>{item.document_count} docs · {item.ai_requests} AI</small><button className={item.is_active ? "" : "enable"} onClick={() => toggleAccount(item)}>{item.is_active ? "Disable" : "Enable"}</button></article>)}</div>}
    </main></section></div>;
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
  return <div className="jobs-wrap"><button className="history-backdrop" aria-label="Close processing jobs" onClick={onClose} /><section className="jobs-panel" role="dialog" aria-label="Processing jobs">
    <header><div><p className="eyebrow">Background activity</p><h2>Processing jobs</h2></div><button aria-label="Close processing jobs" onClick={onClose}><X size={18} /></button></header>
    <main>{error && <div className="form-error">{error}</div>}{items.map((job) => <article key={job.id}><div><strong>{(job.operation ?? "document processing").replaceAll("_", " ")}</strong><span>{job.created_at ? new Date(job.created_at).toLocaleString() : ""} · {job.progress}%</span></div><b className={`job-state ${job.status}`}>{job.status}</b>{job.status === "failed" && job.operation !== "document_processing" && <button onClick={() => retry(job)}>Retry</button>}{job.error_message && <small>{job.error_message}</small>}</article>)}{!items.length && !error && <div className="empty-workspace"><RefreshCw size={30} /><h3>No processing jobs yet</h3></div>}</main>
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
        <button className="copilot-primary" disabled={busy}>{busy ? "Inspecting request…" : "Create safe plan"}<Sparkles size={16} /></button>
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

function WorkspaceApp() {
  const [initialAuth] = useState<AuthResult | null>(() => {
    if (typeof window === "undefined") return null;
    const saved = localStorage.getItem("insightpdf-auth");
    return saved ? JSON.parse(saved) as AuthResult : null;
  });
  const [token, setToken] = useState(initialAuth?.access_token ?? "");
  const [user, setUser] = useState<AuthResult["user"] | null>(initialAuth?.user ?? null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
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
  const [chatDocument, setChatDocument] = useState<DocumentItem | null>(null);
  const [chatDocuments, setChatDocuments] = useState<DocumentItem[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyDocumentFilter, setHistoryDocumentFilter] = useState<DocumentItem | null>(null);
  const [multiChatOpen, setMultiChatOpen] = useState(false);
  const [aiDocument, setAIDocument] = useState<DocumentItem | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [pdfToolsOpen, setPDFToolsOpen] = useState(false);
  const [pdfToolsDocument, setPDFToolsDocument] = useState<DocumentItem | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [draggingUpload, setDraggingUpload] = useState(false);
  const [hubView, setHubView] = useState<"home" | "chat" | "documents">("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem("insightpdf-theme");
  }, []);

  useEffect(() => {
    function handleExpiredSession() {
      setToken("");
      setUser(null);
      setDocuments([]);
      setWorkspaceArtifacts([]);
      setCollections([]);
      setConversations([]);
      setViewer(null);
      setArtifactViewer(null);
      setRenameTarget(null);
      setChatDocument(null);
      setChatDocuments([]);
      setHistoryOpen(false);
      setAIDocument(null);
      setCompareOpen(false);
      setPDFToolsOpen(false);
      setAccountOpen(false);
      setError("Your session expired. Please log in again.");
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpiredSession);
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

  async function openDocumentChat(document: DocumentItem) {
    setBusy(true);
    setError("");
    try {
      const saved = await loadConversations();
      const latest = saved.find((conversation) => conversation.document_ids.includes(document.id)) ?? null;
      setActiveConversation(latest);
      setChatDocuments([document]);
      setChatDocument(document);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load document conversations");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!initialAuth) return;
    const timer = window.setTimeout(() => {
      loadDocuments(initialAuth.access_token).catch(() => undefined);
      loadStats(initialAuth.access_token).catch(() => undefined);
      loadWorkspaceArtifacts(initialAuth.access_token).catch(() => undefined);
      loadCollections(initialAuth.access_token).catch(() => undefined);
      api<Conversation[]>("/conversations", initialAuth.access_token).then(setConversations).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialAuth, loadCollections, loadDocuments, loadStats, loadWorkspaceArtifacts]);

  useEffect(() => {
    if (!token || !documents.some((item) => !["ready", "failed"].includes(item.status))) return;
    const timer = window.setInterval(() => loadDocuments(token).catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, [token, documents, loadDocuments]);

  useEffect(() => {
    function keyboardShortcuts(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable=true]");
      if (event.key === "Escape") {
        setViewer(null); setArtifactViewer(null); setChatDocument(null); setHistoryOpen(false);
        setAIDocument(null); setCompareOpen(false); setPDFToolsOpen(false); setOpenActionMenu("");
        return;
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "/") { event.preventDefault(); workspaceSearchRef.current?.focus(); }
      if (event.key.toLowerCase() === "u") { event.preventDefault(); uploadInputRef.current?.click(); }
    }
    window.addEventListener("keydown", keyboardShortcuts);
    return () => window.removeEventListener("keydown", keyboardShortcuts);
  }, []);

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
      localStorage.setItem("insightpdf-auth", JSON.stringify(result));
      setToken(result.access_token); setUser(result.user);
      await Promise.all([
        loadDocuments(result.access_token), loadStats(result.access_token), loadWorkspaceArtifacts(result.access_token),
        loadCollections(result.access_token), api<Conversation[]>("/conversations", result.access_token).then(setConversations),
      ]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Authentication failed"); }
    finally { setBusy(false); }
  }

  async function openDemoWorkspace() {
    setMode("login");
    await authenticate({
      email: "demo@insightpdf.dev",
      password: "DemoPassword123!",
      display_name: "",
    });
  }

  async function upload(file?: File) {
    if (!file || !token) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Drop a PDF file. Other formats can be converted from PDF tools.");
      return;
    }
    setBusy(true); setError("");
    const data = new FormData(); data.append("file", file);
    try {
      await api("/documents", token, { method: "POST", body: data });
      await Promise.all([loadDocuments(token), loadStats(token)]);
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

  async function generateDocumentMetadata(document: DocumentItem) {
    setBusy(true); setError("");
    try {
      const updated = await api<DocumentItem>(`/documents/${document.id}/generate-metadata`, token, { method: "POST" });
      setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not generate document metadata"); }
    finally { setBusy(false); }
  }

  function signOut() {
    localStorage.removeItem("insightpdf-auth");
    setToken(""); setUser(null); setDocuments([]); setWorkspaceArtifacts([]); setCollections([]); setConversations([]); setArtifactViewer(null); setRenameTarget(null);
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
        <div className="auth-brand auth-brand-login"><img src="/logo.png" alt="InsightPDF" /></div>
        <p className="eyebrow">AI-powered PDF workspace</p>
        <h1>{mode === "login" ? "Welcome back" : "Create your workspace"}</h1>
        <p>Upload PDFs, extract text, and process scanned pages securely.</p>
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
        {DEMO_ENABLED && mode === "login" && <button className="demo-link" type="button" onClick={openDemoWorkspace} disabled={busy}>
          <Sparkles size={14} /> {busy ? "Opening demo workspace…" : "Just exploring? Open the demo workspace"}
        </button>}
      </section>
    </main>
  );

  const readyDocuments = documents.filter((item) => item.status === "ready");

  return (
    <main className={`workspace-page hub-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} data-hub-view={hubView}>
      <aside className="hub-sidebar">
        <div className="hub-brand">
          <span className="hub-brand-mark"><FileText size={19} /></span>
          <strong>Insight<span>PDF</span></strong>
          <button aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setSidebarCollapsed((current) => !current)}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
        </div>
        <nav aria-label="Workspace navigation">
          <button className={hubView === "home" ? "active" : ""} onClick={() => setHubView("home")}><LayoutDashboard size={18} /><span>Home</span></button>
          <button className={hubView === "documents" ? "active" : ""} onClick={() => setHubView("documents")}><FolderOpen size={18} /><span>Documents</span><i>{documents.length + workspaceArtifacts.length}</i></button>
          <span className="hub-nav-label">AI workspace</span>
          <button className={hubView === "chat" ? "active" : ""} disabled={!readyDocuments.length} onClick={() => setHubView("chat")}><BrainCircuit size={18} /><span>Ask AI</span></button>
          <button disabled={!readyDocuments.length} onClick={() => setHubView("chat")}><MessageCircle size={18} /><span>Multi-document</span></button>
          <button disabled={readyDocuments.length < 2} onClick={() => setCompareOpen(true)}><RefreshCw size={18} /><span>Compare</span></button>
          <span className="hub-nav-label">Tools</span>
          <button disabled={!readyDocuments.length} onClick={() => { setPDFToolsDocument(null); setPDFToolsOpen(true); }}><Scissors size={18} /><span>PDF tools</span></button>
          <button onClick={() => { setHistoryDocumentFilter(null); setHistoryOpen(true); loadConversations().catch(() => undefined); }}><History size={18} /><span>Chat history</span></button>
          <button onClick={() => setJobsOpen(true)}><RefreshCw size={18} /><span>Processing</span></button>
        </nav>
        <div className="hub-sidebar-footer">
          <button onClick={() => { setAccountOpen(true); loadStats(token).catch(() => undefined); }}><UserRound size={17} /><span className="hub-user"><strong>{user.display_name}</strong><small>{user.email}</small></span><Settings size={14} /></button>
          <button onClick={signOut}><LogOut size={17} /><span>Sign out</span></button>
        </div>
      </aside>
      <header className="hub-topbar">
        <div><strong>{hubView === "home" ? "AI workspace" : hubView === "chat" ? "Ask AI" : "Documents"}</strong><small>{hubView === "home" ? "Ask, create, and organize" : hubView === "chat" ? "Chat with one or multiple documents" : `${documents.length + workspaceArtifacts.length} files in your workspace`}</small></div>
        <button title="Keyboard shortcuts: / search, U upload" aria-label="Keyboard shortcuts"><Keyboard size={17} /></button>
        <button onClick={() => setJobsOpen(true)} aria-label="Processing jobs"><RefreshCw size={17} /></button>
        <label className={`hub-upload ${busy ? "disabled" : ""}`}><Upload size={16} /> Upload<input ref={uploadInputRef} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => upload(event.target.files?.[0])} /></label>
      </header>
      <section className="workspace-content hub-content">
        {hubView === "home" ? <div className="hub-home">
          <HomeChat token={token} onChanged={() => loadConversations().catch(() => undefined)} onOpenDocuments={() => setHubView("chat")} />
          <section className="hub-conversation">
            <div className="hub-ai-brand"><span className="hub-brand-mark"><FileText size={20} /></span><strong>Insight<span>PDF</span> <i>AI</i></strong></div>
            <h1>What can I help you understand?</h1>
            <button className="hub-prompt" disabled={!readyDocuments.length} onClick={() => setHubView("chat")}>
              <span>{readyDocuments.length ? "Ask anything about your documents…" : "Upload a document to start asking questions"}</span>
              <i><Send size={17} /></i>
            </button>
            <div className="hub-prompt-hints"><span>Try:</span><button disabled={!readyDocuments.length} onClick={() => readyDocuments[0] && setAIDocument(readyDocuments[0])}>Summarize latest</button><button disabled={readyDocuments.length < 2} onClick={() => setCompareOpen(true)}>Compare files</button><button disabled={!readyDocuments.length} onClick={() => setHubView("chat")}>Find across documents</button></div>
          </section>
          <section className="hub-quick-tools">
            <header><div><strong>Quick tools</strong><span>Open a specialized workflow</span></div></header>
            <div>
              <button disabled={!readyDocuments.length} onClick={() => setHubView("chat")}><span><MessageCircle size={19} /></span><strong>Ask documents</strong><small>Grounded answers with citations</small></button>
              <button disabled={!readyDocuments.length} onClick={() => readyDocuments[0] && setAIDocument(readyDocuments[0])}><span><Sparkles size={19} /></span><strong>Summarize</strong><small>Turn long files into key points</small></button>
              <button disabled={readyDocuments.length < 2} onClick={() => setCompareOpen(true)}><span><RefreshCw size={19} /></span><strong>Compare</strong><small>Find changes and differences</small></button>
              <button disabled={!readyDocuments.length} onClick={() => { setPDFToolsDocument(null); setPDFToolsOpen(true); }}><span><Scissors size={19} /></span><strong>PDF tools</strong><small>Convert, merge, split, and edit</small></button>
            </div>
          </section>
          <div className="hub-home-grid">
            <section className="hub-recent">
              <header><div><strong>Recent</strong><span>Your latest work</span></div><button onClick={() => setHubView("documents")}>View all</button></header>
              <div>{recentActivity.slice(0, 5).map((item) => <article key={item.id}>{item.icon === "chat" ? <MessageCircle size={16} /> : item.icon === "artifact" ? <Sparkles size={16} /> : <FileText size={16} />}<span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{new Date(item.date).toLocaleDateString()}</time></article>)}</div>
            </section>
            <section className="hub-overview">
              <header><strong>Workspace</strong><span>At a glance</span></header>
              <div><article><strong>{documents.length + workspaceArtifacts.length}</strong><span>Files</span></article><article><strong>{stats?.page_count ?? 0}</strong><span>Pages</span></article><article><strong>{stats?.ai_requests ?? 0}</strong><span>AI requests</span></article></div>
              <button onClick={() => setHubView("documents")}><FolderOpen size={15} /> Open documents</button>
            </section>
          </div>
        </div> : hubView === "chat" ? <IntegratedChatHub
          documents={readyDocuments}
          token={token}
          onChanged={() => { loadConversations().catch(() => undefined); }}
          onHistory={() => { setHistoryDocumentFilter(null); setHistoryOpen(true); loadConversations().catch(() => undefined); }}
          onPreview={(document) => { setViewerPage(1); setViewerSearch(""); setViewer(document); }}
          onCitation={(citation) => {
            const cited = documents.find((item) => item.id === citation.document_id);
            if (cited) { setViewerPage(citation.page_number); setViewerSearch(citation.snippet); setViewer(cited); }
          }}
        /> : <header className="documents-heading"><div><h1>Your documents</h1><p>Upload, organize, preview, and use AI with every file.</p></div></header>}
        <div className="workspace-title">
          <div><p className="eyebrow">AI-first document workspace</p><h1>What do you want to understand?</h1><p>Upload a PDF, ask grounded questions, compare versions, or transform it into something useful.</p></div>
          <div className="workspace-actions">
            <button className="copilot-launch" disabled={!documents.some((item) => item.status === "ready")} onClick={() => setHubView("chat")}><BrainCircuit size={16} /> Ask documents</button>
            <button disabled={!documents.some((item) => item.status === "ready")} onClick={() => { setPDFToolsDocument(null); setPDFToolsOpen(true); }}><Scissors size={16} /> PDF tools</button>
            <button disabled={documents.filter((item) => item.status === "ready").length < 2} onClick={() => setCompareOpen(true)}><RefreshCw size={16} /> Compare PDFs</button>
            <button disabled={documents.filter((item) => item.status === "ready").length < 2} onClick={() => setMultiChatOpen(true)}><Sparkles size={16} /> Ask multiple PDFs</button>
            <label className={`real-upload ${busy ? "disabled" : ""}`}><Upload size={17} /> Upload PDF<input type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => upload(event.target.files?.[0])} /></label>
          </div>
        </div>
        <button className={`ai-upload-dropzone ${draggingUpload ? "dragging" : ""}`} type="button" onClick={() => uploadInputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDraggingUpload(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDraggingUpload(false)} onDrop={(event) => {
          event.preventDefault(); setDraggingUpload(false); upload(event.dataTransfer.files[0]);
        }}>
          {busy ? <RefreshCw className="spin" size={25} /> : <Upload size={25} />}
          <span><strong>{busy ? "Uploading and preparing your document…" : "Drop a PDF here to begin"}</strong><small>or click to browse · U opens the file picker</small></span>
          <Sparkles size={19} />
        </button>
        {error && <div className="form-error">{error}</div>}
        <div className="dashboard-cards">{stats && <><article><LayoutDashboard size={17} /><div><strong>{documents.length + workspaceArtifacts.length}</strong><span>All files</span></div></article><article><FileText size={17} /><div><strong>{stats.page_count}</strong><span>Pages indexed</span></div></article><article><Sparkles size={17} /><div><strong>{stats.ai_requests}</strong><span>AI requests</span></div></article><article><Download size={17} /><div><strong>{stats.generated_files}</strong><span>Generated files</span></div></article></>}</div>
        {!!recentActivity.length && <section className="recent-activity"><header><Activity size={16} /><div><strong>Recent activity</strong><span>Your latest documents, results, and conversations</span></div></header><div>{recentActivity.map((item) => <article key={item.id}>{item.icon === "chat" ? <MessageCircle size={15} /> : item.icon === "artifact" ? <Sparkles size={15} /> : <FileText size={15} />}<span><strong>{item.title}</strong><small>{item.detail} · {new Date(item.date).toLocaleDateString()}</small></span></article>)}</div></section>}
        <div className="collection-bar">
          <FolderOpen size={16} />
          <button className={collectionFilter === "all" ? "active" : ""} onClick={() => setCollectionFilter("all")}>All documents</button>
          <button className={collectionFilter === "none" ? "active" : ""} onClick={() => setCollectionFilter("none")}>Unfiled</button>
          {collections.map((collection) => <button className={collectionFilter === collection.id ? "active" : ""} key={collection.id} onClick={() => setCollectionFilter(collection.id)}><i style={{ background: collection.color }} />{collection.name}</button>)}
          <form onSubmit={createCollection}><FolderPlus size={14} /><input aria-label="New collection name" value={newCollectionName} onChange={(event) => setNewCollectionName(event.target.value)} placeholder="New collection" /><button disabled={!newCollectionName.trim()}>Add</button></form>
        </div>
        <div className="document-type-tabs" role="tablist" aria-label="Document types">
          <button role="tab" aria-selected={typeFilter === "all"} className={typeFilter === "all" ? "active" : ""} onClick={() => setTypeFilter("all")}>All <span>{documents.length + workspaceArtifacts.length}</span></button>
          <button role="tab" aria-selected={typeFilter === "pdfs"} className={typeFilter === "pdfs" ? "active" : ""} onClick={() => setTypeFilter("pdfs")}>Uploaded PDFs <span>{documents.length}</span></button>
          <button role="tab" aria-selected={typeFilter === "converted"} className={typeFilter === "converted" ? "active" : ""} onClick={() => setTypeFilter("converted")}>Converted <span>{workspaceArtifacts.filter((item) => !isImageArtifact(item)).length}</span></button>
          <button role="tab" aria-selected={typeFilter === "images"} className={typeFilter === "images" ? "active" : ""} onClick={() => setTypeFilter("images")}>Images <span>{workspaceArtifacts.filter(isImageArtifact).length}</span></button>
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
              return <article className="document-card generated-document-card" key={`artifact-${artifact.id}`}>
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
                    <button onClick={() => { downloadArtifact(artifact, token).catch((reason) => setError(reason.message)); setOpenActionMenu(""); }}><Download size={14} /> Download</button>
                    <button disabled={preparingArtifactId === artifact.id} onClick={() => { openArtifactPDFTools(artifact); setOpenActionMenu(""); }}><Scissors size={14} /> {preparingArtifactId === artifact.id ? "Preparing…" : "PDF tools"}</button>
                    <button disabled={preparingArtifactId === artifact.id} onClick={() => { openArtifactAI(artifact, "workspace"); setOpenActionMenu(""); }}><Sparkles size={14} /> AI tools</button>
                    <button disabled={preparingArtifactId === artifact.id} onClick={() => { openArtifactAI(artifact, "chat"); setOpenActionMenu(""); }}><MessageCircle size={14} /> Ask AI</button>
                    <label className="action-menu-select"><FolderOpen size={14} /><select aria-label={`Collection for ${artifact.filename}`} value={artifact.collection_id ?? ""} onChange={(event) => assignArtifactCollection(artifact, event.target.value || null)}><option value="">Unfiled</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label>
                    <button className="danger" onClick={() => { removeWorkspaceArtifact(artifact); setOpenActionMenu(""); }}><Trash2 size={14} /> Delete</button>
                  </nav></>}
                </div>
              </article>;
            }
            const document = entry.item;
            const job = jobs[document.id];
            const ready = document.status === "ready";
            return <article className="document-card" key={document.id}>
              <label className="workspace-document-select" title={`Select ${document.filename}`}><input type="checkbox" checked={selectedFileKeys.includes(`document:${document.id}`)} onChange={(event) => setSelectedFileKeys((current) => event.target.checked ? [...current, `document:${document.id}`] : current.filter((key) => key !== `document:${document.id}`))} /></label>
              <DocumentCardPreview document={document} token={token} onOpen={() => { setViewerPage(1); setViewerSearch(""); setViewer(document); }} />
              <div className="document-info">
                <strong>{document.display_title || document.filename}</strong>
                {document.display_title && <small className="document-original-name">{document.filename}</small>}
                <span>{(document.size_bytes / 1024 / 1024).toFixed(1)} MB · PDF · {new Date(document.created_at).toLocaleDateString()}</span>
                {!!document.tags.length && <div className="document-tags">{document.tags.map((tag) => <i key={tag}>{tag}</i>)}</div>}
                <div className={`phase-status ${ready ? "ready" : document.status === "failed" ? "failed" : ""}`}>
                  {ready ? <Check size={13} /> : <RefreshCw size={13} className="spin" />}
                  {ready ? `Uploaded · Ready · ${document.page_count ?? "—"} ${document.page_count === 1 ? "page" : "pages"}` : document.status.replaceAll("_", " ")}
                </div>
                {!ready && document.status !== "failed" && <div className="job-progress"><i style={{ width: `${job?.progress ?? 0}%` }} /></div>}
                {(document.error_message || job?.error_message) && <small className="document-error">{document.error_message || job?.error_message}</small>}
              </div>
              <div className="document-actions">
                {ready && <div className="document-quick-actions"><button title="Summarize" aria-label={`Summarize ${document.filename}`} onClick={() => setAIDocument(document)}><Sparkles size={14} /></button><button title="Ask AI" aria-label={`Ask AI about ${document.filename}`} onClick={() => openDocumentChat(document)}><MessageCircle size={14} /></button></div>}
                <button className="more-actions-button" aria-label={`More actions for ${document.filename}`} title="More actions" onClick={() => setOpenActionMenu((current) => current === `document:${document.id}` ? "" : `document:${document.id}`)}><MoreVertical size={17} /></button>
                {openActionMenu === `document:${document.id}` && <><button className="action-menu-backdrop" aria-label="Close actions menu" onClick={() => setOpenActionMenu("")} /><nav className="file-action-menu" aria-label={`Actions for ${document.filename}`}>
                  <button disabled={!ready} onClick={() => { setViewerPage(1); setViewerSearch(""); setViewer(document); setOpenActionMenu(""); }}><Eye size={14} /> Preview</button>
                  <button onClick={() => { renameDocument(document); setOpenActionMenu(""); }}><Pencil size={14} /> Rename</button>
                  {document.status === "failed" && <button onClick={() => { retryDocument(document); setOpenActionMenu(""); }}><RefreshCw size={14} /> Retry processing</button>}
                  <button disabled={!ready} onClick={() => { setPDFToolsDocument(document); setPDFToolsOpen(true); setOpenActionMenu(""); }}><Scissors size={14} /> PDF tools</button>
                  <button disabled={!ready} onClick={() => { setAIDocument(document); setOpenActionMenu(""); }}><Sparkles size={14} /> AI tools</button>
                  <button disabled={!ready || busy} onClick={() => { openDocumentChat(document); setOpenActionMenu(""); }}><MessageCircle size={14} /> Ask AI</button>
                  <button disabled={!ready || busy} onClick={() => { generateDocumentMetadata(document); setOpenActionMenu(""); }}><Tag size={14} /> Generate title & tags</button>
                  <label className="action-menu-select"><FolderOpen size={14} /><select aria-label={`Collection for ${document.filename}`} value={document.collection_id ?? ""} onChange={(event) => assignDocumentCollection(document, event.target.value || null)}><option value="">Unfiled</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label>
                  <button className="danger" onClick={() => { removeDocument(document); setOpenActionMenu(""); }}><Trash2 size={14} /> Delete</button>
                </nav></>}
              </div>
            </article>;
          })}
          {!workspaceItems.length && <div className="empty-workspace">{typeFilter === "images" ? <FileImage size={34} /> : <Upload size={34} />}<h2>No documents found</h2><p>{query ? "Try another search or filter." : typeFilter === "images" ? "Image conversion results will appear here. Source images remain temporary unless saved as an output." : "Upload a PDF or create a converted file to get started."}</p></div>}
        </div>
      </section>
      {viewer && <PdfViewer key={`${viewer.id}-${viewerPage}-${viewerSearch}`} document={viewer} token={token} initialPage={viewerPage} initialSearch={viewerSearch} onHistory={() => {
        setHistoryDocumentFilter(viewer); setHistoryOpen(true); loadConversations().catch(() => undefined);
      }} onClose={() => setViewer(null)} />}
      {artifactViewer && <ArtifactViewer key={artifactViewer.id} artifact={artifactViewer} token={token} onClose={() => setArtifactViewer(null)} />}
      {renameTarget && <div className="rename-dialog-wrap">
        <button className="history-backdrop" aria-label="Cancel rename" onClick={() => setRenameTarget(null)} />
        <form className="rename-dialog" role="dialog" aria-modal="true" aria-label="Rename file" onSubmit={saveWorkspaceRename}>
          <header><div><p className="eyebrow">File details</p><h2>Rename file</h2></div><button type="button" aria-label="Cancel rename" onClick={() => setRenameTarget(null)}><X size={17} /></button></header>
          <label>Filename<input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={180} required /></label>
          <div><button type="button" onClick={() => setRenameTarget(null)}>Cancel</button><button type="submit" disabled={renameBusy || !renameValue.trim()}>{renameBusy ? <RefreshCw size={14} className="spin" /> : <Pencil size={14} />} {renameBusy ? "Saving…" : "Save name"}</button></div>
        </form>
      </div>}
      {chatDocument && <ChatPanel document={chatDocument} documentIds={(activeConversation?.document_ids ?? chatDocuments.map((item) => item.id))} documentLabel={chatDocuments.length > 1 ? `${chatDocuments.length} selected PDFs` : chatDocument.filename} token={token} conversation={activeConversation} onChanged={async () => { await loadConversations(); }} onPreview={() => {
        setViewerPage(1); setViewerSearch(""); setViewer(chatDocument);
      }} onHistory={() => {
        setHistoryDocumentFilter(chatDocument); setHistoryOpen(true); loadConversations().catch(() => undefined);
      }} onClose={() => { setChatDocument(null); setActiveConversation(null); }} onCitation={(citation) => {
        const cited = documents.find((item) => item.id === citation.document_id);
        if (cited) { setViewerPage(citation.page_number); setViewerSearch(citation.snippet); setViewer(cited); }
      }} />}
      {historyOpen && <ConversationHistory conversations={conversations} documents={documents} busy={historyBusy} documentFilter={historyDocumentFilter} onRefresh={async () => { await loadConversations(); }} onClose={() => setHistoryOpen(false)} onOpen={(conversation, document) => {
        setHistoryOpen(false); setViewer(null); setActiveConversation(conversation); setChatDocuments(documents.filter((item) => conversation.document_ids.includes(item.id))); setChatDocument(document);
      }} />}
      {multiChatOpen && <MultiDocumentChat documents={documents.filter((item) => item.status === "ready")} token={token} onClose={() => setMultiChatOpen(false)} onCreated={(conversation, selected) => {
        setMultiChatOpen(false); setActiveConversation(conversation); setChatDocuments(selected); setChatDocument(selected[0]); loadConversations().catch(() => undefined);
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
      {accountOpen && <AccountPanel user={user} token={token} stats={stats} onUser={(updated) => {
        setUser(updated);
        const saved = JSON.parse(localStorage.getItem("insightpdf-auth") ?? "{}");
        localStorage.setItem("insightpdf-auth", JSON.stringify({ ...saved, user: updated }));
      }} onClose={() => setAccountOpen(false)} />}
      {jobsOpen && <ProcessingJobs token={token} onClose={() => setJobsOpen(false)} />}
    </main>
  );
}

function LandingPage({ onOpen }: { onOpen: () => void }) {
  const [landingPrompt, setLandingPrompt] = useState("");

  function submitLandingPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!landingPrompt.trim()) return;
    sessionStorage.setItem("insightpdf-pending-prompt", landingPrompt.trim());
    onOpen();
  }

  return (
    <main className="landing-page">
      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="InsightPDF home">
          <img src="/favicon.ico" alt="" />
          <span>Insight<b>PDF</b></span>
        </a>
        <button className="landing-nav-cta" onClick={onOpen}>Open app <span>→</span></button>
      </header>

      <section className="landing-hero">
        <div className="landing-mark" aria-hidden="true">
          <img src="/favicon.ico" alt="" />
        </div>
        <h1>Understand any PDF.<br />Without the busywork.</h1>
        <p>Read, search, summarize, compare, and transform your documents in one focused workspace.</p>
        <form className="landing-chat" onSubmit={submitLandingPrompt}>
          <div className="landing-chat-heading">
            <span><Sparkles size={16} /></span>
            <div><strong>Ask InsightPDF</strong><small>Sign in to send your question</small></div>
          </div>
          <div className="landing-chat-composer">
            <input
              aria-label="Ask InsightPDF"
              value={landingPrompt}
              onChange={(event) => setLandingPrompt(event.target.value)}
              placeholder="Ask anything about your PDF…"
            />
            <button type="submit" aria-label="Send question" disabled={!landingPrompt.trim()}>
              <Send size={18} />
            </button>
          </div>
          <div className="landing-chat-suggestions">
            {["Summarize this document", "Find the key risks", "Compare two PDFs"].map((prompt) =>
              <button key={prompt} type="button" onClick={() => setLandingPrompt(prompt)}>{prompt}</button>
            )}
          </div>
        </form>
        <div className="landing-demo" aria-label="InsightPDF example">
          <div className="landing-demo-top">
            <span><i /> annual-report.pdf</span>
            <small>42 pages</small>
          </div>
          <div className="landing-question">Summarize the key financial changes</div>
          <div className="landing-answer">
            <Sparkles size={18} />
            <p>Revenue increased while operating costs declined, improving the company&apos;s margin across the year.</p>
          </div>
          <div className="landing-citations"><span>Page 12</span><span>Page 27</span><span>Page 31</span></div>
        </div>
      </section>

      <section className="landing-features" aria-label="Features">
        <article><strong>Ask your documents</strong><p>Get clear answers grounded in page-level citations.</p></article>
        <article><strong>Work with PDFs</strong><p>Merge, split, convert, translate, and compare in one place.</p></article>
        <article><strong>Your files stay private</strong><p>Authenticated access and private object storage by default.</p></article>
      </section>

      <footer className="landing-footer">
        <span>InsightPDF</span>
        <button onClick={onOpen}>Get started →</button>
      </footer>
    </main>
  );
}

export default function Home() {
  const [appOpen, setAppOpen] = useState(
    () => new URLSearchParams(window.location.search).has("app"),
  );

  useEffect(() => {
    const syncRoute = () => setAppOpen(new URLSearchParams(window.location.search).has("app"));
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  function openApp() {
    window.history.pushState({}, "", "/?app=1");
    setAppOpen(true);
    window.scrollTo({ top: 0 });
  }

  return appOpen ? <WorkspaceApp /> : <LandingPage onOpen={openApp} />;
}
