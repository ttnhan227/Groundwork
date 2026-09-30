import React from "react";
import { Download, BookOpen, ShieldCheck, History } from "lucide-react";
import { BrandMark } from "../common/BrandMark";

interface NavbarProps {
  currentRoute: string;
  navigate: (path: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentRoute, navigate }) => {
  return (
    <header className="sticky top-0 z-50 h-14 border-b border-white/10 bg-[var(--control-room)]/95 px-4 text-white backdrop-blur sm:px-6">
      <div className="max-w-7xl mx-auto h-full flex items-center justify-between gap-4">
        {/* Brand */}
        <div
          onClick={() => navigate("/")}
          className="flex items-center gap-2.5 cursor-pointer select-none group"
        >
          <span className="flex h-7 w-7 items-center justify-center border border-white/25 bg-white/5 text-white shadow-sm">
            <BrandMark size={16} />
          </span>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-base font-bold tracking-tight text-white">
              Groundwork
            </span>
            <span className="hidden sm:inline border-l border-white/15 pl-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--control-room-muted)]">
              Local Workspace Search
            </span>
          </div>
        </div>

        {/* Links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-[var(--control-room-muted)]">
          <button
            onClick={() => navigate("/")}
            className={`transition-colors hover:text-white ${
              currentRoute === "/" ? "text-white font-bold" : ""
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => navigate("/docs")}
            className={`flex items-center gap-1.5 transition-colors hover:text-white ${
              currentRoute.startsWith("/docs") ? "text-white font-bold" : ""
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Documentation
          </button>
          <button
            onClick={() => navigate("/changelog")}
            className={`flex items-center gap-1.5 transition-colors hover:text-white ${
              currentRoute === "/changelog" ? "text-white font-bold" : ""
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Changelog
          </button>
          <button
            onClick={() => navigate("/privacy")}
            className={`flex items-center gap-1.5 transition-colors hover:text-white ${
              currentRoute === "/privacy" ? "text-white font-bold" : ""
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Privacy
          </button>
        </nav>

        {/* Download CTA */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/download")}
            className="inline-flex h-9 items-center justify-center gap-2 border border-white/20 bg-white px-4 text-xs font-bold text-[var(--control-room)] transition-colors hover:bg-[#eef1f5] active:scale-98 shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-[var(--ink-blue)]" />
            <span>Download Desktop</span>
          </button>
        </div>
      </div>
    </header>
  );
};
