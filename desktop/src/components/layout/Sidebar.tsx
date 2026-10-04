import React, { useEffect, useState } from "react";
import {
  Search,
  FolderGit2,
  Clock,
  BookmarkCheck,
  BrainCircuit,
  FileText,
  Settings,
  HardDrive,
  RefreshCw,
} from "lucide-react";
import { api } from "../../services/api";
import type { IndexProgress } from "../../types/api";
import { BrandMark } from "../common/BrandMark";
import { Badge } from "../ui";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenSearch: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  onOpenSearch,
}) => {
  const [progress, setProgress] = useState<IndexProgress | null>(null);

  useEffect(() => {
    const fetchProgress = async () => {
      try {
        const data = await api.getIndexProgress();
        setProgress(data);
      } catch {
        setProgress(null);
      }
    };
    fetchProgress();
    const interval = setInterval(fetchProgress, 3000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { id: "projects", label: "Projects", icon: FolderGit2 },
    { id: "activity", label: "Timeline", icon: Clock },
    { id: "sessions", label: "Resume Work", icon: BookmarkCheck },
    { id: "ai", label: "AI Context", icon: BrainCircuit },
    { id: "notes", label: "Notes", icon: FileText },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <aside className="w-64 bg-[var(--surface)] border-r border-[var(--hairline)] flex flex-col justify-between shrink-0 h-screen select-none">
      {/* Brand Header */}
      <div>
        <div className="p-4 flex items-center justify-between border-b border-[var(--hairline)] bg-[var(--surface)]">
          <div className="flex items-center space-x-2.5">
            <span className="flex h-7 w-7 items-center justify-center border border-[var(--hairline-strong)] bg-[var(--paper-subtle)] text-[var(--ink-blue)] shadow-[var(--shadow-subtle)] rounded-[var(--radius-sm)]">
              <BrandMark size={16} />
            </span>
            <div>
              <span className="font-serif font-bold text-base tracking-tight text-[var(--ink)] block">
                Groundwork
              </span>
              <span className="text-[10px] text-[var(--ink-muted)] font-mono flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse inline-block" />
                Local Workstation
              </span>
            </div>
          </div>
        </div>

        {/* Global Search Shortcut Button */}
        <div className="p-3">
          <button
            onClick={onOpenSearch}
            className="w-full flex items-center justify-between px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--paper)] border border-[var(--hairline)] text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:border-[var(--ink-blue)] hover:bg-[var(--surface-hover)] transition-all text-xs group shadow-[var(--shadow-subtle)] cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-[var(--ink-blue)]" />
              <span>Search workspace...</span>
            </span>
            <kbd className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--paper-subtle)] border border-[var(--hairline)] text-[var(--ink)] font-mono font-bold">
              Ctrl+Space
            </kbd>
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="px-2 space-y-1 mt-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-sm)] text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? "bg-[var(--control-room)] text-white shadow-[var(--shadow-subtle)]"
                    : "text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-white" : "text-[var(--ink-muted)]"}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer / Indexing Status Widget */}
      <div className="p-3 border-t border-[var(--hairline)] bg-[var(--paper-subtle)]">
        {progress && progress.status === "indexing" ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-[var(--ink)]">
              <span className="flex items-center gap-1.5 font-mono font-bold text-[var(--ink-blue)]">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Indexing...
              </span>
              <span className="font-mono text-[var(--ink-secondary)] font-bold">{progress.percent}%</span>
            </div>
            <div className="w-full bg-[var(--hairline)] h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-[var(--ink-blue)] h-full transition-all duration-300 rounded-full"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="text-[10px] text-[var(--ink-secondary)] truncate font-mono">
              {progress.current_file || `${progress.files_indexed} files`}
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[11px] text-[var(--ink-secondary)]">
            <span className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
              <span>Workspace Index</span>
            </span>
            <span className="font-mono text-[10px] text-[var(--ink-muted)] font-semibold">
              {progress ? `${progress.status} · ${progress.files_indexed} updated` : "Unavailable"}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
};
export default Sidebar;
