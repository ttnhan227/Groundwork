import { useEffect, useState } from "react";
import { LandingPage } from "./features/landing/LandingPage";
import { WorkspaceApp } from "./features/workspace/WorkspaceApp";

export default function App() {
  const [appOpen, setAppOpen] = useState(
    () => new URLSearchParams(window.location.search).has("app"),
  );
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);

  useEffect(() => {
    const syncRoute = () => setAppOpen(new URLSearchParams(window.location.search).has("app"));
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  function openApp() {
    window.history.pushState({}, "", "/?app=1");
    setAppOpen(true);
    window.scrollTo({ top: 0 });
  }

  function closeApp() {
    window.history.pushState({}, "", "/");
    setAppOpen(false);
    window.scrollTo({ top: 0 });
  }

  return appOpen
    ? <WorkspaceApp pendingUpload={pendingUpload} onPendingUploadHandled={() => setPendingUpload(null)} onExit={closeApp} />
    : <LandingPage onOpen={openApp} onUpload={(file) => { setPendingUpload(file); openApp(); }} />;
}
