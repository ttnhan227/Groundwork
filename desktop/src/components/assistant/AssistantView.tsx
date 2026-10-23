import { ShieldCheck, ShieldAlert } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { api, waitForJob, previewFile } from "../../services/api";
import { useSelection } from "../../services/selection";
import type { AIQueryResponse } from "../../types/api";
import { Button, Card, InlineCitationChip } from "../ui";
import { LoadingState } from "../ui/LoadingState";
import { LocalAISetup } from "./LocalAISetup";

export function AssistantView({
  initialQuestion = "",
  requestId = 0,
  compact = false,
  savedSummary = "",
  focusedLine = 1,
  collectionId,
  collectionName,
  onClearCollection,
}: {
  initialQuestion?: string;
  requestId?: number;
  compact?: boolean;
  savedSummary?: string;
  focusedLine?: number;
  collectionId?: string;
  collectionName?: string;
  onClearCollection?: () => void;
}) {
  const { selected, setSelected, navigate } = useSelection();
  const [editingQuestion, setEditingQuestion] = useState(false);
  const [question, setQuestion] = useState(initialQuestion);
  const [provider, setProvider] = useState("local");
  const [providerReady, setProviderReady] = useState(false);
  const [providerLoading, setProviderLoading] = useState(true);
  const [builtinReady, setBuiltinReady] = useState(false);
  const submitting = useRef(false);
  const saving = useRef(false);
  const answerCard = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [providers, setProviders] = useState<
    { id: string; name: string; is_local: boolean }[]
  >([]);
  const [answer, setAnswer] = useState<AIQueryResponse>();
  const [answerQuestion, setAnswerQuestion] = useState("");
  const [answerScope, setAnswerScope] = useState("");
  const currentScope = JSON.stringify({paths: [...selected].sort(), collection: collectionId || null});
  const currentAnswer = answerScope === currentScope && answerQuestion.trim() === question.trim();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy && answer && currentAnswer) requestAnimationFrame(() => answerCard.current?.scrollIntoView({block: "start", behavior: "smooth"}));
  }, [busy, answer]);
  const [error, setError] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  useEffect(() => { setQuestion(initialQuestion); }, [initialQuestion]);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("groundwork-last-answer");
      if (saved) {
        setAnswer(JSON.parse(saved));
        setAnswerQuestion(sessionStorage.getItem("groundwork-answer-question") || "Saved file answer");
        setAnswerScope(sessionStorage.getItem("groundwork-answer-scope") || "");
        if (!initialQuestion && sessionStorage.getItem('groundwork-answer-scope') === currentScope) setQuestion(sessionStorage.getItem('groundwork-answer-question') || '');
      }
    } catch {
      /* A damaged local draft should not block the assistant. */
    }
    let active = true;
    Promise.all([api.listProviders(), api.localAIStatus().catch(() => null)])
      .then(([values, status]) => {
        if (!active) return;
        const ready = Boolean(status?.supported && status.models.some(model => model.installed && model.id === status.selected));
        setBuiltinReady(ready);
        setProviders(values.filter(p => ["local", "builtin"].includes(p.id) || p.active));
        const preferred = values.find(p => p.active && p.id !== "local" && (p.id !== "builtin" || ready));
        setProvider(preferred?.id || (ready ? "builtin" : "local"));
        setProviderReady(true); setProviderLoading(false);
      }).catch(() => { if (active) { setError("Couldn't load answer choices. Retry by reopening Assistant."); setProviderReady(false); setProviderLoading(false); } });
    const previous = sessionStorage.getItem("groundwork-assistant-job");
    if (previous) {
      setBusy(true);
      api
        .assistantJob<AIQueryResponse>(previous)
        .then(waitForJob)
        .then((result) => {
          sessionStorage.setItem(
            "groundwork-last-answer",
            JSON.stringify(result),
          );
          setAnswer(result);
          const scope = sessionStorage.getItem('groundwork-pending-scope') || '';
          setAnswerScope(scope); sessionStorage.setItem('groundwork-answer-scope', scope);
          if (scope === currentScope) setQuestion(sessionStorage.getItem('groundwork-pending-question') || '');
          setAnswerQuestion(sessionStorage.getItem("groundwork-pending-question") || "Saved file answer");
          sessionStorage.setItem("groundwork-answer-question", sessionStorage.getItem("groundwork-pending-question") || "Saved file answer");
        })
        .catch((e) => setError(e.message))
        .finally(() => {
          setBusy(false);
          sessionStorage.removeItem("groundwork-assistant-job");
        });
    }
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!showSetup) return;
    let active = true;
    const refresh = async () => {
      const status = await api.localAIStatus().catch(() => null);
      if (!active || !status) return;
      const ready = status.supported && status.models.some(model => model.installed && model.id === status.selected);
      setBuiltinReady(ready);
      if (ready) setProvider("builtin");
    };
    void refresh();
    const timer = setInterval(refresh, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [showSetup]);
  const ask = async (text: string) => {
    if (submitting.current || busy || !providerReady || !text.trim() || selected.length > 6 || (provider === "builtin" && !builtinReady)) return;
    submitting.current = true;
    setEditingQuestion(false);
    setSaved(false);
    setError("");
    setBusy(true);
    setQuestion(text);
    try {
      const job = await api.startQuestion(text, selected, provider, !selected.length, selected.length ? focusedLine : 1, collectionId);
      sessionStorage.setItem("groundwork-assistant-job", job.id);
      sessionStorage.setItem("groundwork-pending-question", text);
      sessionStorage.setItem('groundwork-pending-scope', currentScope);
      const result = await waitForJob(job);
      sessionStorage.setItem("groundwork-last-answer", JSON.stringify(result));
      setAnswer(result);
      setAnswerQuestion(text);
      setAnswerScope(currentScope); sessionStorage.setItem('groundwork-answer-scope', currentScope);
      sessionStorage.setItem("groundwork-answer-question", text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write an answer.");
    } finally {
      submitting.current = false;
      setBusy(false);
      sessionStorage.removeItem("groundwork-assistant-job");
    }
  };
  useEffect(() => {
    if (!requestId || !providerReady || providerLoading || busy) return;
    const key = "groundwork-last-question-request";
    if (sessionStorage.getItem(key) === String(requestId)) return;
    sessionStorage.setItem(key, String(requestId));
    void ask(initialQuestion);
  }, [requestId, providerReady, providerLoading, busy]);
  return (
    <div className="gw-page assistant-page max-w-4xl" style={{ alignSelf: "flex-start" }}>
      {!compact && <><div><h1 className="gw-title">Ask your files</h1></div><p className="workflow-intro">Find an answer in your files. You can check the evidence before relying on it.</p></>}
      {providerLoading && <LoadingState title="Preparing Assistant" detail="Checking available AI models…"/>}
      {showSetup && <LocalAISetup />}
      {savedSummary && (
        <Card className="space-y-2">
          <h2 className="font-semibold">Saved findings</h2>
          <p className="text-sm">
            These findings were saved earlier. Review your selection and ask
            again to check current file contents.
          </p>
          <div className="whitespace-pre-wrap">{savedSummary}</div>
        </Card>
      )}
      {(!compact || !answer || !currentAnswer || busy || editingQuestion) && <Card className="space-y-4 assistant-question-card">
        <p className="assistant-scope">{collectionId ? `Using: ${collectionName}` : selected.length ? `Using ${selected.length} selected ${selected.length === 1 ? "file" : "files"}` : "Searching your added folders"}</p>
        {collectionId && <div className="gw-notice"><p>Searching only “{collectionName}”. Up to six matching files are read.</p><Button disabled={busy} onClick={onClearCollection}>Search all added locations instead</Button></div>}
        <label className="block">
          Your question
          <textarea
            className="gw-input mt-2 min-h-20"
            value={question}
            maxLength={2000}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault(); void ask(question);
              }
            }}
            placeholder="Summarize these files, or ask a question about them"
          />
        </label>
        <p className="text-xs text-ink-tertiary">Ctrl+Enter to ask · Enter for a new line</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary" isLoading={busy}
            disabled={
              busy ||
              !providerReady ||
              (provider === "builtin" && !builtinReady) ||
              selected.length > 6 ||
              !question.trim()
            }
            onClick={() => ask(question)}
          >
            {busy ? "Working…" : selected.length ? "Ask selected files" : "Find and answer"}
          </Button>
          <Button
            disabled={busy || !providerReady || !selected.length || selected.length > 6 || (provider === "builtin" && !builtinReady)}
            onClick={() =>
              ask(
                "Summarize each selected file. Explain its purpose and cite supporting passages.",
              )
            }
          >
            Summarize
          </Button>
          <Button
            disabled={busy || !providerReady || !selected.length || selected.length > 6 || (provider === "builtin" && !builtinReady)}
            onClick={() =>
              ask(
                "Describe each selected file and suggest a few useful tags. Cite evidence and distinguish facts from guesses.",
              )
            }
          >
            Describe & tags
          </Button>
          {selected.length > 1 && (
            <Button
              disabled={busy || !providerReady || selected.length > 6 || (provider === "builtin" && !builtinReady)}
              onClick={() =>
                ask(
                  "Compare the selected files. Explain agreements, differences, and conflicting dates or decisions. Cite each finding and say when the excerpts are insufficient.",
                )
              }
            >
              Compare files
            </Button>
          )}
          {!selected.length && !collectionId && (
            <>
              <Button
                size="xs"
                disabled={busy || !providerReady || (provider === "builtin" && !builtinReady)}
                onClick={() => ask("What is taking up the most disk space across my folders?")}
              >
                Analyze disk space
              </Button>
              <Button
                size="xs"
                disabled={busy || !providerReady || (provider === "builtin" && !builtinReady)}
                onClick={() => ask("Find duplicate files and safe cleanup candidates.")}
              >
                Find duplicates & cleanup
              </Button>
              <Button
                size="xs"
                disabled={busy || !providerReady || (provider === "builtin" && !builtinReady)}
                onClick={() => ask("List my installed applications sorted by size.")}
              >
                Inspect installed apps
              </Button>
            </>
          )}
        </div>
        {busy && <div className="assistant-progress"><LoadingState title="Working on your question" detail={provider === "local" ? "Finding matching passages in your files…" : "Reading the evidence and preparing an answer. You can keep browsing."} skeleton elapsed/>{provider === "builtin" && <Button onClick={() => api.localAIAction("cancel-answer").catch(e => setError(e.message))}>Cancel local answer</Button>}</div>}
        <details className="assistant-file-scope"><summary>Files being used ({selected.length})</summary>
        {!selected.length && !collectionId && (
          <p>
            Ask a question to find relevant passages across your added locations,
            or choose files to keep the answer focused. Up to six relevant files
            are read; this does not scan files outside your added locations.
          </p>
        )}
        <ul className="space-y-1 text-sm max-h-32 overflow-auto">
          {selected.map((path) => (
            <li key={path} className="flex gap-2 items-center">
              <span className="truncate flex-1" title={path}>{path.split(/[\\/]/).pop()}</span>
              <Button
                variant="ghost"
                onClick={() =>
                  setSelected((values) => values.filter((v) => v !== path))
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        </details>
        <details className="assistant-settings">
          <summary>AI and privacy options</summary>
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => navigate("folders")}>Choose files</Button>
              {selected.length === 1 && (
                <Button onClick={() => previewFile(selected[0])}>Preview selected file</Button>
              )}
              <Button disabled={!selected.length} onClick={() => navigate("organize")}>
                Organize selection
              </Button>
              <Button onClick={() => setShowSetup(!showSetup)}>Set up built-in AI</Button>
            </div>

            <div className="text-xs text-[var(--ink-secondary)] leading-relaxed bg-[var(--paper-subtle)] p-3 rounded-[var(--radius-xs)] border border-[var(--hairline)]">
              <strong className="block text-[var(--ink)] mb-1">What AI can read:</strong>
              AI can read text, PDF, Word, Excel, PowerPoint, OpenDocument, and EPUB files.
              On Windows it can recognize written text in images and up to five scanned PDF pages.
              It uses bounded excerpts from up to six sources. Folder questions include a small sample of direct files.
              Unsupported formats provide file details only. It does not interpret image scenes or transcribe audio/video.
              Plain text is limited to 5 MB; documents and images to 32 MB. Answers and OCR may be mistaken; check the evidence labels.
            </div>

            <label className="block text-sm">
              Answer with
              <select
                aria-label="Answer provider"
                className="gw-input mt-1"
                value={provider}
                disabled={busy || !providerReady}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="builtin" disabled={!builtinReady}>
                  Built-in AI {builtinReady ? "(this computer)" : "(model setup needed)"}
                </option>
                {providers
                  .filter((p) => p.id !== "builtin")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </details>
        {provider === "local" && (
          <div className="gw-notice flex flex-wrap items-center justify-between gap-2">
            <span>Matching passages mode works now, offline. It finds evidence but does not generate an AI answer. Set up a local model or configure an online provider for summaries and comparisons.</span>
            <Button size="xs" onClick={() => setShowSetup(true)}>Enable AI answers</Button>
          </div>
        )}

        {providers.find((p) => p.id === provider)?.is_local === false && (
          <p className="gw-notice">
            Sending a question shares your question, file names and
            readable excerpts, recognized image text, or file details from the selection or up to six matching or nearby files with this cloud provider. Folder questions also share a bounded folder listing. Other files are not
            sent.
          </p>
        )}
        {selected.length > 6 && <p role="alert">Choose up to six files for one answer.</p>}
      </Card>}
      {compact && answer && currentAnswer && !busy && !editingQuestion && <Button onClick={() => setEditingQuestion(true)}>Ask a follow-up</Button>}
      {error && (
        <p role="alert" className="gw-notice">
          {error}
        </p>
      )}
      {answer && !busy && (
        <Card className="space-y-4 assistant-answer-card">
            <div ref={answerCard} aria-hidden="true" />
          <span className="workflow-eyebrow">{error || !currentAnswer ? "PREVIOUS ANSWER" : "ANSWER READY"}</span>
          <p className="text-sm font-semibold">{answerQuestion}</p>
          <p className="text-xs text-[var(--ink-secondary)]">{answer.provider_used === "offline" ? "Retrieved passages · no generated answer" : `Answer provider: ${answer.provider_used}`} · {answer.evidence_count} sources read</p>
          <div className="p-2.5 rounded-[var(--radius-sm)] bg-[var(--paper-subtle)] border border-[var(--hairline)] space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                {answer.citation_verification ? (
                  answer.citation_verification.grounded ? (
                    <span className="flex items-center gap-1 text-[var(--success)] font-semibold">
                      <ShieldCheck size={14} /> Citation Verifier: 100% Grounded
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[var(--warning)] font-semibold">
                      <ShieldAlert size={14} /> Citations: {answer.citation_verification.invalid_citations} unverified claim(s)
                    </span>
                  )
                ) : (
                  <span className="flex items-center gap-1 text-[var(--ink-blue)] font-semibold">
                    <ShieldCheck size={14} /> Grounded Sources
                  </span>
                )}
                {answer.citation_verification && (
                  <span className="text-[var(--ink-muted)] text-[11px]">
                    ({answer.citation_verification.valid_citations}/{answer.citation_verification.total_citations} verified)
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--paper)] border border-[var(--hairline)] text-[var(--ink-secondary)]" title="Hybrid lexical BM25 (SQLite FTS5) + dense vector (all-MiniLM-L6-v2 ONNX)">
                  Hybrid: BM25 + ONNX 384d
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--paper)] border border-[var(--hairline)] text-[var(--ink-secondary)]" title="Code chunks split along Python AST function and class syntax boundaries">
                  AST Semantic Chunks
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--paper)] border border-[var(--hairline)] text-[var(--success)]" title="Processed on CPU locally without cloud data egress">
                  100% On-Device
                </span>
              </div>
            </div>
            {answer.citation_verification?.unsupported_claims_warning && (
              <p className="text-[11px] text-[var(--warning)] leading-snug">
                Warning: Some generated statements could not be verified against the retrieved source chunks.
              </p>
            )}
          </div>
          <AnswerText text={answer.answer} />
          {answer.suggested_actions && answer.suggested_actions.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {answer.suggested_actions.map((act, idx) => (
                <Button
                  key={idx}
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    const view = typeof act.view === "string" ? act.view : "";
                    if (act.action === "navigate" && view) navigate(view);
                  }}
                >
                  {String(act.label || "Open tool")}
                </Button>
              ))}
            </div>
          )}
          {answer.citations.length > 0 && <Button onClick={() => {setEditingQuestion(true); setSelected(answer.citations.map(source => source.path));}}>Use these sources for a follow-up</Button>}
            <h3 className="font-serif font-bold text-sm text-[var(--ink)] mt-4">Evidence used</h3>
          <div className="grid grid-cols-1 gap-2.5">
            {answer.citations.map((source, i) => (
              <div
                key={i}
                className="p-3 rounded-[var(--radius-sm)] bg-[var(--paper-subtle)] border border-[var(--hairline)] hover:border-[var(--ink-blue)] transition-all"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <InlineCitationChip
                      index={i + 1}
                      citation={{
                        file_path: source.path,
                        line_start: source.line_start || 1,
                        line_end: source.line_end || undefined,
                        snippet: source.snippet,
                      }}
                      onOpenFile={(p, l) => previewFile(p, l || 1)}
                    />
                    <button
                      type="button"
                      onClick={() => previewFile(source.path, source.line_start || 1)}
                      className="font-medium text-xs text-[var(--ink)] hover:text-[var(--ink-blue)] hover:underline truncate text-left cursor-pointer"
                    >
                      {source.filename} · {source.evidence_kind === "metadata" ? "File details only" : source.evidence_kind === "folder" ? "Folder listing" : source.evidence_kind === "ocr" ? "Recognized image text" : `Lines ${source.line_start}–${source.line_end}`}
                    </button>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => previewFile(source.path, source.line_start || 1)}
                    title="Open in file reader"
                  >
                    Open
                  </Button>
                </div>
                {source.snippet && (
                  <pre className="text-xs font-mono text-[var(--ink-secondary)] bg-[var(--paper)] p-2 rounded-[var(--radius-xs)] border border-[var(--hairline-subtle)] whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
                    {source.snippet}
                  </pre>
                )}
                {source.file_details?.location && (
                  <p className="text-xs font-mono text-[var(--ink-muted)] mt-1.5 truncate">
                    Location: {source.file_details.location}{source.file_details.size_bytes != null ? ` · ${source.file_details.size_bytes.toLocaleString()} bytes` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
          <Button
            disabled={savingAnswer || saved}
            onClick={async () => {
              if (saving.current || saved) return;
              saving.current = true; setSavingAnswer(true);
              try {
                await api.createSession(
                  (answerQuestion || "Saved file answer").slice(0, 80),
                  undefined,
                  answer.answer,
                  answer.citations.map((c) => c.path),
                );
                setSaved(true);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't save.");
              } finally { saving.current = false; setSavingAnswer(false); }
            }}
          >
            {saved ? "Saved in Saved work" : savingAnswer ? "Saving…" : "Save for later"}
          </Button>
        </Card>
      )}
    </div>
  );
}

// Render provider text as React nodes; never interpret file content as HTML.
function AnswerText({ text }: { text: string }) {
  const inline = (line: string) => line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) =>
    part.startsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> :
    part.startsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : part);
  return <div className="space-y-2 leading-relaxed break-words">{text.split("\n").map((line, index) => {
    if (/^#{1,6}\s/.test(line)) return <p key={index} className="font-semibold pt-2">{inline(line.replace(/^#{1,6}\s+/, ""))}</p>;
    if (/^[-*]\s/.test(line)) return <p key={index} className="pl-3">• {inline(line.slice(2))}</p>;
    if (line.startsWith("> ")) return <blockquote key={index} className="border-l-2 pl-3 text-[var(--ink-secondary)]">{inline(line.slice(2))}</blockquote>;
    return line.trim() ? <p key={index}>{inline(line)}</p> : null;
  })}</div>;
}
