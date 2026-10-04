import React, { useEffect, useState } from "react";
import { Cloud, CloudOff, Folder, AlertTriangle, Search } from "lucide-react";
import { api } from "../../services/api";
import type { Project, SystemStatus } from "../../types/api";
import { Badge, Button } from "../ui";

interface HeaderProps {
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onOpenSearch: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  selectedProjectId,
  onSelectProject,
  onOpenSearch,
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [coreStatus, setCoreStatus] = useState<SystemStatus | null>(null);
  const [isCoreOnline, setIsCoreOnline] = useState<boolean>(false);
  const [coreError, setCoreError] = useState<string>("Starting local service…");
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
      setCoreError("");
    } catch (error) {
      setIsCoreOnline(false);
      setCoreError(String(error));
      return;
    }
    api.listProjects().then(setProjects).catch(() => {});
    api.getSyncStatus().then(setSyncStatus).catch(() => setSyncStatus((previous) => ({...previous, state: "unavailable"})));
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-12 border-b border-[var(--hairline)] bg-[var(--surface)] px-4 flex items-center justify-between shrink-0 select-none shadow-[var(--shadow-subtle)]">
      {/* Project Context Selector */}
      <div className="flex items-center gap-2">
        <Folder className="w-3.5 h-3.5 text-[var(--ink-muted)] shrink-0" />
        <select
          value={selectedProjectId || ""}
          onChange={(e) => onSelectProject(e.target.value ? e.target.value : null)}
          className="bg-[var(--paper)] border border-[var(--hairline)] text-[var(--ink)] text-xs rounded-[var(--radius-sm)] px-2.5 py-1 focus:outline-none focus:border-[var(--ink-blue)] font-sans hover:border-[var(--hairline-strong)] transition-colors cursor-pointer"
        >
          <option value="">All Workspace Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.detected_type})
            </option>
          ))}
        </select>

        <Button
          variant="ghost"
          size="xs"
          onClick={onOpenSearch}
          className="hidden sm:inline-flex text-[var(--ink-secondary)] text-[11px] font-mono gap-1 ml-2"
        >
          <Search size={12} className="text-[var(--ink-blue)]" />
          <span>Quick Find</span>
          <kbd className="text-[9px] px-1 py-0.2 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)]">
            Ctrl+Space
          </kbd>
        </Button>
      </div>

      {/* Status Badges */}
      <div className="flex items-center gap-2.5">
        {/* Core Connectivity Status */}
        {isCoreOnline ? (
          <Badge variant="success" icon={<span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />}>
            Core Active (v{coreStatus?.app_version || "1.0.0"})
          </Badge>
        ) : (
          <Badge variant="danger" title={coreError} icon={<AlertTriangle className="w-3 h-3 text-[var(--danger)]" />}>
            Local core unavailable
          </Badge>
        )}

        {/* Sync Status Badge */}
        {syncStatus.enabled ? (
          <Badge variant="human" icon={<Cloud className="w-3 h-3 text-[var(--ink-blue)]" />}>
            Sync: {syncStatus.state}
          </Badge>
        ) : (
          <Badge variant="neutral" icon={<CloudOff className="w-3 h-3 text-[var(--ink-muted)]" />}>
            100% Local
          </Badge>
        )}
      </div>
    </header>
  );
};
export default Header;
