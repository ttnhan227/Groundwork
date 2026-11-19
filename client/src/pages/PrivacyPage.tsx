import { ShieldCheck } from "lucide-react";

export function PrivacyPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-16 space-y-9">
      <ShieldCheck size={34} className="text-[var(--ink-blue)]" />
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">
          Your PC. Your control.
        </h1>
        <p className="mt-5 text-lg text-[var(--ink-secondary)] leading-relaxed">
          Groundwork inspects storage, hardware, and system settings locally on
          your computer. There are no accounts or cloud sync, and AI is strictly
          optional.
        </p>
      </div>
      {[
        [
          "Diagnostics and storage scans stay local",
          "Folder scans, SHA-256 duplicate hashes, hardware telemetry, Windows tweak backups, and Operation History remain 100% on your PC. Groundwork does not have an account backend or cloud sync service.",
        ],
        [
          "File contents are never indexed or uploaded",
          "Groundwork scans filesystem metadata and selected cleanup/duplicate candidates locally. It does not read, index, OCR, or upload the contents of your documents, spreadsheets, or images.",
        ],
        [
          "Optional AI with sanitized system context",
          "If you configure a cloud AI provider (Google Gemini, OpenAI, Anthropic, Mistral, or a Custom OpenAI-compatible API), your prompts, %USERPROFILE%-sanitized system context, and approved diagnostic tool outputs are sent to that provider when you chat. Its privacy policy and usage charges apply. For 100% offline AI, use local Ollama.",
        ],
        [
          "API keys are encrypted with Windows DPAPI",
          "Optional provider API keys are encrypted at rest using Windows Data Protection API (CurrentUser scope) inside your local app settings file and never leave your machine except as authentication to your chosen provider.",
        ],
        [
          "No telemetry or usage tracking",
          "Groundwork sends zero analytics, crash telemetry, or behavioral tracking. Network calls only occur if you configure a cloud AI provider or check GitHub releases.",
        ],
        [
          "Reversible operations and Recycle Bin safety",
          "AI tools cannot run arbitrary shell commands or delete files silently. Modifying actions require a single-use approval token, route deletions to the Windows Recycle Bin, and log rollback data locally.",
        ],
      ].map(([title, text]) => (
        <section key={title}>
          <h2 className="text-xl font-semibold mb-3">{title}</h2>
          <p className="text-[var(--ink-secondary)] leading-relaxed">{text}</p>
        </section>
      ))}
      <section className="border-t border-[var(--hairline)] pt-7">
        <h2 className="text-xl font-semibold mb-3">Questions?</h2>
        <p className="text-[var(--ink-secondary)]">
          Contact{" "}
          <a
            href="mailto:ttnhan227@gmail.com"
            className="text-[var(--ink-blue)] underline"
          >
            ttnhan227@gmail.com
          </a>{" "}
          about Groundwork and your privacy.
        </p>
      </section>
    </article>
  );
}
