import { useEffect, useState, useRef } from "react";
import { BatteryCharging, Camera, Cpu, HardDrive, MemoryStick, Trash2 } from "lucide-react";
import { api } from "../../services/api";
import { useSelection } from "../../services/selection";
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
  const { navigate } = useSelection();
  const [status, setStatus] = useState<ComputerStatus>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState("");
  const [screenshotPath, setScreenshotPath] = useState("");
  const [busy, setBusy] = useState(false);
  const actionRunning = useRef(false);

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
    if (actionRunning.current) return;
    actionRunning.current = true;
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
            : "Opened saved screenshot.",
        );
      }
    } catch {
      setMessage("Couldn't complete that action on this computer. Please try again.");
    } finally {
      actionRunning.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="gw-page w-full min-w-0 max-w-6xl space-y-5" style={{ alignSelf: "flex-start" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="gw-title">Computer & Installed Apps</h1>
          <p className="gw-description">
            Inspect system utilization, mounted drives, installed Windows applications, official uninstallers, and leftover AppData/ProgramData footprints.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate("cleanup")}>
            <Trash2 size={14} />
            Storage & Cleanup
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void act("screenshot")}>
            <Camera size={14} />
            Take screenshot
          </Button>
          {screenshotPath && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void act("screenshot-open", screenshotPath)}
            >
              Open saved screenshot
            </Button>
          )}
        </div>
      </div>

      {error && <p role="alert">{error}</p>}
      {message && (
        <p role="status" className="gw-notice break-all">
          {message}
        </p>
      )}

      {/* Live System Telemetry & Drives Bar */}
      <Card className="p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-xs uppercase tracking-wider text-[var(--ink-secondary)]">
            System Telemetry & Drives
          </h2>
          <span className="text-[11px] text-[var(--ink-secondary)]">
            {status ? "Live · updates every 5s" : "Checking your computer…"}
          </span>
        </div>

        {status ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-[var(--paper-subtle)] border border-[var(--hairline)] space-y-1.5">
              <div className="flex items-center justify-between text-[var(--ink-secondary)]">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Cpu size={13} className="text-[var(--ink-blue)]" /> CPU Load
                </span>
                <span className="font-mono font-bold text-sm text-[var(--ink)]">
                  {status.cpu_percent}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--paper)] border border-[var(--hairline)] overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${Math.min(100, status.cpu_percent)}%`,
                    backgroundColor:
                      status.cpu_percent > 85 ? "var(--danger, #dc2626)" : "var(--ink-blue)",
                  }}
                />
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--paper-subtle)] border border-[var(--hairline)] space-y-1.5">
              <div className="flex items-center justify-between text-[var(--ink-secondary)]">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <MemoryStick size={13} className="text-[var(--ink-blue)]" /> Memory
                </span>
                <span className="font-mono font-bold text-sm text-[var(--ink)]">
                  {status.memory_percent}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--paper)] border border-[var(--hairline)] overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${Math.min(100, status.memory_percent)}%`,
                    backgroundColor:
                      status.memory_percent > 88 ? "var(--danger, #dc2626)" : "var(--ink-blue)",
                  }}
                />
              </div>
              <p className="text-[11px] text-[var(--ink-secondary)]">
                {gb(status.memory_used)} used of {gb(status.memory_total)}
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--paper-subtle)] border border-[var(--hairline)] space-y-1">
              <div className="flex items-center justify-between text-[var(--ink-secondary)]">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <BatteryCharging size={13} className="text-[var(--ink-blue)]" /> Power
                </span>
                <span className="font-mono font-bold text-sm text-[var(--ink)]">
                  {status.battery ? `${status.battery.percent}%` : "AC"}
                </span>
              </div>
              <p className="text-[11px] text-[var(--ink-secondary)]">
                {status.battery
                  ? status.battery.plugged_in
                    ? "Plugged in"
                    : "On battery power"
                  : "Desktop / AC power"}
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-[var(--paper-subtle)] border border-[var(--hairline)] space-y-1.5">
              <div className="flex items-center justify-between text-[var(--ink-secondary)]">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <HardDrive size={13} className="text-[var(--ink-blue)]" /> Local Drives
                </span>
                <span className="text-[11px] font-mono">{status.drives.length} mounted</span>
              </div>
              <div className="space-y-1">
                {status.drives.slice(0, 2).map((d) => {
                  const usedPct = d.total > 0 ? Math.round(((d.total - d.free) / d.total) * 100) : 0;
                  return (
                    <div key={d.path} className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold">{d.path}</span>
                      <span className="text-[var(--ink-secondary)] font-mono">
                        {gb(d.free)} free / {gb(d.total)} ({usedPct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--ink-secondary)]">Reading CPU, memory, and drive telemetry…</p>
        )}
      </Card>

      <InstalledApps />

      {pending && (
        <Modal
          isOpen
          onClose={() => setPending(undefined)}
          title="Capture all screens?"
          maxWidth="sm"
        >
          <p className="mb-4 text-sm text-[var(--ink-secondary)]">
            This captures everything currently visible on all your screens. The
            image stays in Groundwork's local screenshots folder and is never
            uploaded automatically.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setPending(undefined)}>
              Cancel
            </Button>
            <Button
              variant="primary"
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
