import { useEffect, useState } from "react";
import { Sparkles, LifeBuoy, Info } from "lucide-react";
import { api } from "../../services/api";
import type { SystemStatus } from "../../types/api";
import { Button, Card } from "../ui";

export function SettingsView({ onConfigureAI }: { onConfigureAI: () => void }) {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .getSystemStatus()
      .then(setSystem)
      .catch(() => {});
  }, []);
  return (
    <div className="gw-page max-w-3xl">
      <div>
        <h1 className="gw-title">Settings</h1>
        <p className="gw-description">
          A few preferences to make Groundwork yours.
        </p>
      </div>
      {message && (
        <p role="status" className="gw-notice">
          {message}
        </p>
      )}
      <Card className="space-y-4">
        <Sparkles className="text-[var(--ink-blue)]" size={24} />
        <h2 className="text-lg font-semibold">Answers from your files</h2>
        <p className="text-[var(--ink-secondary)]">
          Start with matching passages from your files, or connect an AI service
          for written answers.
        </p>
        <Button onClick={onConfigureAI}>Choose how answers work</Button>
      </Card>
      <Card className="space-y-3">
        <Info size={23} className="text-[var(--ink-blue)]" />
        <h2 className="text-lg font-semibold">About Groundwork</h2>
        <p className="text-[var(--ink-secondary)]">
          Find your files and keep track of your work. Search and notes work
          without signing in.
        </p>
        <p className="text-sm text-[var(--ink-muted)]">
          {system
            ? `Version ${system.app_version}`
            : "Opening app information…"}
        </p>
      </Card>
      <details className="rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-5">
        <summary className="font-medium cursor-pointer flex items-center gap-2">
          <LifeBuoy size={18} />
          Troubleshooting
        </summary>
        <div className="space-y-4 mt-5">
          <p className="text-sm text-[var(--ink-secondary)]">
            Use these only if files are missing from search or the app isn't
            responding.
          </p>
          <div className="flex gap-3 flex-wrap">
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.startIndexing();
                  setMessage(
                    "Refreshing your files in the background. You can keep working.",
                  );
                } catch {
                  setMessage("Couldn't refresh your files. Please try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Refresh all files
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.restartLocalCore();
                  setMessage("Groundwork restarted. Your work is saved.");
                } catch {
                  setMessage(
                    "Couldn't restart. Close Groundwork and open it again.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Restart Groundwork engine
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}
export default SettingsView;
