import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React, { useState, useEffect } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { GlobalSearchModal } from "./components/search/GlobalSearchModal";
import { ProjectsView } from "./components/projects/ProjectsView";
import { ActivityTimelineView } from "./components/activity/ActivityTimelineView";
import { ContextSessionsView } from "./components/sessions/ContextSessionsView";
import { AIInvestigationView } from "./components/ai/AIInvestigationView";
import { NotesView } from "./components/notes/NotesView";
import { SettingsView } from "./components/settings/SettingsView";
import type { Project, SearchResultItem } from "./types/api";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>("projects");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);

  const [contextQuestion, setContextQuestion] = useState("");
  const [focusedFile, setFocusedFile] = useState<SearchResultItem | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>();

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("groundwork-search", () => setIsSearchOpen(true)).then((cleanup) => {
      if (cancelled) cleanup(); else unlisten = cleanup;
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  // Keyboard shortcut listener for Ctrl+Space or Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.code === "Space" || e.key.toLowerCase() === "k")) {
        e.preventDefault();
        if (e.code === "Space") setIsSearchOpen(true); else setIsSearchOpen((prev) => !prev);
      } else if (e.key === "Escape" && isSearchOpen) {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSearchOpen]);

  const handleInvestigateProject = (project: Project) => {
    setFocusedFile(null);
    setSessionId(undefined);
    setContextQuestion(`Explain ${project.name}: its purpose, entry points, recent work, and current changes.`);
    setSelectedProjectId(project.id);
    setActiveTab("ai");
  };

  const handleAskAIWithContext = (query: string, file: SearchResultItem) => {
    setFocusedFile(file);
    setSessionId(undefined);
    setContextQuestion(`${query}  -  explain ${file.relative_path} at line ${file.line_number ?? 1}`);
    setIsSearchOpen(false);
    setSelectedProjectId(file.project_id || null);
    setActiveTab("ai");
  };

  const renderActiveView = () => {
    switch (activeTab) {
      case "projects":
        return <ProjectsView onInvestigateProject={handleInvestigateProject} />;
      case "activity":
        return <ActivityTimelineView selectedProjectId={selectedProjectId} />;
      case "sessions":
        return <ContextSessionsView selectedProjectId={selectedProjectId} onResume={(session) => { setFocusedFile(null); setSessionId(session.id); setSelectedProjectId(session.project_id); setContextQuestion(`Continue ${session.title}. Review the saved findings and remaining tasks against current files.`); setActiveTab("ai"); }} />;
      case "ai":
        return <AIInvestigationView selectedProjectId={selectedProjectId} initialQuestion={contextQuestion} focusedPath={focusedFile?.path} focusedLine={focusedFile?.line_number || 1} sessionId={sessionId} />;
      case "notes":
        return <NotesView selectedProjectId={selectedProjectId} />;
      case "settings":
        return <SettingsView />;
      default:
        return <ProjectsView onInvestigateProject={handleInvestigateProject} />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--paper)] text-[var(--ink)]">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenSearch={() => setIsSearchOpen(true)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <Header
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          onOpenSearch={() => setIsSearchOpen(true)}
        />
        <main className="flex-1 flex min-h-0 overflow-y-auto relative bg-[var(--paper)]">
          {renderActiveView()}
        </main>
      </div>

      {/* Global Spotlight Search Modal */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        selectedProjectId={selectedProjectId}
        onAskAIWithContext={handleAskAIWithContext}
      />
    </div>
  );
};

export default App;
