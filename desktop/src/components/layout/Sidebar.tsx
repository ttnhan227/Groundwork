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
    { id: "folders", label: "Files", icon: FolderOpen },
    { id: "assistant", label: "Assistant", icon: BrainCircuit },
    { id: "collections", label: "Collections", icon: BookmarkCheck },
    { id: "organize", label: "Organize", icon: FolderOpen },
    { id: "computer", label: "Your computer", icon: HardDrive },
    { id: "projects", label: "Projects", icon: FolderGit2 },
    { id: "activity", label: "Recent activity", icon: Clock },
    { id: "sessions", label: "Saved work", icon: BookmarkCheck },
    { id: "notes", label: "Notes", icon: FileText },
  ];

  return (
    <aside className="w-16 md:w-56 overflow-y-auto bg-[var(--surface)] border-r border-[var(--hairline)] flex flex-col justify-between shrink-0 h-screen select-none">
      {/* Brand Header */}
      <div>
        <div className="p-4 flex items-center justify-between border-b border-[var(--hairline)] bg-[var(--surface)]">
          <div className="flex items-center space-x-2.5">
            <span className="flex h-7 w-7 items-center justify-center border border-[var(--hairline-strong)] bg-[var(--paper-subtle)] text-[var(--ink-blue)] shadow-[var(--shadow-subtle)] rounded-[var(--radius-sm)]">
              <BrandMark size={16} />
            </span>
            <div className="hidden md:block">
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
            aria-label="Find files"
            title="Find files (Ctrl+Space)"
            className="w-full flex items-center justify-between px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--paper)] border border-[var(--hairline)] text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:border-[var(--ink-blue)] hover:bg-[var(--surface-hover)] transition-all text-xs group shadow-[var(--shadow-subtle)] cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-[var(--ink-blue)]" />
              <span className="hidden md:inline">Find files</span>
            </span>
            <kbd className="hidden md:inline px-1.5 py-0.5 rounded text-xs bg-[var(--paper-subtle)] border border-[var(--hairline)] text-[var(--ink)] font-mono font-bold">
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
                aria-label={item.label}
                title={item.label}
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
                <span className="hidden md:inline">{item.label}</span>
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
                aria-label={item.label}
                title={item.label}
              aria-current={activeTab === item.id ? "page" : undefined}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg text-sm font-medium ${activeTab === item.id ? "bg-[var(--surface)] text-[var(--ink-blue)]" : "text-[var(--ink-secondary)] hover:bg-[var(--surface)]"}`}
            >
              <item.icon size={18} />
              <span className="hidden md:inline">{item.label}</span>
            </button>
          ))}
        </div>
        <div className="hidden md:block">
        {progress && progress.status === "indexing" ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm text-[var(--ink)]">
              <span className="flex items-center gap-1.5 font-mono font-bold text-[var(--ink-blue)]">
                <RefreshCw className="w-3 h-3 animate-spin" />
                {progress.phase === "scanning"
                  ? "Finding files…"
                  : progress.phase === "content_discovery"
                    ? "Finding readable files…"
                    : progress.phase === "projects"
                      ? "Finding projects…"
                      : progress.phase === "history"
                        ? "Reading history…"
                        : "Preparing files…"}
              </span>
              <span className="font-mono text-[var(--ink-secondary)] font-bold">
                {progress.phase === "indexing" || !progress.phase
                  ? `${progress.percent}%`
                  : ""}
              </span>
            </div>
            <div className="w-full bg-[var(--hairline)] h-1.5 rounded-full overflow-hidden">
              <div
                className={`bg-[var(--ink-blue)] h-full transition-all duration-300 rounded-full ${progress.phase && progress.phase !== "indexing" ? "animate-pulse" : ""}`}
                style={{
                  width:
                    progress.phase && progress.phase !== "indexing"
                      ? "40%"
                      : `${progress.percent}%`,
                }}
              />
            </div>
            <button
              className="text-xs underline"
              onClick={() => api.cancelIndexing()}
            >
              Cancel
            </button>
            <p className="text-xs text-[var(--ink-secondary)] truncate font-mono">
              {progress.phase === "scanning"
                ? `${(progress.files_inventoried ?? 0).toLocaleString()} files inventoried so far`
                : `${(progress.files_indexed + progress.files_skipped).toLocaleString()} / ${progress.files_discovered.toLocaleString()} files processed`}
            </p>
            <p
              className="text-xs text-[var(--ink-muted)] truncate"
              title={progress.current_file || undefined}
            >
              {progress.current_file || progress.current_workspace}
            </p>
          </div>
        ) : (
          <div
            title={progress?.errors.join("\n")}
            className="flex items-center justify-between text-sm text-[var(--ink-secondary)]"
          >
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
                    : progress.status === "cancelled"
                      ? "Cancelled: partial results"
                      : progress.status === "idle"
                        ? "Choose a folder"
                        : progress.errors.length
                          ? "Complete with errors"
                          : "Scan complete"
                : "Starting…"}
            </span>
          </div>
        )}
        </div>
      </div>
    </aside>
  );
};
export default Sidebar;
