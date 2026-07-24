"use client";

import { BookOpen, Check, FileText, History, LogOut, MessageCircle, Pencil, RefreshCw, Search, Send, Sparkles, Trash2, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

type DocumentItem = {
  id: string;
  filename: string;
  size_bytes: number;
  status: string;
  page_count: number | null;
  error_message: string | null;
  created_at: string;
};

type Job = { status: string; progress: number; error_message: string | null };
type AuthResult = { access_token: string; refresh_token: string; user: { display_name: string; email: string } };
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
      task = pdfPage.render({ canvasContext: context, viewport });
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
      task = pdfPage.render({ canvasContext: context, viewport });
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
    setConversationId(conversation.id);
    setMessages(conversation.messages);
    setError("");
  }, [conversation]);

  useEffect(() => {
    if (conversation) return;
    api<{ id: string }>("/conversations", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `Chat about ${documentLabel}`, document_ids: documentIds }),
    }).then((result) => { setConversationId(result.id); onChanged(); }).catch((reason) => setError(reason.message));
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
    <form onSubmit={ask}><div className="chat-input"><input name="question" aria-label="Question" placeholder="Ask a follow-up question…" disabled={!conversationId || busy} /><small>Answers use indexed document content</small></div><button aria-label="Send" disabled={!conversationId || busy}><Send size={17} /></button></form>
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

export default function Home() {
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
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialAuth, loadDocuments]);

  useEffect(() => {
    if (!token || !documents.some((item) => !["ready", "failed"].includes(item.status))) return;
    const timer = window.setInterval(() => loadDocuments(token).catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, [token, documents, loadDocuments]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<AuthResult>(`/auth/${mode}`, undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          ...(mode === "register" ? { display_name: form.get("display_name") } : {}),
        }),
      });
      localStorage.setItem("insightpdf-auth", JSON.stringify(result));
      setToken(result.access_token); setUser(result.user);
      await loadDocuments(result.access_token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Authentication failed"); }
    finally { setBusy(false); }
  }

  async function upload(file?: File) {
    if (!file || !token) return;
    setBusy(true); setError("");
    const data = new FormData(); data.append("file", file);
    try {
      await api("/documents", token, { method: "POST", body: data });
      await loadDocuments(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed"); }
    finally { setBusy(false); }
  }

  function signOut() {
    localStorage.removeItem("insightpdf-auth");
    setToken(""); setUser(null); setDocuments([]); setConversations([]);
  }

  if (!token || !user) return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand"><span><BookOpen size={24} /></span> Insight<b>PDF</b></div>
        <p className="eyebrow">AI-powered PDF workspace</p>
        <h1>{mode === "login" ? "Welcome back" : "Create your workspace"}</h1>
        <p>Upload PDFs, extract text, and process scanned pages securely.</p>
        <form onSubmit={authenticate}>
          {mode === "register" && <label>Display name<input name="display_name" minLength={2} required /></label>}
          <label>Email<input name="email" type="email" required /></label>
          <label>Password<input name="password" type="password" minLength={8} required /></label>
          {error && <div className="form-error">{error}</div>}
          <button disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
        <button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "Need an account? Register" : "Already registered? Sign in"}
        </button>
      </section>
    </main>
  );

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div className="auth-brand"><span><BookOpen size={21} /></span> Insight<b>PDF</b></div>
        <div><strong>{user.display_name}</strong><small>{user.email}</small></div>
        <button onClick={signOut}><LogOut size={17} /> Sign out</button>
      </header>
      <section className="workspace-content">
        <div className="workspace-title">
          <div><p className="eyebrow">Document workspace</p><h1>Your PDFs</h1><p>Text extraction and OCR run safely in the background.</p></div>
          <div className="workspace-actions">
            <button disabled={documents.filter((item) => item.status === "ready").length < 2} onClick={() => setMultiChatOpen(true)}><Sparkles size={16} /> Ask multiple PDFs</button>
            <label className={`real-upload ${busy ? "disabled" : ""}`}><Upload size={17} /> Upload PDF<input type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => upload(event.target.files?.[0])} /></label>
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="document-grid">
          {documents.map((document) => {
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
                <button disabled={!ready} onClick={() => { setViewerPage(1); setViewer(document); }}>Open PDF</button>
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
      {chatDocument && <ChatPanel document={chatDocument} documentIds={(activeConversation?.document_ids ?? chatDocuments.map((item) => item.id))} documentLabel={chatDocuments.length > 1 ? `${chatDocuments.length} selected PDFs` : chatDocument.filename} token={token} conversation={activeConversation} onChanged={loadConversations} onHistory={() => {
        setHistoryDocumentFilter(chatDocument); setHistoryOpen(true); loadConversations().catch(() => undefined);
      }} onClose={() => { setChatDocument(null); setActiveConversation(null); }} onCitation={(citation) => {
        const cited = documents.find((item) => item.id === citation.document_id);
        if (cited) { setViewerPage(citation.page_number); setViewer(cited); }
      }} />}
      {historyOpen && <ConversationHistory conversations={conversations} documents={documents} busy={historyBusy} documentFilter={historyDocumentFilter} onRefresh={loadConversations} onClose={() => setHistoryOpen(false)} onOpen={(conversation, document) => {
        setHistoryOpen(false); setViewer(null); setActiveConversation(conversation); setChatDocuments(documents.filter((item) => conversation.document_ids.includes(item.id))); setChatDocument(document);
      }} />}
      {multiChatOpen && <MultiDocumentChat documents={documents.filter((item) => item.status === "ready")} token={token} onClose={() => setMultiChatOpen(false)} onCreated={(conversation, selected) => {
        setMultiChatOpen(false); setActiveConversation(conversation); setChatDocuments(selected); setChatDocument(selected[0]); loadConversations().catch(() => undefined);
      }} />}
    </main>
  );
}
