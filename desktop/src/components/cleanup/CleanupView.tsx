import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Layers,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  api,
  previewFile,
  type CleanupExecutionResponse,
  type CleanupProposalResponse,
  type CleanupScanResponse,
  type StorageOverviewResponse,
} from "../../services/api";
import { useSelection } from "../../services/selection";
import { categoryColors, formatBytes } from "../folders/StorageCategoryStrip";
import { Badge, Button, Card, Modal } from "../ui";
import { LoadingState } from "../ui/LoadingState";

function formatDateShort(epochSeconds: number): string {
  if (!epochSeconds) return "—";
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function CleanupView() {
  const { navigate, setSelected: setGlobalSelected } = useSelection();
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("");
  const [staleDays, setStaleDays] = useState<number>(60);
  const [minLargeMb, setMinLargeMb] = useState<number>(25);

  const [overview, setOverview] = useState<StorageOverviewResponse | null>(null);
  const [scanData, setScanData] = useState<CleanupScanResponse | null>(null);
  const [activeRuleId, setActiveRuleId] = useState<string>("exact_duplicates");
  const [hotspotTab, setHotspotTab] = useState<"map" | "folders" | "files">("map");

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [cleanupMode, setCleanupMode] = useState<"recycle" | "permanent">("recycle");

  const [proposing, setProposing] = useState<boolean>(false);
  const [proposal, setProposal] = useState<CleanupProposalResponse | null>(null);
  const [executing, setExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<CleanupExecutionResponse | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ov, sc] = await Promise.all([
        api.getStorageOverview(workspaceFilter || undefined, 12),
        api.scanCleanupCandidates(workspaceFilter || undefined, staleDays, minLargeMb),
      ]);
      setOverview(ov);
      setScanData(sc);
      if (Array.isArray(sc?.rules) && sc.rules.length > 0) {
        const firstWithItems = sc.rules.find((r) => r.candidate_count > 0);
        if (firstWithItems && !sc.rules.some((r) => r.id === activeRuleId && r.candidate_count > 0)) {
          setActiveRuleId(firstWithItems.id);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load storage and cleanup analysis.");
    } finally {
      setLoading(false);
    }
  }, [workspaceFilter, staleDays, minLargeMb, activeRuleId]);

  useEffect(() => {
    void loadAll();
  }, [workspaceFilter]);

  const activeRule = useMemo(
    () =>
      Array.isArray(scanData?.rules)
        ? scanData.rules.find((r) => r.id === activeRuleId) || scanData.rules[0]
        : undefined,
    [scanData, activeRuleId],
  );

  const selectedBytes = useMemo(() => {
    if (!scanData) return 0;
    const sizeMap = new Map<string, number>();
    for (const rule of scanData.rules) {
      for (const item of rule.items) {
        sizeMap.set(item.path, item.size_bytes);
      }
    }
    if (overview) {
      for (const f of overview.largest_files) {
        sizeMap.set(f.path, f.size_bytes);
      }
    }
    let sum = 0;
    selectedPaths.forEach((p) => {
      sum += sizeMap.get(p) || 0;
    });
    return sum;
  }, [scanData, overview, selectedPaths]);

  const togglePath = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAllInActiveRule = () => {
    if (!activeRule) return;
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const item of activeRule.items) next.add(item.path);
      return next;
    });
  };

  const handlePropose = async () => {
    if (!selectedPaths.size || proposing) return;
    setProposing(true);
    setError("");
    setExecutionResult(null);
    try {
      const res = await api.proposeCleanup(Array.from(selectedPaths), cleanupMode);
      setProposal(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare cleanup confirmation.");
    } finally {
      setProposing(false);
    }
  };

  const handleExecute = async () => {
    if (!proposal || executing) return;
    setExecuting(true);
    setError("");
    try {
      const res = await api.executeCleanup(proposal.proposal, proposal.confirmation_token);
      setExecutionResult(res);
      setProposal(null);
      setSelectedPaths(new Set());
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cleanup execution failed.");
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="gw-page w-full min-w-0 max-w-6xl space-y-5" style={{ alignSelf: "flex-start" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="gw-title">Storage Analyzer & Cleanup</h1>
          <p className="gw-description">
            Inspect disk usage, proportional folder sizes, SHA-256 exact duplicates, caches, and stale files. Nothing is removed without your confirmation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate("computer")}>
            <HardDrive size={14} />
            Apps & Leftovers
          </Button>
          {overview && overview.workspaces.length > 0 && (
            <select
              aria-label="Filter cleanup by folder"
              className="gw-input text-xs py-1.5 px-2.5 w-auto"
              value={workspaceFilter}
              onChange={(e) => setWorkspaceFilter(e.target.value)}
            >
              <option value="">All added locations ({overview.workspaces.length})</option>
              {overview.workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name} ({formatBytes(ws.bytes)})
                </option>
              ))}
            </select>
          )}
          <Button size="sm" onClick={() => void loadAll()} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Scanning…" : "Refresh Scan"}
          </Button>
        </div>
      </div>

      {loading && !overview && (
        <LoadingState
          title="Analyzing storage & cleanup candidates"
          detail="Computing folder sizes, proportional space hotspots, SHA-256 duplicate hashes, and safe cleanup rules…"
          skeleton
        />
      )}

      {overview && overview.workspaces.length === 0 && (
        <Card className="p-4 border-[var(--ink-blue)] bg-[var(--paper-subtle)] flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-semibold text-sm text-[var(--ink)]">
              Add a folder to inspect duplicate files and folder hotspots
            </h2>
            <p className="text-xs text-[var(--ink-secondary)]">
              Drive capacity is shown below. Add your Downloads, Documents, or project folders in the Files workspace to scan for SHA-256 duplicates, caches, and large files.
            </p>
          </div>
          <Button size="sm" variant="primary" onClick={() => navigate("folders")}>
            <FolderOpen size={14} />
            Add Folder in Files
          </Button>
        </Card>
      )}

      {error && (
        <div role="alert" className="gw-notice flex items-center justify-between gap-2">
          <span>{error}</span>
          <Button size="xs" onClick={() => void loadAll()}>
            Retry
          </Button>
        </div>
      )}

      {executionResult && (
        <Card className="p-3.5 border-[var(--ink-blue)] bg-[var(--paper-subtle)] space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-sm text-[var(--ink)]">
              <CheckCircle2 size={16} className="text-[var(--success)]" />
              <span>
                Cleanup complete: {executionResult.removed_count} item(s) removed ·{" "}
                {formatBytes(executionResult.bytes_reclaimed)} reclaimed
              </span>
            </div>
            <Button size="xs" variant="ghost" onClick={() => setExecutionResult(null)}>
              Dismiss
            </Button>
          </div>
          {executionResult.failed.length > 0 && (
            <p className="text-xs text-[var(--warning)]">
              {executionResult.failed.length} item(s) could not be removed (e.g. locked by another process).
            </p>
          )}
        </Card>
      )}

      {/* 1. Mounted Drives & Overall Summary */}
      {overview && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card className="p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs text-[var(--ink-secondary)] font-semibold uppercase tracking-wider">
              <span>Scanned Storage</span>
              <Layers size={14} className="text-[var(--ink-blue)]" />
            </div>
            <p className="text-xl font-bold text-[var(--ink)]">{formatBytes(overview.total_bytes)}</p>
            <p className="text-xs text-[var(--ink-secondary)]">
              Across {overview.total_files.toLocaleString()} indexed files in {overview.workspaces.length} location(s)
            </p>
          </Card>

          <Card className="p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs text-[var(--ink-secondary)] font-semibold uppercase tracking-wider">
              <span>Potential Reclaimable</span>
              <Trash2 size={14} className="text-[var(--ink-blue)]" />
            </div>
            <p className="text-xl font-bold text-[var(--ink-blue)]">
              {formatBytes(scanData?.total_reclaimable_bytes || 0)}
            </p>
            <p className="text-xs text-[var(--ink-secondary)]">
              {scanData?.total_candidates || 0} candidate files across {scanData?.rules.filter((r) => r.candidate_count > 0).length || 0} rules
            </p>
          </Card>

          <Card className="p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs text-[var(--ink-secondary)] font-semibold uppercase tracking-wider">
              <span>Mounted Drives</span>
              <HardDrive size={14} className="text-[var(--ink-blue)]" />
            </div>
            {overview.drives.length === 0 ? (
              <p className="text-xs text-[var(--ink-secondary)]">Drive metrics unavailable</p>
            ) : (
              <div className="space-y-1.5">
                {overview.drives.slice(0, 2).map((d) => (
                  <div key={d.path} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-semibold">{d.path}</span>
                      <span className="text-[var(--ink-secondary)]">
                        {formatBytes(d.free_bytes)} free / {formatBytes(d.total_bytes)} ({d.used_percent}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--paper-subtle)] border border-[var(--hairline)] overflow-hidden">
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${Math.min(100, d.used_percent)}%`,
                          backgroundColor: d.used_percent > 88 ? "var(--danger, #ef4444)" : "var(--ink-blue)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* 2. Visual Space Map & Storage Hotspots */}
      {overview && overview.total_bytes > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--hairline)] pb-2.5">
            <div>
              <h2 className="font-semibold text-sm">Storage Hotspots & Proportional Space Map</h2>
              <p className="text-xs text-[var(--ink-secondary)]">
                Visual distribution of folders and largest files in your scanned locations.
              </p>
            </div>
            <div className="flex gap-1.5">
              <Button
                size="xs"
                variant={hotspotTab === "map" ? "primary" : "ghost"}
                onClick={() => setHotspotTab("map")}
              >
                Space Map ({overview.space_map.length})
              </Button>
              <Button
                size="xs"
                variant={hotspotTab === "folders" ? "primary" : "ghost"}
                onClick={() => setHotspotTab("folders")}
              >
                Largest Folders ({overview.largest_folders.length})
              </Button>
              <Button
                size="xs"
                variant={hotspotTab === "files" ? "primary" : "ghost"}
                onClick={() => setHotspotTab("files")}
              >
                Largest Files ({overview.largest_files.length})
              </Button>
            </div>
          </div>

          {hotspotTab === "map" && (
            <div className="space-y-3">
              {/* Proportional visual treemap strip */}
              <div
                className="flex h-9 w-full overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--paper-subtle)]"
                aria-label="Proportional space map"
              >
                {overview.space_map.slice(0, 12).map((item, idx) => {
                  const color =
                    item.kind === "folder"
                      ? idx % 2 === 0
                        ? "#2563eb"
                        : "#4f46e5"
                      : categoryColors[(item.category as keyof typeof categoryColors) || "other"] || "#64748b";
                  return (
                    <button
                      key={item.path}
                      type="button"
                      title={`${item.name} (${item.kind}): ${formatBytes(item.size_bytes)} · ${item.share_percent}%`}
                      onClick={() => {
                        if (item.kind === "file") previewFile(item.path);
                        else void api.revealFile(item.path);
                      }}
                      className="h-full border-r border-white/20 hover:opacity-85 transition-opacity flex items-center justify-center px-1 text-[11px] font-medium text-white truncate cursor-pointer"
                      style={{
                        width: `${Math.max(4, item.share_percent)}%`,
                        backgroundColor: color,
                      }}
                    >
                      {item.share_percent >= 8 ? `${item.name} (${item.share_percent}%)` : ""}
                    </button>
                  );
                })}
              </div>

              {/* Grid of proportional tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {overview.space_map.slice(0, 12).map((item) => (
                  <div
                    key={item.path}
                    className="p-2.5 rounded-lg border border-[var(--hairline)] bg-[var(--paper-subtle)] hover:border-[var(--ink-blue)] transition-colors flex flex-col justify-between gap-1.5"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {item.kind === "folder" ? (
                        <Folder size={14} className="text-[var(--ink-blue)] shrink-0" />
                      ) : (
                        <FileText size={14} className="text-[var(--ink-secondary)] shrink-0" />
                      )}
                      <span className="text-xs font-semibold truncate" title={item.path}>
                        {item.name}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[var(--ink-secondary)]">
                      <span className="font-mono font-semibold text-[var(--ink)]">
                        {formatBytes(item.size_bytes)}
                      </span>
                      <span>
                        {item.share_percent}% · {item.file_count} {item.file_count === 1 ? "file" : "files"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hotspotTab === "folders" && (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {overview.largest_folders.map((folder) => (
                <div
                  key={folder.path}
                  className="flex items-center justify-between gap-2 p-2 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Folder size={15} className="text-[var(--ink-blue)] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{folder.name}</p>
                      <p className="text-[11px] text-[var(--ink-secondary)] truncate">{folder.path}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <span className="font-mono font-semibold">{formatBytes(folder.size_bytes)}</span>
                      <span className="block text-[10px] text-[var(--ink-secondary)]">
                        {folder.file_count.toLocaleString()} files · {folder.share_percent}%
                      </span>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void api.revealFile(folder.path)}
                      title="Show folder in Windows Explorer"
                    >
                      <FolderOpen size={13} />
                      Explorer
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {hotspotTab === "files" && (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {overview.largest_files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center justify-between gap-2 p-2 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      aria-label={`Select ${file.name} for cleanup`}
                      checked={selectedPaths.has(file.path)}
                      onChange={() => togglePath(file.path)}
                    />
                    <FileText size={14} className="text-[var(--ink-secondary)] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{file.name}</p>
                      <p className="text-[11px] text-[var(--ink-secondary)] truncate">
                        {file.path}
                        {file.allocated_bytes != null && file.allocated_bytes !== file.size_bytes
                          ? ` · Allocated on disk: ${formatBytes(file.allocated_bytes)}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono font-semibold">{formatBytes(file.size_bytes)}</span>
                    <Button size="xs" variant="ghost" onClick={() => previewFile(file.path)}>
                      Preview
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => void api.revealFile(file.path)}>
                      <FolderOpen size={13} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* 3. Cleanup Rules & SHA-256 Duplicate Candidates */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline)] pb-3">
          <div>
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <ShieldCheck size={16} className="text-[var(--ink-blue)]" />
              Cleanup Rules & Duplicate Scanner
            </h2>
            <p className="text-xs text-[var(--ink-secondary)]">
              {scanData?.safety_notice ||
                "No files are ever deleted automatically. Review each item and confirm before removal."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <label className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-[var(--ink-secondary)]">Untouched ≥</span>
              <select
                aria-label="Stale file days threshold"
                className="gw-input py-1 px-2 text-xs w-auto"
                value={staleDays}
                onChange={(e) => setStaleDays(Number(e.target.value))}
              >
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-[var(--ink-secondary)]">Large file ≥</span>
              <select
                aria-label="Large file size threshold"
                className="gw-input py-1 px-2 text-xs w-auto"
                value={minLargeMb}
                onChange={(e) => setMinLargeMb(Number(e.target.value))}
              >
                <option value={10}>10 MB</option>
                <option value={25}>25 MB</option>
                <option value={50}>50 MB</option>
                <option value={100}>100 MB</option>
                <option value={500}>500 MB</option>
              </select>
            </label>
            <Button size="xs" onClick={() => void loadAll()} disabled={loading}>
              Apply Rules
            </Button>
          </div>
        </div>

        {/* Rule selector tabs */}
        {scanData && (
          <div className="flex flex-wrap gap-2">
            {scanData.rules.map((rule) => (
              <button
                key={rule.id}
                type="button"
                onClick={() => setActiveRuleId(rule.id)}
                className={`px-3 py-2 rounded-lg border text-xs text-left transition-all cursor-pointer flex items-center gap-2 ${
                  activeRule?.id === rule.id
                    ? "border-[var(--ink-blue)] bg-[var(--ink-blue-subtle,rgba(37,99,235,0.08))] font-semibold"
                    : "border-[var(--hairline)] bg-[var(--paper-subtle)] hover:border-[var(--ink-secondary)]"
                }`}
              >
                <span>{rule.name}</span>
                <Badge variant={rule.candidate_count > 0 ? "human" : "neutral"}>
                  {rule.candidate_count} · {formatBytes(rule.reclaimable_bytes)}
                </Badge>
              </button>
            ))}
          </div>
        )}

        {/* Active Rule Details & Candidate Table */}
        {activeRule && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--paper-subtle)] p-2.5 rounded-lg border border-[var(--hairline)] text-xs">
              <p className="text-[var(--ink-secondary)]">{activeRule.description}</p>
              {activeRule.items.length > 0 && (
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="xs" variant="ghost" onClick={selectAllInActiveRule}>
                    Select all in rule ({activeRule.items.length})
                  </Button>
                  {selectedPaths.size > 0 && (
                    <Button size="xs" variant="ghost" onClick={() => setSelectedPaths(new Set())}>
                      Clear selection
                    </Button>
                  )}
                </div>
              )}
            </div>

            {activeRule.items.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--ink-secondary)]">
                No files matched <strong>{activeRule.name}</strong> in your scanned locations.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {activeRule.items.map((item) => (
                  <div
                    key={item.path}
                    className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border text-xs transition-colors ${
                      selectedPaths.has(item.path)
                        ? "border-[var(--ink-blue)] bg-[var(--ink-blue-subtle,rgba(37,99,235,0.06))]"
                        : "border-[var(--hairline)] bg-[var(--paper-subtle)]"
                    }`}
                  >
                    <label className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={selectedPaths.has(item.path)}
                        onChange={() => togglePath(item.path)}
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-[var(--ink)] truncate">{item.name}</span>
                          <Badge variant={item.confidence === "high" ? "success" : "warning"}>
                            {item.confidence === "high" ? "High confidence" : "Review recommended"}
                          </Badge>
                          {item.sha256 && (
                            <span className="font-mono text-[10px] text-[var(--ink-secondary)] bg-[var(--paper)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">
                              SHA-256: {item.sha256.slice(0, 12)}…
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--ink-secondary)] truncate" title={item.path}>
                          {item.path}
                        </p>
                        <p className="text-[11px] text-[var(--ink-blue)]">{item.reason}</p>
                      </div>
                    </label>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right mr-1">
                        <span className="font-mono font-semibold">{formatBytes(item.size_bytes)}</span>
                        <span className="block text-[10px] text-[var(--ink-secondary)]">
                          {formatDateShort(item.mtime)}
                        </span>
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => previewFile(item.path)}
                        title="Preview file in Groundwork reader"
                      >
                        <ExternalLink size={13} />
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => void api.revealFile(item.path)}
                        title="Show in Windows Explorer"
                      >
                        <FolderOpen size={13} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Bar for Selected Cleanup Items */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--hairline)]">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span>
              <strong>{selectedPaths.size}</strong> item(s) selected ·{" "}
              <strong className="text-[var(--ink-blue)]">{formatBytes(selectedBytes)}</strong> to reclaim
            </span>
            <label className="flex items-center gap-1.5">
              <span className="text-[var(--ink-secondary)]">Removal mode:</span>
              <select
                aria-label="Removal mode"
                className="gw-input py-1 px-2 text-xs w-auto"
                value={cleanupMode}
                onChange={(e) => setCleanupMode(e.target.value as "recycle" | "permanent")}
              >
                <option value="recycle">Send to Recycle Bin (Safer)</option>
                <option value="permanent">Delete permanently</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedPaths.size > 0 && selectedPaths.size <= 6 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setGlobalSelected(Array.from(selectedPaths));
                  navigate("assistant");
                }}
              >
                <Sparkles size={14} />
                Ask AI about selection
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={selectedPaths.size === 0 || proposing}
              isLoading={proposing}
              onClick={() => void handlePropose()}
            >
              <Trash2 size={14} />
              Review & Clean Up ({selectedPaths.size})
            </Button>
          </div>
        </div>
      </Card>

      {/* 4. Explicit Token-Confirmed Cleanup Modal */}
      {proposal && (
        <Modal
          isOpen
          onClose={() => !executing && setProposal(null)}
          title="Confirm File Cleanup"
          maxWidth="md"
        >
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-[var(--paper-subtle)] border border-[var(--warning)] text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-[var(--ink)]">
                <AlertTriangle size={15} className="text-[var(--warning)]" />
                <span>
                  {cleanupMode === "recycle"
                    ? "Moving selected items to Windows Recycle Bin"
                    : "Permanently deleting selected items from disk"}
                </span>
              </div>
              <p className="text-[var(--ink-secondary)]">{proposal.warning}</p>
            </div>

            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Validated items ({proposal.item_count})</span>
              <span className="text-[var(--ink-blue)]">Total: {formatBytes(proposal.total_bytes)}</span>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1.5 border border-[var(--hairline)] rounded-lg p-2 bg-[var(--paper-subtle)]">
              {proposal.items.map((item) => (
                <div key={item.path} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-[var(--hairline-subtle)] last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{item.name}</p>
                    <p className="text-[11px] text-[var(--ink-secondary)] truncate">{item.path}</p>
                  </div>
                  <span className="font-mono shrink-0">{formatBytes(item.size_bytes)}</span>
                </div>
              ))}
            </div>

            {proposal.skipped.length > 0 && (
              <div className="text-xs text-[var(--ink-secondary)]">
                <strong>Skipped ({proposal.skipped.length}):</strong>{" "}
                {proposal.skipped.map((s) => `${s.path} (${s.reason})`).join("; ")}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--hairline)]">
              <Button variant="secondary" disabled={executing} onClick={() => setProposal(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={executing}
                isLoading={executing}
                onClick={() => void handleExecute()}
              >
                <Trash2 size={14} />
                Confirm & Remove ({formatBytes(proposal.total_bytes)})
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
