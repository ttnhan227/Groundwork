import { Activity, AlertTriangle, ArrowRight, Check, CheckCircle2, Clock3, Download, Eye, FileOutput, FileText, History, ListChecks, MessageCircle, Pencil, PlayCircle, Plus, Redo2, RefreshCw, RotateCcw, Search, ShieldCheck, Sparkles, Trash2, Undo2, Upload, X } from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API, api, authenticatedFetch } from "../../api/client";
import type { AISuggestion, ActivityEvent, DeliverableReadiness, DeliverableRequirement, DeliverableReviewFinding, DocumentComment, DocumentItem, NativeDocument, NativeDocumentVersion, Workspace, WorkspaceSearchResult } from "../../types";

type Section = "deliverables" | "search" | "activity";

function savedSnapshot(title: string, text: string, status: NativeDocument["status"]) {
  return JSON.stringify({ title, text, status });
}

function nativeContentText(content: NativeDocument["content"]) {
  return content.blocks.map((block) => block.type === "heading" ? `# ${block.text}` : block.type === "bullet" ? `• ${block.text}` : block.text).join("\n\n");
}

function documentText(document: NativeDocument) {
  return nativeContentText(document.content);
}

function contentFromText(text: string): NativeDocument["content"] {
  return {
    type: "doc",
    blocks: text.split(/\n\s*\n/).map((value) => value.startsWith("# ")
      ? { type: "heading" as const, text: value.slice(2) }
      : value.startsWith("• ") ? { type: "bullet" as const, text: value.slice(2) }
        : { type: "paragraph" as const, text: value }),
  };
}

