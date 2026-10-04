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
  Info,
  Database,
} from "lucide-react";
import { api } from "../../services/api";
import type { SystemStatus, Workspace } from "../../types/api";
import { Button, Card, Badge } from "../ui";

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

  const [providerChoice, setProviderChoice] = useState("local");
  const [providerKey, setProviderKey] = useState("");
  const [providerModel, setProviderModel] = useState("");
  const [cloudUrl, setCloudUrl] = useState("");
  const [cloudEmail, setCloudEmail] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [registerAccount, setRegisterAccount] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  useEffect(() => { api.getPreferences().then((prefs) => {
    setProviderChoice(String(prefs.ai_provider || "local")); setCloudUrl(String(prefs.cloud_sync_url || ""));
  }).catch((error) => setActionMessage(`Preferences unavailable: ${String(error)}`)); }, []);

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
      setActionMessage(`Settings unavailable: ${String(err)}`);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!reindexing) return;
    const timer = setInterval(() => api.getIndexProgress().then((progress) => {
      setActionMessage(`Indexing: ${progress.status} · ${progress.files_indexed} indexed · ${progress.files_skipped} skipped`);
      if (!["indexing", "scanning"].includes(progress.status)) { setReindexing(false); loadData(); }
    }).catch((error) => {setActionMessage(`Index status unavailable: ${String(error)}`); setReindexing(false);}), 1000);
    return () => clearInterval(timer);
  }, [reindexing]);

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
      setReindexing(false);
    }
  };

  const handleTriggerSync = async () => {
    setSyncing(true);
    try {
      const res = await api.triggerSync();
      setActionMessage(`Sync result: ${res.status} (${res.error || res.message || "Completed"})`);
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
        <div role="status" className="mb-6 p-3 rounded-[var(--radius-sm)] bg-[var(--paper-subtle)] border border-[var(--hairline)] text-[var(--ink)] text-xs flex items-center justify-between font-medium">
          <span className="flex items-center gap-2">
            <Info className="w-4 h-4 shrink-0" />
            {actionMessage}
          </span>
          <button
            onClick={() => setActionMessage(null)}
            className="text-[var(--ink-secondary)] hover:text-[var(--ink)] text-[11px] underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-6 max-w-4xl">
        {/* Section 1: Workspaces & Indexing */}
        <Card className="border-[var(--hairline-strong)] space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-[var(--ink-blue)]" />
              <h2 className="text-sm font-serif font-bold text-[var(--ink)]">Indexed Workspaces</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleTriggerReindex}
                disabled={reindexing}
                isLoading={reindexing}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                  Re-index All
                </Button>
                <Button variant="secondary" size="sm" onClick={() => api.restartLocalCore().then(() => {setActionMessage("Local service restarted"); loadData();}).catch((error) => setActionMessage(String(error)))}>Restart local service</Button>
            </div>
          </div>

          {/* List of active workspaces */}
          <div className="space-y-2">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="flex items-center justify-between p-3 rounded-[var(--radius-sm)] bg-[var(--paper)] border border-[var(--hairline)]"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-[var(--ink)]">{ws.name}</span>
                    <Badge variant="success" className="font-mono">
                      Active
                    </Badge>
                  </div>
                  <p className="text-[11px] font-mono text-[var(--ink-muted)] mt-0.5">{ws.path}</p>
                </div>

                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleDeleteWorkspace(ws.id)}
                  title="Remove Workspace"
                  className="hover:text-[var(--danger)]"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* Add Workspace Form */}
          <form onSubmit={handleAddWorkspace} className="pt-3 border-t border-[var(--hairline)]">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[var(--ink)] block mb-2">
              Add Workspace Folder
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={async () => {
              try { const folder = await api.pickWorkspaceFolder(); if (folder) { setNewWsPath(folder); if (!newWsName) setNewWsName(folder.split(/[\\/]/).pop() || "Workspace"); } }
              catch (error) { setActionMessage(`Folder picker failed: ${String(error)}`); }
            }}>Choose folder</Button>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
              <input
                type="text"
                placeholder="Workspace Name (e.g. My Projects)"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                className="bg-[var(--paper)] border border-[var(--hairline)] rounded-[var(--radius-sm)] px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] focus:outline-none focus:border-[var(--ink-blue)]"
              />
              <input
                type="text"
                required
                placeholder="Full Folder Path (e.g. C:\projects)"
                value={newWsPath}
                onChange={(e) => setNewWsPath(e.target.value)}
                className="bg-[var(--paper)] border border-[var(--hairline)] rounded-[var(--radius-sm)] px-3 py-2 text-xs text-[var(--ink)] placeholder-[var(--ink-faint)] font-mono focus:outline-none focus:border-[var(--ink-blue)]"
              />
              <Button
                type="submit"
                variant="primary"
                size="md"
              >
                <FolderPlus className="w-4 h-4" />
                Add Workspace
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className="font-serif text-lg font-bold mb-3">Configure AI provider</h2>
          <form className="space-y-3" onSubmit={async (event) => {
            event.preventDefault(); setSavingPreferences(true);
            try {
              const values: Record<string, string> = {ai_provider: providerChoice};
              if (providerKey && providerChoice !== "local" && providerChoice !== "ollama") values[`${providerChoice}_api_key`] = providerKey;
              if (providerModel && providerChoice !== "local") values[`${providerChoice}_model`] = providerModel;
              await api.updatePreferences(values); setProviderKey(""); setActionMessage("Provider preferences saved on this device."); await loadData();
            } catch (error) { setActionMessage(`Provider update failed: ${String(error)}`); }
            finally { setSavingPreferences(false); }
          }}>
            <select aria-label="Default AI provider" value={providerChoice} onChange={(event) => setProviderChoice(event.target.value)} className="border border-[var(--hairline)] rounded px-3 py-2 bg-[var(--paper)] text-sm">
              <option value="local">Local workspace excerpts</option><option value="ollama">Ollama on this device</option><option value="openai">OpenAI cloud</option><option value="gemini">Gemini cloud</option>
            </select>
            {providerChoice !== "local" && <input aria-label="Model name" placeholder="Model name (leave blank to keep current)" value={providerModel} onChange={(event) => setProviderModel(event.target.value)} className="block w-full border border-[var(--hairline)] rounded px-3 py-2 bg-[var(--paper)] text-sm" />}
            {["openai", "gemini"].includes(providerChoice) && <><input type="password" autoComplete="off" aria-label="Provider API key" placeholder="API key (leave blank to keep current)" value={providerKey} onChange={(event) => setProviderKey(event.target.value)} className="block w-full border border-[var(--hairline)] rounded px-3 py-2 bg-[var(--paper)] text-sm" /><p className="text-xs text-[var(--ink-secondary)]">Cloud queries send your question, selected file paths, and retrieved excerpts to this provider. Indexing remains local. Keys are protected with your Windows account.</p></>}
            <Button type="submit" variant="primary" isLoading={savingPreferences} disabled={savingPreferences}>Save provider</Button>
          </form>
        </Card>

        <Card>
          <h2 className="font-serif text-lg font-bold mb-3">Optional cloud account</h2>
          <p className="text-xs text-[var(--ink-secondary)] mb-3">Signing in enables synchronization of your local notes and saved searches. Workspace files and credentials are excluded.</p>
          <form className="space-y-3" onSubmit={async (event) => {
            event.preventDefault(); setSyncing(true);
            try { await api.loginCloud(cloudUrl, cloudEmail, cloudPassword, registerAccount); setCloudPassword(""); setActionMessage("Cloud account connected. Use Sync Now to synchronize metadata."); await loadData(); }
            catch (error) { setActionMessage(`Cloud sign-in failed: ${String(error)}`); }
            finally { setSyncing(false); }
          }}>
            <input required aria-label="Cloud server URL" value={cloudUrl} onChange={(event) => setCloudUrl(event.target.value)} className="block w-full border border-[var(--hairline)] rounded px-3 py-2 bg-[var(--paper)] text-sm" />
            <input required type="email" autoComplete="username" aria-label="Account email" placeholder="Email" value={cloudEmail} onChange={(event) => setCloudEmail(event.target.value)} className="block w-full border border-[var(--hairline)] rounded px-3 py-2 bg-[var(--paper)] text-sm" />
            <input required type="password" autoComplete={registerAccount ? "new-password" : "current-password"} minLength={registerAccount ? 12 : 1} aria-label="Account password" placeholder="Password" value={cloudPassword} onChange={(event) => setCloudPassword(event.target.value)} className="block w-full border border-[var(--hairline)] rounded px-3 py-2 bg-[var(--paper)] text-sm" />
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={registerAccount} onChange={(event) => setRegisterAccount(event.target.checked)} />Create a new account</label>
            <Button type="submit" variant="primary" disabled={syncing}>{registerAccount ? "Create account" : "Sign in"}</Button>
            <Button type="button" variant="secondary" onClick={async () => { try { await api.logoutCloud(); setActionMessage("Cloud disconnected. Local work remains available."); await loadData(); } catch (error) { setActionMessage(`Sign-out failed: ${String(error)}`); } }}>Sign out</Button>
          </form>
        </Card>

        {/* Section 2: AI Provider Settings */}
        <Card className="border-[var(--hairline-strong)] space-y-4">
          <div className="flex items-center gap-2 border-b border-[var(--hairline)] pb-3">
            <Cpu className="w-4 h-4 text-[var(--ink-blue)]" />
            <h2 className="text-sm font-serif font-bold text-[var(--ink)]">AI Context Providers</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {providers.map((p) => (
              <div
                key={p.id}
                className={`p-3.5 rounded-[var(--radius-sm)] border transition-all ${
                  p.active
                    ? "bg-[var(--paper-subtle)] border-[var(--ink-blue)] shadow-[var(--shadow-subtle)]"
                    : "bg-[var(--paper)] border-[var(--hairline)]"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-serif font-bold text-[var(--ink)]">{p.name}</span>
                  <Badge variant={p.is_local ? "success" : "human"} className="font-mono">
                    {p.is_local ? "Offline Local" : "Cloud Hosted"}
                  </Badge>
                </div>
                <p className="text-[11px] text-[var(--ink-secondary)] leading-relaxed font-sans">
                  {p.is_local
                    ? "Runs entirely on your machine. Zero outbound traffic."
                    : "Sends the selected question, file paths, and retrieved excerpts to this provider when you run a query. Indexing remains local."}
                </p>
              </div>
            ))}
          </div>
        </Card>

        {/* Section 3: Groundwork Sync (Privacy First) */}
        <Card className="border-[var(--hairline-strong)] space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-[var(--ink-blue)]" />
              <h2 className="text-sm font-serif font-bold text-[var(--ink)]">Groundwork Sync (Optional)</h2>
            </div>
            {syncStatus?.enabled ? (
              <Badge variant="human" className="font-mono">
                <Cloud className="w-3.5 h-3.5 mr-1" />
                Active ({syncStatus.state})
              </Badge>
            ) : (
              <Badge variant="neutral" className="font-mono">
                <CloudOff className="w-3.5 h-3.5 mr-1" />
                Disabled (100% Local)
              </Badge>
            )}
          </div>

          <div className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--paper-subtle)] border border-[var(--hairline)] space-y-2">
            <div className="flex items-center gap-2 text-xs font-serif font-bold text-[var(--ink)]">
              <ShieldCheck className="w-4 h-4 text-[var(--signal)]" />
              Groundwork Privacy Model
            </div>
            <p className="text-xs text-[var(--ink-secondary)] leading-relaxed font-sans">
              Groundwork never synchronizes or uploads your files, source code, repositories, or full search index.
              Groundwork Sync is strictly limited to preferences, saved searches, and notes metadata across your paired devices.
            </p>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-[var(--ink-secondary)] font-sans">
              Cloud Service Endpoint:{" "}
              <span className="font-mono text-[var(--ink)] bg-[var(--paper)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">
                {syncStatus?.cloud_url || cloudUrl || "Loading service endpoint…"}
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTriggerSync}
              disabled={syncing}
              isLoading={syncing}
            >
              Test Connection / Trigger Sync
            </Button>
          </div>
        </Card>

        {/* Section 4: Diagnostics & Persistence Status */}
        {systemStatus && (
          <Card className="border-[var(--hairline-strong)] space-y-3">
            <div className="flex items-center gap-2 border-b border-[var(--hairline)] pb-3">
              <Database className="w-4 h-4 text-[var(--ink-blue)]" />
              <h2 className="text-sm font-serif font-bold text-[var(--ink)]">System &amp; Local Database Telemetry</h2>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
              <div className="bg-[var(--paper)] p-3 rounded-[var(--radius-sm)] border border-[var(--hairline)]">
                <span className="text-lg font-mono font-bold text-[var(--ink)] block">
                  {systemStatus.counts.workspaces}
                </span>
                <span className="text-[10px] font-mono text-[var(--ink-muted)] uppercase tracking-wider">Workspaces</span>
              </div>
              <div className="bg-[var(--paper)] p-3 rounded-[var(--radius-sm)] border border-[var(--hairline)]">
                <span className="text-lg font-mono font-bold text-[var(--ink-blue)] block">
                  {systemStatus.counts.projects}
                </span>
                <span className="text-[10px] font-mono text-[var(--ink-muted)] uppercase tracking-wider">Projects</span>
              </div>
              <div className="bg-[var(--paper)] p-3 rounded-[var(--radius-sm)] border border-[var(--hairline)]">
                <span className="text-lg font-mono font-bold text-[var(--success)] block">
                  {systemStatus.counts.files}
                </span>
                <span className="text-[10px] font-mono text-[var(--ink-muted)] uppercase tracking-wider">Indexed Files</span>
              </div>
              <div className="bg-[var(--paper)] p-3 rounded-[var(--radius-sm)] border border-[var(--hairline)]">
                <span className="text-lg font-mono font-bold text-[var(--ink-sepia)] block">
                  {systemStatus.counts.chunks}
                </span>
                <span className="text-[10px] font-mono text-[var(--ink-muted)] uppercase tracking-wider">Chunks &amp; AST</span>
              </div>
              <div className="bg-[var(--paper)] p-3 rounded-[var(--radius-sm)] border border-[var(--hairline)]">
                <span className="text-lg font-mono font-bold text-[var(--warning)] block">
                  {systemStatus.counts.notes}
                </span>
                <span className="text-[10px] font-mono text-[var(--ink-muted)] uppercase tracking-wider">Notes</span>
              </div>
            </div>

            <div className="pt-2 text-[11px] font-mono text-[var(--ink-muted)]">
              Database Path: <span className="text-[var(--ink)]">{systemStatus.database_path}</span>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};
export default SettingsView;
