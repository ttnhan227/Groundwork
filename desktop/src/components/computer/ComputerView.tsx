import { useEffect, useState } from "react";
import { api } from "../../services/api";
import { Button, Card, Modal } from "../ui";
import { InstalledApps } from "./InstalledApps";
export interface ComputerStatus {
  cpu_percent: number;
  memory_percent: number;
  memory_total: number;
  memory_used: number;
  battery: { percent: number; plugged_in: boolean } | null;
  drives: Array<{ path: string; total: number; free: number }>;
}
const gb = (value: number) => `${(value / 1073741824).toFixed(1)} GB`;
export function ComputerView() {
  const [status, setStatus] = useState<ComputerStatus>();
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState("");
  const [screenshotPath, setScreenshotPath] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .getComputerStatus()
        .then((data) => {
          if (active) {
            setStatus(data);
            setError("");
          }
        })
        .catch(() => {
          if (active) setError("Couldn't check your computer.");
        });
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const act = async (action: string, value = "", token?: string) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await api.desktopAction(action, value, token);
      if (result.confirmation_required) setPending(result.confirmation_token);
      else {
        setPending(undefined);
        if (result.path) setScreenshotPath(result.path);
        setMessage(
          result.path
            ? `Screenshot saved on this computer: ${result.path}`
            : "Opened.",
        );
      }
    } catch {
      setMessage(
        "Couldn't complete that action. Check the website address or try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="gw-page max-w-4xl">
      <h1 className="gw-title">Your computer</h1>
      <p className="gw-description">
        Your installed apps, storage, and system status.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && (
        <p role="status" className="gw-notice break-all">
          {message}
        </p>
      )}
      <InstalledApps />
      <Card className="space-y-3">
        <h2 className="font-semibold">Computer status</h2>
        {status ? (
          <>
            <p>
              CPU: {status.cpu_percent}% · Memory: {status.memory_percent}% (
              {gb(status.memory_used)} of {gb(status.memory_total)})
            </p>
            <p>
              {status.battery
                ? `Battery: ${status.battery.percent}% · ${status.battery.plugged_in ? "Plugged in" : "On battery"}`
                : "No battery detected"}
            </p>
            {status.drives.map((d) => (
              <p key={d.path}>
                {d.path} — {gb(d.free)} free of {gb(d.total)}
              </p>
            ))}
            <p className="text-sm">Updates every five seconds.</p>
          </>
        ) : (
          <p>Checking your computer…</p>
        )}
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Screenshot</h2>
        <p>
          Capture all screens and save a PNG on this computer. Screenshots may
          include private information.
        </p>
        <Button disabled={busy} onClick={() => void act("screenshot")}>
          Take screenshot
        </Button>
      </Card>
      {screenshotPath && (
        <Button
          disabled={busy}
          onClick={() => void act("screenshot-open", screenshotPath)}
        >
          Open saved screenshot
        </Button>
      )}
      {pending && (
        <Modal
          isOpen
          onClose={() => setPending(undefined)}
          title="Capture all screens?"
          maxWidth="sm"
        >
          <p className="mb-4">
            This captures everything currently visible on all your screens. The
            image stays in Groundwork's local screenshots folder and is never
            uploaded automatically.
          </p>
          <div className="flex gap-3">
            <Button onClick={() => setPending(undefined)}>Cancel</Button>
            <Button
              disabled={busy}
              onClick={() => {
                const token = pending;
                setPending(undefined);
                void act("screenshot", "", token);
              }}
            >
              Capture and save
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
