import React from "react";
import { ShieldCheck, HardDrive, Lock, EyeOff, CheckCircle2, XCircle } from "lucide-react";

export const PrivacyPage: React.FC = () => {
  return (
    <div className="bg-[var(--paper)] text-[var(--ink)] min-h-screen py-16 px-4 font-sans">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] text-[var(--ink-blue)] text-xs font-mono font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            Groundwork Privacy Manifesto
          </div>
          <h1 className="text-3xl sm:text-5xl font-serif font-bold text-[var(--ink)] tracking-tight">
            The user's workspace belongs to the user's machine.
          </h1>
          <p className="text-sm sm:text-base text-[var(--ink-secondary)] max-w-2xl mx-auto leading-relaxed">
            Groundwork was built as a deliberate rejection of cloud-first document scrapers. Your code, documents, and working memory never leave your device without explicit permission.
          </p>
        </div>

        {/* 3 Core Tenets */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-lg bg-[var(--surface)] border border-[var(--hairline)] space-y-2 shadow-xs">
            <Lock className="w-5 h-5 text-[var(--ink-blue)] mb-2" />
            <h3 className="font-serif font-bold text-sm text-[var(--ink)]">100% Offline by Default</h3>
            <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">
              Groundwork requires no internet connection to index your workspace, search files, parse code AST, or inspect Git history.
            </p>
          </div>

          <div className="p-6 rounded-lg bg-[var(--surface)] border border-[var(--hairline)] space-y-2 shadow-xs">
            <EyeOff className="w-5 h-5 text-[var(--signal)] mb-2" />
            <h3 className="font-serif font-bold text-sm text-[var(--ink)]">Zero Telemetry &amp; Tracking</h3>
            <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">
              We do not track which files you open, which queries you execute, what projects you work on, or what code you write.
            </p>
          </div>

          <div className="p-6 rounded-lg bg-[var(--surface)] border border-[var(--hairline)] space-y-2 shadow-xs">
            <HardDrive className="w-5 h-5 text-[var(--ink-sepia)] mb-2" />
            <h3 className="font-serif font-bold text-sm text-[var(--ink)]">Strict Boundary Enforcement</h3>
            <p className="text-xs text-[var(--ink-secondary)] leading-relaxed">
              Groundwork Sync is completely optional and strictly scoped to non-sensitive preferences and notes.
            </p>
          </div>
        </div>

        {/* Data Boundary Comparison Table */}
        <div className="bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-lg p-6 sm:p-8 space-y-4 shadow-[var(--shadow-card)]">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)]">
            Security Guarantee
          </p>
          <h2 className="text-xl font-serif font-bold text-[var(--ink)] mb-2">
            Local vs Cloud Data Responsibility
          </h2>
          <p className="text-xs text-[var(--ink-secondary)] leading-relaxed mb-4">
            Here is the exact boundary enforced throughout the Groundwork architecture:
          </p>

          <div className="overflow-x-auto border border-[var(--hairline)] rounded">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-[var(--paper-subtle)] border-b border-[var(--hairline)] text-[var(--ink)] font-mono text-[11px]">
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-3">Local Machine (100%)</th>
                  <th className="py-2.5 px-3">Groundwork Sync (Optional Cloud)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hairline-subtle)] bg-[var(--surface)]">
                <tr>
                  <td className="py-3 px-3 font-semibold text-[var(--ink)]">Source Repositories</td>
                  <td className="py-3 px-3 text-[var(--success)] font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Stored &amp; parsed locally
                  </td>
                  <td className="py-3 px-3 text-[var(--danger)] font-medium">
                    <XCircle className="w-3.5 h-3.5 inline mr-1" /> NEVER uploaded
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-3 font-semibold text-[var(--ink)]">Search Index &amp; Vectors</td>
                  <td className="py-3 px-3 text-[var(--success)] font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> SQLite WAL + FTS5 BM25
                  </td>
                  <td className="py-3 px-3 text-[var(--danger)] font-medium">
                    <XCircle className="w-3.5 h-3.5 inline mr-1" /> NEVER uploaded
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-3 font-semibold text-[var(--ink)]">Git Commits &amp; Logs</td>
                  <td className="py-3 px-3 text-[var(--success)] font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Read via local Git CLI
                  </td>
                  <td className="py-3 px-3 text-[var(--danger)] font-medium">
                    <XCircle className="w-3.5 h-3.5 inline mr-1" /> NEVER uploaded
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-3 font-semibold text-[var(--ink)]">Notes &amp; Saved Searches</td>
                  <td className="py-3 px-3 text-[var(--success)] font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Stored in local DB
                  </td>
                  <td className="py-3 px-3 text-[var(--ink-blue)] font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" /> Synchronized if opt-in
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-3 font-semibold text-[var(--ink)]">Application Settings</td>
                  <td className="py-3 px-3 text-[var(--success)] font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Stored locally
                  </td>
                  <td className="py-3 px-3 text-[var(--ink-blue)] font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" /> Synchronized if opt-in
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
