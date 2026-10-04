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
  Home,
  FolderOpen,
  UserRound,
} from "lucide-react";
import { api } from "../../services/api";
import type { IndexProgress } from "../../types/api";
import { BrandMark } from "../common/BrandMark";

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
    { id: "home", label: "Home", icon: Home },
    { id: "folders", label: "Folders", icon: FolderOpen },
    { id: "projects", label: "Projects", icon: FolderGit2 },
    { id: "activity", label: "Recent activity", icon: Clock },
    { id: "sessions", label: "Saved work", icon: BookmarkCheck },
    { id: "ai", label: "Ask your files", icon: BrainCircuit },
    { id: "notes", label: "Notes", icon: FileText },
  ];

  return (
    <aside className="w-56 bg-[var(--surface)] border-r border-[var(--hairline)] flex flex-col justify-between shrink-0 h-screen select-none">
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
              <span className="text-xs text-[var(--ink-muted)] flex items-center gap-1">
                Your work, within reach
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
              <span>Search files</span>
            </span>
            <kbd className="px-1.5 py-0.5 rounded text-xs bg-[var(--paper-subtle)] border border-[var(--hairline)] text-[var(--ink)] font-mono font-bold">
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
                aria-current={isActive ? "page" : undefined}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-[var(--radius-sm)] text-sm font-medium transition-all cursor-pointer ${
                  isActive
                    ? "bg-[var(--control-room)] text-white shadow-[var(--shadow-subtle)]"
                    : "text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${isActive ? "text-white" : "text-[var(--ink-muted)]"}`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer / Indexing Status Widget */}
      <div className="p-3 border-t border-[var(--hairline)] bg-[var(--paper-subtle)]">
        <div className="space-y-1 mb-4">
          {[
            { id: "account", label: "Account", icon: UserRound },
            { id: "settings", label: "Settings", icon: Settings },
          ].map((item) => (
            <button
              key={item.id}
              aria-current={activeTab === item.id ? "page" : undefined}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg text-sm font-medium ${activeTab === item.id ? "bg-[var(--surface)] text-[var(--ink-blue)]" : "text-[var(--ink-secondary)] hover:bg-[var(--surface)]"}`}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </div>
        {progress && progress.status === "indexing" ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm text-[var(--ink)]">
              <span className="flex items-center gap-1.5 font-mono font-bold text-[var(--ink-blue)]">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Preparing your files…
              </span>
              <span className="font-mono text-[var(--ink-secondary)] font-bold">
                {progress.percent}%
              </span>
            </div>
            <div className="w-full bg-[var(--hairline)] h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-[var(--ink-blue)] h-full transition-all duration-300 rounded-full"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="text-xs text-[var(--ink-secondary)] truncate font-mono">
              {progress.current_file || `${progress.files_indexed} files`}
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between text-sm text-[var(--ink-secondary)]">
            <span className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
              <span>Your files</span>
            </span>
            <span className="text-xs text-[var(--ink-muted)] font-medium">
              {progress
                ? ["scanning", "indexing"].includes(progress.status)
                  ? "Preparing…"
                  : progress.status === "failed"
                    ? "Needs attention"
                    : "Ready to search"
                : "Starting…"}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
};
export default Sidebar;
