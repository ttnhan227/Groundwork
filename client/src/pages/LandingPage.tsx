import {
  Search,
  FolderOpen,
  FileText,
  Download,
  ArrowRight,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export function LandingPage({
  navigate,
}: {
  navigate: (path: string) => void;
}) {
  return (
    <div>
      <section className="max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <p className="text-[var(--ink-blue)] font-medium mb-5">
          Groundwork 1.0 · A desktop workspace for your files
        </p>
        <h1 className="max-w-4xl text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.12]">
          Explore your files. Ask your AI.
          <br />
          <span className="text-[var(--ink-blue)]">Stay in control.</span>
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-[var(--ink-secondary)] mt-7">
          Browse a folder tree, search files, inspect storage, and ask Assistant
          in one compact desktop workspace. Keep notes and preview file organization
          alongside your work. Start with a folder. No
          account needed.
        </p>
        <div className="flex flex-wrap gap-4 mt-9">
          <button
            onClick={() => navigate("/download")}
            className="site-primary"
          >
            <Download size={19} />
            Download for Windows
          </button>
          <button onClick={() => navigate("/docs")} className="site-secondary">
            See how to get started
            <ArrowRight size={18} />
          </button>
        </div>
        <p className="text-sm text-[var(--ink-muted)] mt-5">
          Windows 10 or 11 · Search works offline · Optional account sync
        </p>
      </section>
      <section className="border-y border-[var(--hairline)] bg-[var(--surface)]">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="text-3xl font-semibold tracking-tight mb-9">
            Get back to the work that matters.
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-7">
            {[
              {
                icon: Search,
                title: "Find the file you remember",
                text: "Find files by name or path as they are discovered. Search inside supported readable formats once preparation finishes.",
              },
              {
                icon: Sparkles,
                title: "Ask AI with sources",
                text: "Get local AI answers from your files with sources to check. Download a model or import a GGUF file; online providers are optional.",
              },
              {
                icon: FileText,
                title: "Keep your work together",
                text: "Save notes and useful AI findings. Return to recent changes and saved work without leaving the workspace.",
              },
              {
                icon: FolderOpen,
                title: "Explore and organize",
                text: "Browse folders and files together, inspect logical sizes, and review proposed file moves before applying them. Change history includes undo.",
              },
            ].map((item) => (
              <article key={item.title} className="space-y-4">
                <item.icon className="text-[var(--ink-blue)]" size={26} />
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="text-[var(--ink-secondary)] leading-relaxed">
                  {item.text}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-12">
          <div>
            <p className="text-[var(--ink-blue)] font-medium mb-4">
              Ready when you are
            </p>
            <h2 className="text-3xl font-semibold tracking-tight">
              Three steps to your first search.
            </h2>
            <p className="text-[var(--ink-secondary)] mt-5 leading-relaxed">
              Nothing to configure before you start. You can connect an account
              or add an AI service later.
            </p>
          </div>
          <ol className="space-y-7">
            {[
              [
                "Install Groundwork",
                "Download the Windows installer and open the app.",
              ],
              [
                "Choose how to start",
                "Sign in to sync notes and saved searches, or choose Continue locally.",
              ],
              [
                "Choose a folder or drive",
                "Click Choose folder in the workspace toolbar. Browse and search as Groundwork prepares supported file contents in the background.",
              ],
            ].map(([title, text], index) => (
              <li key={title} className="flex gap-5">
                <span className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] font-semibold">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="text-[var(--ink-secondary)] mt-1 leading-relaxed">
                    {text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="rounded-2xl bg-[var(--control-room)] text-white p-8 sm:p-12 flex flex-col md:flex-row gap-8 items-start">
          <ShieldCheck className="shrink-0 text-[var(--signal)]" size={38} />
          <div className="space-y-4">
            <h2 className="text-3xl font-semibold">
              Your files stay on your computer.
            </h2>
            <p className="max-w-3xl text-[var(--control-room-muted)] leading-relaxed">
              Search and notes work without an internet connection. If you sign
              in, you can sync your notes and saved searches. If you choose an
              online AI service, only your question and relevant file excerpts
              are sent when you ask.
            </p>
            <button
              onClick={() => navigate("/privacy")}
              className="inline-flex gap-2 items-center font-medium text-white underline underline-offset-4"
            >
              Read about your privacy
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
