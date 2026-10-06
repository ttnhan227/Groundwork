import { useEffect, useState } from "react";
import { api } from "../../services/api";
import { Button, Card } from "../ui";

export interface LocalAIStatus {
  supported: boolean;
  engine_size: number;
  selected: string;
  loaded: string | null;
  generating: boolean;
  hardware: {
    architecture: string;
    ram_total: number;
    ram_available: number;
    cpu_threads: number;
    acceleration: string;
  };
  models: {
    id: string;
    name: string;
    size: number;
    license: string;
    installed: boolean;
  }[];
  download: {
    phase: string;
    bytes: number;
    total: number;
    error: string | null;
    artifact?: string;
  };
}
const mb = (value: number) => `${(value / 1000000).toFixed(0)} MB`;
export function LocalAISetup() {
  const [status, setStatus] = useState<LocalAIStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [importPath, setImportPath] = useState("");
  const [importMessage, setImportMessage] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .localAIStatus()
        .then((value) => {
          if (active) setStatus(value);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    load();
    const timer = setInterval(load, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const action = async (name: string, model?: string) => {
    setError("");
    setBusy(true);
    try {
      setStatus(await api.localAIAction(name, model));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't finish setup.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const downloading =
    status &&
    ["starting", "downloading", "checking", "installing"].includes(
      status.download.phase,
    );
  return (
    <Card className="space-y-4">
      <h2 className="font-semibold text-lg">Built-in AI</h2>
      <p className="text-sm text-[var(--ink-secondary)]">
        Download once to write answers on this computer, then use it offline. No
        account or separate app is needed. Setup contacts GitHub and Hugging
        Face to download the engine and model; your files are not sent.
      </p>
      {!status && !error && (
        <p role="status" className="text-sm">
          Checking your computer and AI files…
        </p>
      )}
      {status && (
        <>
          <p className="text-sm">
            {(status.hardware.ram_available / 1073741824).toFixed(1)} GB free of{" "}
            {(status.hardware.ram_total / 1073741824).toFixed(1)} GB memory ·{" "}
            {status.hardware.architecture} · CPU mode
          </p>
          <p className="text-sm text-[var(--ink-secondary)]">
            Start with the small model. Larger models can use more memory and
            take longer. Speed and answer quality depend on your computer and
            files; these models have no published hardware recommendations.
          </p>
          {!status.supported && (
            <p>
              Built-in AI isn't available for this platform yet. Browsing and
              search still work.
            </p>
          )}
          {status.models
            .slice()
            .sort(
              (a, b) =>
                ["small", "larger", "compact"].indexOf(a.id) -
                ["small", "larger", "compact"].indexOf(b.id),
            )
            .map((model) => (
              <div
                key={model.id}
                className="border border-[var(--hairline)] rounded-lg p-3 space-y-2"
              >
                <p className="font-medium">
                  {model.name}
                  {model.id === "small" ? " (default)" : ""} · {mb(model.size)}{" "}
                  {model.installed ? "· Installed" : ""}
                </p>
                {model.id === "compact" && (
                  <p className="text-sm">
                    This compact option made inaccurate summaries in development
                    tests. The small model is the default; compare answers with
                    source text if you choose this option.
                  </p>
                )}
                <p className="text-xs">
                  Apache-2.0 · GGUF · Engine adds {mb(status.engine_size)} on
                  first setup
                </p>
                <div className="flex gap-2">
                  {!model.installed && (
                    <Button
                      disabled={
                        !status.supported || Boolean(downloading) || busy
                      }
                      onClick={() => action("install", model.id)}
                    >
                      Download / resume
                    </Button>
                  )}
                  {model.installed && (
                    <Button
                      disabled={busy || status.generating}
                      onClick={async () => {
                        try {
                          if (!(await action("select", model.id))) return;
                          await api.updatePreferences({
                            ai_provider: "builtin",
                          });
                        } catch (e) {
                          setError(
                            e instanceof Error
                              ? e.message
                              : "Couldn't save your choice.",
                          );
                        }
                      }}
                    >
                      {status.selected === model.id
                        ? "Use this model"
                        : "Switch to this model"}
                    </Button>
                  )}
                  {model.installed && (
                    <Button
                      variant="ghost"
                      disabled={
                        busy || Boolean(downloading) || status.generating
                      }
                      onClick={() => action("install", model.id)}
                    >
                      Repair download
                    </Button>
                  )}
                </div>
              </div>
            ))}
          {status.download.phase !== "idle" && (
            <div role="status" className="space-y-2">
              <p>
                {
                  (
                    {
                      starting: "Preparing download",
                      downloading: "Downloading",
                      checking: "Checking download",
                      installing: "Installing engine",
                      complete: "Download complete — choose Use this model",
                      cancelled: "Download paused — resume when ready",
                      error: "Download needs attention",
                    } as Record<string, string>
                  )[status.download.phase]
                }{" "}
                {status.download.total > 0 &&
                  `· ${mb(status.download.bytes)} of ${mb(status.download.total)}`}
              </p>
              {status.download.phase === "downloading" && (
                <progress
                  className="w-full"
                  value={status.download.bytes}
                  max={status.download.total}
                />
              )}
              {downloading && (
                <Button onClick={() => action("cancel-download")}>
                  Cancel download
                </Button>
              )}
              {status.download.error && (
                <p className="gw-notice">{status.download.error}</p>
              )}
            </div>
          )}
          <p className="text-sm">
            {status.loaded
              ? "AI is loaded in memory."
              : "AI loads when you ask a question."}{" "}
            It unloads after three minutes without use.
          </p>

          <div className="border border-[var(--hairline)] rounded-lg p-3 space-y-3">
            <h3 className="font-medium text-sm">Import existing GGUF model</h3>
            <p className="text-xs text-[var(--ink-secondary)]">
              Already have a compatible GGUF model file on your computer? Import it directly without downloading another copy. Groundwork verifies the file header and checksum before use.
            </p>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={async () => {
                try { const chosen = await api.pickAIModel(); if (chosen) setImportPath(chosen); }
                catch (e) { setError(e instanceof Error ? e.message : "Couldn't open the file picker."); }
              }}>Choose model file</Button>
              <input
                aria-label="Existing model file"
                className="gw-input flex-1 text-sm"
                placeholder="Path to .gguf file (e.g. C:/Models/model.gguf)"
                value={importPath}
                onChange={(e) => setImportPath(e.target.value)}
              />
              <Button
                disabled={!importPath.trim() || busy}
                onClick={async () => {
                  setError("");
                  setImportMessage("");
                  setBusy(true);
                  try {
                    const res = await api.importLocalModel(importPath.trim());
                    setImportMessage(`Imported ${res.name}. You can now select it.`);
                    setImportPath("");
                    setStatus(await api.localAIStatus());
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Couldn't import model.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Import file
              </Button>
            </div>
            {importMessage && <p className="text-sm text-[var(--ink-blue)]">{importMessage}</p>}
          </div>

          <Button
            disabled={status.generating || busy}
            onClick={() => action("unload")}
          >
            Free AI memory
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="gw-notice">
          {error}
        </p>
      )}
    </Card>
  );
}