export function NativeWorkspace({ token, sources, section, onSection, onOpenSource, onCount, onSourcesChanged, onUploadSource, autoDemo = false, onDemoHandled, studio }: {
  token: string;
  sources: DocumentItem[];
  section: Section;
  onSection: (section: Section) => void;
  onOpenSource: (document: DocumentItem, page?: number, snippet?: string) => void;
  onCount: (count: number) => void;
  onSourcesChanged: () => Promise<void>;
  onUploadSource: () => void;
  autoDemo?: boolean;
  onDemoHandled?: () => void;
  studio: (onGenerated: (document: NativeDocument) => void) => ReactNode;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [documents, setDocuments] = useState<NativeDocument[]>([]);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [active, setActive] = useState<NativeDocument | null>(null);
  const [activityItems, setActivityItems] = useState<ActivityEvent[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showStudio, setShowStudio] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  const refreshDocuments = useCallback(async (current: Workspace) => {
    const items = await api<NativeDocument[]>(`/workspaces/${current.id}/native-documents`, token);
    setDocuments(items); setDocumentsLoaded(true); onCount(items.length);
  }, [onCount, token]);

  useEffect(() => {
    let cancelled = false;
    api<Workspace[]>("/workspaces", token).then(async (items) => {
      if (cancelled || !items[0]) return;
      setWorkspace(items[0]);
      await refreshDocuments(items[0]);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not open workspace"); });
    return () => { cancelled = true; };
  }, [refreshDocuments, token]);

  useEffect(() => {
    if (!workspace || !documentsLoaded || documents.length) return;
    const key = `insightpdf-welcome-viewed:${workspace.id}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    api(`/workspaces/${workspace.id}/events`, token, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "onboarding.welcome_viewed", payload: { surface: "deliverables" } }),
    }).catch(() => undefined);
  }, [documents.length, documentsLoaded, token, workspace]);

  useEffect(() => {
    if (!workspace || section !== "activity") return;
    api<ActivityEvent[]>(`/workspaces/${workspace.id}/activity`, token).then(setActivityItems).catch((reason) => setError(reason.message));
  }, [section, token, workspace]);

  useEffect(() => {
    if (!workspace || section !== "search" || query.trim().length < 2) {
      return;
    }
    const timer = window.setTimeout(() => {
      api<WorkspaceSearchResult[]>(`/workspaces/${workspace.id}/search?q=${encodeURIComponent(query.trim())}`, token)
        .then(setResults).catch((reason) => setError(reason.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, section, token, workspace]);

  async function createDocument() {
    if (!workspace) return;
    setBusy(true); setError("");
    try {
      const created = await api<NativeDocument>(`/workspaces/${workspace.id}/native-documents`, token, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled client report", source_document_ids: sources.filter((item) => item.status === "ready").map((item) => item.id).slice(0, 10) }),
      });
      setDocuments((current) => [created, ...current]);
      onCount(documents.length + 1);
      setActive(created);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create deliverable"); }
    finally { setBusy(false); }
  }

  const createDemo = useCallback(async () => {
    if (!workspace || demoBusy) return;
    setDemoBusy(true); setError("");
    try {
      const created = await api<NativeDocument>(`/workspaces/${workspace.id}/demo`, token, { method: "POST" });
      await Promise.all([refreshDocuments(workspace), onSourcesChanged()]);
      setActive(created);
      onDemoHandled?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the guided demo"); }
    finally { setDemoBusy(false); }
  }, [demoBusy, onDemoHandled, onSourcesChanged, refreshDocuments, token, workspace]);

  useEffect(() => {
    if (!autoDemo || !workspace || demoBusy) return;
    const timer = window.setTimeout(() => createDemo().catch(() => undefined), 0);
    return () => window.clearTimeout(timer);
  }, [autoDemo, createDemo, demoBusy, workspace]);

  async function deleteDocument(item: NativeDocument) {
    if (!window.confirm(`Delete ${item.title}? Its versions and comments will also be removed.`)) return;
    await api(`/native-documents/${item.id}`, token, { method: "DELETE" });
    setDocuments((current) => current.filter((candidate) => candidate.id !== item.id));
    onCount(Math.max(0, documents.length - 1));
  }

  function openGenerated(document: NativeDocument) {
    setDocuments((current) => [document, ...current.filter((item) => item.id !== document.id)]);
    onCount(Math.max(documents.length, documents.some((item) => item.id === document.id) ? documents.length : documents.length + 1));
    setShowStudio(false);
    setActive(document);
  }

  function openResult(result: WorkspaceSearchResult) {
    if (result.kind === "deliverable") {
      const found = documents.find((item) => item.id === result.id);
      if (found) setActive(found);
      return;
    }
    const source = sources.find((item) => item.id === result.document_id);
    if (source) onOpenSource(source, result.page_number ?? 1, result.snippet);
  }

  if (!workspace && !error) return <div className="native-loading"><RefreshCw className="spin" size={22} /><strong>Opening your workspace…</strong></div>;

  return <div className="native-workspace">
    <header className="native-toolbar">
      <div><p className="eyebrow">{workspace?.name ?? "Personal workspace"}</p><h1>{section === "search" ? "Search workspace" : section === "activity" ? "Activity timeline" : "Deliverables"}</h1></div>
      <nav aria-label="Deliverable workspace views">
        <button className={section === "deliverables" ? "active" : ""} onClick={() => onSection("deliverables")}><FileOutput size={14} /> Documents</button>
        <button className={section === "search" ? "active" : ""} onClick={() => onSection("search")}><Search size={14} /> Search</button>
        <button className={section === "activity" ? "active" : ""} onClick={() => onSection("activity")}><Activity size={14} /> Activity</button>
      </nav>
      {section === "deliverables" && <div className="native-toolbar-actions"><button className="native-demo-action" disabled={demoBusy} onClick={createDemo}>{demoBusy ? <RefreshCw className="spin" size={15} /> : <PlayCircle size={15} />} Guided demo</button><button className="native-create" disabled={busy} onClick={createDocument}>{busy ? <RefreshCw className="spin" size={15} /> : <Plus size={15} />} New client report</button></div>}
    </header>
    {error && <div className="form-error">{error}<button aria-label="Dismiss error" onClick={() => setError("")}><X size={13} /></button></div>}

    {section === "search" && <section className="workspace-search-view">
      <label><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, exact terms, and indexed source content" /></label>
      {query.trim().length < 2 ? <div className="native-empty"><Search size={30} /><h2>Search the complete workspace</h2><p>Find sources, page-level evidence, and native deliverables. Semantic research remains available from the Research view.</p></div> : !results.length ? <div className="native-empty"><Search size={30} /><h2>No matching evidence</h2><p>Try a different exact term or use Research for a conceptual question.</p></div> : <div className="workspace-search-results">{results.map((result) => <button key={`${result.kind}:${result.id}`} onClick={() => openResult(result)}><span className={`search-kind ${result.kind}`}>{result.kind === "content" ? <FileText size={15} /> : <FileOutput size={15} />}</span><span><strong>{result.title}</strong><small>{result.kind}{result.page_number ? ` · page ${result.page_number}` : ""}</small><p>{result.snippet}</p></span></button>)}</div>}
    </section>}

    {section === "activity" && <section className="activity-timeline">{!activityItems.length ? <div className="native-empty"><Activity size={30} /><h2>No recorded activity yet</h2><p>Creating, saving, reviewing, commenting, and restoring deliverables will appear here.</p></div> : activityItems.map((item) => <article key={item.id}><span><Activity size={14} /></span><div><strong>{item.event_type.replaceAll(".", " ")}</strong><p>{String(item.payload.title ?? item.payload.name ?? item.payload.revision ?? "Workspace item updated")}</p><time>{new Date(item.created_at).toLocaleString()}</time></div></article>)}</section>}

    {section === "deliverables" && <>
      <section className="native-document-list">
        {!documentsLoaded ? <div className="native-empty"><RefreshCw className="spin" size={24} /><h2>Loading your deliverables</h2></div> : !documents.length ? <div className="deliverable-welcome"><div className="welcome-copy"><span><Sparkles size={14} /> Welcome to InsightPDF</span><h2>Create a source-backed report you can confidently send.</h2><p>Bring a brief and evidence, turn them into a checklist, draft with AI, verify every requirement, then export with an audit trail.</p><div><button onClick={createDocument}><Plus size={14} /> Create your first verified report</button><button className="secondary" disabled={demoBusy} onClick={createDemo}>{demoBusy ? <RefreshCw className="spin" size={14} /> : <PlayCircle size={14} />} {demoBusy ? "Building demo…" : "Try the 2-minute demo"}</button></div></div><ol><li><b>1</b><span><strong>See the complete workflow</strong><small>Two sample sources and a finished Northstar report</small></span></li><li><b>2</b><span><strong>Inspect why it is ready</strong><small>Requirements, evidence snippets, and verification state</small></span></li><li><b>3</b><span><strong>Export with an audit appendix</strong><small>A client document plus its traceable source record</small></span></li></ol></div> : documents.map((item) => <article key={item.id}>
          <button className="native-document-open" onClick={() => setActive(item)}><span><FileOutput size={19} /></span><div><strong>{item.title}</strong><small>Revision {item.revision} · {item.source_document_ids.length} sources · {item.status}</small><time>Updated {new Date(item.updated_at).toLocaleString()}</time></div></button>
          <button className="native-delete" aria-label={`Delete ${item.title}`} onClick={() => deleteDocument(item)}><Trash2 size={14} /></button>
        </article>)}
      </section>
      <section className="document-studio-container"><header><div><strong>AI document studio</strong><span>Choose a real-world template, carry in workspace evidence, preview the result, and continue in the editor.</span></div><button onClick={() => setShowStudio((value) => !value)}>{showStudio ? "Hide studio" : "Create from template"}</button></header>{showStudio && studio(openGenerated)}</section>
    </>}
    {active && <NativeEditor key={`${active.id}:${active.revision}`} document={active} token={token} sources={sources} workspaceId={workspace?.id ?? active.workspace_id} onUploadSource={onUploadSource} onClose={() => setActive(null)} onChanged={(updated) => { setActive(updated); setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item)); }} onOpenSource={onOpenSource} />}
  </div>;
}

function NativeEditor({ document, token, sources, workspaceId, onUploadSource, onClose, onChanged, onOpenSource }: {
  document: NativeDocument;
  token: string;
  sources: DocumentItem[];
  workspaceId: string;
  onUploadSource: () => void;
  onClose: () => void;
  onChanged: (document: NativeDocument) => void;
  onOpenSource: (document: DocumentItem, page?: number, snippet?: string) => void;
}) {
  const [title, setTitle] = useState(document.title);
  const [text, setText] = useState(documentText(document));
  const [status, setStatus] = useState(document.status);
  const [revision, setRevision] = useState(document.revision);
  const [versions, setVersions] = useState<NativeDocumentVersion[]>([]);
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [requirements, setRequirements] = useState<DeliverableRequirement[]>([]);
  const [findings, setFindings] = useState<DeliverableReviewFinding[]>([]);
  const [readiness, setReadiness] = useState<DeliverableReadiness | null>(null);
  const [requirementDraft, setRequirementDraft] = useState("");
  const [reviewFocus, setReviewFocus] = useState("");
  const [reviewBusy, setReviewBusy] = useState<"" | "extract" | "review">("");
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [instruction, setInstruction] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [sourceIds, setSourceIds] = useState(document.source_document_ids);
  const [panel, setPanel] = useState<"requirements" | "sources" | "review" | "versions">("requirements");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "conflict">("saved");
  const [exportFormat, setExportFormat] = useState<"markdown" | "docx" | "pdf">(() => {
    try {
      const value = JSON.parse(localStorage.getItem("insightpdf-preferences") ?? "{}").default_export_format;
      return ["markdown", "docx", "pdf"].includes(value) ? value : "pdf";
    } catch { return "pdf"; }
  });
  const [includeAudit, setIncludeAudit] = useState(true);
  const [showBlockers, setShowBlockers] = useState(false);
  const [compareVersion, setCompareVersion] = useState<NativeDocumentVersion | null>(null);
  const [error, setError] = useState("");
  const currentRevision = useRef(revision);
  const lastSavedSnapshot = useRef(savedSnapshot(document.title, documentText(document), document.status));
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [historyAvailability, setHistoryAvailability] = useState({ undo: false, redo: false });

  function changeText(next: string) {
    undoStack.current.push(text);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setText(next);
    setHistoryAvailability({ undo: true, redo: false });
  }

  function undo() {
    const previous = undoStack.current.pop();
    if (previous === undefined) return;
    redoStack.current.push(text);
    setText(previous);
    setHistoryAvailability({ undo: undoStack.current.length > 0, redo: true });
  }

  function redo() {
    const next = redoStack.current.pop();
    if (next === undefined) return;
    undoStack.current.push(text);
    setText(next);
    setHistoryAvailability({ undo: true, redo: redoStack.current.length > 0 });
  }

  const loadReview = useCallback(async () => {
    const [versionItems, commentItems, suggestionItems, requirementItems, findingItems, readinessItem] = await Promise.all([
      api<NativeDocumentVersion[]>(`/native-documents/${document.id}/versions`, token),
      api<DocumentComment[]>(`/native-documents/${document.id}/comments`, token),
      api<AISuggestion[]>(`/native-documents/${document.id}/suggestions`, token),
      api<DeliverableRequirement[]>(`/native-documents/${document.id}/requirements`, token),
      api<DeliverableReviewFinding[]>(`/native-documents/${document.id}/review-findings`, token),
      api<DeliverableReadiness>(`/native-documents/${document.id}/readiness`, token),
    ]);
    setVersions(versionItems); setComments(commentItems); setSuggestions(suggestionItems);
    setRequirements(requirementItems); setFindings(findingItems); setReadiness(readinessItem);
  }, [document.id, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadReview().catch((reason) => setError(reason.message)), 0);
    return () => window.clearTimeout(timer);
  }, [loadReview]);

  const save = useCallback(async (summary = "Autosaved changes") => {
    setSaveState("saving"); setError("");
    try {
      const updated = await api<NativeDocument>(`/native-documents/${document.id}`, token, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content: contentFromText(text), revision: currentRevision.current, status, change_summary: summary }),
      });
      currentRevision.current = updated.revision;
      lastSavedSnapshot.current = savedSnapshot(title, text, status);
      setRevision(updated.revision); setSaveState("saved"); onChanged(updated);
      loadReview().catch(() => undefined);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Autosave failed";
      setError(message); setSaveState(message.includes("changed elsewhere") ? "conflict" : "unsaved");
    }
  }, [document.id, loadReview, onChanged, status, text, title, token]);

  useEffect(() => {
    if (savedSnapshot(title, text, status) === lastSavedSnapshot.current) return;
    setSaveState("unsaved");
    const timer = window.setTimeout(() => { save().catch(() => undefined); }, 900);
    return () => window.clearTimeout(timer);
  }, [save, status, text, title]);

  async function restore(version: NativeDocumentVersion) {
    const updated = await api<NativeDocument>(`/native-documents/${document.id}/versions/${version.id}/restore`, token, { method: "POST" });
    const restoredText = documentText(updated);
    lastSavedSnapshot.current = savedSnapshot(updated.title, restoredText, updated.status);
    setTitle(updated.title); setText(restoredText); setStatus(updated.status); setRevision(updated.revision); currentRevision.current = updated.revision; onChanged(updated); setSaveState("saved"); await loadReview();
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    await api(`/native-documents/${document.id}/comments`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: comment, anchor: selectedText ? { selected_text: selectedText } : {} }) });
    setComment(""); await loadReview();
  }

  async function track(eventType: string, payload: Record<string, unknown> = {}) {
    await api(`/workspaces/${workspaceId}/events`, token, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: eventType, subject_id: document.id, payload }),
    }).catch(() => undefined);
  }

  async function createSuggestion(value: string, scope = selectedText || text) {
    if (!value.trim() || suggestionBusy) return;
    setSuggestionBusy(true); setError("");
    try {
      await api(`/native-documents/${document.id}/suggestions`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction: value, before_text: scope }) });
      await track("onboarding.writing_action", { action: value.slice(0, 80), scope: selectedText ? "selection" : "document" });
      setInstruction(""); setPanel("review"); await loadReview();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Suggestion failed"); }
    finally { setSuggestionBusy(false); }
  }

  async function requestSuggestion(event: FormEvent) {
    event.preventDefault();
    await createSuggestion(instruction);
  }

  async function addRequirement(event: FormEvent) {
    event.preventDefault();
    if (!requirementDraft.trim()) return;
    setError("");
    try {
      await api(`/native-documents/${document.id}/requirements`, token, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: requirementDraft.trim(), kind: "content", is_required: true, position: requirements.length }),
      });
      setRequirementDraft(""); await loadReview();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add requirement"); }
  }

  async function extractRequirements() {
    setReviewBusy("extract"); setError("");
    try {
      const extracted = await api<DeliverableRequirement[]>(`/native-documents/${document.id}/requirements/extract`, token, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const shouldOutline = !text.trim() && extracted.length > 0;
      if (shouldOutline) {
        const extractedSections = extracted.filter((item) => item.kind === "section").map((item) => item.text
          .replace(/^(include|provide|describe|finish with|add)\s+(an?|the)?\s*/i, "")
          .replace(/[.!:]$/, ""));
        const sections = Array.from(new Set(["Executive summary", ...extractedSections, "Key findings", "Recommendations", "Implementation plan", "Risks and assumptions", "Source notes", "Requirement coverage"]));
        changeText(sections.map((name) => `# ${name}\n\n[Draft this section from linked evidence]`).join("\n\n"));
      }
      await track("onboarding.requirements_extracted", { count: extracted.length, outline_created: shouldOutline });
      await loadReview();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Requirement extraction failed"); }
    finally { setReviewBusy(""); }
  }

  async function updateRequirement(item: DeliverableRequirement, values: Partial<Pick<DeliverableRequirement, "status" | "is_required" | "text" | "kind">>) {
    await api(`/requirements/${item.id}`, token, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values),
    });
    await loadReview();
  }

  async function removeRequirement(item: DeliverableRequirement) {
    await api(`/requirements/${item.id}`, token, { method: "DELETE" });
    await loadReview();
  }

  async function runReview() {
    setReviewBusy("review"); setError("");
    try {
      if (saveState !== "saved") await save("Saved before verification");
      await api(`/native-documents/${document.id}/review`, token, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ focus: reviewFocus }),
      });
      await track("onboarding.verification_completed");
      setPanel("review"); await loadReview();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Verification failed"); }
    finally { setReviewBusy(""); }
  }

  async function decideFinding(finding: DeliverableReviewFinding, action: "accept" | "reject" | "resolve") {
    setError("");
    try {
      await api(`/review-findings/${finding.id}/decision`, token, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (action === "accept") {
        const updated = await api<NativeDocument>(`/native-documents/${document.id}`, token);
        const updatedText = documentText(updated);
        lastSavedSnapshot.current = savedSnapshot(updated.title, updatedText, updated.status);
        setText(updatedText); setTitle(updated.title); setStatus(updated.status); setRevision(updated.revision);
        currentRevision.current = updated.revision; setSaveState("saved"); onChanged(updated);
      }
      await loadReview();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not apply review decision"); }
  }

  async function toggleSource(sourceId: string) {
    const next = sourceIds.includes(sourceId) ? sourceIds.filter((id) => id !== sourceId) : [...sourceIds, sourceId];
    const updated = await api<NativeDocument>(`/native-documents/${document.id}/sources`, token, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document_ids: next }),
    });
    setSourceIds(next); onChanged(updated);
  }

  async function decide(suggestion: AISuggestion, action: "accept" | "reject") {
    await api(`/suggestions/${suggestion.id}/decision`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (action === "accept") {
      const updated = await api<NativeDocument>(`/native-documents/${document.id}`, token);
      const updatedText = documentText(updated);
      lastSavedSnapshot.current = savedSnapshot(updated.title, updatedText, updated.status);
      setText(updatedText); setTitle(updated.title); setStatus(updated.status); setRevision(updated.revision); currentRevision.current = updated.revision; setSaveState("saved"); onChanged(updated);
    }
    await loadReview();
  }

  async function download() {
    const latest = await api<DeliverableReadiness>(`/native-documents/${document.id}/readiness`, token);
    setReadiness(latest);
    if (latest.status !== "ready") {
      setShowBlockers(true);
      await track("onboarding.export_blocked", { blockers: latest.blockers });
      return;
    }
    const response = await authenticatedFetch(`${API}/native-documents/${document.id}/export?format=${exportFormat}&include_audit=${includeAudit}`, token);
    if (!response.ok) throw new Error("Export failed");
    const url = URL.createObjectURL(await response.blob());
    const link = window.document.createElement("a"); link.href = url; link.download = `${title}.${exportFormat === "markdown" ? "md" : exportFormat}`; link.click(); URL.revokeObjectURL(url);
    await track("onboarding.first_export", { format: exportFormat, audit: includeAudit });
  }

  const linkedSources = useMemo(() => sources.filter((source) => sourceIds.includes(source.id)), [sourceIds, sources]);
  const draftSections = useMemo(() => Array.from(text.matchAll(/^#+\s+(.+)$/gm)).map((match) => match[1].trim()), [text]);
  const verificationRun = Boolean(readiness && !readiness.blockers.includes("Run whole-deliverable verification"));
  const guideSteps = [
    { label: "Link evidence", done: sourceIds.length > 0, panel: "sources" as const },
    { label: "Extract requirements", done: requirements.length > 0, panel: "requirements" as const },
    { label: "Generate draft", done: Boolean(text.trim()), panel: "sources" as const },
    { label: "Run verification", done: verificationRun, panel: "review" as const },
    { label: "Fix findings", done: verificationRun && (readiness?.open_findings ?? 1) === 0, panel: "review" as const },
    { label: "Export", done: readiness?.status === "ready", panel: "review" as const },
  ];
  const nextStep = guideSteps.find((step) => !step.done);

  function jumpToSection(sectionName: string) {
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`^#+\\s+${escaped}\\s*$`, "im").exec(text);
    if (!match || !textAreaRef.current) return "";
    const following = text.slice(match.index + match[0].length).search(/\n#+\s+/);
    const end = following < 0 ? text.length : match.index + match[0].length + following;
    textAreaRef.current.focus();
    textAreaRef.current.setSelectionRange(match.index, end);
    const sectionText = text.slice(match.index, end);
    setSelectedText(sectionText);
    return sectionText;
  }

  return <div className="native-editor-wrap" role="dialog" aria-modal="true" aria-label={`Edit ${document.title}`}>
    <button className="history-backdrop" aria-label="Close editor" onClick={onClose} />
    <section className="native-editor">
      <header><div className="native-editor-title"><input aria-label="Document title" value={title} onChange={(event) => setTitle(event.target.value)} /><span className={saveState}>{saveState === "saving" ? <RefreshCw className="spin" size={12} /> : saveState === "saved" ? <Check size={12} /> : <Clock3 size={12} />}{saveState} · revision {revision}</span></div><div><select aria-label="Document status" value={status} onChange={(event) => setStatus(event.target.value as NativeDocument["status"])}><option value="draft">Draft</option><option value="review">In review</option><option value="complete">Complete</option></select><button onClick={() => save("Manual save")}><Check size={14} /> Save</button><select aria-label="Export format" value={exportFormat} onChange={(event) => setExportFormat(event.target.value as typeof exportFormat)}><option value="pdf">PDF</option><option value="docx">Word</option><option value="markdown">Markdown</option></select><label className="audit-toggle" title="Append requirements and source evidence"><input type="checkbox" checked={includeAudit} onChange={(event) => setIncludeAudit(event.target.checked)} /> Audit</label><button className={readiness?.status === "ready" ? "" : "export-blocked"} onClick={download}><Download size={14} /> {readiness?.status === "ready" ? "Export" : "Export locked"}</button><button aria-label="Close native editor" onClick={onClose}><X size={16} /></button></div></header>
      <div className="native-editor-notices">
        {readiness && <div className={`deliverable-readiness ${readiness.status}`}>
          <span className="readiness-state">{readiness.status === "ready" ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}<strong>{readiness.status === "ready" ? "Ready to export" : readiness.status === "setup_needed" ? "Set up verification" : "Needs review"}</strong></span>
          <span><b>{readiness.required_covered}/{readiness.requirements_required}</b> required covered</span>
          <span><b>{readiness.unsupported_claims}</b> unsupported claims</span>
          <span><b>{readiness.open_findings}</b> open findings</span>
          <span><b>{readiness.sources_used}/{readiness.sources_linked}</b> sources used</span>
        </div>}
        <section className="readiness-guide" aria-label="Ready-to-send workflow">
          <div className="readiness-guide-steps">{guideSteps.map((step, index) => <button className={step.done ? "done" : nextStep === step ? "current" : ""} key={step.label} onClick={() => setPanel(step.panel)}><span>{step.done ? <Check size={12} /> : index + 1}</span><small>{step.label}</small></button>)}</div>
          {nextStep ? <button className="next-best-action" onClick={() => { setPanel(nextStep.panel); track("onboarding.next_action_clicked", { step: nextStep.label }).catch(() => undefined); }}>{nextStep.label}<ArrowRight size={13} /></button> : <span className="workflow-complete"><ShieldCheck size={13} /> Ready to send</span>}
        </section>
        {readiness && readiness.status !== "ready" && showBlockers && <section className="export-blocker-panel"><header><AlertTriangle size={15} /><div><strong>Export is locked</strong><span>Resolve these checks so the ready-to-send label stays trustworthy.</span></div><button aria-label="Hide export blockers" onClick={() => setShowBlockers(false)}><X size={13} /></button></header><ul>{readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul><button onClick={() => setPanel(nextStep?.panel ?? "review")}>Go to next required step <ArrowRight size={13} /></button></section>}
        {error && <div className="native-editor-error">{error}{saveState === "conflict" && <button onClick={() => window.location.reload()}>Reload latest</button>}</div>}
      </div>
      <div className="native-editor-layout">
        <main><div className="native-format-bar"><button title="Undo (Ctrl/Cmd+Z)" disabled={!historyAvailability.undo} onClick={undo}><Undo2 size={13} /> Undo</button><button title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!historyAvailability.redo} onClick={redo}><Redo2 size={13} /> Redo</button><button onClick={() => changeText(`${text}\n\n# New section`)}>Heading</button><button onClick={() => changeText(`${text}\n\n• Item`)}>Bullet</button><span>{selectedText ? `${selectedText.length} characters selected for section-level AI` : "Select text for section-level AI or comments."}</span></div><textarea ref={textAreaRef} aria-label="Document content" value={text} onChange={(event) => changeText(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); } }} onSelect={(event) => { const target = event.currentTarget; setSelectedText(target.value.slice(target.selectionStart, target.selectionEnd)); }} placeholder="Write the report here…" /></main>
        <aside><nav><button className={panel === "requirements" ? "active" : ""} onClick={() => setPanel("requirements")}><ListChecks size={13} /> Brief</button><button className={panel === "sources" ? "active" : ""} onClick={() => setPanel("sources")}><FileText size={13} /> Evidence</button><button className={panel === "review" ? "active" : ""} onClick={() => setPanel("review")}><ShieldCheck size={13} /> Verify</button><button className={panel === "versions" ? "active" : ""} onClick={() => setPanel("versions")}><History size={13} /> Versions</button></nav>
          {panel === "requirements" && <div className="native-side-content requirements-panel">
            <div className="side-heading"><div><small>STEP 1</small><h3>Acceptance checklist</h3></div><button disabled={reviewBusy === "extract" || !linkedSources.length} onClick={extractRequirements}>{reviewBusy === "extract" ? <RefreshCw className="spin" size={12} /> : <Sparkles size={12} />} Extract from brief</button></div>
            <p className="side-explainer">Make the brief testable before drafting. AI-extracted items stay separate from anything you add manually.</p>
            {!requirements.length && <div className="workflow-empty"><ListChecks size={24} /><strong>No requirements yet</strong><span>Link a client brief under Evidence, then extract its requirements or add one below.</span></div>}
            <div className="requirement-list requirement-table"><header><span>Status</span><span>Requirement and evidence</span><span>Draft section</span></header>{requirements.map((item) => <article className={`requirement-row ${item.status}`} key={item.id}>
              <button className="requirement-check" aria-label={`${item.status === "covered" ? "Mark pending" : "Mark covered"}: ${item.text}`} onClick={() => updateRequirement(item, { status: item.status === "covered" ? "pending" : "covered" })}>{item.status === "covered" ? <Check size={12} /> : item.status === "partial" ? <span>½</span> : null}</button>
              <div className="requirement-main"><span><em className={`coverage-status ${item.status}`}>{item.status === "pending" ? "missing" : item.status}</em><em>{item.kind}</em>{item.origin === "ai" && <em>brief</em>}{!item.is_required && <em>optional</em>}</span><p>{item.text}</p>{item.evidence.map((citation, index) => { const source = sources.find((value) => value.id === citation.document_id); return <details className="evidence-snippet" key={`${citation.document_id}-${index}`}><summary>{citation.document_name || source?.filename || "Brief"} · p{citation.page_number}</summary><mark>{citation.snippet || "Open the cited page to inspect the exact supporting text."}</mark><button onClick={() => source && onOpenSource(source, citation.page_number, citation.snippet)}>Open highlighted source <ArrowRight size={11} /></button></details>; })}</div>
              <div className="requirement-sections">{(item.linked_sections ?? []).length ? item.linked_sections.map((sectionName) => <button key={sectionName} onClick={() => jumpToSection(sectionName)}><Eye size={11} /> {sectionName}</button>) : <small>Not linked yet</small>}</div>
              <button className="requirement-delete" aria-label={`Delete requirement: ${item.text}`} onClick={() => removeRequirement(item)}><Trash2 size={12} /></button>
            </article>)}</div>
            <form onSubmit={addRequirement}><label>Add a requirement<textarea value={requirementDraft} onChange={(event) => setRequirementDraft(event.target.value)} placeholder="Example: Include a one-page executive summary for the client" /></label><button disabled={!requirementDraft.trim()}><Plus size={13} /> Add to checklist</button></form>
          </div>}
          {panel === "sources" && <div className="native-side-content evidence-writing-panel">
            <div className="side-heading"><div><small>STEP 2</small><h3>Brief and evidence pack</h3></div><button onClick={onUploadSource}><Upload size={12} /> Add source</button></div>
            <p className="side-explainer">Only checked files are available to writing and verification. Open a source to inspect its exact pages.</p>
            {sources.filter((source) => source.status === "ready").map((source) => <div className="linked-source-row" key={source.id}><label><input type="checkbox" checked={sourceIds.includes(source.id)} onChange={() => toggleSource(source.id)} /><span><strong>{source.display_title || source.filename}</strong><small>{source.page_count ?? "—"} pages · {sourceIds.includes(source.id) ? "in context" : "not used"}</small></span></label><button aria-label={`Open ${source.display_title || source.filename}`} onClick={() => onOpenSource(source)}><FileText size={13} /></button></div>)}
            {!sources.some((source) => source.status === "ready") && <div className="workflow-empty"><FileText size={24} /><strong>No ready evidence yet</strong><span>Upload the client brief and research files. You can keep working while they are indexed.</span><button onClick={onUploadSource}><Upload size={13} /> Upload evidence</button></div>}
            <section className="smart-writing-actions"><header><small>STEP 3</small><h3>Write with guided AI</h3><p>Choose an outcome. InsightPDF supplies the grounding and formatting instructions.</p></header><div>{[
              ["Draft complete report", "Draft a complete client-ready report from the acceptance checklist and linked evidence. Use clear Markdown headings, preserve uncertainty, and add inline source markers for factual and numeric claims."],
              ["Executive summary", "Draft a concise one-page executive summary for leadership using only linked evidence and explicit source markers."],
              ["30/60/90 plan", "Draft a practical 30/60/90-day implementation plan grounded in the linked evidence. Distinguish evidence from recommendations."],
              ["Consulting style", "Rewrite the selected section or current draft in a polished consulting style: answer-first headings, concise evidence, implications, and specific recommendations."],
              ["Internal memo", "Rewrite the selected section or current draft as a concise internal decision memo with context, decision, rationale, risks, and next actions."],
            ].map(([label, prompt]) => <button key={label} disabled={suggestionBusy || !linkedSources.length} onClick={() => createSuggestion(prompt)}>{suggestionBusy ? <RefreshCw className="spin" size={12} /> : <Sparkles size={12} />}{label}</button>)}</div>
              {!!draftSections.length && <details><summary>Improve one section</summary><div className="section-action-list">{draftSections.map((sectionName) => <button key={sectionName} disabled={suggestionBusy} onClick={() => { const scope = jumpToSection(sectionName); createSuggestion(`Improve the ${sectionName} section using only linked evidence. Make it specific, visually scannable, and client-ready.`, scope).catch(() => undefined); }}><Pencil size={11} /> {sectionName}</button>)}</div></details>}
            </section>
            <details className="custom-writing-instruction"><summary>Write a custom instruction</summary><form onSubmit={requestSuggestion}><label>What should change?<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Example: Tighten the selected recommendation and preserve its citation" /></label><small>Scope: {selectedText ? "selected section" : "current document"} · {linkedSources.length} linked sources</small><button disabled={suggestionBusy || !instruction.trim()}>{suggestionBusy ? <RefreshCw className="spin" size={14} /> : <Sparkles size={14} />} {suggestionBusy ? "Writing from evidence…" : "Create reviewable revision"}</button></form></details>
          </div>}
          {panel === "review" && <div className="native-side-content verification-panel">
            <div className="side-heading"><div><small>STEP 4</small><h3>Verify before export</h3></div></div>
            <p className="side-explainer">Check every requirement and factual claim against the linked evidence. Changes stay reviewable and create a new version when applied.</p>
            <label className="review-focus">Optional review focus<input value={reviewFocus} onChange={(event) => setReviewFocus(event.target.value)} placeholder="Example: budget claims and executive tone" /></label>
            <button className="run-verification" disabled={reviewBusy === "review" || !requirements.length || !text.trim()} onClick={runReview}>{reviewBusy === "review" ? <RefreshCw className="spin" size={13} /> : <ShieldCheck size={13} />} Run verification</button>
            {!text.trim() && <small className="verification-prerequisite">Write or apply a draft before verification.</small>}
            <h3 className="section-divider">Verification findings</h3>
            {!findings.length && <div className="workflow-empty"><ShieldCheck size={24} /><strong>No verification run yet</strong><span>Run verification after drafting to find missing requirements and unsupported claims.</span></div>}
            {findings.map((finding) => <article className={`verification-finding ${finding.severity} ${finding.status}`} key={finding.id}>
              <header><span>{finding.kind.replaceAll("_", " ")}</span><em>{finding.claim_type.replaceAll("_", " ")}</em><em>{finding.severity}</em><small>{finding.status}</small></header>
              <p>{finding.explanation}</p>
              {finding.claim_text && <blockquote>{finding.claim_text}</blockquote>}
              {finding.proposed_text && <div className="proposed-fix"><small>PROPOSED REVISION</small><p>{finding.proposed_text}</p></div>}
              <div className="finding-citations">{finding.citations.map((citation, index) => { const source = sources.find((item) => item.id === citation.document_id); return <details className="evidence-snippet" key={index}><summary>{citation.document_name || source?.filename || "Source"} · p{citation.page_number}</summary><mark>{citation.snippet || "Open the cited page to inspect the evidence."}</mark><button onClick={() => source && onOpenSource(source, citation.page_number, citation.snippet)}>Open highlighted source <ArrowRight size={11} /></button></details>; })}</div>
              {finding.status === "open" && <footer><button onClick={() => decideFinding(finding, finding.proposed_text ? "reject" : "resolve")}>{finding.proposed_text ? "Reject" : "Mark resolved"}</button>{finding.proposed_text && <button onClick={() => decideFinding(finding, "accept")}><CheckCircle2 size={12} /> Apply revision</button>}</footer>}
            </article>)}
            <details className="secondary-review"><summary>Targeted AI suggestions ({suggestions.length})</summary><div><form onSubmit={requestSuggestion}><label>Instruction<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Make this concise and preserve cited evidence" /></label><small>Scope: {selectedText ? "selected text" : "current document"} · {linkedSources.length} linked sources</small><button disabled={suggestionBusy || !instruction.trim()}>{suggestionBusy ? <RefreshCw className="spin" size={14} /> : <Sparkles size={14} />} {suggestionBusy ? "Writing…" : "Create suggestion"}</button></form>{suggestions.map((suggestion) => <article className={`suggestion-card ${suggestion.status}`} key={suggestion.id}><small>{suggestion.status}</small><strong>{suggestion.instruction}</strong><p>{suggestion.proposed_text}</p>{suggestion.status === "pending" && <div><button onClick={() => decide(suggestion, "reject")}><X size={12} /> Reject</button><button onClick={() => decide(suggestion, "accept")}><CheckCircle2 size={12} /> Apply</button></div>}</article>)}</div></details>
            <details className="secondary-review"><summary>Comments ({comments.filter((item) => item.status === "open").length} open)</summary><div>{comments.map((item) => <article className="comment-card" key={item.id}><strong>{item.status}</strong><p>{item.body}</p>{item.status === "open" && <button onClick={async () => { await api(`/comments/${item.id}/resolve`, token, { method: "POST" }); await loadReview(); }}>Resolve</button>}</article>)}<form onSubmit={addComment}><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={selectedText ? "Comment on selected text" : "Add a document comment"} /><button disabled={!comment.trim()}><MessageCircle size={13} /> Add comment</button></form></div></details>
          </div>}
          {panel === "versions" && <div className="native-side-content versions-panel"><div className="side-heading"><div><small>Immutable history</small><h3>Before and current</h3></div></div><p className="side-explainer">Compare any saved version with the current draft before restoring it.</p>{compareVersion && <section className="version-comparison"><header><strong>What changed</strong><button onClick={() => setCompareVersion(null)}><X size={12} /> Close</button></header><p>{compareVersion.change_summary || "Saved document changes"}</p><div><article><small>VERSION {compareVersion.version_number}</small><pre>{nativeContentText(compareVersion.content)}</pre></article><article><small>CURRENT · REVISION {revision}</small><pre>{text}</pre></article></div></section>}{versions.map((version) => <article className="version-row" key={version.id}><span><strong>Version {version.version_number}</strong><small>{version.change_summary || "Saved changes"}</small><time>{new Date(version.created_at).toLocaleString()}</time></span><div>{version.version_number !== revision && <button onClick={() => setCompareVersion(version)}><Eye size={12} /> Compare</button>}{version.version_number !== revision && <button onClick={() => restore(version)}><RotateCcw size={12} /> Restore</button>}</div></article>)}</div>}
        </aside>
      </div>
    </section>
  </div>;
}
