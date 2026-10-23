import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  AppWindow,
  CheckCircle2,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  api,
  type CleanupExecutionResponse,
  type CleanupProposalResponse,
  type InstalledApp,
  type LeftoverScanResponse,
} from "../../services/api";
import { formatBytes } from "../folders/StorageCategoryStrip";
import { Badge, Button, Card, Modal } from "../ui";
import { LoadingState } from "../ui/LoadingState";

function formatReportedSize(bytes?: number | null): string {
  if (bytes === null || bytes === undefined) return "Size not reported";
  return formatBytes(bytes);
}

export function InstalledApps() {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "size" | "publisher" | "date">("size");
  const [kindFilter, setKindFilter] = useState<"all" | "uninstallable" | "desktop" | "packaged">("all");
  const [selected, setSelected] = useState<InstalledApp>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [launching, setLaunching] = useState(false);
  const launchRunning = useRef(false);
  const [supported, setSupported] = useState(true);

  // Guided Uninstaller state
  const [uninstallProposal, setUninstallProposal] = useState<
    Awaited<ReturnType<typeof api.proposeAppUninstall>> | null
  >(null);
  const [uninstallBusy, setUninstallBusy] = useState(false);
  const [recentlyUninstalled, setRecentlyUninstalled] = useState<{
    app_id: string;
    app_name: string;
    publisher: string;
    install_location: string;
  } | null>(null);

  // Leftover Scanner state
  const [leftoverScan, setLeftoverScan] = useState<LeftoverScanResponse | null>(null);
  const [scanningLeftovers, setScanningLeftovers] = useState(false);
  const [customScanName, setCustomScanName] = useState("");
  const [customScanPub, setCustomScanPub] = useState("");
  const [showCustomLeftoverInput, setShowCustomLeftoverInput] = useState(false);
  const [selectedLeftoverPaths, setSelectedLeftoverPaths] = useState<Set<string>>(new Set());
  const [leftoverMode, setLeftoverMode] = useState<"recycle" | "permanent">("recycle");
  const [leftoverProposal, setLeftoverProposal] = useState<CleanupProposalResponse | null>(null);
  const [leftoverCleanupResult, setLeftoverCleanupResult] = useState<CleanupExecutionResponse | null>(null);

  const load = async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const result = await api.getInstalledApps(refresh);
      setApps(result.apps);
      setSupported(result.supported);
      setSelected((previous) => result.apps.find((app) => app.id === previous?.id) || result.apps[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read installed apps.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = apps.filter((app) => {
      if (q && !`${app.name} ${app.publisher} ${app.description} ${app.version}`.toLowerCase().includes(q)) {
        return false;
      }
      if (kindFilter === "uninstallable" && !app.can_uninstall) return false;
      if (kindFilter === "desktop" && app.kind !== "Desktop app") return false;
      if (kindFilter === "packaged" && app.kind !== "Packaged app") return false;
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === "size") {
        const sa = a.estimated_size_bytes ?? -1;
        const sb = b.estimated_size_bytes ?? -1;
        if (sa !== sb) return sb - sa;
      } else if (sortBy === "publisher") {
        const pa = (a.publisher || "zzzz").toLowerCase();
        const pb = (b.publisher || "zzzz").toLowerCase();
        if (pa !== pb) return pa.localeCompare(pb);
      } else if (sortBy === "date") {
        const da = a.install_date || "";
        const db = b.install_date || "";
        if (da !== db) return db.localeCompare(da);
      }
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    return list;
  }, [apps, query, sortBy, kindFilter]);

  useEffect(() => {
    setSelected((previous) => filtered.find((app) => app.id === previous?.id) || filtered[0]);
  }, [filtered]);

  const totalReportedBytes = useMemo(
    () => apps.reduce((acc, a) => acc + (a.estimated_size_bytes || 0), 0),
    [apps],
  );
  const desktopCount = useMemo(
    () => apps.filter((a) => a.kind === "Desktop app").length,
    [apps],
  );
  const uninstallableCount = useMemo(
    () => apps.filter((a) => a.can_uninstall).length,
    [apps],
  );

  const launch = async (app: InstalledApp) => {
    if (launchRunning.current || app.can_launch === false) return;
    launchRunning.current = true;
    setLaunching(true);
    setError("");
    setMessage("");
    try {
      await api.launchInstalledApp(app.id);
      setMessage(`Opened ${app.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't launch this app.");
    } finally {
      launchRunning.current = false;
      setLaunching(false);
    }
  };

  const handleProposeUninstall = async (app: InstalledApp) => {
    setUninstallBusy(true);
    setError("");
    setMessage("");
    try {
      const prop = await api.proposeAppUninstall(app.id);
      setUninstallProposal(prop);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare uninstaller.");
    } finally {
      setUninstallBusy(false);
    }
  };

  const handleExecuteUninstall = async () => {
    if (!uninstallProposal || uninstallBusy) return;
    setUninstallBusy(true);
    setError("");
    try {
      const res = await api.executeAppUninstall(
        uninstallProposal.proposal,
        uninstallProposal.confirmation_token,
      );
      setUninstallProposal(null);
      setRecentlyUninstalled({
        app_id: res.app_id,
        app_name: res.app_name,
        publisher: res.publisher,
        install_location: res.install_location,
      });
      setMessage(
        `Launched official uninstaller for ${res.app_name} (PID ${res.pid}). Once it finishes, click "Scan for Leftovers" to check for remaining app data.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not launch uninstaller.");
    } finally {
      setUninstallBusy(false);
    }
  };

  const runLeftoverScan = async (target: {
    app_id?: string;
    app_name: string;
    publisher?: string;
    install_location?: string;
  }) => {
    setScanningLeftovers(true);
    setError("");
    setLeftoverCleanupResult(null);
    try {
      const res = await api.scanAppLeftovers(target);
      setLeftoverScan(res);
      // Pre-select only high-confidence leftovers by default
      const highPaths = new Set(
        res.leftovers.filter((item) => item.confidence === "high").map((item) => item.path),
      );
      setSelectedLeftoverPaths(highPaths);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not scan for application leftovers.");
    } finally {
      setScanningLeftovers(false);
    }
  };

  const handleProposeLeftoverCleanup = async () => {
    if (!selectedLeftoverPaths.size || scanningLeftovers) return;
    setScanningLeftovers(true);
    setError("");
    try {
      const res = await api.proposeLeftoverCleanup(Array.from(selectedLeftoverPaths), leftoverMode);
      setLeftoverProposal(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare leftover cleanup.");
    } finally {
      setScanningLeftovers(false);
    }
  };

  const handleExecuteLeftoverCleanup = async () => {
    if (!leftoverProposal || scanningLeftovers) return;
    setScanningLeftovers(true);
    setError("");
    try {
      const res = await api.executeLeftoverCleanup(
        leftoverProposal.proposal,
        leftoverProposal.confirmation_token,
      );
      setLeftoverCleanupResult(res);
      setLeftoverProposal(null);
      setSelectedLeftoverPaths(new Set());
      if (leftoverScan) {
        await runLeftoverScan({
          app_id: leftoverScan.app_id,
          app_name: leftoverScan.app_name,
          publisher: leftoverScan.publisher,
          install_location: leftoverScan.install_location,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Leftover cleanup failed.");
    } finally {
      setScanningLeftovers(false);
    }
  };

  const icon = (app: InstalledApp, size = 32) =>
    app.icon ? (
      <img src={app.icon} alt="" width={size} height={size} className="object-contain shrink-0" />
    ) : (
      <AppWindow
        size={size}
        className="shrink-0 text-[var(--ink-secondary)]"
        aria-label="Windows did not provide an icon"
      />
    );

  return (
    <section className="installed-apps space-y-3" aria-label="Installed apps">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h2 className="font-semibold text-base">Installed Applications & Uninstaller</h2>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--ink-secondary)]">
            <Badge variant="neutral">{apps.length} apps</Badge>
            <Badge variant="neutral">{desktopCount} Win32 desktop</Badge>
            <Badge variant="human">{uninstallableCount} with uninstaller</Badge>
            {totalReportedBytes > 0 && (
              <Badge variant="neutral">{formatBytes(totalReportedBytes)} reported footprint</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setShowCustomLeftoverInput((v) => !v)}
          >
            <Search size={13} />
            Find Leftovers by App Name
          </Button>
          <button
            className="gw-button"
            title="Refresh installed apps"
            aria-label="Refresh installed apps"
            disabled={loading}
            onClick={() => void load(true)}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {showCustomLeftoverInput && (
        <Card className="p-3 bg-[var(--paper-subtle)] space-y-2">
          <p className="text-xs font-semibold">Scan for Leftovers of an Uninstalled Program</p>
          <div className="flex flex-wrap gap-2">
            <input
              className="gw-input text-xs flex-1 min-w-[160px]"
              placeholder="Application name (e.g. Zoom, Discord)…"
              value={customScanName}
              onChange={(e) => setCustomScanName(e.target.value)}
            />
            <input
              className="gw-input text-xs flex-1 min-w-[140px]"
              placeholder="Publisher (optional)…"
              value={customScanPub}
              onChange={(e) => setCustomScanPub(e.target.value)}
            />
            <Button
              size="xs"
              variant="primary"
              disabled={customScanName.trim().length < 2 || scanningLeftovers}
              onClick={() =>
                void runLeftoverScan({
                  app_name: customScanName.trim(),
                  publisher: customScanPub.trim(),
                })
              }
            >
              Scan AppData & ProgramData
            </Button>
          </div>
        </Card>
      )}

      {/* Search, Sort & Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search size={14} />
          <input
            className="gw-input"
            type="search"
            aria-label="Find installed apps"
            placeholder="Find an app, publisher, or version…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter apps by type"
          className="gw-input text-xs py-1.5 px-2 w-auto"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
        >
          <option value="all">All apps ({apps.length})</option>
          <option value="uninstallable">With Desktop Uninstaller</option>
          <option value="desktop">Desktop apps</option>
          <option value="packaged">Packaged / Store apps</option>
        </select>
        <select
          aria-label="Sort installed apps"
          className="gw-input text-xs py-1.5 px-2 w-auto"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
        >
          <option value="size">Sort: Size (Largest first)</option>
          <option value="name">Sort: Name (A–Z)</option>
          <option value="publisher">Sort: Publisher</option>
          <option value="date">Sort: Install Date</option>
        </select>
      </div>

      {loading && (
        <LoadingState
          title="Reading installed applications"
          detail="Enumerating Start Menu shortcuts, Windows Registry Uninstall entries, estimated sizes, and registered uninstallers…"
        />
      )}
      {error && (
        <p role="alert" className="gw-notice">
          {error}{" "}
          <button
            className="underline font-semibold ml-2 hover:text-[var(--ink-blue)] cursor-pointer"
            onClick={() => void load(true)}
          >
            Retry
          </button>
        </p>
      )}
      {message && (
        <p role="status" className="gw-notice">
          {message}
        </p>
      )}

      {recentlyUninstalled && (
        <Card className="p-3 border-[var(--ink-blue)] bg-[var(--paper-subtle)] flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs space-y-0.5">
            <p className="font-semibold text-[var(--ink)]">
              Post-Uninstall Check for {recentlyUninstalled.app_name}
            </p>
            <p className="text-[var(--ink-secondary)]">
              After the uninstaller window finishes, scan for leftover AppData, ProgramData, and install folders.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="primary"
              disabled={scanningLeftovers}
              onClick={() => void runLeftoverScan(recentlyUninstalled)}
            >
              Scan for Leftovers
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setRecentlyUninstalled(null)}>
              Dismiss
            </Button>
          </div>
        </Card>
      )}

      {!supported && <p>Installed-app discovery is available on Windows.</p>}

      <div className="installed-app-list" role="listbox" aria-label="Applications">
        {filtered.map((app) => (
          <button
            key={app.id}
            role="option"
            aria-selected={selected?.id === app.id}
            className={`installed-app-row ${selected?.id === app.id ? "is-selected" : ""}`}
            onClick={() => setSelected(app)}
            onDoubleClick={() => !launching && app.can_launch !== false && void launch(app)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !launching && app.can_launch !== false) {
                e.preventDefault();
                void launch(app);
              }
            }}
          >
            {icon(app)}
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate font-medium">{app.name}</span>
              <span className="block truncate text-[var(--ink-secondary)]">
                {app.publisher || app.kind}
                {app.version ? ` · v${app.version}` : ""}
                {app.install_date ? ` · Installed ${app.install_date}` : ""}
              </span>
            </span>
            <span className="text-right shrink-0 ml-2">
              <span className="block text-xs font-mono font-semibold">
                {app.estimated_size_bytes != null ? formatBytes(app.estimated_size_bytes) : "—"}
              </span>
              <span className="block text-[10px] text-[var(--ink-secondary)]">
                {app.can_uninstall ? "Uninstaller" : app.kind}
              </span>
            </span>
          </button>
        ))}
        {!loading && supported && !filtered.length && (
          <p className="p-3">
            {apps.length ? "No apps match your search." : "Windows reported no launchable apps."}
          </p>
        )}
      </div>

      <p className="text-xs text-[var(--ink-secondary)]">
        {filtered.length} of {apps.length} apps · Double-click or press Enter to open · Reported sizes come from Windows Registry EstimatedSize
      </p>

      {/* Selected Application Inspector */}
      {selected && (
        <div className="installed-app-details space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {icon(selected, 48)}
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold break-words">{selected.name}</h3>
              <p className="text-xs text-[var(--ink-secondary)]">
                {selected.kind} · {formatReportedSize(selected.estimated_size_bytes)}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                className="gw-button"
                disabled={launching || selected.can_launch === false}
                onClick={() => void launch(selected)}
              >
                Open
              </button>
              {(selected.install_location || selected.location) && (
                <button
                  className="gw-button"
                  onClick={() =>
                    void api.openFolder(selected.install_location || selected.location)
                  }
                  title="Open installation folder in Windows Explorer"
                >
                  <FolderOpen size={14} />
                  Folder
                </button>
              )}
              <button
                className="gw-button"
                disabled={scanningLeftovers}
                onClick={() =>
                  void runLeftoverScan({
                    app_id: selected.id,
                    app_name: selected.name,
                    publisher: selected.publisher,
                    install_location: selected.install_location || selected.location,
                  })
                }
                title="Scan AppData, ProgramData, and install directory for associated files"
              >
                <HardDrive size={14} />
                {scanningLeftovers ? "Scanning…" : "Scan Leftovers"}
              </button>
              {selected.can_uninstall && (
                <button
                  className="gw-button text-[var(--danger,#dc2626)]"
                  disabled={uninstallBusy}
                  onClick={() => void handleProposeUninstall(selected)}
                  title="Review and launch the registered Windows uninstaller"
                >
                  <Trash2 size={14} />
                  Uninstall…
                </button>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-[100px_1fr] gap-1 text-xs mt-2">
            <dt className="text-[var(--ink-secondary)]">Publisher</dt>
            <dd>{selected.publisher || "Not provided by Windows"}</dd>
            <dt className="text-[var(--ink-secondary)]">Version</dt>
            <dd>{selected.version || "Not provided by Windows"}</dd>
            <dt className="text-[var(--ink-secondary)]">Reported Size</dt>
            <dd>{formatReportedSize(selected.estimated_size_bytes)}</dd>
            {selected.install_date && (
              <>
                <dt className="text-[var(--ink-secondary)]">Install Date</dt>
                <dd>{selected.install_date}</dd>
              </>
            )}
            {selected.description && (
              <>
                <dt className="text-[var(--ink-secondary)]">About</dt>
                <dd>{selected.description}</dd>
              </>
            )}
            {(selected.install_location || selected.location) && (
              <>
                <dt className="text-[var(--ink-secondary)]">Location</dt>
                <dd className="break-all font-mono">
                  {selected.install_location || selected.location}
                </dd>
              </>
            )}
          </dl>

          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-[var(--ink-secondary)]">
              Technical & uninstaller details
            </summary>
            <div className="mt-1.5 space-y-1 font-mono text-[11px] bg-[var(--paper-subtle)] p-2 rounded border border-[var(--hairline)]">
              <p className="break-all select-text">ID: {selected.id}</p>
              {selected.uninstall_string && (
                <p className="break-all select-text">
                  UninstallString: {selected.uninstall_string}
                </p>
              )}
              {selected.registry_key && (
                <p className="break-all select-text">Registry Key: {selected.registry_key}</p>
              )}
            </div>
          </details>
        </div>
      )}

      {/* Leftover Analysis Results Panel */}
      {leftoverScan && (
        <Card className="p-4 space-y-3 border-[var(--ink-blue)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--hairline)] pb-2.5">
            <div>
              <h3 className="font-semibold text-sm flex items-center gap-1.5">
                <HardDrive size={15} className="text-[var(--ink-blue)]" />
                Leftover & Footprint Analysis: {leftoverScan.app_name}
              </h3>
              <p className="text-xs text-[var(--ink-secondary)]">
                {leftoverScan.total_count} filesystem item(s) ({formatBytes(leftoverScan.total_reclaimable_bytes)}) ·{" "}
                {leftoverScan.high_confidence_count} high-confidence ({formatBytes(leftoverScan.high_confidence_bytes)}) ·{" "}
                {leftoverScan.review_required_count} review-required
              </p>
            </div>
            <Button size="xs" variant="ghost" onClick={() => setLeftoverScan(null)}>
              Close Leftover Report
            </Button>
          </div>

          <p className="text-xs text-[var(--ink-secondary)] bg-[var(--paper-subtle)] p-2.5 rounded border border-[var(--hairline)]">
            {leftoverScan.safety_notice}
          </p>

          {leftoverCleanupResult && (
            <div className="p-2.5 rounded bg-[var(--paper-subtle)] border border-[var(--success)] text-xs flex items-center gap-2">
              <CheckCircle2 size={14} className="text-[var(--success)]" />
              <span>
                Removed {leftoverCleanupResult.removed_count} leftover item(s) · Reclaimed{" "}
                {formatBytes(leftoverCleanupResult.bytes_reclaimed)}
              </span>
            </div>
          )}

          {leftoverScan.leftovers.length === 0 ? (
            <p className="text-xs text-[var(--ink-secondary)] py-4 text-center">
              No leftover folders or files were found in AppData, ProgramData, or install directories for{" "}
              <strong>{leftoverScan.app_name}</strong>.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex gap-2">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      setSelectedLeftoverPaths(
                        new Set(
                          leftoverScan.leftovers
                            .filter((i) => i.confidence === "high")
                            .map((i) => i.path),
                        ),
                      )
                    }
                  >
                    Select High-Confidence Only ({leftoverScan.high_confidence_count})
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setSelectedLeftoverPaths(new Set())}
                  >
                    Clear Selection
                  </Button>
                </div>
                <label className="flex items-center gap-1.5">
                  <span className="text-[var(--ink-secondary)]">Mode:</span>
                  <select
                    className="gw-input py-1 px-2 text-xs w-auto"
                    value={leftoverMode}
                    onChange={(e) => setLeftoverMode(e.target.value as "recycle" | "permanent")}
                  >
                    <option value="recycle">Recycle Bin (Safer)</option>
                    <option value="permanent">Permanent Delete</option>
                  </select>
                </label>
              </div>

              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {leftoverScan.leftovers.map((item) => (
                  <div
                    key={item.path}
                    className="flex items-center justify-between gap-2 p-2.5 rounded border border-[var(--hairline)] bg-[var(--paper-subtle)] text-xs"
                  >
                    <label className="flex items-start gap-2 min-w-0 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={selectedLeftoverPaths.has(item.path)}
                        onChange={() => {
                          setSelectedLeftoverPaths((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.path)) next.delete(item.path);
                            else next.add(item.path);
                            return next;
                          });
                        }}
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">{item.name}</span>
                          <Badge variant={item.confidence === "high" ? "success" : "warning"}>
                            {item.confidence === "high" ? (
                              <span className="inline-flex items-center gap-1">
                                <ShieldCheck size={11} /> High confidence
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1">
                                <ShieldAlert size={11} /> Review required
                              </span>
                            )}
                          </Badge>
                          <Badge variant="neutral">{item.location_group}</Badge>
                        </div>
                        <p className="font-mono text-[11px] text-[var(--ink-secondary)] truncate">
                          {item.path}
                        </p>
                        <p className="text-[11px] text-[var(--ink-blue)]">Evidence: {item.evidence}</p>
                      </div>
                    </label>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <span className="font-mono font-semibold">{formatBytes(item.size_bytes)}</span>
                        <span className="block text-[10px] text-[var(--ink-secondary)]">
                          {item.file_count} files
                        </span>
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => void api.revealFile(item.path)}
                        title="Inspect in Windows Explorer"
                      >
                        <FolderOpen size={13} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={selectedLeftoverPaths.size === 0 || scanningLeftovers}
                  onClick={() => void handleProposeLeftoverCleanup()}
                >
                  <Trash2 size={14} />
                  Review & Remove Selected Leftovers ({selectedLeftoverPaths.size})
                </Button>
              </div>
            </div>
          )}

          {leftoverScan.registry_leftovers.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-[var(--hairline)]">
              <p className="text-xs font-semibold">
                Registry Keys Detected (Read-Only Evidence — Not Auto-Deleted):
              </p>
              {leftoverScan.registry_leftovers.map((reg) => (
                <div
                  key={reg.key}
                  className="p-2 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] text-xs flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono font-medium truncate">{reg.key}</p>
                    <p className="text-[11px] text-[var(--ink-secondary)]">{reg.evidence}</p>
                  </div>
                  <Badge variant={reg.confidence === "high" ? "human" : "warning"}>
                    {reg.confidence === "high" ? "High match" : "Shared vendor key"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Modal 1: Guided Uninstaller Confirmation */}
      {uninstallProposal && (
        <Modal
          isOpen
          onClose={() => !uninstallBusy && setUninstallProposal(null)}
          title={`Uninstall ${uninstallProposal.proposal.app_name}?`}
          maxWidth="md"
        >
          <div className="space-y-4 text-xs">
            <p className="text-sm text-[var(--ink-secondary)]">{uninstallProposal.warning}</p>
            <div className="p-3 rounded-lg bg-[var(--paper-subtle)] border border-[var(--hairline)] space-y-1.5 font-mono">
              <p>
                <strong>Application:</strong> {uninstallProposal.proposal.app_name}{" "}
                {uninstallProposal.proposal.version ? `(${uninstallProposal.proposal.version})` : ""}
              </p>
              <p>
                <strong>Publisher:</strong> {uninstallProposal.proposal.publisher || "Unknown"}
              </p>
              {uninstallProposal.proposal.install_location && (
                <p className="break-all">
                  <strong>Install Location:</strong> {uninstallProposal.proposal.install_location}
                </p>
              )}
              <p className="break-all">
                <strong>Registered Command:</strong> {uninstallProposal.proposal.uninstall_command}
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--hairline)]">
              <Button
                variant="secondary"
                disabled={uninstallBusy}
                onClick={() => setUninstallProposal(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={uninstallBusy}
                isLoading={uninstallBusy}
                onClick={() => void handleExecuteUninstall()}
              >
                Launch Official Uninstaller
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal 2: Leftover Cleanup Confirmation */}
      {leftoverProposal && (
        <Modal
          isOpen
          onClose={() => !scanningLeftovers && setLeftoverProposal(null)}
          title="Confirm Leftover Removal"
          maxWidth="md"
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded bg-[var(--paper-subtle)] border border-[var(--warning)] space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={14} className="text-[var(--warning)]" />
                <span>Confirm removal of {leftoverProposal.item_count} leftover item(s)</span>
              </div>
              <p className="text-[var(--ink-secondary)]">{leftoverProposal.warning}</p>
            </div>
            <div className="max-h-52 overflow-y-auto space-y-1.5 border border-[var(--hairline)] rounded p-2 bg-[var(--paper-subtle)]">
              {leftoverProposal.items.map((item) => (
                <div
                  key={item.path}
                  className="flex items-center justify-between gap-2 py-1 border-b border-[var(--hairline-subtle)] last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{item.name}</p>
                    <p className="font-mono text-[11px] text-[var(--ink-secondary)] truncate">
                      {item.path}
                    </p>
                  </div>
                  <span className="font-mono shrink-0">{formatBytes(item.size_bytes)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--hairline)]">
              <Button
                variant="secondary"
                disabled={scanningLeftovers}
                onClick={() => setLeftoverProposal(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={scanningLeftovers}
                isLoading={scanningLeftovers}
                onClick={() => void handleExecuteLeftoverCleanup()}
              >
                Confirm & Remove ({formatBytes(leftoverProposal.total_bytes)})
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
