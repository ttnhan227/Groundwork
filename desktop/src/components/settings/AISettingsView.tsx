import { useEffect, useState } from "react";
import { ArrowLeft, Check, KeyRound } from "lucide-react";
import { api } from "../../services/api";
import { Button, Card } from "../ui";

const choices = [
  {
    id: "local",
    title: "Find matching passages",
    detail: "Use your files directly. Works offline, with no key or setup.",
  },
  {
    id: "ollama",
    title: "Ollama on your computer",
    detail:
      "Written answers from a local model. Requires Ollama to be installed and running.",
  },
  {
    id: "openai",
    title: "OpenAI",
    detail:
      "Written answers using your OpenAI account and API key. Requires internet.",
  },
  {
    id: "gemini",
    title: "Google Gemini",
    detail: "Written answers using your Gemini API key. Requires internet.",
  },
];
export function AISettingsView({ onBack }: { onBack: () => void }) {
  const [choice, setChoice] = useState("local");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [models, setModels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api
      .getPreferences()
      .then((prefs) => {
        setChoice(String(prefs.ai_provider || "local"));
        setConfigured({
          openai: Boolean(prefs.openai_api_key_configured),
          gemini: Boolean(prefs.gemini_api_key_configured),
        });
        setModels({
          openai: String(prefs.openai_model || ""),
          gemini: String(prefs.gemini_model || ""),
          ollama: String(prefs.ollama_model || ""),
        });
        setReady(true);
      })
      .catch(() =>
        setMessage("Couldn't load your preferences. Go back and try again."),
      );
  }, []);
  const cloud = ["openai", "gemini"].includes(choice);
  return (
    <div className="gw-page max-w-3xl">
      <Button variant="ghost" onClick={onBack} className="self-start">
        <ArrowLeft size={17} />
        Back to Ask your files
      </Button>
      <div>
        <h1 className="gw-title">How would you like answers?</h1>
        <p className="gw-description">
          You can change this any time. Search always stays on your computer.
        </p>
      </div>
      {message && (
        <p role="status" className="gw-notice">
          {message}
        </p>
      )}
      <form
        className="space-y-5"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            const values: Record<string, string> = { ai_provider: choice };
            if (cloud && key.trim()) values[`${choice}_api_key`] = key.trim();
            if (model.trim() && choice !== "local")
              values[`${choice}_model`] = model.trim();
            const prefs = await api.updatePreferences(values);
            setKey("");
            setConfigured({
              openai: Boolean(prefs.openai_api_key_configured),
              gemini: Boolean(prefs.gemini_api_key_configured),
            });
            setMessage("Your choice is saved on this computer.");
          } catch {
            setMessage("Couldn't save your choice. Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="space-y-3" disabled={!ready || busy}>
          <legend className="sr-only">Answer service</legend>
          {choices.map((item) => (
            <label
              key={item.id}
              className={`flex gap-3 items-start p-5 rounded-xl border cursor-pointer ${choice === item.id ? "border-[var(--ink-blue)] bg-[var(--ink-blue-subtle)]" : "border-[var(--hairline)] bg-[var(--surface)]"}`}
            >
              <input
                type="radio"
                name="answer-service"
                aria-label={item.title}
                className="mt-1"
                value={item.id}
                checked={choice === item.id}
                onChange={() => {
                  setChoice(item.id);
                  setKey("");
                  setModel("");
                }}
              />
              <span>
                <span className="block font-semibold mb-1">{item.title}</span>
                <span className="text-sm text-[var(--ink-secondary)]">
                  {item.detail}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {cloud && (
          <Card className="space-y-4">
            <label className="block font-medium text-sm">
              <span className="flex items-center gap-2 mb-2">
                <KeyRound size={16} />
                Your API key
              </span>
              <input
                className="gw-input"
                aria-label="API key"
                type="password"
                autoComplete="off"
                required={!configured[choice]}
                placeholder={
                  configured[choice]
                    ? "A key is saved. Leave blank to keep it."
                    : "Paste your API key"
                }
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
            {configured[choice] && (
              <p className="text-sm text-[var(--success)] flex gap-2">
                <Check size={16} />A key is already saved on this computer.
              </p>
            )}
            <p className="text-sm text-[var(--ink-secondary)] leading-relaxed">
              When you ask a question, the question and relevant file excerpts
              are sent to this service. Your key stays on this device. Your
              provider may charge for usage.
            </p>
          </Card>
        )}
        {choice !== "local" && (
          <details className="p-4 border border-[var(--hairline)] rounded-lg">
            <summary className="cursor-pointer text-sm">
              Advanced: model choice
            </summary>
            <label className="block text-sm mt-4">
              Model name
              <input
                className="gw-input mt-2"
                aria-label="Model name"
                placeholder={models[choice] || "Use the default model"}
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
          </details>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={!ready}
          isLoading={busy}
        >
          Save choice
        </Button>
      </form>
    </div>
  );
}
