import React, { useState } from "react";
import {
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  ShieldCheck,
  Lock,
  Unlock,
  Download,
  FileText,
  FileCheck2,
  FileCode,
  RefreshCw,
  Sparkles,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import type { Workspace, NativeDocument, DeliverableReadiness } from "../../types";

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
  isSidebarOpen: boolean;
  isSourcesOpen?: boolean;
  isRightPanelOpen?: boolean;
  onToggleSidebar: () => void;
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
  isSidebarOpen,
  isSourcesOpen = true,
  isRightPanelOpen = true,
  onToggleSidebar,
  onToggleSources,
  onToggleRightPanel,
  onOpenAudit,
  onExport,
}) => {
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  return (
    <header className="h-12 border-b border-[var(--hairline)] bg-[var(--surface)] px-3 sm:px-4 flex items-center justify-between select-none z-20 min-w-0 w-full">
      {/* Left: Sidebar Toggle + Breadcrumb */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Button
          variant="ghost"
          size="xs"
          onClick={onToggleSidebar}
          className="text-[var(--ink-muted)] hover:text-[var(--ink)] flex-shrink-0"
          title={isSidebarOpen ? "Collapse sidebar" : "Open sidebar"}
          aria-label={isSidebarOpen ? "Collapse sidebar" : "Open sidebar"}
        >
          {isSidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
        </Button>

        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)] min-w-0 flex-1">
          <span className="truncate max-w-[100px] sm:max-w-[140px] text-[var(--ink-secondary)] font-medium">
            {workspace.name}
          </span>
          <ChevronRight size={12} className="text-[var(--ink-faint)] flex-shrink-0" />
          <span className="font-serif font-semibold text-[13px] text-[var(--ink)] truncate max-w-[120px] sm:max-w-[200px]">
            {activeDoc?.title || "Untitled Document"}
          </span>
          {activeDoc?.revision && (
            <span className="hidden xs:inline text-[10px] font-mono px-1 py-0.2 rounded bg-[var(--paper-subtle)] text-[var(--ink-muted)] flex-shrink-0">
              v{activeDoc.revision}
            </span>
          )}
        </nav>
      </div>

      {/* Center: Evidence Grounding Pill & Agent Working Status */}
      <div className="hidden lg:flex items-center gap-3 px-2 flex-shrink-0">
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-full)] bg-[var(--paper-subtle)] border border-[var(--hairline)] text-xs text-[var(--ink-secondary)] font-medium"
          title={`${selectedSourcesCount} of ${sourcesCount} documents actively used for claim grounding`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
          <span>{selectedSourcesCount} Sources Grounded</span>
        </div>

        {isAgentRunning && (
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-full)] bg-[var(--ink-sepia-subtle)] border border-[var(--ink-sepia-border)] text-xs text-[var(--ink-sepia)] font-mono font-medium animate-pulse"
            role="status"
          >
            <RefreshCw size={11} className="spin text-[var(--ink-sepia)]" />
            <span className="truncate max-w-[150px]">{activeAgentStepLabel || "Agent drafting…"}</span>
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
            isExportBlocked
              ? `${openFindingsCount} unverified claims require review before export.`
              : "All claims verified against active source documentation."
          }
        >
          <ShieldCheck size={14} className="text-current flex-shrink-0" />
          <span className="font-semibold">{readinessScore}%</span>
          <span className="hidden md:inline text-[11px] opacity-80">
            {isExportBlocked ? `${openFindingsCount} Issues` : "Verified"}
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
                ? "Export is blocked until all review findings are verified"
                : "Export deliverable"
            }
          >
            {isExportBlocked ? <Lock size={12} /> : <Unlock size={12} />}
            <span>Export</span>
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
                  <p className="text-[11px] font-semibold text-[var(--ink)]">Export Verified Deliverable</p>
                  <p className="text-[10px] text-[var(--ink-muted)]">Includes Cryptographic Provenance</p>
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
                  <span className="text-[10px] font-mono text-[var(--success)] font-medium">Ready</span>
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
                  <span className="text-[10px] font-mono text-[var(--success)] font-medium">Ready</span>
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
                  <span className="text-[10px] font-mono text-[var(--success)] font-medium">Ready</span>
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
              title={isRightPanelOpen ? "Collapse audit panel" : "Open audit panel"}
              aria-label={isRightPanelOpen ? "Collapse audit panel" : "Open audit panel"}
            >
              {isRightPanelOpen ? <PanelRightClose size={15} /> : <PanelRight size={15} />}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};

export default TopBar;
