import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React, { useState, useEffect } from "react";
import { DesktopCommandBar, ToolPanelHeader } from "./components/layout/DesktopCommandBar";
import { BackgroundTaskStatus } from "./components/layout/BackgroundTaskStatus";
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
import { CollectionsView } from "./components/collections/CollectionsView";
import { FilePreviewView } from "./components/folders/FilePreviewView";
import type { FileCollection } from "./services/api";
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

  const [questionRequest, setQuestionRequest] = useState(0);
  const [contextQuestion, setContextQuestion] = useState("");
  const [contextCollection, setContextCollection] = useState<FileCollection>();
  const [preview, setPreview] = useState<{path: string; line: number}>();
  const [readerFiles, setReaderFiles] = useState<string[]>([]);
  const [assistantFocus, setAssistantFocus] = useState<{path: string; line: number}>();
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{path: string; line?: number; automatic?: boolean; neighbors?: string[]}>).detail;
      if (!detail || typeof detail.path !== "string" ) return;
      setReaderFiles(detail.neighbors?.filter(path => typeof path === "string").slice(0, 1000) || [detail.path]);
      setPreview({path: detail.path, line: detail.line || 1});
      setActiveTab("preview"); setIsSearchOpen(false);
    };
    window.addEventListener("groundwork-preview", show);
    return () => window.removeEventListener("groundwork-preview", show);
  }, [activeTab]);
  const [focusedFile, setFocusedFile] = useState<SearchResultItem | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>();

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("groundwork-search", () => {
      if (!accountDialogRef.current) setContentQuery(""); setIsSearchOpen(true);
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
        setContentQuery(""); setIsSearchOpen(true);
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
    setContextCollection(undefined);
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
            requestId={questionRequest}
            compact={readingFile}
            savedSummary={resumedSummary}
            collectionId={contextCollection?.id}
            collectionName={contextCollection?.title}
            onClearCollection={() => {setContextCollection(undefined); setSelectedFiles([]);}}
            focusedLine={focusedFile && selectedFiles[0] === focusedFile.path ? focusedFile.line_number || 1 : assistantFocus && assistantFocus.path === selectedFiles[0] ? assistantFocus.line : 1}
          />
        );
      case "organize":
        return <OrganizeView />;
      case "preview":
        return null;
      case "collections":
        return <CollectionsView onAsk={(collection, question, paths = []) => {
          setContextCollection(collection); setSelectedFiles(paths); setFocusedFile(null);
          setContextQuestion(question); setResumedSummary(""); setActiveTab("assistant");
        }} />;
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
              setContextCollection(undefined);
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
            focusedLine={focusedFile && selectedFiles[0] === focusedFile.path ? focusedFile.line_number || 1 : 1}
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

  const readingFile = Boolean(preview && (activeTab === "preview" || (activeTab === "assistant" && selectedFiles.length === 1 && selectedFiles[0] === preview.path)));
  const readerIndex = preview ? readerFiles.indexOf(preview.path) : -1;
  const changeReaderFile = (offset: number) => {
    const path = readerFiles[readerIndex + offset];
    if (!path) return;
    setPreview({path, line: 1}); setSelectedFiles([path]); setContextCollection(undefined);
    setQuestionRequest(0); setContextQuestion(""); setFocusedFile(null); setActiveTab("preview");
  };
  const askFromReader = (question: string, line: number) => {
    if (!preview) return;
    setContextCollection(undefined); setSelectedFiles([preview.path]); setFocusedFile(null);
    setAssistantFocus({path: preview.path, line}); setContextQuestion(question);
    setQuestionRequest(Date.now()); setResumedSummary(""); setActiveTab("assistant");
  };
  return (
    <SelectionProvider
      navigate={(tab) => {setContextCollection(undefined); setActiveTab(tab);}}
      selected={selectedFiles}
      setSelected={setSelectedFiles}
    >
      <div className="desktop-shell">
        <DesktopCommandBar active={activeTab} onTool={(tab) => {setContextCollection(undefined); setActiveTab(tab === "home" || tab === "projects" ? "folders" : tab);}}
          onSearch={() => { setContentQuery(""); setIsSearchOpen(true); }} />
        <BackgroundTaskStatus active={activeTab} onNavigate={tab => {if(tab === 'assistant') setContextQuestion(''); setActiveTab(tab);}}/>
        <div className={`desktop-work-area ${readingFile ? "reader-work-area" : ""}`}>
          <div className="desktop-explorer-host" hidden={readingFile}><ExplorerWorkspace active={!readingFile && ["folders", "home", "projects"].includes(activeTab)} /></div>
          {readingFile && preview && <main className="desktop-reader" aria-label="File reader">
            <FilePreviewView key={preview.path} path={preview.path} line={preview.line} showAI={activeTab === "preview"} onBack={() => setActiveTab("folders")} onAsk={askFromReader} onPreviousFile={readerIndex > 0 ? () => changeReaderFile(-1) : undefined} onNextFile={readerIndex >= 0 && readerIndex < readerFiles.length - 1 ? () => changeReaderFile(1) : undefined}/>
          </main>}
          {!["folders", "home", "projects", "preview"].includes(activeTab) && <aside className={`desktop-tool-panel ${expandedTool ? "is-expanded" : ""}`} aria-label="Tool panel">
            <ToolPanelHeader active={activeTab} expanded={expandedTool} toggle={() => setExpandedTool(value => !value)} canExpand={!readingFile} close={() => setActiveTab(readingFile ? "preview" : "folders")} />
            {readingFile && <button className="assistant-return-file" onClick={() => setActiveTab("preview")}>Close Assistant · Keep reading</button>}
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
