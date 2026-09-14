import React, { useState } from "react";
import {
  PanelLeft,
  PanelRight,
  PanelRightClose,
  ShieldCheck,
  Lock,
  Unlock,
  FileText,
  FileCheck2,
  FileCode,
  RefreshCw,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { Button } from "../ui/Button";
import type { Workspace, NativeDocument } from "../../types";

export interface TopBarProps {
  workspace: Workspace;
  activeDoc: NativeDocument | null;
  sourcesCount: number;
  selectedSourcesCount: number;
  isAgentRunning: boolean;
  activeAgentStepLabel?: string;
  readinessScore: number;
  isExportBlocked: boolean;
  openFindingsCount: number;
  readinessStatus: "setup_needed" | "needs_review" | "ready" | null;
  readinessBlockers: string[];
  isSidebarOpen: boolean;
  isSourcesOpen?: boolean;
  isRightPanelOpen?: boolean;
  onToggleSidebar: () => void;
  onBackToLibrary: () => void;
  onToggleSources?: () => void;
  onToggleRightPanel?: () => void;
  onOpenAudit: () => void;
  onExport: (format: "pdf" | "docx" | "md") => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  workspace,
  activeDoc,
  sourcesCount,
  selectedSourcesCount,
  isAgentRunning,
  activeAgentStepLabel,
  readinessScore,
  isExportBlocked,
  openFindingsCount,
  readinessStatus,
  readinessBlockers,
  isSidebarOpen,
  isRightPanelOpen = true,
  onToggleSidebar,
  onBackToLibrary,
  onToggleRightPanel,
  onOpenAudit,
  onExport,
}) => {
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  React.useEffect(() => {
    if (!isExportMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsExportMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExportMenuOpen]);

  return (
    <header className="h-12 border-b border-[var(--hairline)] bg-[var(--surface)] px-3 sm:px-4 flex items-center justify-between select-none z-20 min-w-0 w-full">
      {/* Left: Sidebar Toggle (when collapsed) + Breadcrumb */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {!isSidebarOpen && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onToggleSidebar}
            className="text-[var(--ink-muted)] hover:text-[var(--ink)] flex-shrink-0"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <PanelLeft size={16} />
          </Button>
        )}

        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)] min-w-0 flex-1"
        >
          <button
            type="button"
            onClick={onBackToLibrary}
            className="sm:hidden inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--paper-subtle)] hover:text-[var(--ink-blue)] flex-shrink-0"
            title="All responses"
            aria-label="All responses"
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            onClick={onBackToLibrary}
            className="hidden sm:inline text-[var(--ink-muted)] hover:text-[var(--ink-blue)]"
          >
            All responses
          </button>
          <ChevronRight
            size={12}
            className="hidden sm:block text-[var(--ink-faint)] flex-shrink-0"
          />
          <span className="truncate max-w-[100px] sm:max-w-[140px] text-[var(--ink-secondary)] font-medium">
            {workspace.name}
          </span>
          <ChevronRight
            size={12}
            className="text-[var(--ink-faint)] flex-shrink-0"
          />
          <span className="font-serif font-semibold text-[13px] text-[var(--ink)] truncate max-w-[120px] sm:max-w-[200px]">
            {activeDoc?.title || "Response setup"}
          </span>
          {activeDoc?.revision && (
            <span className="hidden xs:inline text-[10px] font-mono px-1 py-0.2 rounded bg-[var(--paper-subtle)] text-[var(--ink-muted)] flex-shrink-0">
              v{activeDoc.revision}
            </span>
          )}
        </nav>
      </div>

      {/* Center: selected source and AI status */}
      <div className="hidden lg:flex items-center gap-3 px-2 flex-shrink-0">
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-full)] bg-[var(--paper-subtle)] border border-[var(--hairline)] text-xs text-[var(--ink-secondary)] font-medium"
          title={`${selectedSourcesCount} of ${sourcesCount} research documents selected as context`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ink-blue)]" />
          <span>{selectedSourcesCount} research sources</span>
        </div>

        {isAgentRunning && (
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-full)] bg-[var(--ink-sepia-subtle)] border border-[var(--ink-sepia-border)] text-xs text-[var(--ink-sepia)] font-mono font-medium animate-pulse"
            role="status"
          >
            <RefreshCw size={11} className="spin text-[var(--ink-sepia)]" />
            <span className="truncate max-w-[150px]">
              {activeAgentStepLabel || "Groundwork AI is working…"}
            </span>
          </div>
        )}
      </div>

      {/* Right: Readiness Score & Verification Export Gate */}
      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
        {/* Verification Readiness Widget */}
        <button
          onClick={onOpenAudit}
          className={`readiness-topbar-widget flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1 rounded-[var(--radius-sm)] border text-xs font-medium transition-colors cursor-pointer flex-shrink-0 ${
            isExportBlocked
              ? "bg-[var(--warning-bg)] border-[var(--warning-border)] text-[var(--warning)] hover:bg-[var(--paper-subtle)]"
              : "bg-[var(--success-bg)] border-[var(--success-border)] text-[var(--success)] hover:bg-[var(--paper-subtle)]"
          }`}
          title={
            !activeDoc
              ? "Create a response draft before review and export."
              : readinessBlockers.length > 0
                ? readinessBlockers.join(" · ")
              : isExportBlocked
                ? "Finish the response check before export."
                : "No blocking review findings are currently open."
          }
        >
          <ShieldCheck size={14} className="text-current flex-shrink-0" />
          <span className="font-semibold">
            {activeDoc && readinessStatus !== "setup_needed"
              ? `${readinessScore}%`
              : "Setup"}
          </span>
          <span className="hidden md:inline text-[11px] opacity-80">
            {!activeDoc
              ? "No draft"
              : readinessStatus === "setup_needed"
                ? "Needs mapping"
                : isExportBlocked
                  ? `${readinessBlockers.length || openFindingsCount} blockers`
                  : "Review clear"}
          </span>
        </button>

        {/* Export Gate Button with Dropdown */}
        <div className="relative flex-shrink-0">
          <Button
            variant={isExportBlocked ? "secondary" : "human"}
            size="sm"
            className="btn-export-gate"
            onClick={() => {
              if (isExportBlocked) {
                onOpenAudit();
              } else {
                setIsExportMenuOpen((prev) => !prev);
              }
            }}
            title={
              isExportBlocked
                ? !activeDoc
                  ? "Create a response draft before export"
                  : "Export is blocked until all review findings are verified"
                : "Export response"
            }
          >
            {isExportBlocked ? <Lock size={12} /> : <Unlock size={12} />}
            <span>Export response</span>
          </Button>

          {/* Export Dropdown Menu */}
          {isExportMenuOpen && !isExportBlocked && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setIsExportMenuOpen(false)}
              />
              <div className="absolute right-0 mt-1.5 w-52 bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-md)] shadow-[var(--shadow-popover)] p-1 z-40 animate-in fade-in zoom-in-95">
                <div className="px-2.5 py-1.5 border-b border-[var(--hairline-subtle)] mb-1">
                  <p className="text-[11px] font-semibold text-[var(--ink)]">
                    Export response
                  </p>
                  <p className="text-[10px] text-[var(--ink-muted)]">
                    Choose a file format
                  </p>
                </div>

                <button
                  onClick={() => {
                    setIsExportMenuOpen(false);
                    onExport("pdf");
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-[var(--ink)] hover:bg-[var(--surface-hover)] rounded-[var(--radius-xs)] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-[var(--ink-blue)]" />
                    <span>PDF Document</span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--success)] font-medium">
                    Ready
                  </span>
                </button>

                <button
                  onClick={() => {
                    setIsExportMenuOpen(false);
                    onExport("docx");
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-[var(--ink)] hover:bg-[var(--surface-hover)] rounded-[var(--radius-xs)] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <FileCheck2 size={14} className="text-[var(--ink-blue)]" />
                    <span>Word (.docx)</span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--success)] font-medium">
                    Ready
                  </span>
                </button>

                <button
                  onClick={() => {
                    setIsExportMenuOpen(false);
                    onExport("md");
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-[var(--ink)] hover:bg-[var(--surface-hover)] rounded-[var(--radius-xs)] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <FileCode size={14} className="text-[var(--ink-blue)]" />
                    <span>Markdown</span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--success)] font-medium">
                    Ready
                  </span>
                </button>
              </div>
            </>
          )}
          {/* Right Panel Toggle */}
          {onToggleRightPanel && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onToggleRightPanel}
              className="text-[var(--ink-muted)] hover:text-[var(--ink)] flex-shrink-0 ml-1"
              title={
                isRightPanelOpen ? "Collapse workspace tools" : "Open workspace tools"
              }
              aria-label={
                isRightPanelOpen ? "Collapse workspace tools" : "Open workspace tools"
              }
            >
              {isRightPanelOpen ? (
                <PanelRightClose size={15} />
              ) : (
                <PanelRight size={15} />
              )}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};

export default TopBar;
