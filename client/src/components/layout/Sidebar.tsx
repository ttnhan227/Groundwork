import React from "react";
import {
  FileText,
  Plus,
  Search,
  Settings,
  Sun,
  Moon,
  ChevronRight,
  ChevronDown,
  Layers,
  PanelLeftClose,
  CheckCircle2,
} from "lucide-react";
import type { Workspace, NativeDocument, AuthResult } from "../../types";
import { BrandMark } from "../common/BrandMark";
import { Button } from "../ui/Button";

export interface SidebarProps {
  auth: AuthResult;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  nativeDocs: NativeDocument[];
  activeDocId: string | null;
  isOpen: boolean;
  activeTheme: "light" | "dark";
  onToggleOpen: () => void;
  onSelectWorkspace: (wsId: string) => void;
  onSelectDoc: (docId: string) => void;
  onCreateDoc?: (workspaceId: string) => void;
  onDeleteWorkspace?: (workspaceId: string) => void;
  onRenameWorkspace?: (workspaceId: string) => void;
  onOpenCommandPalette: () => void;
  onOpenAccount: () => void;
  onBackToLibrary: () => void;
  onToggleTheme: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  auth,
  workspaces,
  activeWorkspaceId,
  nativeDocs,
  activeDocId,
  isOpen,
  activeTheme,
  onToggleOpen,
  onSelectWorkspace,
  onSelectDoc,
  onCreateDoc,
  onOpenCommandPalette,
  onOpenAccount,
  onBackToLibrary,
  onToggleTheme,
}) => {
  const [expandedWorkspaces, setExpandedWorkspaces] = React.useState<
    Record<string, boolean>
  >(() => {
    return activeWorkspaceId ? { [activeWorkspaceId]: true } : {};
  });

  const toggleExpand = (wsId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedWorkspaces((prev) => ({ ...prev, [wsId]: !prev[wsId] }));
  };

  return (
    <aside
      className={`h-screen flex-shrink-0 flex flex-col bg-[var(--paper)] border-r border-[var(--hairline)] transition-[width,opacity] duration-300 ease-in-out select-none z-30 overflow-hidden ${
        isOpen
          ? "w-[260px] opacity-100"
          : "w-0 opacity-0 border-r-0 pointer-events-none"
      }`}
      aria-hidden={!isOpen}
    >
      {/* Fixed-width content container ensures contents never squash during slide transitions */}
      <div className="w-[260px] h-full flex flex-col flex-shrink-0 min-w-0">
        {/* Top Brand & Workspace Switcher */}
        <div className="p-3 border-b border-[var(--hairline-subtle)] flex items-center justify-between min-w-0">
          <button
            type="button"
            className="flex items-center gap-2 px-1.5 py-1 rounded-[var(--radius-sm)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors flex-1 min-w-0"
            onClick={onBackToLibrary}
            title="All responses"
          >
            <BrandMark size={18} />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-serif text-[13px] font-bold text-[var(--ink)] leading-tight truncate">
                Groundwork
              </span>
              <span className="text-[10px] text-[var(--ink-muted)] truncate">
                {auth.user.display_name}
              </span>
            </div>
          </button>

          <Button
            variant="ghost"
            size="xs"
            onClick={onToggleOpen}
            className="text-[var(--ink-muted)] hover:text-[var(--ink)] flex-shrink-0 ml-1"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={15} />
          </Button>
        </div>

        {/* Quick Action Navigation */}
        <div className="p-2 space-y-0.5 border-b border-[var(--hairline-subtle)] min-w-0">
          <button
            onClick={onOpenCommandPalette}
            className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] rounded-[var(--radius-sm)] transition-colors group cursor-pointer min-w-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Search
                size={14}
                className="text-[var(--ink-muted)] group-hover:text-[var(--ink)] flex-shrink-0"
              />
              <span className="truncate">Quick search</span>
            </div>
            <kbd className="text-[10px] font-mono px-1 py-0.5 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] text-[var(--ink-muted)] flex-shrink-0">
              ⌘K
            </kbd>
          </button>

        </div>

        {/* Page Tree / Workspaces Section */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3 min-w-0">
          <div>
            <div className="flex items-center justify-between px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--ink-faint)]">
              <button
                type="button"
                onClick={onBackToLibrary}
                className="hover:text-[var(--ink)]"
              >
                Responses
              </button>
            </div>

            <div className="space-y-0.5 mt-0.5">
              {workspaces.map((ws) => {
                const isActiveWs = ws.id === activeWorkspaceId;
                const isExpanded = Boolean(
                  expandedWorkspaces[ws.id] ?? isActiveWs,
                );
                const wsDocs = nativeDocs.filter(
                  (d) => d.workspace_id === ws.id,
                );

                return (
                  <div key={ws.id} className="group/ws">
                    {/* Workspace Row */}
                    <div
                      className={`flex items-center justify-between px-2 py-1.5 rounded-[var(--radius-sm)] text-xs transition-colors cursor-pointer min-w-0 ${
                        isActiveWs
                          ? "bg-[var(--surface)] text-[var(--ink)] font-semibold shadow-[var(--shadow-subtle)] border border-[var(--hairline)]"
                          : "text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                      }`}
                      onClick={() => onSelectWorkspace(ws.id)}
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <button
                          onClick={(e) => toggleExpand(ws.id, e)}
                          className="text-[var(--ink-muted)] hover:text-[var(--ink)] p-0.5 -ml-1 rounded flex-shrink-0"
                        >
                          {isExpanded ? (
                            <ChevronDown size={12} />
                          ) : (
                            <ChevronRight size={12} />
                          )}
                        </button>
                        <Layers
                          size={13}
                          className={
                            isActiveWs
                              ? "text-[var(--ink-blue)] flex-shrink-0"
                              : "text-[var(--ink-muted)] flex-shrink-0"
                          }
                        />
                        <span className="truncate">{ws.name}</span>
                      </div>

                      {/* Hover Actions */}
                      <div className="opacity-60 group-hover/ws:opacity-100 group-focus-within/ws:opacity-100 flex items-center gap-0.5 transition-opacity flex-shrink-0">
                        {onCreateDoc && (
                          <Button
                            variant="ghost"
                            size="xs"
                            className="h-5 w-5 p-0 text-[var(--ink-muted)] hover:text-[var(--ink)]"
                            onClick={(e) => {
                              e.stopPropagation();
                              onCreateDoc(ws.id);
                            }}
                            title="Add response draft"
                          >
                            <Plus size={12} />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Nested Deliverables/Documents */}
                    {isExpanded && (
                      <div className="pl-4 pr-1 mt-0.5 space-y-0.5 border-l border-[var(--hairline-subtle)] ml-3 min-w-0">
                        {wsDocs.map((doc) => {
                          const isActiveDoc = doc.id === activeDocId;
                          return (
                            <div
                              key={doc.id}
                              onClick={() => {
                                onSelectWorkspace(ws.id);
                                onSelectDoc(doc.id);
                              }}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-xs)] text-xs cursor-pointer transition-colors min-w-0 ${
                                isActiveDoc
                                  ? "bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] font-medium"
                                  : "text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                              }`}
                            >
                              <FileText
                                size={12}
                                className={
                                  isActiveDoc
                                    ? "text-[var(--ink-blue)] flex-shrink-0"
                                    : "text-[var(--ink-faint)] flex-shrink-0"
                                }
                              />
                              <span className="truncate flex-1">
                                {doc.title || "Untitled response"}
                              </span>
                              {doc.status === "complete" && (
                                <CheckCircle2
                                  size={10}
                                  className="text-[var(--success)] ml-auto flex-shrink-0"
                                />
                              )}
                            </div>
                          );
                        })}

                        {wsDocs.length === 0 && (
                          <div className="px-2 py-1 text-[11px] text-[var(--ink-faint)] italic">
                            No response drafts yet
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer / User & Theme toggles */}
        <div className="p-2 border-t border-[var(--hairline-subtle)] flex items-center justify-between text-xs text-[var(--ink-muted)] min-w-0">
          <button
            onClick={onOpenAccount}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] transition-colors cursor-pointer min-w-0"
          >
            <Settings size={14} className="flex-shrink-0" />
            <span className="truncate">Settings</span>
          </button>

          <Button
            variant="ghost"
            size="xs"
            onClick={onToggleTheme}
            className="text-[var(--ink-muted)] hover:text-[var(--ink)] flex-shrink-0"
            title={activeTheme === "dark" ? "Light Mode" : "Dark Mode"}
            aria-label="Toggle theme"
          >
            {activeTheme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </Button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
