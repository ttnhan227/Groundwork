import { useEffect, useState } from "react";
import { Navbar } from "./components/site/Navbar";
import { Footer } from "./components/site/Footer";
import { LandingPage } from "./pages/LandingPage";
import { DownloadPage } from "./pages/DownloadPage";
import { DocsPage } from "./pages/DocsPage";
import { ChangelogPage } from "./pages/ChangelogPage";
import { PrivacyPage } from "./pages/PrivacyPage";

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() => {
    return window.location.pathname || "/";
  });

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname || "/");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const renderCurrentPage = () => {
    if (currentPath === "/download") {
      return <DownloadPage />;
    }
    if (currentPath.startsWith("/docs")) {
      const parts = currentPath.split("/").filter(Boolean);
      const sub = parts[1] || "getting-started";
      return <DocsPage initialSection={sub} />;
    }
    if (currentPath === "/changelog") {
      return <ChangelogPage />;
    }
    if (currentPath === "/privacy") {
      return <PrivacyPage />;
    }
    return <LandingPage navigate={navigate} />;
  };

  return (
    <div className="flex flex-col min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <Navbar currentRoute={currentPath} navigate={navigate} />
      <div className="flex-1">
        {renderCurrentPage()}
      </div>
      <Footer navigate={navigate} />
    </div>
  );
}
