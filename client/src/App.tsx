import { BrainCircuit, Check, Download, FileImage, FileText, FolderOpen, History, Languages, LayoutDashboard, ListChecks, LogOut, MessageCircle, Pencil, RefreshCw, Scissors, Search, Send, Settings, ShieldCheck, Sparkles, Trash2, Upload, UserRound, X, ZoomIn, ZoomOut } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const API = import.meta.env.VITE_API_URL ?? "/api/v1";

type DocumentItem = {
  id: string;
  filename: string;
  size_bytes: number;
  status: string;
  page_count: number | null;
  error_message: string | null;
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
type Artifact = { id: string; operation: string; filename: string; content_type: string; size_bytes: number; parameters: Record<string, unknown>; created_at: string };
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
    return <div className="ai-result comparison-result"><div className="similarity"><strong>{String(result.similarity_percent)}%</strong><span>text similarity</span></div>
      <h3>Comparison overview</h3><p>{String(result.summary ?? "")}</p>
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

function PdfViewer({ document, token, initialPage = 1, onHistory, onClose }: { document: DocumentItem; token: string; initialPage?: number; onHistory: () => void; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initialPage);
  const [scale, setScale] = useState(1.2);
  const [error, setError] = useState("");
  const [searchResults, setSearchResults] = useState<{ page: number; snippet: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [sideMode, setSideMode] = useState<"pages" | "search">("pages");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        const response = await fetch(`${API}/documents/${document.id}/content`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.status === 401) expireSession();
        if (!response.ok) throw new Error("Could not load this PDF");
        const loaded = await pdfjs.getDocument({ data: await response.arrayBuffer() }).promise;
        if (!cancelled) setPdf(loaded);
        setPage(initialPage);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not load this PDF");
      }
    })();
    return () => { cancelled = true; };
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
    })();
    return () => task?.cancel();
  }, [page, scale, pdf]);

  useEffect(() => () => { pdf?.destroy(); }, [pdf]);

  async function searchPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pdf) return;
    const query = String(new FormData(event.currentTarget).get("query") ?? "").trim().toLowerCase();
    if (!query) { setSearchResults([]); setSideMode("pages"); return; }
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
    <div className="viewer-wrap" role="dialog" aria-modal="true">
      <div className="viewer-toolbar">
        <strong>{document.filename}</strong>
        <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
        <span>{page} / {pdf?.numPages ?? document.page_count ?? "…"}</span>
        <button disabled={page >= (pdf?.numPages ?? 1)} onClick={() => setPage((value) => value + 1)}>Next</button>
        <button aria-label="Zoom out" onClick={() => setScale((value) => Math.max(.6, value - .2))}><ZoomOut size={18} /></button>
        <button aria-label="Zoom in" onClick={() => setScale((value) => Math.min(2.4, value + .2))}><ZoomIn size={18} /></button>
        <form className="viewer-search" onSubmit={searchPdf}><Search size={15} /><input name="query" placeholder="Search PDF" aria-label="Search PDF" /><button aria-label="Run search">Search</button></form>
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
        <div className="viewer-stage">{error ? <p>{error}</p> : <canvas ref={canvas} />}</div>
      </div>
    </div>
  );
}

