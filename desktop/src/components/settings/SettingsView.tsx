import React, { useEffect, useState } from "react";
import {
  Settings,
  FolderPlus,
  Trash2,
  RefreshCw,
  HardDrive,
  Cloud,
  CloudOff,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Database,
} from "lucide-react";
import { api } from "../../services/api";
import type { SystemStatus, Workspace } from "../../types/api";

export const SettingsView: React.FC = () => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<{
    enabled: boolean;
    cloud_url: string;
    is_authenticated: boolean;
    pending_items: number;
    state: string;
  } | null>(null);
  const [providers, setProviders] = useState<Array<{ id: string; name: string; is_local: boolean; active: boolean }>>([]);
  
  // Add Workspace modal/form
  const [newWsName, setNewWsName] = useState<string>("");
  const [newWsPath, setNewWsPath] = useState<string>("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);

  const loadData = async () => {
    try {
      const [ws, sys, sync, prov] = await Promise.all([
        api.listWorkspaces(),
        api.getSystemStatus(),
        api.getSyncStatus(),
        api.listProviders(),
      ]);
      setWorkspaces(ws);
      setSystemStatus(sys);
      setSyncStatus(sync);
      setProviders(prov);
    } catch (err) {
      console.error("Failed to load settings data:", err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsPath.trim()) return;

    try {
      await api.createWorkspace(
        newWsName.trim() || newWsPath.split(/[\\/]/).pop() || "Workspace",
        newWsPath.trim()
      );
      setNewWsName("");
      setNewWsPath("");
      setActionMessage("Workspace added successfully! Background indexer will scan files.");
      loadData();
    } catch (err: any) {
      alert(`Error adding workspace: ${err.message || err}`);
    }
  };

  const handleDeleteWorkspace = async (id: string) => {
    if (!confirm("Are you sure you want to remove this workspace from Groundwork?")) return;
    try {
      await api.deleteWorkspace(id);
      loadData();
    } catch (err: any) {
      alert(`Error removing workspace: ${err.message || err}`);
    }
  };

  const handleTriggerReindex = async () => {
    setReindexing(true);
    try {
      await api.startIndexing();
      setActionMessage("Full workspace re-indexing started in background!");
    } catch (err: any) {
      alert(`Error starting index: ${err.message || err}`);
    } finally {
      setTimeout(() => setReindexing(false), 2000);
    }
  };

  const handleTriggerSync = async () => {
    setSyncing(true);
    try {
      const res = await api.triggerSync();
      setActionMessage(`Sync result: ${res.status} (${res.message || "Completed"})`);
      loadData();
    } catch (err: any) {
      alert(`Sync failed: ${err.message || err}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--paper)] text-[var(--ink)] font-sans w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-[var(--hairline)]">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)] mb-1">
            System Administration
          </p>
          <h1 className="text-xl font-serif font-bold tracking-tight text-[var(--ink)] flex items-center gap-2">
            <Settings className="w-5 h-5 text-[var(--ink-muted)]" />
            Groundwork Settings
          </h1>
          <p className="text-xs text-[var(--ink-secondary)] mt-1">
            Local workspace configuration, index controls, AI provider selection, and optional sync.
          </p>
        </div>
      </div>

      {actionMessage && (
        <div className="mb-6 p-3 rounded bg-[var(--success-bg)] border border-[var(--success-border)] text-[var(--success)] text-xs flex items-center justify-between font-medium">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {actionMessage}
          </span>
          <button
            onClick={() => setActionMessage(null)}
            className="text-[var(--ink-secondary)] hover:text-[var(--ink)] text-[11px] underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-6 max-w-4xl">
        {/* Section 1: Workspaces & Indexing */}
        <div className="bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg p-5 shadow-[var(--shadow-card)] space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-[var(--ink-blue)]" />
              <h2 className="text-sm font-serif font-bold text-[var(--ink)]">Indexed Workspaces</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleTriggerReindex}
                disabled={reindexing}
                className="flex items-center gap-1.5 px-3 py-1 rounded bg-[var(--control-room)] hover:bg-[var(--control-room-hover)] text-white text-xs font-semibold transition-colors shadow-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reindexing ? "animate-spin" : ""}`} />
                Re-index All
              </button>
            </div>
          </div>

          {/* List of active workspaces */}
          <div className="space-y-2">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="flex items-center justify-between p-3 rounded bg-[var(--paper)] border border-[var(--hairline)]"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-[var(--ink)]">{ws.name}</span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-[var(--success-bg)] border border-[var(--success-border)] text-[var(--success)] font-mono font-bold">
                      Active
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-[var(--ink-muted)] mt-0.5">{ws.path}</p>
                </div>

                <button
                  onClick={() => handleDeleteWorkspace(ws.id)}
                  title="Remove Workspace"
                  className="p-1.5 rounded hover:bg-[var(--danger-bg)] text-[var(--ink-muted)] hover:text-[var(--danger)] transition-colors border border-transparent hover:border-[var(--danger-border)]"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Add Workspace Form */}
          <form onSubmit={handleAddWorkspace} className="pt-3 border-t border-[var(--hairline)]">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--ink)] block mb-2">
              Add Workspace Folder
            </span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="Workspace Name (e.g. My Projects)"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                className="bg-[var(--paper)] border border-[var(--hairline)] rounded px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)]"
              />
              <input
                type="text"
                required
                placeholder="Full Folder Path (e.g. C:\projects)"
                value={newWsPath}
                onChange={(e) => setNewWsPath(e.target.value)}
                className="bg-[var(--paper)] border border-[var(--hairline)] rounded px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] font-mono focus:outline-none focus:border-[var(--ink-blue)]"
              />
              <button
                type="submit"
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded bg-[var(--control-room)] hover:bg-[var(--control-room-hover)] text-white text-xs font-bold transition-colors shadow-xs"
              >
                <FolderPlus className="w-4 h-4" />
                Add Workspace
              </button>
            </div>
          </form>
        </div>

        {/* Section 2: AI Provider Settings */}
        <div className="bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg p-5 shadow-[var(--shadow-card)] space-y-4">
          <div className="flex items-center gap-2 border-b border-[var(--hairline)] pb-3">
            <Cpu className="w-4 h-4 text-[var(--ink-blue)]" />
            <h2 className="text-sm font-serif font-bold text-[var(--ink)]">AI Context Providers</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {providers.map((p) => (
              <div
                key={p.id}
                className={`p-3.5 rounded border transition-all ${
                  p.active
                    ? "bg-[var(--paper-subtle)] border-[var(--ink-blue)] shadow-xs"
                    : "bg-[var(--paper)] border-[var(--hairline)]"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-serif font-bold text-[var(--ink)]">{p.name}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                      p.is_local
                        ? "bg-[var(--success-bg)] border border-[var(--success-border)] text-[var(--success)]"
                        : "bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] text-[var(--ink-blue)]"
                    }`}
                  >
                    {p.is_local ? "Offline Local" : "Cloud Hosted"}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--ink-secondary)] leading-relaxed">
                  {p.is_local
                    ? "Runs entirely on your machine. Zero outbound traffic."
                    : "Connects to remote provider for synthesis. Citations remain local."}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Section 3: Groundwork Sync (Privacy First) */}
        <div className="bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg p-5 shadow-[var(--shadow-card)] space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-[var(--ink-blue)]" />
              <h2 className="text-sm font-serif font-bold text-[var(--ink)]">Groundwork Sync (Optional)</h2>
            </div>
            {syncStatus?.enabled ? (
              <span className="flex items-center gap-1.5 text-xs text-[var(--ink-blue)] font-mono font-bold">
                <Cloud className="w-3.5 h-3.5" />
                Sync Active ({syncStatus.state})
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-[var(--ink-secondary)] font-mono font-semibold">
                <CloudOff className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
                Disabled (100% Local)
              </span>
            )}
          </div>

          <div className="p-3.5 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] space-y-2">
            <div className="flex items-center gap-2 text-xs font-serif font-bold text-[var(--ink)]">
              <ShieldCheck className="w-4 h-4 text-[var(--signal)]" />
              Groundwork Privacy Model
            </div>
            <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">
              Groundwork never synchronizes or uploads your files, source code, repositories, or full search index.
              Groundwork Sync is strictly limited to preferences, saved searches, and notes across your paired devices.
            </p>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-[var(--ink-secondary)]">
              Cloud Service Endpoint:{" "}
              <span className="font-mono text-[var(--ink)] bg-[var(--paper)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">
                {syncStatus?.cloud_url || "http://127.0.0.1:8001"}
              </span>
            </div>
            <button
              onClick={handleTriggerSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--paper-subtle)] hover:bg-[var(--surface-hover)] border border-[var(--hairline)] text-[var(--ink)] text-xs font-semibold transition-colors shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              Test Connection / Trigger Sync
            </button>
          </div>
        </div>

        {/* Section 4: Diagnostics & Persistence Status */}
        {systemStatus && (
          <div className="bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg p-5 shadow-[var(--shadow-card)] space-y-3">
            <div className="flex items-center gap-2 border-b border-[var(--hairline)] pb-3">
              <Database className="w-4 h-4 text-[var(--ink-blue)]" />
              <h2 className="text-sm font-serif font-bold text-[var(--ink)]">System &amp; Local Database Telemetry</h2>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
              <div className="bg-[var(--paper)] p-3 rounded border border-[var(--hairline)]">
                <span className="text-lg font-mono font-bold text-[var(--ink)] block">
                  {systemStatus.counts.workspaces}
                </span>
                <span className="text-[10px] font-mono text-[var(--ink-muted)] uppercase tracking-wider">Workspaces</span>
              </div>
              <div className="bg-[var(--paper)] p-3 rounded border border-[var(--hairline)]">
                <span className="text-lg font-mono font-bold text-[var(--ink-blue)] block">
                  {systemStatus.counts.projects}
                </span>
                <span className="text-[10px] font-mono text-[var(--ink-muted)] uppercase tracking-wider">Projects</span>
              </div>
              <div className="bg-[var(--paper)] p-3 rounded border border-[var(--hairline)]">
                <span className="text-lg font-mono font-bold text-[var(--success)] block">
                  {systemStatus.counts.files}
                </span>
                <span className="text-[10px] font-mono text-[var(--ink-muted)] uppercase tracking-wider">Indexed Files</span>
              </div>
              <div className="bg-[var(--paper)] p-3 rounded border border-[var(--hairline)]">
                <span className="text-lg font-mono font-bold text-[var(--ink-sepia)] block">
                  {systemStatus.counts.chunks}
                </span>
                <span className="text-[10px] font-mono text-[var(--ink-muted)] uppercase tracking-wider">Chunks &amp; AST</span>
              </div>
              <div className="bg-[var(--paper)] p-3 rounded border border-[var(--hairline)]">
                <span className="text-lg font-mono font-bold text-[var(--warning)] block">
                  {systemStatus.counts.notes}
                </span>
                <span className="text-[10px] font-mono text-[var(--ink-muted)] uppercase tracking-wider">Notes</span>
              </div>
            </div>

            <div className="pt-2 text-[11px] font-mono text-[var(--ink-muted)]">
              Database Path: <span className="text-[var(--ink)]">{systemStatus.database_path}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
