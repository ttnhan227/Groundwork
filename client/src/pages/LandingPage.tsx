import {
  Search,
  FolderOpen,
  FileText,
  Clock,
  Download,
  ArrowRight,
  ShieldCheck,
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
          A little less searching. A little more doing.
        </p>
        <h1 className="max-w-4xl text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.12]">
          Your files, notes, and unfinished thoughts.
          <br />
          <span className="text-[var(--ink-blue)]">Back within reach.</span>
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-[var(--ink-secondary)] mt-7">
          Groundwork helps you find files on your computer, keep notes alongside
          your work, and return to what you were doing. Start with a folder. No
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
                icon: FileText,
                title: "Keep a thought close",
                text: "Save a note, a reminder, or the next step while it's fresh in your mind.",
              },
              {
                icon: Clock,
                title: "Pick up where you left off",
                text: "See recent changes and revisit questions and work you've saved.",
              },
              {
                icon: FolderOpen,
                title: "Understand your projects",
                text: "For code projects, see an overview, recent changes, and the files behind an answer.",
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
                "Add your first folder",
                "Choose a folder from Home. Search your files as Groundwork prepares them in the background.",
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
