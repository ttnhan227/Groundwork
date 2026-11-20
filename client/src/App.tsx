import { useEffect, useState } from "react";
import { Navbar } from "./components/site/Navbar";
import { Footer } from "./components/site/Footer";
import { LandingPage } from "./pages/LandingPage";
import { DownloadPage } from "./pages/DownloadPage";
import { DocsPage } from "./pages/DocsPage";
import { ChangelogPage } from "./pages/ChangelogPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ProductInfoPage } from "./pages/ProductInfoPage";
import { NotFoundPage } from "./pages/NotFoundPage";

const ROUTE_TITLES: Record<string, string> = {
  "/": "Groundwork — Windows storage analyzer, duplicate cleaner and hardware inspector",
  "/download": "Downloads — Groundwork",
  "/docs": "Documentation — Groundwork",
  "/changelog": "Changelog — Groundwork",
  "/privacy": "Privacy — Groundwork",
  "/resources": "Resources — Groundwork",
  "/about": "About — Groundwork",
  "/contributors": "Contributors — Groundwork",
  "/contact": "Support & Contact — Groundwork",
};

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

function getTitleForPath(path: string): string {
  if (path.startsWith("/docs")) return ROUTE_TITLES["/docs"];
  return ROUTE_TITLES[path] ?? "Page not found (404) — Groundwork";
}

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() =>
    normalizePath(window.location.pathname || "/"),
  );

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(normalizePath(window.location.pathname || "/"));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    document.title = getTitleForPath(currentPath);
  }, [currentPath]);

  const navigate = (path: string) => {
    const target = normalizePath(path);
    if (target !== currentPath) {
      window.history.pushState({}, "", target);
      setCurrentPath(target);
    }
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  };

  const renderCurrentPage = () => {
    if (
      ["/resources", "/about", "/contributors", "/contact"].includes(
        currentPath,
      )
    ) {
      return (
        <ProductInfoPage page={currentPath.slice(1)} navigate={navigate} />
      );
    }
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
    if (currentPath === "/") {
      return <LandingPage navigate={navigate} />;
    }
    return <NotFoundPage navigate={navigate} />;
  };

  return (
    <div className="product-site">
      <a className="product-skip" href="#main-content">
        Skip to content
      </a>
      <Navbar currentRoute={currentPath} navigate={navigate} />
      <main
        id="main-content"
        tabIndex={-1}
        className={currentPath === "/" ? "product-home" : "product-inner"}
      >
        {renderCurrentPage()}
      </main>
      <Footer navigate={navigate} />
    </div>
  );
}
