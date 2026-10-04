import React from "react";
import { History, Tag, Sparkles, CheckCircle2 } from "lucide-react";

export const ChangelogPage: React.FC = () => {
  const releases = [
    {
      version: "Development build",
      date: "October 2026",
      title: "The Local-First Transformation",
      badge: "In development",
      summary:
        "Groundwork transformed from a browser document app into a high-performance local-first workspace search and AI context tool for developers.",
      highlights: [
        "Native Tauri 2 desktop client for Windows with global shortcut Ctrl+Space / Ctrl+K.",
        "Local FastAPI core running on SQLite in WAL mode with FTS5 BM25 virtual tables.",
        "Hybrid search combines SQLite FTS5, local vectors, filename matching, recency, and project context. Latency depends on the indexed workspace.",
        "AST Symbol and Function Extractor for Python, TypeScript, JavaScript, Rust, and Go.",
        "Project Explorer detecting package.json, pyproject.toml, Cargo.toml, READMEs, and Git remotes.",
        "Activity timeline and resume summaries use observed file changes, Git commits, notes, and sessions.",
        "Context Sessions ('Continue where I left off') preserving working memory, inspected files, and task checklists.",
        "Grounded AI Context Engine with verifiable citations drawer and single-use execution tokens.",
        "Groundwork Sync: Optional lightweight cloud service on Cloud Run for settings and notes.",
      ],
    },
  ];

  return (
    <div className="bg-[var(--paper)] text-[var(--ink)] min-h-screen py-16 px-4 font-sans">
      <div className="max-w-3xl mx-auto space-y-10">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] text-[var(--ink-blue)] text-xs font-mono font-semibold mb-3">
            <History className="w-3.5 h-3.5" />
            Releases &amp; Updates
          </div>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-[var(--ink)] tracking-tight">
            Changelog
          </h1>
          <p className="text-xs text-[var(--ink-secondary)] mt-1">
            Track all updates, releases, and architectural improvements across Groundwork.
          </p>
        </div>

        <div className="space-y-8">
          {releases.map((rel, idx) => (
            <div
              key={idx}
              className="p-6 rounded-lg bg-[var(--surface)] border border-[var(--hairline-strong)] space-y-4 shadow-[var(--shadow-card)]"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-base font-bold text-[var(--ink-blue)]">
                    {rel.version}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[var(--control-room)] text-white">
                    {rel.badge}
                  </span>
                </div>
                <span className="text-xs font-mono text-[var(--ink-muted)]">{rel.date}</span>
              </div>

              <h2 className="text-lg font-serif font-bold text-[var(--ink)]">{rel.title}</h2>
              <p className="text-xs text-[var(--ink-secondary)] leading-relaxed font-sans">{rel.summary}</p>

              <div className="pt-3 border-t border-[var(--hairline)]">
                <h4 className="text-xs font-mono font-bold text-[var(--ink)] uppercase tracking-wider mb-2">
                  Key Capabilities Delivered
                </h4>
                <ul className="space-y-2">
                  {rel.highlights.map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-[var(--ink-secondary)]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[var(--signal)] shrink-0 mt-0.5" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
