import { useEffect, useState } from "react";
import { api, waitForJob } from "../../services/api";
import { useSelection } from "../../services/selection";
import type { AIQueryResponse } from "../../types/api";
import { Button, Card } from "../ui";
import { LocalAISetup } from "./LocalAISetup";

export function AssistantView({
  initialQuestion = "",
  savedSummary = "",
}: {
  initialQuestion?: string;
  savedSummary?: string;
}) {
  const { selected, setSelected, navigate } = useSelection();
  const [question, setQuestion] = useState(initialQuestion);
  const [provider, setProvider] = useState("builtin");
  const [providers, setProviders] = useState<
    { id: string; name: string; is_local: boolean }[]
  >([]);
  const [answer, setAnswer] = useState<AIQueryResponse>();
  const [answerQuestion, setAnswerQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  useEffect(() => { setQuestion(initialQuestion); }, [initialQuestion]);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("groundwork-last-answer");
      if (saved) {
        setAnswer(JSON.parse(saved));
        setAnswerQuestion(sessionStorage.getItem("groundwork-answer-question") || "Saved file answer");
      }
    } catch {
      /* A damaged local draft should not block the assistant. */
    }
    api
      .listProviders()
      .then((values) =>
        setProviders(
          values.filter((p) => ["local", "builtin"].includes(p.id) || p.active),
        ),
      )
      .catch(() => setError("Couldn't load answer choices."));
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
          setAnswerQuestion(sessionStorage.getItem("groundwork-pending-question") || "Saved file answer");
          sessionStorage.setItem("groundwork-answer-question", sessionStorage.getItem("groundwork-pending-question") || "Saved file answer");
        })
        .catch((e) => setError(e.message))
        .finally(() => {
          setBusy(false);
          sessionStorage.removeItem("groundwork-assistant-job");
        });
    }
  }, []);
  const ask = async (text: string) => {
    if (busy || !text.trim() || !selected.length || selected.length > 6) return;
    setError("");
    setBusy(true);
    setQuestion(text);
    try {
      const job = await api.startQuestion(text, selected, provider);
      sessionStorage.setItem("groundwork-assistant-job", job.id);
      sessionStorage.setItem("groundwork-pending-question", text);
      const result = await waitForJob(job);
      sessionStorage.setItem("groundwork-last-answer", JSON.stringify(result));
      setAnswer(result);
      setAnswerQuestion(text);
      sessionStorage.setItem("groundwork-answer-question", text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write an answer.");
    } finally {
      setBusy(false);
      sessionStorage.removeItem("groundwork-assistant-job");
    }
  };
  return (
    <div className="gw-page max-w-4xl" style={{ alignSelf: "flex-start" }}>
      <div>
        <h1 className="gw-title">Ask selected files</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigate("folders")}>Choose files</Button>
        <Button
          onClick={() => navigate("organize")}
          disabled={!selected.length}
        >
          Organize selection
        </Button>
        <Button onClick={() => setShowSetup(!showSetup)}>
          Set up built-in AI
        </Button>
      </div>
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
      <Card className="space-y-4">
        <h2 className="font-semibold">Selected files ({selected.length})</h2>
        {!selected.length && (
          <p>
            Choose files in Files first. You can search and browse without
            setting up AI.
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
        <details className="text-sm text-[var(--ink-secondary)]"><summary>What AI can read</summary><p>
          AI can read text files and PDFs with selectable text. It uses up to
          six files, bounded excerpts of each, with a 5 MB file limit. It
          cannot read scanned images or unsupported formats. Answers may be
          mistaken; check the sources.
        </p></details>
        <label className="block text-sm">
          Answer with
          <select
            className="gw-input mt-1"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="builtin">Built-in AI (this computer)</option>
            {providers
              .filter((p) => p.id !== "builtin")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        {providers.find((p) => p.id === provider)?.is_local === false && (
          <p className="gw-notice">
            Sending a question shares your question, selected file names and
            readable excerpts with this cloud provider. Other files are not
            sent.
          </p>
        )}
        <label className="block">
          Your question
          <textarea
            className="gw-input mt-2 min-h-24"
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
            disabled={
              busy ||
              !selected.length ||
              selected.length > 6 ||
              !question.trim()
            }
            onClick={() => ask(question)}
          >
            Ask
          </Button>
          <Button
            disabled={busy || !selected.length || selected.length > 6}
            onClick={() =>
              ask(
                "Summarize each selected file. Explain its purpose and cite supporting passages.",
              )
            }
          >
            Summarize
          </Button>
          <Button
            disabled={busy || !selected.length || selected.length > 6}
            onClick={() =>
              ask(
                "Describe each selected file and suggest a few useful tags. Cite evidence and distinguish facts from guesses.",
              )
            }
          >
            Describe and suggest tags
          </Button>
        </div>
        {busy && (
          <div role="status" className="space-y-2">
            <p>
              Preparing and writing your answer… Files and search remain
              available.
            </p>
            <Button
              onClick={() =>
                api
                  .localAIAction("cancel-answer")
                  .catch((e) => setError(e.message))
              }
            >
              Cancel local answer
            </Button>
          </div>
        )}
      </Card>
      {error && (
        <p role="alert" className="gw-notice">
          {error}
        </p>
      )}
      {answer && (
        <Card className="space-y-4">
          <div className="whitespace-pre-wrap">{answer.answer}</div>
          <h3 className="font-medium">Sources actually read</h3>
          {answer.citations.map((source, i) => (
            <div key={i}>
              <Button
                variant="ghost"
                onClick={() =>
                  api.openFile(source.path).catch((e) => setError(e.message))
                }
              >
                {source.filename} · lines {source.line_start}–{source.line_end}
              </Button>
              <details className="text-sm">
                <summary>Read excerpt</summary>
                <pre className="whitespace-pre-wrap">{source.snippet}</pre>
              </details>
            </div>
          ))}
          <Button
            onClick={async () => {
              try {
                await api.createSession(
                  (answerQuestion || "Saved file answer").slice(0, 80),
                  undefined,
                  answer.answer,
                  answer.citations.map((c) => c.path),
                );
                setError("Saved in Saved work.");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't save.");
              }
            }}
          >
            Save for later
          </Button>
        </Card>
      )}
    </div>
  );
}
