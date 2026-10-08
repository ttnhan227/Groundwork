import {
  Download,
  ArrowRight,
  Search,
  HardDrive,
  ShieldCheck,
  Sparkles,
  FolderTree,
  NotebookPen,
} from "lucide-react";
export function LandingPage({
  navigate,
}: {
  navigate: (path: string) => void;
}) {
  return (
    <>
      <section className="product-showcase">
        <div className="product-first-glance">
          <p className="product-eyebrow">
            Groundwork · Your local desktop workspace
          </p>
          <h1>
            Find your files.
            <br />
            <span>Understand what matters.</span>
          </h1>
          <p className="product-intro">
            Find documents, read them, and ask about the details you need—
            with answers you can trace back to the file.
          </p>
          <div className="product-hero-actions">
            <button
              className="site-primary"
              onClick={() => navigate("/download")}
            >
              <Download size={18} />
              Download for Windows
            </button>
            <button
              className="site-secondary"
              onClick={() => navigate("/docs")}
            >
              See how it works
              <ArrowRight size={17} />
            </button>
          </div>
          <p className="product-hero-note">
            Windows 10 / 11 · Search works offline · No account needed
          </p>
          <figure className="product-workspace-shot">
            <a
              href="/screenshots/workspace.png?v=20261008c"
              target="_blank"
              rel="noreferrer"
              aria-label="Open full-size workspace screenshot"
            >
              <img
                src="/screenshots/workspace.png?v=20261008c"
                alt="Groundwork built-in reader showing an apartment lease renewal beside its cited AI answer"
                width={1440}
                height={900}
                fetchPriority="high"
              />
            </a>
            <figcaption>
              Read a lease renewal with its AI answer beside it, without opening another app.
              Actual interface with illustrative sample documents.
            </figcaption>
          </figure>
        </div>
      </section>
      <section
        className="product-ai-feature"
        aria-labelledby="ai-feature-title"
      >
        <div className="product-ai-copy">
          <p className="product-eyebrow">More than finding a file</p>
          <h2 id="ai-feature-title">
            What changed?
            <br />
            What do I need to do?
          </h2>
          <p>
            Ask about a receipt, document, spreadsheet, or folder. Read Office
            documents and PDF text, or recognize written text in images and scanned
            PDFs on Windows. Keep your files beside the answer.
          </p>
          <ul>
            <li>
              <strong>Check the source.</strong> Follow references back to your
              files. See whether the answer used document text, OCR, or file details only.
            </li>
            <li>
              <strong>Choose where AI runs.</strong> Use local excerpts, a local
              model, or an online provider.
            </li>
            <li>
              <strong>Stay in control.</strong> Review proposed changes before
              applying them.
            </li>
          </ul>
          <button className="utility-ai-link" onClick={() => navigate("/docs")}>
            Explore Assistant
            <ArrowRight size={17} />
          </button>
          <p className="product-ai-setup">
            Generated answers require a configured model or provider. Matching
            excerpts work locally.
          </p>
        </div>
        <figure className="product-ai-shot">
          <a
            href="/screenshots/assistant.png?v=20261008c"
            target="_blank"
            rel="noreferrer"
            aria-label="Open full-size Assistant screenshot"
          >
            <div className="product-ai-crop">
              <img
                src="/screenshots/assistant.png?v=20261008c"
                alt="Groundwork Assistant answering a lease renewal question with document sources"
                width={392}
                height={529}
                loading="lazy"
              />
            </div>
          </a>
          <figcaption>
            A real local AI answer identifying the rent increase and renewal deadline in a sample lease. Click to enlarge.
          </figcaption>
        </figure>
      </section>
      <section className="product-benefits" aria-labelledby="benefits-title">
        <p className="product-eyebrow">Features & benefits</p>
        <h2 id="benefits-title">Why use Groundwork?</h2>
        <div className="product-benefit-grid">
          {[
            {
              icon: FolderTree,
              title: "One desktop workspace",
              text: "Keep the folder tree, file list, storage details, and tools together. Select a file and act on it without navigating through separate screens.",
            },
            {
              icon: Search,
              title: "Find files and matching text",
              text: "Find files by name or path as they are discovered. Search inside supported readable formats after indexing. Filter by file type or scope.",
            },
            {
              icon: HardDrive,
              title: "Understand your storage",
              text: "Sort by size, compare folders, and explore storage by type. Folder totals show logical bytes; individual files can show allocated size and hard links where available.",
            },
            {
              icon: Sparkles,
              title: "AI grounded in your files",
              text: "Ask about documents, spreadsheets, presentations, and recognized image text. Check source references and coverage labels. Unsupported formats provide file details only. Generative answers need a configured model.",
            },
            {
              icon: ShieldCheck,
              title: "Review before changes",
              text: "Inspect duplicate candidates and preview organization plans before applying moves. Supported organization operations include history and undo.",
            },
            {
              icon: NotebookPen,
              title: "Keep useful context",
              text: "Group related files in collections without moving originals. Save useful answers, notes, searches, and next steps. Your local file index stays on your computer.",
            },
          ].map((item) => (
            <article key={item.title}>
              <item.icon size={34} />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="product-bottom-cta">
        <h2>Ready to explore your files?</h2>
        <p>
          The Windows installer includes the local engine. No Python, Docker, or
          database installation needed.
        </p>
        <button className="site-primary" onClick={() => navigate("/download")}>
          <Download size={18} />
          Get Groundwork for Windows
        </button>
        <button
          className="product-roadmap-link"
          onClick={() => navigate("/about")}
        >
          macOS roadmap
        </button>
      </section>
    </>
  );
}
