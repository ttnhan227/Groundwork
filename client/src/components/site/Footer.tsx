import React from "react";
import { HardDrive, GitBranch } from "lucide-react";
import { BrandMark } from "../common/BrandMark";

interface FooterProps {
  navigate: (path: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ navigate }) => {
  return (
    <footer className="bg-[var(--control-room)] border-t border-white/10 text-[var(--control-room-muted)] text-xs py-12">
      <div className="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-4 gap-8 mb-8 sm:px-6">
        {/* Brand Col */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center border border-white/25 bg-white/5 text-white">
              <BrandMark size={14} />
            </span>
            <span className="font-serif font-bold text-sm text-white">Groundwork</span>
          </div>
          <p className="text-[var(--control-room-muted)] text-xs leading-relaxed">
            Local-first workspace search, project intelligence, and AI context tool for developers.
          </p>
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--signal)] font-mono">
            <HardDrive className="w-3.5 h-3.5" />
            <span>100% Local by Default</span>
          </div>
        </div>

        {/* Product Col */}
        <div>
          <h4 className="text-white font-semibold text-xs mb-3 uppercase tracking-wider font-mono">Product</h4>
          <ul className="space-y-2">
            <li>
              <button onClick={() => navigate("/download")} className="hover:text-white transition-colors">
                Download for Windows
              </button>
            </li>
            <li>
              <button onClick={() => navigate("/download")} className="hover:text-white transition-colors">
                macOS & Linux (Roadmap)
              </button>
            </li>
            <li>
              <button onClick={() => navigate("/changelog")} className="hover:text-white transition-colors">
                Changelog & Releases
              </button>
            </li>
          </ul>
        </div>

        {/* Documentation Col */}
        <div>
          <h4 className="text-white font-semibold text-xs mb-3 uppercase tracking-wider font-mono">Documentation</h4>
          <ul className="space-y-2">
            <li>
              <button onClick={() => navigate("/docs/getting-started")} className="hover:text-white transition-colors">
                Getting Started
              </button>
            </li>
            <li>
              <button onClick={() => navigate("/docs/search")} className="hover:text-white transition-colors">
                Search & Ranking Architecture
              </button>
            </li>
            <li>
              <button onClick={() => navigate("/docs/ai")} className="hover:text-white transition-colors">
                AI Context Engine
              </button>
            </li>
            <li>
              <button onClick={() => navigate("/docs/sync")} className="hover:text-white transition-colors">
                Groundwork Sync
              </button>
            </li>
          </ul>
        </div>

        {/* Legal & Privacy Col */}
        <div>
          <h4 className="text-white font-semibold text-xs mb-3 uppercase tracking-wider font-mono">Security & Privacy</h4>
          <ul className="space-y-2">
            <li>
              <button onClick={() => navigate("/privacy")} className="hover:text-white transition-colors">
                Privacy Manifesto
              </button>
            </li>
            <li>
              <button onClick={() => navigate("/docs/privacy")} className="hover:text-white transition-colors">
                Security Architecture
              </button>
            </li>
            <li>
              <a
                href="https://github.com/ttnhan227/Groundwork"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 hover:text-white transition-colors"
              >
                <GitBranch className="w-3.5 h-3.5" />
                GitHub Repository
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-6 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4 text-[11px] text-[var(--control-room-muted)] sm:px-6">
        <div>
          &copy; {new Date().getFullYear()} Groundwork. Released under the Apache 2.0 License.
        </div>
        <div className="flex items-center gap-1 font-serif italic text-white/80">
          <span>The user's workspace belongs to the user's machine.</span>
        </div>
      </div>
    </footer>
  );
};
