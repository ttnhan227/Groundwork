import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  FileSearch,
  FileCheck2,
  LockKeyhole,
  Send,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { BrandMark } from "../../components/common/BrandMark";
import {
  AUTH_EXPIRED_EVENT,
  AUTH_REFRESHED_EVENT,
  getStoredAuth,
} from "../../api/client";

const DOCUMENT_UPLOAD_ACCEPT =
  ".pdf,.docx,.pptx,.md,.markdown,.txt,.rtf,.png,.jpg,.jpeg,.webp";

export function LandingPage({
  onOpen,
  onUpload,
}: {
  onOpen: () => void;
  onUpload: (file: File) => void;
}) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const saved = getStoredAuth();
    return Boolean(saved?.access_token && saved?.user);
  });

  useEffect(() => {
    const syncAuthentication = () => {
      const saved = getStoredAuth();
      setIsAuthenticated(Boolean(saved?.access_token && saved?.user));
    };
    window.addEventListener("storage", syncAuthentication);
    window.addEventListener(AUTH_EXPIRED_EVENT, syncAuthentication);
    window.addEventListener(AUTH_REFRESHED_EVENT, syncAuthentication);
    return () => {
      window.removeEventListener("storage", syncAuthentication);
      window.removeEventListener(AUTH_EXPIRED_EVENT, syncAuthentication);
      window.removeEventListener(AUTH_REFRESHED_EVENT, syncAuthentication);
    };
  }, []);

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[var(--paper)] text-[var(--ink)]">
      <header className="sticky top-0 z-20 h-14 border-b border-white/10 bg-[color:var(--control-room)]/95 px-4 text-white backdrop-blur sm:px-6">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4">
          <a
            href="/"
            className="flex items-center gap-2"
            aria-label="Groundwork home"
          >
            <span className="flex h-7 w-7 items-center justify-center border border-white/25 bg-white/5 text-white">
              <BrandMark size={16} />
            </span>
            <span className="font-serif text-sm font-bold tracking-tight">
              Groundwork
            </span>
            <span className="hidden border-l border-white/15 pl-2 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--control-room-muted)] sm:inline">
              Response control
            </span>
          </a>
          <nav
            className="flex items-center gap-4 text-xs font-semibold text-[var(--control-room-muted)]"
            aria-label="Main navigation"
          >
            <a
              className="hidden transition-colors hover:text-white sm:inline"
              href="#workflow"
            >
              Workflow
            </a>
            <a
              className="hidden transition-colors hover:text-white sm:inline"
              href="#outcomes"
            >
              What it solves
            </a>
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex h-9 items-center justify-center gap-2 border border-white/20 bg-white px-4 text-xs font-bold text-[var(--control-room)] transition-colors hover:bg-[#eef1f5]"
            >
              {isAuthenticated ? "Open responses" : "Sign in"}
              <ArrowRight size={13} />
            </button>
          </nav>
        </div>
      </header>

      <section className="border-b border-[var(--hairline-strong)] bg-[#f1efe8] text-[var(--ink)]">
        <div className="mx-auto grid w-full max-w-7xl border-x border-[var(--hairline-strong)] lg:grid-cols-[0.72fr_1.28fr]">
          <div className="flex flex-col justify-between border-b border-[var(--hairline-strong)] px-5 py-10 sm:px-8 sm:py-14 lg:border-b-0 lg:border-r lg:py-16">
            <div>
              <p className="text-xs font-semibold text-[var(--ink-secondary)]">
                AI Research Notebook &amp; Document Synthesis
              </p>
              <h1 className="mt-5 max-w-xl font-serif text-4xl font-bold leading-[1.06] tracking-[-0.04em] sm:text-[42px] xl:text-5xl">
                Your AI Research Notebook. Keep the response defensible and grounded in your documents.
              </h1>
              <p className="mt-6 max-w-lg text-base leading-relaxed text-[var(--ink-secondary)]">
                Upload your research papers, notes, reports, or project files. Chat with
                selected sources, generate study guides and outlines, and synthesize notes
                with verified, page-level citations.
              </p>
            </div>
            <div className="mt-9">
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <label className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 bg-[var(--control-room)] px-5 text-sm font-bold text-white transition-colors hover:bg-[var(--control-room-hover)]">
                <Upload size={15} />
                Load a document or research paper
                <input
                  className="sr-only"
                  type="file"
                  accept={DOCUMENT_UPLOAD_ACCEPT}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onUpload(file);
                  }}
                />
              </label>
                <button
                  type="button"
                  onClick={onOpen}
                  className="text-sm font-semibold text-[var(--ink)] underline decoration-[var(--hairline-strong)] underline-offset-4 hover:decoration-[var(--ink)]"
                >
                  {isAuthenticated ? "Open response library" : "Explore the notebook"}
                </button>
              </div>
              <p className="mt-5 max-w-md text-xs leading-relaxed text-[var(--ink-muted)]">
                PDF, Word, PowerPoint, text, and markdown files are supported.
                Every claim is verified against your uploaded sources.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-center p-4 sm:p-6 lg:p-8">
            <div className="w-full overflow-hidden rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface)] shadow-xl">
              <div className="flex items-center gap-1.5 border-b border-[var(--hairline)] bg-[#e9e6dd] px-3.5 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#d5d0c3] border border-black/10" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#d5d0c3] border border-black/10" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#d5d0c3] border border-black/10" />
                <span className="ml-2 font-mono text-[11px] text-[var(--ink-muted)]">groundwork · research workspace studio</span>
              </div>
              <img
                src="/groundwork-workspace-real.png"
                width="1440"
                height="810"
                className="block h-auto w-full"
                alt="Groundwork AI research workspace showing grounded sources, research canvas, and source-backed AI assistant"
              />
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" className="bg-[var(--paper)]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.72fr_1.28fr] lg:py-20">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)]">
              Research &amp; Synthesis / 01—04
            </p>
            <h2 className="mt-3 max-w-xl font-serif text-3xl font-bold tracking-tight sm:text-4xl">
              A visible chain of custody from source to synthesis.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-[var(--ink-secondary)]">
              Every step leaves something inspectable: an indexed source, a selective
              context filter, a cited claim, or an automated verification finding.
            </p>
          </div>
          <ol className="border-t border-[var(--hairline-strong)]">
            {[
              {
                icon: Upload,
                step: "01",
                title: "Upload & Ground Sources",
                body: "Add PDFs, research papers, reports, notes, or bid packs. Selectively toggle which sources are active in the AI's context window.",
              },
              {
                icon: FileSearch,
                step: "02",
                title: "Studio Chat & Exploration",
                body: "Ask questions, extract core themes, and generate study guides, FAQs, or structured briefing outlines from your sources.",
              },
              {
                icon: FileCheck2,
                step: "03",
                title: "Draft with Direct Citations",
                body: "Synthesize notes and responses where every single factual assertion links directly to the cited page and paragraph.",
              },
              {
                icon: Send,
                step: "04",
                title: "Review & Fact-Check",
                body: "Audit unsupported assertions against source pages, resolve gaps, and export verified documents in PDF, Word, or Markdown.",
              },
            ].map(({ icon: Icon, step, title, body }) => (
              <li
                key={step}
                className="grid gap-4 border-b border-[var(--hairline)] py-6 sm:grid-cols-[52px_0.8fr_1.2fr] sm:items-start"
              >
                <span className="font-mono text-xs font-bold text-[var(--ink-blue)]">{step}</span>
                <div className="flex items-center gap-3">
                  <Icon size={16} className="text-[var(--ink-muted)]" />
                  <h3 className="font-serif text-lg font-bold">{title}</h3>
                </div>
                <p className="text-sm leading-relaxed text-[var(--ink-secondary)]">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="outcomes"
        className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[0.72fr_1.28fr]"
      >
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-blue)]">
            What it solves
          </p>
          <h2 className="mt-2 font-serif text-3xl font-bold tracking-tight">
            Zero hallucination. Full source provenance.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-[var(--ink-secondary)]">
            Groundwork is built for professionals, students, and researchers working
            with dense documents who need answers and drafts they can actually prove and trust.
          </p>
        </div>
        <div className="overflow-hidden border-y border-[var(--hairline-strong)]">
          {[
            {
              label: "Selective source grounding",
              text: "Tell the AI exactly which documents to consult. Toggle sources on or off with a single click.",
            },
            {
              label: "Page-level citations",
              text: "Click any citation to jump straight to the source document page with highlighted text.",
            },
            {
              label: "Automated verification gate",
              text: "Review findings highlight any claim lacking direct evidence before you share or export.",
            },
          ].map((item) => (
            <article key={item.label} className="grid gap-2 border-b border-[var(--hairline)] py-5 last:border-b-0 sm:grid-cols-[0.7fr_1.3fr] sm:items-start">
              <h3 className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.08em]">
                <Check size={13} className="text-[var(--signal)]" />
                {item.label}
              </h3>
              <p className="text-sm leading-relaxed text-[var(--ink-secondary)]">
                {item.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-[var(--hairline)] bg-[var(--surface)]">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-2">
          <div className="flex gap-4">
            <LockKeyhole size={20} className="mt-1 shrink-0 text-[var(--ink-blue)]" />
            <div>
              <h2 className="font-serif text-lg font-bold">Account-scoped records</h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-secondary)]">
                Access checks apply to response workspaces and their records.
                AI actions send only the selected workspace context to the
                configured external AI service.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <ShieldCheck size={20} className="mt-1 shrink-0 text-[var(--ink-blue)]" />
            <div>
              <h2 className="font-serif text-lg font-bold">Human-owned submission</h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-secondary)]">
                AI suggestions can be incomplete or wrong. Citations and
                automated findings support review; they do not replace legal,
                commercial, or subject-matter approval.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-[var(--paper)] px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 text-xs text-[var(--ink-muted)] sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2 font-semibold text-[var(--ink)]">
            <BrandMark size={16} /> Groundwork
          </span>
          <span>RFP response control with evidence and human review.</span>
        </div>
      </footer>
    </main>
  );
}
