import { useState } from "react";
import { Download, Menu, X } from "lucide-react";
import { BrandMark } from "../common/BrandMark";

export function Navbar({
  currentRoute,
  navigate,
}: {
  currentRoute: string;
  navigate: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const links = [
    { path: "/", label: "Overview" },
    { path: "/docs", label: "Getting started" },
    { path: "/changelog", label: "What's new" },
    { path: "/privacy", label: "Privacy" },
  ];
  const go = (path: string) => {
    navigate(path);
    setExpanded(false);
  };
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-[var(--surface)]/95 backdrop-blur">
      <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between gap-5">
        <button
          aria-label="Groundwork home"
          onClick={() => go("/")}
          className="flex items-center gap-3 font-semibold text-lg tracking-tight"
        >
          <span className="text-[var(--ink-blue)]">
            <BrandMark size={25} />
          </span>
          Groundwork
        </button>
        <nav
          aria-label="Main navigation"
          className="hidden md:flex items-center gap-6 text-sm"
        >
          {links.map((link) => (
            <button
              key={link.path}
              aria-current={
                (
                  link.path === "/"
                    ? currentRoute === "/"
                    : currentRoute.startsWith(link.path)
                )
                  ? "page"
                  : undefined
              }
              className="text-[var(--ink-secondary)] hover:text-[var(--ink-blue)]"
              onClick={() => go(link.path)}
            >
              {link.label}
            </button>
          ))}
        </nav>
        <div className="flex gap-3">
          <button
            className="site-primary text-sm"
            onClick={() => go("/download")}
          >
            <Download size={16} />
            <span>Download</span>
          </button>
          <button
            aria-label={expanded ? "Close menu" : "Open menu"}
            aria-expanded={expanded}
            className="md:hidden p-2"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {expanded && (
        <nav
          aria-label="Mobile navigation"
          className="md:hidden flex flex-col px-6 pb-5 gap-3"
        >
          {links.map((link) => (
            <button
              key={link.path}
              className="text-left py-2"
              onClick={() => go(link.path)}
            >
              {link.label}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}
