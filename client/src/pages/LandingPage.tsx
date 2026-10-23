import {
  Download,
  ArrowRight,
  Search,
  HardDrive,
  ShieldCheck,
  Sparkles,
  FolderTree,
  Trash2,
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
            Groundwork 1.0 · Local Windows workspace, storage & cleanup utility
          </p>
          <h1>
            Find your files.
            <br />
            <span>Understand what matters.</span>
          </h1>
          <p className="product-intro">
            Explore your folders, reclaim disk space from SHA-256 duplicates and
            app leftovers, read documents, and ask AI questions—with answers you
            can trace back to the file.
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
              href="/screenshots/cleanup.png"
              target="_blank"
              rel="noreferrer"
              aria-label="Open full-size storage and cleanup workspace screenshot"
            >
              <img
                src="/screenshots/cleanup.png"
                alt="Groundwork Storage Analyzer & Cleanup showing proportional folder space map, mounted drive capacity, and SHA-256 duplicate rules"
                width={1280}
                height={820}
                fetchPriority="high"
              />
            </a>
            <figcaption>
              Inspect proportional folder sizes, mounted drive capacity, and SHA-256 duplicate rules in one local utility.
            </figcaption>
          </figure>
        </div>
      </section>
      <section
        className="product-ai-feature"
        aria-labelledby="ai-feature-title"
      >
        <div className="product-ai-copy">
          <p className="product-eyebrow">Grounded AI operator & document reader</p>
          <h2 id="ai-feature-title">
            What changed?
            <br />
            What is using my space?
          </h2>
          <p>
            Ask about a receipt, document, spreadsheet, folder, storage hotspot,
            or installed program. Read Office documents and PDF text, recognize
            written text in images and scanned PDFs on Windows, or let the local
            operator inspect duplicate files and application footprints.
          </p>
          <ul>
            <li>
              <strong>Check the source.</strong> Follow references back to your
              files. See whether the answer used document text, OCR, storage metrics, or file details only.
            </li>
            <li>
              <strong>Choose where AI runs.</strong> Use local excerpts, a local
              model, or an online provider.
            </li>
            <li>
              <strong>Stay in control.</strong> Every cleanup, uninstaller launch, and file move requires your explicit review and confirmation.
            </li>
          </ul>
          <button className="utility-ai-link" onClick={() => navigate("/docs")}>
            Explore Assistant
            <ArrowRight size={17} />
          </button>
          <p className="product-ai-setup">
            Generated answers require a configured model or provider. Matching
            excerpts and deterministic storage tools work locally.
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
              text: "Keep the folder tree, file list, built-in reader, storage analyzer, and installed app tools together without switching between separate utilities.",
            },
            {
              icon: Search,
              title: "Find files and matching text",
              text: "Find files by name or path as they are discovered. Search inside supported readable formats after indexing. Filter by file type or scope.",
            },
            {
              icon: HardDrive,
              title: "Storage map & SHA-256 cleanup",
              text: "Explore proportional folder space maps, largest files, and mounted drives. Reclaim space from byte-verified SHA-256 duplicates, caches, temp logs, and stale downloads via the Windows Recycle Bin.",
            },
            {
              icon: Trash2,
              title: "Installed apps & leftover scanner",
              text: "Browse Windows desktop and Store apps sorted by size, launch official uninstallers with confirmation, and scan AppData, ProgramData, and Registry keys for leftover footprints.",
            },
            {
              icon: Sparkles,
              title: "AI grounded in your PC",
              text: "Ask about documents, spreadsheets, recognized image text, disk usage, or installed software. Check source references and coverage labels. Unsupported formats provide file details only. Generative answers need a configured model.",
            },
            {
              icon: ShieldCheck,
              title: "Review before changes",
              text: "Inspect duplicate candidates and preview organization plans before applying moves. Nothing is ever deleted or moved without explicit confirmation, and supported organization operations include history and undo.",
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
        <h2>Ready to explore and clean up your PC?</h2>
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
