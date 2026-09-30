import React, { useEffect, useState } from "react";
import { Cloud, CloudOff, Folder, CheckCircle, AlertTriangle } from "lucide-react";
import { api } from "../../services/api";
import type { Project, SystemStatus } from "../../types/api";

interface HeaderProps {
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onOpenSearch: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  selectedProjectId,
  onSelectProject,
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [coreStatus, setCoreStatus] = useState<SystemStatus | null>(null);
  const [isCoreOnline, setIsCoreOnline] = useState<boolean>(true);
  const [syncStatus, setSyncStatus] = useState<{
    enabled: boolean;
    state: string;
    pending_items: number;
  }>({ enabled: false, state: "local_only", pending_items: 0 });

  const checkHealth = async () => {
    try {
      const status = await api.getSystemStatus();
      setCoreStatus(status);
      setIsCoreOnline(true);
      const proj = await api.listProjects();
      setProjects(proj);
      const sync = await api.getSyncStatus();
      setSyncStatus(sync);
    } catch {
      setIsCoreOnline(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-12 border-b border-[var(--hairline)] bg-[var(--surface)] px-4 flex items-center justify-between shrink-0 select-none">
      {/* Project Context Selector */}
      <div className="flex items-center gap-2">
        <Folder className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
        <select
          value={selectedProjectId || ""}
          onChange={(e) => onSelectProject(e.target.value ? e.target.value : null)}
          className="bg-[var(--paper)] border border-[var(--hairline)] text-[var(--ink)] text-xs rounded px-2.5 py-1 focus:outline-none focus:border-[var(--ink-blue)] font-sans"
        >
          <option value="">All Workspace Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.detected_type})
            </option>
          ))}
        </select>
      </div>

      {/* Status Badges */}
      <div className="flex items-center gap-3">
        {/* Core Connectivity Status */}
        {isCoreOnline ? (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] bg-[var(--success-bg)] border border-[var(--success-border)] text-[var(--success)] font-mono font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse"></span>
            <span>Core Active (v{coreStatus?.app_version || "1.0.0"})</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger)] font-mono font-bold">
            <AlertTriangle className="w-3 h-3 text-[var(--danger)]" />
            <span>Core Offline (Waiting for 127.0.0.1:8000)</span>
          </div>
        )}

        {/* Sync Status Badge */}
        {syncStatus.enabled ? (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] text-[var(--ink-blue)] font-mono font-bold">
            <Cloud className="w-3 h-3 text-[var(--ink-blue)]" />
            <span>Sync: {syncStatus.state}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] bg-[var(--paper-subtle)] border border-[var(--hairline)] text-[var(--ink-secondary)] font-mono font-semibold">
            <CloudOff className="w-3 h-3 text-[var(--ink-muted)]" />
            <span>100% Local</span>
          </div>
        )}
      </div>
    </header>
  );
};
