import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

const guides: Record<
  string,
  { title: string; intro: string; steps: Array<[string, string]> }
> = {
  "getting-started": {
    title: "Start here",
    intro: "From installation to your first search, in a few minutes.",
    steps: [
      [
        "Install and open Groundwork",
        "Download the Windows installer from the Download page. Open it and follow the installation steps. Groundwork includes what it needs to search your files.",
      ],
      [
        "Sign in, or continue locally",
        "The welcome window offers Google sign-in, email sign-in, or Continue locally. An account is optional. Local use keeps your notes and saved searches on this computer.",
      ],
      [
        "Add a folder from Home",
        "Click Add your first folder, then Choose folder. Pick your Documents folder or a project folder and click Add folder. Your original files stay in place.",
      ],
      [
        "Find something",
        "Click Search files or press Ctrl + Space. Type a filename or a phrase you remember. Files become searchable as Groundwork prepares them.",
      ],
      [
        "Make yourself at home",
        "Use Notes for ideas and reminders, Recent activity to see changes, and Saved work to return to questions you've kept. Manage the folders you search in Folders.",
      ],
    ],
  },
  search: {
    title: "Find your files",
    intro:
      "Search the folders you've chosen, without moving or uploading them.",
    steps: [
      [
        "Search by name or content",
        "Click Search files. Try part of a filename, a phrase from a document, or a function name from code. You can narrow results to a project or file type.",
      ],
      [
        "Open a result",
        "Choose a result to open the file, show its folder, or ask a question using that file as a source.",
      ],
      [
        "Add or remove folders",
        "Open Folders to manage what Groundwork searches. Removing a folder from Groundwork doesn't delete your original files.",
      ],
      [
        "If a file is missing",
        "Wait for files to finish preparing. Check that its folder is included. If needed, open Settings → Troubleshooting → Refresh all files.",
      ],
    ],
  },
  ai: {
    title: "Ask your files",
    intro:
      "Find relevant passages or get a written answer with sources you can check.",
    steps: [
      [
        "Start without setup",
        "Ask your files can find matching passages on this computer without an account or API key. This mode retrieves sources; it doesn't generate an AI-written answer.",
      ],
      [
        "Choose written answers",
        "Open Ask your files → Set up answers. Choose Ollama for a model running on your computer, or OpenAI or Google Gemini with your own API key. Online providers require internet and may charge for usage.",
      ],
      [
        "Know what gets shared",
        "Online AI receives your question and relevant file excerpts when you ask. Your search index and API key stay on your computer. Ollama requires a local installation and downloaded model.",
      ],
      [
        "Check the sources",
        "Use the source links to review the files behind an answer. Save useful findings as notes or saved work so you can return to them.",
      ],
    ],
  },
  sync: {
    title: "Your account and sync",
    intro: "An optional way to keep notes and saved searches across computers.",
    steps: [
      [
        "Sign in any time",
        "Choose Account in the app, then Sign in. Use Google or your email and password. You can create an email account from the same window.",
      ],
      [
        "Sync when you're ready",
        "Choose Sync now in Account. Note content, saved searches, and supported preferences are copied to your account. Files, code repositories, the search index, and AI keys are excluded.",
      ],
      [
        "Keep working offline",
        "Your folders and notes are available locally even without internet. When you're connected again, use Sync now to send your saved changes.",
      ],
      [
        "Sign out safely",
        "Signing out stops account sync. It doesn't remove folders or delete notes saved on this computer.",
      ],
    ],
  },
  privacy: {
    title: "Your privacy",
    intro: "Understand what stays here and what you choose to share.",
    steps: [
      [
        "On your computer",
        "Groundwork searches and prepares your selected folders locally. Workspace files and the search index are not uploaded to Groundwork's account service.",
      ],
      [
        "With an account",
        "Email sign-in stores your email and a protected password hash. Google sign-in uses your Google identity and email to authenticate. Sync stores the notes and saved searches you choose to synchronize.",
      ],
      [
        "With online AI",
        "If you select an online AI service, questions and relevant file excerpts are sent to that provider when you ask. You supply your own key. Search and indexing remain local.",
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
        <nav className="space-y-2">
          {Object.entries(guides).map(([id, item]) => (
            <button
              key={id}
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
          <ArrowRight size={14} />
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
