import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React, { useState, useEffect } from "react";
import { DesktopCommandBar, ToolPanelHeader } from "./components/layout/DesktopCommandBar";
import { ExplorerWorkspace } from "./components/folders/ExplorerWorkspace";

import { GlobalSearchModal } from "./components/search/GlobalSearchModal";
import { ProjectsView } from "./components/projects/ProjectsView";
import { ActivityTimelineView } from "./components/activity/ActivityTimelineView";
import { ContextSessionsView } from "./components/sessions/ContextSessionsView";
import { AIInvestigationView } from "./components/ai/AIInvestigationView";
import { NotesView } from "./components/notes/NotesView";
import { SettingsView } from "./components/settings/SettingsView";
import { HomeView } from "./components/home/HomeView";
import { ComputerView } from "./components/computer/ComputerView";
import { FoldersView } from "./components/folders/FoldersView";
import { AccountDialog } from "./components/account/AccountDialog";
import { AccountView } from "./components/account/AccountView";
import { AISettingsView } from "./components/settings/AISettingsView";
import { api } from "./services/api";
import { SelectionProvider } from "./services/selection";
import { AssistantView } from "./components/assistant/AssistantView";
import { OrganizeView } from "./components/assistant/OrganizeView";
import type { Project, SearchResultItem } from "./types/api";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>("folders");
  const [expandedTool, setExpandedTool] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [resumedSummary, setResumedSummary] = useState("");
  const mainScroll = React.useRef<HTMLElement>(null);
  useEffect(() => {
    mainScroll.current?.scrollTo({ top: 0 });
    setExpandedTool(false);
  }, [activeTab]);
  const [accountDialog, setAccountDialog] = useState<
    "welcome" | "signin" | "link" | null
  >(null);
  const [accountRevision, setAccountRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const shouldWelcome = !localStorage.getItem("groundwork-welcome-complete");
    if (shouldWelcome)
      api
        .getSyncStatus()
        .then((status) => {
          if (!cancelled && !status.is_authenticated)
            setAccountDialog("welcome");
          if (status.is_authenticated)
            localStorage.setItem("groundwork-welcome-complete", "1");
        })
        .catch(() => {
          if (!cancelled) setAccountDialog("welcome");
        });
    return () => {
      cancelled = true;
    };
  }, []);
  const closeAccount = React.useCallback(() => {
    localStorage.setItem("groundwork-welcome-complete", "1");
    setAccountDialog(null);
  }, []);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [contentQuery, setContentQuery] = useState("");
  useEffect(() => {
    const openContents = (event: Event) => { setContentQuery((event as CustomEvent<string>).detail ?? ""); setIsSearchOpen(true); };
    window.addEventListener("groundwork-content-search", openContents);
    return () => window.removeEventListener("groundwork-content-search", openContents);
  }, []);
  const accountDialogRef = React.useRef(accountDialog);
  accountDialogRef.current = accountDialog;

  const [contextQuestion, setContextQuestion] = useState("");
  const [focusedFile, setFocusedFile] = useState<SearchResultItem | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>();

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("groundwork-search", () => {
      if (!accountDialogRef.current) window.dispatchEvent(new Event("groundwork-focus-search"));
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Keyboard shortcut listener for Ctrl+Space or Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (accountDialog) return;
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.code === "Space" || e.key.toLowerCase() === "k")
      ) {
        e.preventDefault();
        window.dispatchEvent(new Event("groundwork-focus-search"));
      } else if (e.key === "Escape" && isSearchOpen) {
        setIsSearchOpen(false);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault(); setContentQuery(""); setIsSearchOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSearchOpen, accountDialog]);

  const handleInvestigateProject = (project: Project) => {
    setFocusedFile(null);
    setSessionId(undefined);
    setContextQuestion(
      `Explain ${project.name}: its purpose, entry points, recent work, and current changes.`,
    );
    setSelectedProjectId(project.id);
    setActiveTab("ai");
  };

  const handleAskAIWithContext = (query: string, file: SearchResultItem) => {
    setSelectedFiles([file.path]);
    setResumedSummary("");
    setFocusedFile(file);
    setSessionId(undefined);
    setContextQuestion(
      `${query}  -  explain ${file.relative_path} at line ${file.line_number ?? 1}`,
    );
    setIsSearchOpen(false);
    setSelectedProjectId(file.project_id || null);
    setActiveTab("assistant");
  };

  const renderActiveView = () => {
    switch (activeTab) {
      case "assistant":
        return (
          <AssistantView
            initialQuestion={contextQuestion}
            savedSummary={resumedSummary}
          />
        );
      case "organize":
        return <OrganizeView />;
      case "home":
        return (
          <HomeView
            onNavigate={setActiveTab}
            onSearch={() => setIsSearchOpen(true)}
          />
        );
      case "computer":
        return <ComputerView />;
      case "folders":
        return <FoldersView />;
      case "account":
        return (
          <AccountView
            key={accountRevision}
            onSignIn={() => setAccountDialog("signin")}
            onLinkGoogle={() => setAccountDialog("link")}
            onChanged={() => setAccountRevision((previous) => previous + 1)}
          />
        );
      case "ai-settings":
        return <AISettingsView onBack={() => setActiveTab("ai")} />;
      case "projects":
        return <ProjectsView onInvestigateProject={handleInvestigateProject} />;
      case "activity":
        return <ActivityTimelineView selectedProjectId={selectedProjectId} />;
      case "sessions":
        return (
          <ContextSessionsView
            selectedProjectId={null}
            onResume={(session) => {
              setSelectedFiles(session.files_inspected || []);
              setResumedSummary(session.summary || "");
              setFocusedFile(null);
              setSessionId(session.id);
              setSelectedProjectId(session.project_id);
              setContextQuestion(
                `Continue ${session.title}. Review the saved findings and remaining tasks against current files.`,
              );
              setActiveTab("assistant");
            }}
          />
        );
      case "ai":
        return (
          <AIInvestigationView
            onChooseFiles={() => setActiveTab("folders")}
            onConfigure={() => setActiveTab("ai-settings")}
            selectedProjectId={selectedProjectId}
            initialQuestion={contextQuestion}
            focusedPath={focusedFile?.path}
            focusedLine={focusedFile?.line_number || 1}
            sessionId={sessionId}
          />
        );
      case "notes":
        return <NotesView selectedProjectId={null} />;
      case "settings":
        return (
          <SettingsView onConfigureAI={() => setActiveTab("ai-settings")} />
        );
      default:
        return <ProjectsView onInvestigateProject={handleInvestigateProject} />;
    }
  };

  return (
    <SelectionProvider
      navigate={setActiveTab}
      selected={selectedFiles}
      setSelected={setSelectedFiles}
    >
      <div className="desktop-shell">
        <DesktopCommandBar active={activeTab} onTool={(tab) => setActiveTab(tab === "home" || tab === "projects" ? "folders" : tab)}
          onSearch={() => window.dispatchEvent(new Event("groundwork-focus-search"))} />
        <div className="desktop-work-area">
          <ExplorerWorkspace />
          {!["folders", "home", "projects"].includes(activeTab) && <aside className={`desktop-tool-panel ${expandedTool ? "is-expanded" : ""}`} aria-label="Tool panel">
            <ToolPanelHeader active={activeTab} expanded={expandedTool} toggle={() => setExpandedTool(value => !value)} close={() => setActiveTab("folders")} />
            <main ref={mainScroll} className="desktop-tool-content">{renderActiveView()}</main>
          </aside>}
        </div>
        {/* Global Spotlight Search Modal */}
        <GlobalSearchModal
          isOpen={isSearchOpen && !accountDialog}
          onClose={() => setIsSearchOpen(false)}
          selectedProjectId={null}
          initialMode="lexical"
          initialQuery={contentQuery}
          onAskAIWithContext={handleAskAIWithContext}
        />
        {accountDialog && (
          <AccountDialog
            welcome={accountDialog === "welcome"}
            link={accountDialog === "link"}
            onClose={closeAccount}
            onConnected={() => {
              closeAccount();
              setAccountRevision((previous) => previous + 1);
              setActiveTab("account");
            }}
          />
        )}
      </div>
    </SelectionProvider>
  );
};

export default App;
