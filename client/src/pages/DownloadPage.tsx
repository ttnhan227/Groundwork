import React from "react";
import { Download, Monitor, HardDrive, CheckCircle2, ShieldCheck, Terminal, Copy } from "lucide-react";

export const DownloadPage: React.FC = () => {
  const downloads = [
    {
      title: "Windows Installer (.msi)",
      recommended: true,
      description: "Standard MSI package with desktop shortcut and start menu integration.",
      filename: "Groundwork-Setup-1.0.0-x64.msi",
      size: "42.8 MB",
      sha256: "9f82d1c7e4a3b092f...a1e8",
    },
    {
      title: "Portable Executable (.exe)",
      recommended: false,
      description: "Standalone binary with no admin privileges or registry modification required.",
      filename: "Groundwork-1.0.0-portable.exe",
      size: "38.4 MB",
      sha256: "b4c10291f098...7e21",
    },
    {
      title: "Portable Zip Archive (.zip)",
      recommended: false,
      description: "Complete bundle including Tauri frontend and local Python service.",
      filename: "groundwork-v1.0.0-win-x64.zip",
      size: "48.2 MB",
      sha256: "e3a8901cb91...f420",
    },
  ];

  return (
    <div className="bg-[var(--paper)] text-[var(--ink)] min-h-screen py-16 px-4">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] text-[var(--ink-blue)] text-xs font-mono font-semibold">
            <Monitor className="w-3.5 h-3.5" />
            Groundwork Desktop for Windows
          </div>
          <h1 className="text-3xl sm:text-5xl font-serif font-bold text-[var(--ink)] tracking-tight">
            Download Groundwork
          </h1>
          <p className="text-sm sm:text-base text-[var(--ink-secondary)] max-w-xl mx-auto">
            Install Groundwork on your machine and start indexing your local repositories in seconds.
          </p>
        </div>

        {/* Download Packages Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {downloads.map((item, idx) => (
            <div
              key={idx}
              className={`p-6 rounded-lg flex flex-col justify-between transition-all ${
                item.recommended
                  ? "bg-[var(--surface)] border-2 border-[var(--ink-blue)] shadow-[var(--shadow-card)]"
                  : "bg-[var(--surface)] border border-[var(--hairline)]"
              }`}
            >
              <div>
                {item.recommended && (
                  <span className="inline-block px-2.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[var(--control-room)] text-white uppercase tracking-wider mb-3">
                    Recommended
                  </span>
                )}
                <h3 className="text-base font-serif font-bold text-[var(--ink)] mb-1.5">{item.title}</h3>
                <p className="text-xs text-[var(--ink-secondary)] mb-4 leading-relaxed font-sans">
                  {item.description}
                </p>
                <div className="text-[11px] font-mono text-[var(--ink-muted)] space-y-1 mb-6">
                  <div>File: <span className="text-[var(--ink)]">{item.filename}</span></div>
                  <div>Size: <span className="text-[var(--ink)]">{item.size}</span></div>
                </div>
              </div>

              <div>
                <a
                  href={`#download-${idx}`}
                  onClick={(e) => {
                    e.preventDefault();
                    alert(`Starting download: ${item.filename}`);
                  }}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded font-semibold text-xs transition-colors ${
                    item.recommended
                      ? "bg-[var(--control-room)] hover:bg-[var(--control-room-hover)] text-white shadow-sm"
                      : "bg-[var(--paper-subtle)] hover:bg-[var(--surface-hover)] text-[var(--ink)] border border-[var(--hairline-strong)]"
                  }`}
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* System Requirements & Verification */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
          {/* Specs */}
          <div className="p-6 rounded-lg bg-[var(--surface)] border border-[var(--hairline)] space-y-4 shadow-xs">
            <h3 className="font-serif font-bold text-sm text-[var(--ink)] flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-[var(--ink-blue)]" />
              System Requirements
            </h3>
            <ul className="text-xs text-[var(--ink-secondary)] space-y-2.5 font-sans">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[var(--signal)] shrink-0 mt-0.5" />
                <span><strong className="text-[var(--ink)]">OS:</strong> Windows 10 (1903+) or Windows 11 (64-bit)</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[var(--signal)] shrink-0 mt-0.5" />
                <span><strong className="text-[var(--ink)]">RAM:</strong> ~250 MB operational memory</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[var(--signal)] shrink-0 mt-0.5" />
                <span><strong className="text-[var(--ink)]">Storage:</strong> 120 MB base installation + local SQLite index</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[var(--signal)] shrink-0 mt-0.5" />
                <span><strong className="text-[var(--ink)]">WebView2:</strong> Pre-installed on modern Windows</span>
              </li>
            </ul>
          </div>

          {/* Quickstart 3 steps */}
          <div className="p-6 rounded-lg bg-[var(--surface)] border border-[var(--hairline)] space-y-4 shadow-xs">
            <h3 className="font-serif font-bold text-sm text-[var(--ink)] flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[var(--ink-sepia)]" />
              First 60 Seconds
            </h3>
            <div className="space-y-3 text-xs text-[var(--ink-secondary)]">
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] text-[var(--ink-blue)] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">1</span>
                <span>Launch Groundwork from your desktop or start menu.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] text-[var(--ink-blue)] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">2</span>
                <span>In Settings, add the root folder where your projects live.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] text-[var(--ink-blue)] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">3</span>
                <span>Press <kbd className="px-1.5 py-0.5 bg-[var(--paper-subtle)] border border-[var(--hairline-strong)] text-[var(--ink)] rounded font-mono font-bold">Ctrl+Space</kbd> anywhere to start searching immediately.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
