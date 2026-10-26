import { useEffect, useState } from "react";
import { Navbar } from "./components/site/Navbar";
import { Footer } from "./components/site/Footer";
import { LandingPage } from "./pages/LandingPage";
import { DownloadPage } from "./pages/DownloadPage";
import { DocsPage } from "./pages/DocsPage";
import { ChangelogPage } from "./pages/ChangelogPage";
import { PrivacyPage } from "./pages/PrivacyPage";

import { ProductInfoPage } from "./pages/ProductInfoPage";

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
    return <LandingPage navigate={navigate} />;
  };

  return (
    <div className="product-site">
      <a className="product-skip" href="#main-content">
        Skip to content
      </a>
      <div className="product-announcement">
        Groundwork for macOS is in development.{" "}
        <button onClick={() => navigate("/about")}>View the roadmap</button>
      </div>
      <Navbar currentRoute={currentPath} navigate={navigate} />
      <main
        id="main-content"
        className={currentPath === "/" ? "product-home" : "product-inner"}
      >
        {renderCurrentPage()}
      </main>
      <Footer navigate={navigate} />
    </div>
  );
}
