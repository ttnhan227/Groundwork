import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

const guides: Record<
  string,
  { title: string; intro: string; steps: Array<[string, string]> }
> = {
  "getting-started": {
    title: "Start here",
    intro:
      "From installation to storage scans, hardware diagnostics, tweaks, and AI troubleshooting in minutes.",
    steps: [
      [
        "Install and open Groundwork",
        "Download the Windows installer from the Download page. Open it and follow the setup steps. Groundwork ships as a native .NET 10 WinUI 3 application with no Python, Docker, or external database required.",
      ],
      [
        "No account needed",
        "Groundwork runs 100% locally on your PC without accounts, sign-in prompts, or cloud sync. Hardware scans, storage analysis, optimization state, and Operation History stay on this computer.",
      ],
      [
        "Inspect Overview & Hardware",
        "Open Overview for an instant snapshot of CPU, memory, drives, GPU, network state, startup items, and pending reboots. Open Analyze to inspect CPU/RAM SPD modules, BIOS/Secure Boot, GPUs, disks, signed drivers, and live processes.",
      ],
      [
        "Scan storage, duplicates & apps",
        "Run parallel Win32 folder and drive scans in Storage Analyzer, inspect Space-Hog Forensics and SHA-256 duplicates, or open Applications to browse installed Win32 apps, leftovers, Microsoft Store bloatware, and winget tools.",
      ],
      [
        "Optimize, repair & ask AI",
        "Apply reversible Windows 11/10 tweaks, run guided network/SFC/DISM troubleshooting investigations, or open AI Assistant to ask natural-language questions backed by 27 typed system inspection and proposal tools.",
      ],
    ],
  },
  cleanup: {
    title: "Storage, duplicates & apps",
    intro:
      "Inspect disk hotspots, remove verified SHA-256 duplicates, uninstall apps with leftover cleanup, and debloat Store packages safely.",
    steps: [
      [
        "Proportional space map & hotspots",
        "Open Storage Analyzer to scan drives or folders across 2–16 parallel threads, view a proportional treemap and category breakdown, inspect the largest files, reveal paths in File Explorer, or export results to CSV.",
      ],
      [
        "Space-Hog Forensics & SHA-256 duplicates",
        "Surface GPU shader caches, browser caches, developer build caches, and WSL/Docker .vhdx virtual disks. Duplicate Finder runs a 3-stage pipeline (file size, 4 KB head/tail pre-hash, then full SHA-256) with hard-link and cloud placeholder protection while preserving the oldest copy.",
      ],
      [
        "Installed apps, leftovers & winget",
        "Open Applications to inspect Win32 desktop programs and Microsoft Store packages, launch official uninstallers with explicit confirmation, scan AppData and ProgramData for leftover folders, read read-only Registry evidence, or batch-install tools with winget.",
      ],
      [
        "Explicit confirmation & Recycle Bin recovery",
        "No file or folder is ever deleted automatically or silently by AI. Every modifying operation uses a single-use approval token in the 10-step Safe Operation Engine and routes file deletions to the Windows Recycle Bin.",
      ],
    ],
  },
  tweaks: {
    title: "Tweaks, diagnostics & repair",
    intro:
      "Tune Windows performance safely, run guided investigations, and verify system health before and after changes.",
    steps: [
      [
        "Windows 11/10 tweaks & presets",
        "Inspect and reversibly toggle Game Mode, transparency effects, HAGS status, power plans, hibernation, and startup entries — or apply curated presets such as Clean Win11 & Debloat and Gaming & Raw Mouse.",
      ],
      [
        "Guided Investigations & Event Logs",
        "Run structured investigations across Performance, Storage, Network, Windows Health, Startup, Hardware, or custom user queries, inspect System and Application Event Log errors, and export reports as Markdown, JSON, or plain text.",
      ],
      [
        "Network, Runtime Health & Repair Toolkit",
        "Verify IPv4/IPv6/gateway/DNS state, run ICMP ping, DNS, and TCP checks, audit .NET/MSVC/VCLibs runtimes, check pending Component-Based Servicing reboots, and run 6 guided repair workflows including SFC and DISM.",
      ],
      [
        "Operation History & rollback",
        "Every executed modification records its prior state, verification outcome, and one-click rollback support in Operation History.",
      ],
    ],
  },
  ai: {
    title: "AI System Assistant",
    intro:
      "Diagnose PC slowdowns, disk usage, network issues, and installed software with live Windows telemetry and confirmation-gated proposals.",
    steps: [
      [
        "All core utilities work without AI",
        "Storage scanning, hardware topology, duplicate removal, tweaks, repair workflows, and guided investigations all run deterministically on this computer without configuring an AI model or API key.",
      ],
      [
        "Choose local Ollama or cloud providers",
        "Open Settings to configure Ollama (Local) at http://127.0.0.1:11434 for offline answers, or connect Google Gemini, OpenAI, Mistral AI, Anthropic, or Custom (OpenAI API) for OpenAI-compatible endpoints such as Groq, LM Studio, or DeepSeek. If you use Ollama, install and manage models directly in Ollama.",
      ],
      [
        "27 typed telemetry & proposal tools",
        "Rather than guessing or running unrestricted shell commands, the assistant queries typed read-only tools for hardware/OS specs, drives, folder scans, space hogs, processes, startup entries, power plans, network health, event logs, services, runtimes, and installed apps.",
      ],
      [
        "Confirmation-gated changes only",
        "Modifying AI tools (propose_*) can only stage reviewable proposals — such as switching power plans, toggling startup items or settings, flushing or switching DNS, cleaning verified caches, creating a restore point, or running repair workflows — behind your single-use approval token.",
      ],
      [
        "Know what gets shared",
        "Groundwork never indexes or uploads your file contents or documents to AI. When you send a message to a cloud provider, only your prompt, %USERPROFILE%-sanitized system context, and approved diagnostic tool outputs are sent to that provider. API keys are encrypted at rest with Windows DPAPI.",
      ],
    ],
  },
  organize: {
    title: "Tidy Folder organization",
    intro:
      "Preview every proposed move before organizing cluttered folders. Scanning never moves or renames your files.",
    steps: [
      [
        "Pick a folder in Maintenance",
        "Open Smart File Organizer in Maintenance and select a cluttered directory such as Downloads or Desktop. Groundwork groups files locally by category and file extension without needing AI or cloud access.",
      ],
      [
        "Review the proposed plan",
        "Groundwork builds a complete preview plan showing current paths and destination subfolders before creating directories or moving files.",
      ],
      [
        "Apply the reviewed plan",
        "Applying the exact displayed plan runs through the Safe Operation Engine with collision-safe checks so existing files are never silently overwritten.",
      ],
      [
        "Undo from Operation History",
        "Every completed organization batch is recorded in Operation History so you can restore files back to their original locations with one click.",
      ],
    ],
  },
  privacy: {
    title: "Your privacy",
    intro: "Understand what stays on your PC and what leaves it only when you ask.",
    steps: [
      [
        "100% local utilities, zero accounts",
        "Storage scans, duplicate hashes, hardware diagnostics, Windows tweaks, repair checks, and Operation History remain strictly on this computer. Groundwork has no user accounts, login service, or cloud sync.",
      ],
      [
        "DPAPI-protected API keys",
        "Optional cloud AI keys are encrypted at rest using Windows DPAPI (ProtectedData scoped to your Windows user) inside %APPDATA%\\Groundwork\\settings.json.",
      ],
      [
        "Sanitized AI system context",
        "File contents are never read, indexed, or uploaded by Groundwork. When you talk to a configured cloud AI provider, only your conversation, sanitized telemetry (%USERPROFILE%-masked paths), and diagnostic tool results are sent to that endpoint.",
      ],
    ],
  },
};
export function DocsPage({
  initialSection = "getting-started",
}: {
  initialSection?: string;
}) {
  const [active, setActive] = useState(
    guides[initialSection] ? initialSection : "getting-started",
  );
  useEffect(
    () =>
      setActive(guides[initialSection] ? initialSection : "getting-started"),
    [initialSection],
  );
  const guide = guides[active];
  return (
    <div className="max-w-6xl mx-auto px-6 py-14 flex flex-col md:flex-row gap-10">
      <aside className="md:w-56 shrink-0">
        <p className="text-sm font-semibold text-[var(--ink-muted)] mb-4">
          Groundwork guide
        </p>
        <nav aria-label="Documentation sections" className="space-y-2">
          {Object.entries(guides).map(([id, item]) => (
            <button
              key={id}
              type="button"
              aria-current={active === id ? "page" : undefined}
              onClick={() => setActive(id)}
              className={`w-full text-left rounded-lg px-4 py-3 text-sm ${active === id ? "bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] font-semibold" : "text-[var(--ink-secondary)] hover:bg-[var(--surface)]"}`}
            >
              {item.title}
            </button>
          ))}
        </nav>
        <a
          href="https://github.com/ttnhan227/Groundwork#readme"
          className="inline-flex gap-2 items-center mt-8 text-sm text-[var(--ink-blue)]"
        >
          Developer setup
          <ArrowRight size={14} aria-hidden="true" />
        </a>
      </aside>
      <main className="flex-1 max-w-3xl">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          {guide.title}
        </h1>
        <p className="mt-4 text-lg text-[var(--ink-secondary)] leading-relaxed">
          {guide.intro}
        </p>
        <div className="space-y-9 mt-10">
          {guide.steps.map(([title, text]) => (
            <section key={title}>
              <h2 className="text-xl font-semibold mb-3">{title}</h2>
              <p className="text-[var(--ink-secondary)] leading-relaxed">
                {text}
              </p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