function ChatPanel({
  document, documentIds, documentLabel, token, conversation, onClose, onCitation, onChanged, onHistory,
}: {
  document: DocumentItem;
  documentIds: string[];
  documentLabel: string;
  token: string;
  conversation?: Conversation | null;
  onClose: () => void;
  onCitation: (citation: Citation) => void;
  onChanged: () => void;
  onHistory: () => void;
}) {
  const [conversationId, setConversationId] = useState(conversation?.id ?? "");
  const [messages, setMessages] = useState<ChatMessage[]>(conversation?.messages ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const documentIdKey = documentIds.join(",");

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
  }, [conversation, document.id, document.filename, documentIdKey, documentLabel, onChanged, token]);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversationId || busy) return;
    const form = new FormData(event.currentTarget);
    const question = String(form.get("question") ?? "").trim();
    if (!question) return;
    event.currentTarget.reset();
    setMessages((current) => [...current, { role: "user", content: question }]);
    setBusy(true); setError("");
    try {
      const result = await api<{ answer: string; citations: Citation[] }>(
        `/conversations/${conversationId}/messages`, token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        },
      );
      setMessages((current) => [...current, { role: "assistant", content: result.answer, citations: result.citations }]);
      onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not answer"); }
    finally { setBusy(false); }
  }

  return <aside className="chat-panel">
    <header><span className="chat-brand"><Sparkles size={18} /></span><div><strong>Ask InsightPDF</strong><small>{documentLabel}</small></div><button className="new-chat-button" title="Start new conversation" onClick={beginNewConversation}><MessageCircle size={15} /><span>New chat</span></button><button aria-label="Document chat history" title="Chat history" onClick={onHistory}><History size={17} /></button><button aria-label="Close chat" onClick={onClose}><X size={18} /></button></header>
    <div className="chat-messages">
      {!messages.length && <div className="chat-empty"><MessageCircle size={30} /><strong>Ask about this PDF</strong><span>Answers are grounded in indexed pages and include source citations.</span></div>}
      {messages.map((message, index) => <div className={`chat-message ${message.role}`} key={index}>
        {message.role === "assistant" ? <><div className="assistant-label"><Sparkles size={13} /> InsightPDF</div><FormattedAnswer content={message.content} /></> : <p>{message.content}</p>}
        {!!message.citations?.length && <div className="citation-list"><span className="citation-heading">Sources</span>{message.citations.map((citation, citationIndex) => <button key={citationIndex} onClick={() => onCitation(citation)}>
          <b>{citation.document_name}</b><em>Page {citation.page_number}</em><span>{citation.snippet}</span>
        </button>)}</div>}
      </div>)}
      {busy && <div className="chat-thinking"><RefreshCw className="spin" size={14} /> Searching indexed pages…</div>}
    </div>
    {error && <div className="chat-error">{error}</div>}
    <form onSubmit={ask}><div className="chat-input"><textarea name="question" aria-label="Question" placeholder="Ask a follow-up question…" rows={1} disabled={!conversationId || busy} onKeyDown={(event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
    }} /><small>Enter to send · Shift+Enter for a new line</small></div><button aria-label="Send" disabled={!conversationId || busy}><Send size={17} /></button></form>
  </aside>;
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

  return <div className="folder-wrap"><button className="history-backdrop" aria-label="Close my folder" onClick={onClose} />
    <section className="folder-panel" role="dialog" aria-label="My folder">
      <header><div><p className="eyebrow">File library</p><h2>My folder</h2></div><button aria-label="Close my folder" onClick={onClose}><X size={18} /></button></header>
      <nav>
        <button className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}><FileText size={15} /> Uploaded PDFs <span>{documents.length}</span></button>
        <button className={tab === "generated" ? "active" : ""} onClick={() => setTab("generated")}><Sparkles size={15} /> Generated files <span>{artifacts.length}</span></button>
      </nav>
      <div className="folder-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" /></div>
      {error && <div className="form-error">{error}</div>}
      <main>
        {tab === "documents" && visibleDocuments.map((item) => <article className="folder-item" key={item.id}>
          <div className="folder-file-icon pdf"><FileText size={19} /></div>
          <div><strong>{item.filename}</strong><span>{(item.size_bytes / 1024 / 1024).toFixed(1)} MB · {item.page_count ?? "—"} pages · {item.status.replaceAll("_", " ")}</span></div>
          <div className="folder-actions">
            <button disabled={busyId === item.id} title="Download" onClick={() => downloadDocumentFile(item, token).catch((reason) => setError(reason.message))}><Download size={14} /></button>
            <button disabled={busyId === item.id} title="Rename" onClick={() => renameDocumentItem(item)}><Pencil size={14} /></button>
            <button disabled={busyId === item.id} title="Delete" onClick={() => deleteDocumentItem(item)}><Trash2 size={14} /></button>
          </div>
        </article>)}
        {tab === "generated" && visibleArtifacts.map((item) => <article className="folder-item" key={item.id}>
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
              {images.length > 0 && <div className="image-order-list" aria-label="Image order">{images.map((image, index) => <article key={`${image.name}-${image.lastModified}-${index}`}><span>{index + 1}. {image.name}</span><button disabled={index === 0} onClick={() => setImages((current) => current.map((item, itemIndex) => itemIndex === index - 1 ? current[index] : itemIndex === index ? current[index - 1] : item))}>Up</button><button disabled={index === images.length - 1} onClick={() => setImages((current) => current.map((item, itemIndex) => itemIndex === index + 1 ? current[index] : itemIndex === index ? current[index + 1] : item))}>Down</button><button onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></article>)}</div>}</>}
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
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<DocumentItem | null>(null);
  const [viewerPage, setViewerPage] = useState(1);
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
  const [folderOpen, setFolderOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const authForm = useForm<AuthFields>({
    resolver: zodResolver(authSchema),
    defaultValues: { display_name: "", email: "", password: "" },
  });

  useEffect(() => {
    function handleExpiredSession() {
      setToken("");
      setUser(null);
      setDocuments([]);
      setConversations([]);
      setViewer(null);
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
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialAuth, loadDocuments, loadStats]);

  useEffect(() => {
    if (!token || !documents.some((item) => !["ready", "failed"].includes(item.status))) return;
    const timer = window.setInterval(() => loadDocuments(token).catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, [token, documents, loadDocuments]);

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
      await Promise.all([loadDocuments(result.access_token), loadStats(result.access_token)]);
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
    setBusy(true); setError("");
    const data = new FormData(); data.append("file", file);
    try {
      await api("/documents", token, { method: "POST", body: data });
      await Promise.all([loadDocuments(token), loadStats(token)]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed"); }
    finally { setBusy(false); }
  }

  function signOut() {
    localStorage.removeItem("insightpdf-auth");
    setToken(""); setUser(null); setDocuments([]); setConversations([]);
  }

  async function renameDocument(document: DocumentItem) {
    const filename = window.prompt("New filename", document.filename);
    if (!filename || filename === document.filename) return;
    try {
      await api(`/documents/${document.id}`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename }) });
      await loadDocuments(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Rename failed"); }
  }

  async function removeDocument(document: DocumentItem) {
    if (!window.confirm(`Delete ${document.filename}? This removes its chats and indexed content.`)) return;
    try {
      await api(`/documents/${document.id}`, token, { method: "DELETE" });
      await Promise.all([loadDocuments(token), loadStats(token)]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Delete failed"); }
  }

  async function retryDocument(document: DocumentItem) {
    try {
      await api(`/documents/${document.id}/retry`, token, { method: "POST" });
      await loadDocuments(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Retry failed"); }
  }

  if (!token || !user) return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand auth-brand-login"><img src="/logo.png" alt="InsightPDF" /></div>
        <p className="eyebrow">AI-powered PDF workspace</p>
        <h1>{mode === "login" ? "Welcome back" : "Create your workspace"}</h1>
        <p>Upload PDFs, extract text, and process scanned pages securely.</p>
        {mode === "login" && <section className="demo-account">
          <Sparkles size={17} />
          <div><strong>Demo workspace</strong><span>Open a populated workspace with sample PDFs, AI tools, conversations, and generated files.</span></div>
          <button type="button" onClick={openDemoWorkspace} disabled={busy}>{busy ? <><RefreshCw size={14} className="spin" /> Logging you in…</> : "Explore populated demo"}</button>
        </section>}
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
        <button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "Need an account? Register" : "Already registered? Sign in"}
        </button>
      </section>
    </main>
  );

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div className="auth-brand auth-brand-header"><img src="/logo.png" alt="InsightPDF" /></div>
        <div><strong>{user.display_name}</strong><small>{user.email}</small></div>
        <button onClick={() => setFolderOpen(true)}><FolderOpen size={16} /> My folder</button>
        <button onClick={() => setJobsOpen(true)}><RefreshCw size={16} /> Processing jobs</button>
        <button onClick={() => { setAccountOpen(true); loadStats(token).catch(() => undefined); }}><Settings size={16} /> Account</button>
        <button onClick={signOut}><LogOut size={17} /> Sign out</button>
      </header>
      <section className="workspace-content">
        <div className="workspace-title">
          <div><p className="eyebrow">Document workspace</p><h1>Your PDFs</h1><p>Text extraction and OCR run safely in the background.</p></div>
          <div className="workspace-actions">
            <button className="copilot-launch" disabled={!documents.some((item) => item.status === "ready")} onClick={() => setCopilotOpen(true)}><BrainCircuit size={16} /> Ask copilot</button>
            <button disabled={!documents.some((item) => item.status === "ready")} onClick={() => { setPDFToolsDocument(null); setPDFToolsOpen(true); }}><Scissors size={16} /> PDF tools</button>
            <button disabled={documents.filter((item) => item.status === "ready").length < 2} onClick={() => setCompareOpen(true)}><RefreshCw size={16} /> Compare PDFs</button>
            <button disabled={documents.filter((item) => item.status === "ready").length < 2} onClick={() => setMultiChatOpen(true)}><Sparkles size={16} /> Ask multiple PDFs</button>
            <label className={`real-upload ${busy ? "disabled" : ""}`}><Upload size={17} /> Upload PDF<input type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => upload(event.target.files?.[0])} /></label>
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="dashboard-cards">{stats && <><article><LayoutDashboard size={17} /><div><strong>{stats.document_count}</strong><span>Documents</span></div></article><article><FileText size={17} /><div><strong>{stats.page_count}</strong><span>Pages indexed</span></div></article><article><Sparkles size={17} /><div><strong>{stats.ai_requests}</strong><span>AI requests</span></div></article><article><Download size={17} /><div><strong>{stats.generated_files}</strong><span>Generated files</span></div></article></>}</div>
        <div className="document-filters"><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your PDFs" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="ready">Ready</option><option value="processing">Processing</option><option value="failed">Failed</option></select></div>
        <div className="document-grid">
          {documents.filter((document) => document.filename.toLowerCase().includes(query.toLowerCase()) && (
            statusFilter === "all" ? true : statusFilter === "processing" ? !["ready", "failed"].includes(document.status) : document.status === statusFilter
          )).map((document) => {
            const job = jobs[document.id];
            const ready = document.status === "ready";
            return <article className="document-card" key={document.id}>
              <div className="pdf-badge"><FileText size={25} /></div>
              <div className="document-info">
                <strong>{document.filename}</strong>
                <span>{(document.size_bytes / 1024 / 1024).toFixed(1)} MB · {document.page_count ?? "—"} pages</span>
                <div className={`phase-status ${ready ? "ready" : document.status === "failed" ? "failed" : ""}`}>
                  {ready ? <Check size={13} /> : <RefreshCw size={13} className="spin" />}
                  {document.status.replaceAll("_", " ")}
                </div>
                {!ready && document.status !== "failed" && <div className="job-progress"><i style={{ width: `${job?.progress ?? 0}%` }} /></div>}
                {(document.error_message || job?.error_message) && <small className="document-error">{document.error_message || job?.error_message}</small>}
              </div>
              <div className="document-actions">
                <button title="Rename" onClick={() => renameDocument(document)}><Pencil size={13} /></button>
                <button title="Delete" onClick={() => removeDocument(document)}><Trash2 size={13} /></button>
                {document.status === "failed" && <button onClick={() => retryDocument(document)}><RefreshCw size={13} /> Retry</button>}
                <button disabled={!ready} onClick={() => { setViewerPage(1); setViewer(document); }}>Open PDF</button>
                <button disabled={!ready} onClick={() => { setPDFToolsDocument(document); setPDFToolsOpen(true); }}><Scissors size={14} /> Tools</button>
                <button disabled={!ready} onClick={() => setAIDocument(document)}><Sparkles size={14} /> AI tools</button>
                <button disabled={!ready || busy} onClick={() => openDocumentChat(document)}><MessageCircle size={14} /> Ask AI</button>
              </div>
            </article>;
          })}
          {!documents.length && <div className="empty-workspace"><Upload size={34} /><h2>No PDFs yet</h2><p>Upload your first document to start extraction.</p></div>}
        </div>
      </section>
      {viewer && <PdfViewer document={viewer} token={token} initialPage={viewerPage} onHistory={() => {
        setHistoryDocumentFilter(viewer); setHistoryOpen(true); loadConversations().catch(() => undefined);
      }} onClose={() => setViewer(null)} />}
      {chatDocument && <ChatPanel document={chatDocument} documentIds={(activeConversation?.document_ids ?? chatDocuments.map((item) => item.id))} documentLabel={chatDocuments.length > 1 ? `${chatDocuments.length} selected PDFs` : chatDocument.filename} token={token} conversation={activeConversation} onChanged={async () => { await loadConversations(); }} onHistory={() => {
        setHistoryDocumentFilter(chatDocument); setHistoryOpen(true); loadConversations().catch(() => undefined);
      }} onClose={() => { setChatDocument(null); setActiveConversation(null); }} onCitation={(citation) => {
        const cited = documents.find((item) => item.id === citation.document_id);
        if (cited) { setViewerPage(citation.page_number); setViewer(cited); }
      }} />}
      {historyOpen && <ConversationHistory conversations={conversations} documents={documents} busy={historyBusy} documentFilter={historyDocumentFilter} onRefresh={async () => { await loadConversations(); }} onClose={() => setHistoryOpen(false)} onOpen={(conversation, document) => {
        setHistoryOpen(false); setViewer(null); setActiveConversation(conversation); setChatDocuments(documents.filter((item) => conversation.document_ids.includes(item.id))); setChatDocument(document);
      }} />}
      {multiChatOpen && <MultiDocumentChat documents={documents.filter((item) => item.status === "ready")} token={token} onClose={() => setMultiChatOpen(false)} onCreated={(conversation, selected) => {
        setMultiChatOpen(false); setActiveConversation(conversation); setChatDocuments(selected); setChatDocument(selected[0]); loadConversations().catch(() => undefined);
      }} />}
      {aiDocument && <AIWorkspace document={aiDocument} documents={documents.filter((item) => item.status === "ready")} token={token} compareMode={false} onClose={() => setAIDocument(null)} onPage={(documentId, page) => {
        const selected = documents.find((item) => item.id === documentId);
        if (selected) { setViewerPage(page); setViewer(selected); }
      }} />}
      {compareOpen && <AIWorkspace document={null} documents={documents.filter((item) => item.status === "ready")} token={token} compareMode onClose={() => setCompareOpen(false)} onPage={(documentId, page) => {
        const selected = documents.find((item) => item.id === documentId);
        if (selected) { setViewerPage(page); setViewer(selected); }
      }} />}
      {pdfToolsOpen && <PDFToolsWorkspace documents={documents.filter((item) => item.status === "ready")} token={token} initialDocument={pdfToolsDocument} onClose={() => setPDFToolsOpen(false)} />}
      {accountOpen && <AccountPanel user={user} token={token} stats={stats} onUser={(updated) => {
        setUser(updated);
        const saved = JSON.parse(localStorage.getItem("insightpdf-auth") ?? "{}");
        localStorage.setItem("insightpdf-auth", JSON.stringify({ ...saved, user: updated }));
      }} onClose={() => setAccountOpen(false)} />}
      {jobsOpen && <ProcessingJobs token={token} onClose={() => setJobsOpen(false)} />}
      {copilotOpen && <CopilotWorkspace documents={documents.filter((item) => item.status === "ready")} token={token} onClose={() => setCopilotOpen(false)} />}
      {folderOpen && <MyFolder documents={documents} token={token} onDocuments={setDocuments} onClose={() => setFolderOpen(false)} />}
    </main>
  );
}

function LandingPage({ onOpen }: { onOpen: () => void }) {
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
        <button className="landing-primary" onClick={onOpen}>Open InsightPDF <span>→</span></button>
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
