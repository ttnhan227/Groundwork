import React, { useState } from "react";
import {
  Search,
  FolderGit2,
  Clock,
  BookmarkCheck,
  BrainCircuit,
  HardDrive,
  Download,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Terminal,
  GitCommit,
  CheckCircle2,
  FileCode,
  Layers,
  Cpu,
  Check,
  Lock,
} from "lucide-react";

interface LandingPageProps {
  navigate: (path: string) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ navigate }) => {
  const [activePreviewTab, setActivePreviewTab] = useState<
    "search" | "projects" | "timeline" | "sessions" | "ai"
  >("search");

  return (
    <div className="bg-[var(--paper)] text-[var(--ink)] min-h-screen font-sans selection:bg-[var(--ink-sepia-subtle)] selection:text-[var(--ink)]">
      {/* Hero Section */}
      <section className="relative pt-16 pb-20 border-b border-[var(--hairline-strong)] bg-[var(--paper)]">
        <div className="max-w-5xl mx-auto px-4 text-center relative z-10">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] text-[var(--ink-blue)] text-xs font-mono mb-6">
            <span className="w-2 h-2 rounded-full bg-[var(--ink-blue)] animate-pulse" />
            Groundwork 1.0 — Local-First Workspace Architecture
          </div>

          {/* Primary Headline */}
          <h1 className="text-4xl sm:text-6xl font-serif font-bold tracking-tight text-[var(--ink)] mb-6 leading-tight">
            Find what you were <br className="hidden sm:inline" />
            <span className="text-[var(--ink-blue)]">
              working on.
            </span>
          </h1>

          {/* Supporting Headline */}
          <p className="text-base sm:text-lg text-[var(--ink-secondary)] max-w-2xl mx-auto mb-8 leading-relaxed">
            Groundwork helps you find, understand, and resume work scattered across your computer.
            A local-first workspace search, project intelligence, and AI context tool for developers.
          </p>

          {/* Supporting Concepts Ribbon */}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-xs text-[var(--ink-secondary)] font-mono mb-10">
            <span className="px-2.5 py-1 rounded bg-[var(--surface)] border border-[var(--hairline)] shadow-xs">Your files</span>
            <span className="text-[var(--ink-faint)]">•</span>
            <span className="px-2.5 py-1 rounded bg-[var(--surface)] border border-[var(--hairline)] shadow-xs">Your projects</span>
            <span className="text-[var(--ink-faint)]">•</span>
            <span className="px-2.5 py-1 rounded bg-[var(--surface)] border border-[var(--hairline)] shadow-xs">Your Git history</span>
            <span className="text-[var(--ink-faint)]">•</span>
            <span className="px-2.5 py-1 rounded bg-[var(--surface)] border border-[var(--hairline)] shadow-xs">Your notes</span>
            <span className="text-[var(--ink-faint)]">•</span>
            <span className="px-2.5 py-1 rounded bg-[var(--surface)] border border-[var(--hairline)] shadow-xs">Your context</span>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => navigate("/download")}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 bg-[var(--control-room)] hover:bg-[var(--control-room-hover)] text-white font-bold text-sm shadow-[var(--shadow-card)] transition-colors"
            >
              <Download className="w-4 h-4" />
              Download for Windows (Tauri 2)
            </button>
            <button
              onClick={() => navigate("/docs")}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--hairline-strong)] text-[var(--ink)] font-semibold text-sm transition-colors"
            >
              <span>Explore Documentation</span>
              <ArrowRight className="w-4 h-4 text-[var(--ink-muted)]" />
            </button>
          </div>

          <p className="text-[11px] text-[var(--ink-muted)] mt-4 font-mono">
            Zero cloud requirement • 100% offline ready • Windows 10/11 x64
          </p>
        </div>
      </section>

      {/* The Problem We Solve */}
      <section className="py-14 border-b border-[var(--hairline)] bg-[var(--paper-subtle)]">
        <div className="max-w-4xl mx-auto px-4">
          <div className="p-8 rounded-lg bg-[var(--surface)] border border-[var(--hairline-strong)] shadow-[var(--shadow-card)] relative">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded border border-[var(--ink-sepia-border)] bg-[var(--ink-sepia-subtle)] flex items-center justify-center shrink-0 mt-1">
                <Clock className="w-5 h-5 text-[var(--ink-sepia)]" />
              </div>
              <div className="space-y-3">
                <span className="text-xs font-mono uppercase tracking-wider text-[var(--ink-sepia)] font-bold">
                  The Developer Reality
                </span>
                <blockquote className="text-base sm:text-lg font-serif italic text-[var(--ink)] leading-relaxed">
                  "I have files, repositories, notes, logs, documents, projects, and unfinished work scattered across my computer. I often lose track of where something is or what I was doing. Groundwork helps me find it, understand it, and continue from where I left off."
                </blockquote>
                <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">
                  Unlike generic document chatbots or SaaS dashboards, Groundwork operates right on your machine. It indexes your codebase, detects projects, remembers open files and tasks, tracks Git events, and synthesizes answers bounded strictly by real local citations.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Desktop Showcase Preview */}
      <section className="py-16 max-w-6xl mx-auto px-4">
        <div className="text-center mb-10">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)] mb-2">
            Inspection &amp; Retrieval Engine
          </p>
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--ink)] mb-3">
            Spotlight speed. Project intelligence.
          </h2>
          <p className="text-sm text-[var(--ink-secondary)] max-w-xl mx-auto">
            Experience the 5 core capabilities built directly into the lightweight Tauri desktop app.
          </p>

          {/* Navigation Pill Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
            {[
              { id: "search", label: "Global Spotlight Search", icon: Search },
              { id: "projects", label: "Project Intelligence", icon: FolderGit2 },
              { id: "timeline", label: "Activity Timeline", icon: Clock },
              { id: "sessions", label: "Resume Work Sessions", icon: BookmarkCheck },
              { id: "ai", label: "Grounded AI Context", icon: BrainCircuit },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activePreviewTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActivePreviewTab(tab.id as any)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded text-xs font-semibold transition-all ${
                    isActive
                      ? "bg-[var(--control-room)] text-white shadow-sm"
                      : "bg-[var(--surface)] text-[var(--ink-secondary)] hover:text-[var(--ink)] border border-[var(--hairline)]"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Feature Display Window */}
        <div className="bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg shadow-[var(--shadow-card)] overflow-hidden">
          {/* Window Titlebar */}
          <div className="bg-[var(--paper-subtle)] border-b border-[var(--hairline)] px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--danger)]"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--warning)]"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--success)]"></span>
              <span className="ml-2 text-xs font-mono font-semibold text-[var(--ink)]">
                Groundwork Desktop — {activePreviewTab.toUpperCase()}
              </span>
            </div>
            <span className="text-[11px] font-mono text-[var(--success)] flex items-center gap-1.5 font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
              127.0.0.1:8000 (Local Core)
            </span>
          </div>

          {/* Window Body */}
          <div className="p-6 bg-[var(--paper)] min-h-[380px]">
            {activePreviewTab === "search" && (
              <div className="space-y-4 max-w-3xl mx-auto">
                {/* Search Bar Mockup */}
                <div className="flex items-center gap-3 px-4 py-3 rounded bg-[var(--surface)] border border-[var(--ink-blue)] shadow-xs">
                  <Search className="w-4 h-4 text-[var(--ink-blue)]" />
                  <span className="text-sm text-[var(--ink)] font-mono font-medium">auth middleware token</span>
                  <span className="ml-auto text-xs font-mono text-[var(--ink-muted)]">Hybrid Search (9.4ms)</span>
                </div>

                {/* Results Mockup */}
                <div className="space-y-2">
                  <div className="p-3.5 rounded bg-[var(--surface)] border border-[var(--hairline)] hover:border-[var(--ink-blue)] transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-bold text-[var(--ink-blue)]">server/app/core/security.py</span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] font-mono font-bold">Score: 0.984</span>
                    </div>
                    <p className="text-xs font-mono text-[var(--ink-secondary)] line-clamp-1 bg-[var(--paper-subtle)] p-1.5 rounded border border-[var(--hairline-subtle)]">
                      def verify_confirmation_token(token: str) -&gt; bool: ...
                    </p>
                  </div>

                  <div className="p-3.5 rounded bg-[var(--surface)] border border-[var(--hairline)]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-bold text-[var(--ink)]">cloud/app/core/security.py</span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--paper-subtle)] text-[var(--ink-secondary)] font-mono">Score: 0.892</span>
                    </div>
                    <p className="text-xs font-mono text-[var(--ink-secondary)] line-clamp-1 bg-[var(--paper-subtle)] p-1.5 rounded border border-[var(--hairline-subtle)]">
                      def create_access_token(data: dict) -&gt; str: ...
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activePreviewTab === "projects" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded bg-[var(--surface)] border border-[var(--hairline)]">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-serif font-bold text-sm text-[var(--ink)]">Groundwork Server</h3>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] font-mono font-bold">FastAPI</span>
                  </div>
                  <p className="text-xs text-[var(--ink-secondary)] mb-3">Local workspace indexing, SQLite WAL database, and Git inspector.</p>
                  <div className="flex items-center gap-2 text-xs font-mono text-[var(--ink-muted)]">
                    <GitCommit className="w-3.5 h-3.5 text-[var(--ink-sepia)]" />
                    <span>commit 4a9f3b2: hybrid ranking engine</span>
                  </div>
                </div>

                <div className="p-4 rounded bg-[var(--surface)] border border-[var(--hairline)]">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-serif font-bold text-sm text-[var(--ink)]">Groundwork Desktop</h3>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] font-mono font-bold">Tauri 2 + React</span>
                  </div>
                  <p className="text-xs text-[var(--ink-secondary)] mb-3">Native desktop client with global spotlight shortcut and instant UI.</p>
                  <div className="flex items-center gap-2 text-xs font-mono text-[var(--ink-muted)]">
                    <FileCode className="w-3.5 h-3.5 text-[var(--ink-blue)]" />
                    <span>src/components/search/GlobalSearchModal.tsx</span>
                  </div>
                </div>
              </div>
            )}

            {activePreviewTab === "timeline" && (
              <div className="max-w-2xl mx-auto space-y-3">
                <div className="p-4 rounded bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)]">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-[var(--ink-blue)]" />
                    <span className="font-bold text-xs text-[var(--ink)] font-serif">Synthesized Activity (Last 2 Days)</span>
                  </div>
                  <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">
                    You worked on SQLite WAL FTS5 schemas, implemented the hybrid ranking formula, and verified 100% search recall across benchmark queries.
                  </p>
                </div>

                <div className="p-3 rounded bg-[var(--surface)] border border-[var(--hairline)] flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-mono text-[var(--ink)]">
                    <GitCommit className="w-3.5 h-3.5 text-[var(--ink-sepia)]" />
                    Git commit: feat: implement SQLite WAL and FTS5 indices
                  </span>
                  <span className="text-[10px] font-mono text-[var(--ink-muted)]">2 hours ago</span>
                </div>
              </div>
            )}

            {activePreviewTab === "sessions" && (
              <div className="max-w-2xl mx-auto p-4 rounded bg-[var(--surface)] border border-[var(--hairline)] space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-serif font-bold text-[var(--ink)]">Refactoring Search Engine &amp; Ranking</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--success-bg)] text-[var(--success)] border border-[var(--success-border)] font-mono font-bold">
                    ACTIVE SESSION
                  </span>
                </div>
                <p className="text-xs text-[var(--ink-secondary)]">
                  Inspected 4 files • 2/3 tasks completed • Saved local working memory
                </p>
                <div className="space-y-1.5 text-xs text-[var(--ink-secondary)] font-mono">
                  <div className="text-[var(--success)] font-bold">[✓] Verify SQLite FTS5 BM25 scoring</div>
                  <div className="text-[var(--success)] font-bold">[✓] Compute 384-d semantic vector cosine similarity</div>
                  <div className="text-[var(--ink-muted)]">[ ] Run latency benchmark against 10,000 files</div>
                </div>
              </div>
            )}

            {activePreviewTab === "ai" && (
              <div className="max-w-2xl mx-auto space-y-3">
                <div className="p-4 rounded bg-[var(--surface)] border border-[var(--hairline)] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--ink)] flex items-center gap-1.5 font-serif">
                      <BrainCircuit className="w-4 h-4 text-[var(--ink-blue)]" />
                      Q: Where is path sanitization handled?
                    </span>
                    <span className="text-[10px] font-mono text-[var(--ink-muted)]">Offline Local Provider</span>
                  </div>
                  <p className="text-xs text-[var(--ink-secondary)] leading-relaxed bg-[var(--paper-subtle)] p-3 rounded border border-[var(--hairline-subtle)] font-mono">
                    Path sanitization and directory traversal prevention are implemented in <code className="text-[var(--ink-blue)] font-bold">server/app/core/security.py</code> using <code className="text-[var(--ink-blue)] font-bold">sanitize_path()</code>. It resolves relative paths against authorized workspace roots and raises <code className="text-[var(--danger)] font-bold">SecurityError</code> on unauthorized access.
                  </p>
                  <div className="flex items-center gap-2 pt-1 text-[11px] font-mono text-[var(--ink-muted)]">
                    <span>Evidence: server/app/core/security.py (L22-L46)</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Local-First Principles */}
      <section className="py-16 border-t border-[var(--hairline-strong)] bg-[var(--paper-subtle)]">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)] mb-2">
              Architecture &amp; Security
            </p>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--ink)] mb-2">
              Built on strict local-first principles.
            </h2>
            <p className="text-xs sm:text-sm text-[var(--ink-secondary)]">
              The user's workspace belongs to the user's machine. Period.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded bg-[var(--surface)] border border-[var(--hairline)] shadow-xs">
              <HardDrive className="w-6 h-6 text-[var(--ink-blue)] mb-3" />
              <h3 className="font-serif font-bold text-sm text-[var(--ink)] mb-1.5">100% Offline Capable</h3>
              <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">
                Search files, browse Git history, view timeline, and generate AI insights completely without an internet connection.
              </p>
            </div>

            <div className="p-6 rounded bg-[var(--surface)] border border-[var(--hairline)] shadow-xs">
              <ShieldCheck className="w-6 h-6 text-[var(--signal)] mb-3" />
              <h3 className="font-serif font-bold text-sm text-[var(--ink)] mb-1.5">Zero Silent Uploads</h3>
              <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">
                Groundwork never uploads your source code, PDFs, or private files. Cloud sync is strictly opt-in and restricted to preferences and notes.
              </p>
            </div>

            <div className="p-6 rounded bg-[var(--surface)] border border-[var(--hairline)] shadow-xs">
              <Terminal className="w-6 h-6 text-[var(--ink-sepia)] mb-3" />
              <h3 className="font-serif font-bold text-sm text-[var(--ink)] mb-1.5">Bounded AI Tools</h3>
              <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">
                AI features are grounded by real file symbols and AST nodes. Mutating actions require explicit single-use user authorization.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="py-20 border-t border-[var(--hairline-strong)] text-center bg-[var(--paper)]">
        <div className="max-w-3xl mx-auto px-4">
          <h2 className="text-3xl font-serif font-bold text-[var(--ink)] mb-4">
            Never lose track of your work again.
          </h2>
          <p className="text-sm text-[var(--ink-secondary)] mb-8">
            Install Groundwork in seconds. Point it at your projects directory. Press Ctrl+Space to search.
          </p>
          <button
            onClick={() => navigate("/download")}
            className="inline-flex items-center gap-2 px-8 py-4 bg-[var(--control-room)] hover:bg-[var(--control-room-hover)] text-white font-bold text-sm shadow-[var(--shadow-card)] transition-colors"
          >
            <Download className="w-4 h-4" />
            Download Groundwork for Windows
          </button>
        </div>
      </section>
    </div>
  );
};
