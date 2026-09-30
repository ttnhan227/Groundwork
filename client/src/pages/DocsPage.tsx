import React, { useState } from "react";
import {
  BookOpen,
  Search,
  BrainCircuit,
  Cloud,
  ShieldCheck,
  Terminal,
  Layers,
  HardDrive,
  GitCommit,
  CheckCircle2,
} from "lucide-react";

interface DocsPageProps {
  initialSection?: string;
}

export const DocsPage: React.FC<DocsPageProps> = ({ initialSection = "getting-started" }) => {
  const [activeSection, setActiveSection] = useState<string>(initialSection);

  const sections = [
    { id: "getting-started", label: "Getting Started", icon: Terminal },
    { id: "search", label: "Universal Search & Ranking", icon: Search },
    { id: "ai", label: "AI Context Engine", icon: BrainCircuit },
    { id: "sync", label: "Groundwork Sync", icon: Cloud },
    { id: "privacy", label: "Privacy Architecture", icon: ShieldCheck },
  ];

  return (
    <div className="bg-[var(--paper)] text-[var(--ink)] min-h-screen py-10 px-4 font-sans">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-8">
        {/* Left Sidebar */}
        <aside className="w-full md:w-64 shrink-0 space-y-6">
          <div className="p-4 rounded bg-[var(--surface)] border border-[var(--hairline)] shadow-xs">
            <h3 className="text-xs font-mono font-bold text-[var(--ink)] uppercase tracking-wider mb-3 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[var(--ink-blue)]" />
              Documentation
            </h3>
            <nav className="space-y-1">
              {sections.map((sec) => {
                const Icon = sec.icon;
                const isActive = activeSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    onClick={() => setActiveSection(sec.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-semibold transition-colors ${
                      isActive
                        ? "bg-[var(--control-room)] text-white font-bold"
                        : "text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{sec.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="p-4 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] text-xs text-[var(--ink-secondary)] space-y-2">
            <span className="font-serif font-bold text-[var(--ink)] block text-sm">Offline Documentation</span>
            <p className="text-[11px] leading-relaxed">
              All documentation is also packaged directly into the Groundwork desktop client for offline consultation.
            </p>
          </div>
        </aside>

        {/* Right Content */}
        <main className="flex-1 bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg p-6 sm:p-10 shadow-[var(--shadow-card)] overflow-hidden">
          {activeSection === "getting-started" && (
            <article className="space-y-6">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)] mb-1">
                  Guide / 01
                </p>
                <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--ink)] mb-2">
                  Getting Started with Groundwork
                </h1>
                <p className="text-xs text-[var(--ink-secondary)]">
                  Setup, first indexing run, keyboard shortcuts, and architecture overview.
                </p>
              </div>

              <div className="space-y-4 text-xs text-[var(--ink-secondary)] leading-relaxed">
                <p>
                  Groundwork is built as a hybrid local application: a native <strong className="text-[var(--ink)]">Tauri 2</strong> desktop frontend communicating directly with a lightweight local Python / FastAPI service running at <code className="text-[var(--ink-blue)] font-mono bg-[var(--paper-subtle)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">127.0.0.1:8000</code>.
                </p>

                <h3 className="text-sm font-serif font-bold text-[var(--ink)] pt-2">Step 1: Configure Your First Workspace</h3>
                <p>
                  When you open Groundwork for the first time, navigate to the <strong className="text-[var(--ink)]">Settings</strong> tab. Enter the folder path where your projects, notes, or codebases reside (e.g. <code className="text-[var(--ink-blue)] font-mono bg-[var(--paper-subtle)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">C:\Users\username\Documents\projects</code>).
                </p>

                <h3 className="text-sm font-serif font-bold text-[var(--ink)] pt-2">Step 2: Background Indexing</h3>
                <p>
                  Groundwork immediately scans the workspace directory using incremental SHA-256 content hashing. It extracts symbols, functions, and classes using Python AST and language parsers, indexes text into an SQLite FTS5 database in WAL mode, and computes 384-dimensional local dense vector embeddings.
                </p>

                <h3 className="text-sm font-serif font-bold text-[var(--ink)] pt-2">Step 3: Global Shortcut (Spotlight)</h3>
                <p>
                  Press <kbd className="px-2 py-0.5 rounded bg-[var(--paper-subtle)] border border-[var(--hairline-strong)] text-[var(--ink)] font-mono font-bold">Ctrl+Space</kbd> (or <kbd className="px-2 py-0.5 rounded bg-[var(--paper-subtle)] border border-[var(--hairline-strong)] text-[var(--ink)] font-mono font-bold">Ctrl+K</kbd>) anywhere in the app to open the global Spotlight modal. Type queries to search across code snippets, documentation, commits, and notes in under 10 milliseconds.
                </p>
              </div>
            </article>
          )}

          {activeSection === "search" && (
            <article className="space-y-6">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)] mb-1">
                  Engine / 02
                </p>
                <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--ink)] mb-2">
                  {"Universal Search & Hybrid Ranking"}
                </h1>
                <p className="text-xs text-[var(--ink-secondary)]">
                  How Groundwork combines lexical FTS5, dense semantic vectors, filename matching, recency decay, and project boosting.
                </p>
              </div>

              <div className="space-y-4 text-xs text-[var(--ink-secondary)] leading-relaxed">
                <p>
                  Groundwork does not rely on a single retrieval strategy. Because developer queries range from exact variable names (<code className="text-[var(--ink-blue)] font-mono bg-[var(--paper-subtle)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">verify_confirmation_token</code>) to conceptual questions ("where is jwt expired handling?"), Groundwork executes a <strong className="text-[var(--ink)]">multi-signal hybrid scoring formula</strong>:
                </p>

                <div className="bg-[var(--control-room)] p-4 rounded border border-black/20 font-mono text-[11px] text-[var(--control-room-muted)] space-y-1">
                  <div>score = 0.40 × S_lexical (SQLite FTS5 BM25)</div>
                  <div>      + 0.35 × S_semantic (Dense Vector Cosine Similarity)</div>
                  <div>      + 0.15 × S_filename (Filename exact/partial match)</div>
                  <div>      + 0.05 × S_recency (Exponential decay on file mtime)</div>
                  <div>      + 0.05 × S_project (Active project boost)</div>
                </div>

                <h3 className="text-sm font-serif font-bold text-[var(--ink)] pt-2">FTS5 Full-Text Search</h3>
                <p>
                  The local SQLite database leverages virtual tables with the BM25 ranking algorithm, tokenizing alphanumeric words and identifiers. This provides sub-millisecond retrieval for exact symbol references and variable names.
                </p>

                <h3 className="text-sm font-serif font-bold text-[var(--ink)] pt-2">Dense Semantic Embeddings</h3>
                <p>
                  Groundwork generates 384-dimensional normalized vectors locally. When searching conceptually, cosine similarity matches chunks that describe the query even when exact keywords differ.
                </p>
              </div>
            </article>
          )}

          {activeSection === "ai" && (
            <article className="space-y-6">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)] mb-1">
                  Intelligence / 03
                </p>
                <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--ink)] mb-2">
                  {"AI Context Engine & Investigation"}
                </h1>
                <p className="text-xs text-[var(--ink-secondary)]">
                  Grounded investigation, citations drawer, bounded tools, and single-use confirmation security.
                </p>
              </div>

              <div className="space-y-4 text-xs text-[var(--ink-secondary)] leading-relaxed">
                <p>
                  Unlike generic AI chatbots that guess file contents, Groundwork's AI Context Engine retrieves real files, functions, and commit history from your local index.
                </p>

                <h3 className="text-sm font-serif font-bold text-[var(--ink)] pt-2">Grounding &amp; Citations</h3>
                <p>
                  Every investigation synthesizes answers accompanied by exact file paths and line ranges. You can click any citation to instantly open or reveal the file in your code editor.
                </p>

                <h3 className="text-sm font-serif font-bold text-[var(--ink)] pt-2">Offline Local LLMs (Ollama)</h3>
                <p>
                  Groundwork integrates natively with local Ollama instances (<code className="text-[var(--ink-blue)] font-mono bg-[var(--paper-subtle)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">llama3</code>, <code className="text-[var(--ink-blue)] font-mono bg-[var(--paper-subtle)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">mistral</code>, <code className="text-[var(--ink-blue)] font-mono bg-[var(--paper-subtle)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">qwen</code>). Your code and queries never leave your computer.
                </p>

                <h3 className="text-sm font-serif font-bold text-[var(--ink)] pt-2">Bounded Tool Execution</h3>
                <p>
                  When the AI suggests running shell commands (such as <code className="text-[var(--ink-blue)] font-mono bg-[var(--paper-subtle)] px-1.5 py-0.5 rounded border border-[var(--hairline)]">git status</code> or test suites), Groundwork enforces a single-use authorization token modal. No arbitrary execution is permitted without explicit user confirmation.
                </p>
              </div>
            </article>
          )}

          {activeSection === "sync" && (
            <article className="space-y-6">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)] mb-1">
                  Cloud Backend / 04
                </p>
                <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--ink)] mb-2">
                  Groundwork Sync (Optional Cloud Backend)
                </h1>
                <p className="text-xs text-[var(--ink-secondary)]">
                  Optional multi-machine synchronization for preferences, saved searches, and notes.
                </p>
              </div>

              <div className="space-y-4 text-xs text-[var(--ink-secondary)] leading-relaxed">
                <p>
                  Groundwork Sync is a lightweight optional backend deployed to Google Cloud Run with PostgreSQL. The desktop application works completely without it.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
                  <div className="p-4 rounded bg-[var(--success-bg)] border border-[var(--success-border)]">
                    <span className="font-serif font-bold text-xs text-[var(--success)] block mb-1">Synchronized via Cloud</span>
                    <ul className="space-y-1 text-[11px] text-[var(--ink-secondary)] list-disc list-inside">
                      <li>User account &amp; registered devices</li>
                      <li>Groundwork UI settings &amp; preferences</li>
                      <li>Saved searches &amp; favorite queries</li>
                      <li>Tags &amp; local markdown notes</li>
                    </ul>
                  </div>

                  <div className="p-4 rounded bg-[var(--danger-bg)] border border-[var(--danger-border)]">
                    <span className="font-serif font-bold text-xs text-[var(--danger)] block mb-1">NEVER Uploaded to Cloud</span>
                    <ul className="space-y-1 text-[11px] text-[var(--ink-secondary)] list-disc list-inside">
                      <li>Source code &amp; repository files</li>
                      <li>PDFs, documents, and spreadsheets</li>
                      <li>Git history &amp; commit diffs</li>
                      <li>FTS5 index and vector embeddings</li>
                    </ul>
                  </div>
                </div>
              </div>
            </article>
          )}

          {activeSection === "privacy" && (
            <article className="space-y-6">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)] mb-1">
                  Security / 05
                </p>
                <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[var(--ink)] mb-2">
                  {"Privacy Architecture & Security Model"}
                </h1>
                <p className="text-xs text-[var(--ink-secondary)]">
                  Security guarantees, path sanitization, and offline reliability.
                </p>
              </div>

              <div className="space-y-4 text-xs text-[var(--ink-secondary)] leading-relaxed">
                <p>
                  Groundwork is architected under one fundamental premise: <strong className="text-[var(--ink)]">The user's workspace belongs to the user's machine.</strong>
                </p>

                <h3 className="text-sm font-serif font-bold text-[var(--ink)] pt-2">Path Traversal Defense</h3>
                <p>
                  All filesystem operations pass through strict canonicalization. Relative path traversal sequences (such as <code className="text-[var(--danger)] font-mono bg-[var(--danger-bg)] px-1.5 py-0.5 rounded border border-[var(--danger-border)] font-bold">../../</code> or null bytes) are blocked, and access is restricted to user-declared workspace roots.
                </p>

                <h3 className="text-sm font-serif font-bold text-[var(--ink)] pt-2">Zero Silent Uploads</h3>
                <p>
                  Groundwork contains no telemetry tracking, no background file synchronization, and no cloud dependencies for core search or project understanding.
                </p>
              </div>
            </article>
          )}
        </main>
      </div>
    </div>
  );
};
