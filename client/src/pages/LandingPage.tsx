import {
  Download,
  ArrowRight,
  Search,
  HardDrive,
  ShieldCheck,
  Sparkles,
  Trash2,
  Cpu,
  Sliders,
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
            Groundwork 1.1 · High-speed storage analyzer, hardware topology &amp; cleanup utility
          </p>
          <h1>
            Find your files.
            <br />
            <span>Understand what matters.</span>
          </h1>
          <p className="product-intro">
            High-speed multi-drive storage analysis, live hardware component topology,
            safe SHA-256 duplicate removal, app uninstallation with leftover cleanup, and local AI assistance in one native Windows app.
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
            Windows 10 / 11 · 100% Offline Capable · No account needed
          </p>
          <figure className="product-workspace-shot">
            <a
              href="/screenshots/cleanup.png?v=1.1.2"
              target="_blank"
              rel="noreferrer"
              aria-label="Open full-size storage and cleanup workspace screenshot"
            >
              <img
                src="/screenshots/cleanup.png?v=1.1.2"
                alt="Groundwork Storage Analyzer &amp; Cleanup showing proportional folder space map, mounted drive capacity, and diagnostic rules"
                width={1280}
                height={820}
                fetchPriority="high"
              />
            </a>
            <figcaption>
              Inspect proportional folder sizes, mounted drive capacity, live hardware topology, and instant diagnostics in one local utility.
            </figcaption>
          </figure>
        </div>
      </section>
      <section
        className="product-ai-feature"
        aria-labelledby="ai-feature-title"
      >
        <div className="product-ai-copy">
          <p className="product-eyebrow">Multi-provider AI operator &amp; document reader</p>
          <h2 id="ai-feature-title">
            What changed?
            <br />
            What is using my space?
          </h2>
          <p>
            Ask about your hardware components, documents, spreadsheets, storage hotspots,
            or installed programs. Read Office documents and PDF text, recognize
            written text in images, or connect 100% offline local LLMs (Ollama) as well as cloud providers (Gemini &amp; OpenAI).
          </p>
          <ul>
            <li>
              <strong>Check the source.</strong> Follow references back to your
              files and hardware metrics with verifiable evidence.
            </li>
            <li>
              <strong>Choose where AI runs.</strong> Run entirely offline with on-device Ollama models or connect to Gemini/OpenAI cloud models.
            </li>
            <li>
              <strong>Stay in control.</strong> Every cleanup, uninstaller launch, and file move requires your explicit review and confirmation.
            </li>
          </ul>
          <button className="utility-ai-link" onClick={() => navigate("/docs")}>
            Explore Agent &amp; Settings
            <ArrowRight size={17} />
          </button>
          <p className="product-ai-setup">
            Generated answers require a configured model or provider in Settings. Hardware topology and deterministic storage tools work 100% locally.
          </p>
        </div>
        <figure className="product-ai-shot">
          <a
            href="/screenshots/assistant.png?v=1.1.2"
            target="_blank"
            rel="noreferrer"
            aria-label="Open full-size Agent screenshot"
          >
            <div className="product-ai-crop">
              <img
                src="/screenshots/assistant.png?v=1.1.2"
                alt="Groundwork Agent answering system queries with grounded reasoning and recommendations"
                width={392}
                height={529}
                loading="lazy"
              />
            </div>
          </a>
          <figcaption>
            Groundwork Agent analyzing system context and providing structured recommendations. Click to enlarge.
          </figcaption>
        </figure>
      </section>
      <section className="product-benefits" aria-labelledby="benefits-title">
        <p className="product-eyebrow">Features &amp; benefits</p>
        <h2 id="benefits-title">Why use Groundwork?</h2>
        <div className="product-benefit-grid">
          {[
            {
              icon: Cpu,
              title: "Hardware & component topology",
              text: "Inspect live processor specs, motherboard and BIOS firmware, RAM SPD module timings, multi-GPU dedicated VRAM, and signed WHQL drivers with zero hardcoded metrics.",
            },
            {
              icon: HardDrive,
              title: "High-speed storage analyzer",
              text: "Multi-drive parallel scanning traversing over 150,000 files/sec, interactive proportional space maps, and direct NTFS MFT raw index elevation.",
            },
            {
              icon: Search,
              title: "Find files and matching text",
              text: "Find files by name or path as they are discovered. Search inside supported readable formats after indexing. Filter by file type or scope.",
            },
            {
              icon: Sliders,
              title: "Power-user engine settings",
              text: "Tune parallel scanner threads (2-16), switch between customizable byte notations, toggle serial masking for safe screenshots, and configure restore point creation.",
            },
            {
              icon: Trash2,
              title: "App uninstaller & leftover cleaner",
              text: "Browse Windows desktop and Store apps sorted by size, launch official uninstallers, and scan AppData, ProgramData, and Registry keys for leftover footprints.",
            },
            {
              icon: Sparkles,
              title: "Multi-provider AI Agent",
              text: "Connect free offline local LLMs (Ollama) or cloud models (Gemini, OpenAI) with live connection testing and grounded file citations.",
            },
            {
              icon: ShieldCheck,
              title: "Recycle Bin safety guaranteed",
              text: "Inspect duplicate candidates and preview organization plans before applying moves. Deletions strictly use Windows Recycle Bin with System Restore safeguards.",
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
        <h2>Ready to explore, analyze, and clean up your PC?</h2>
        <p>
          The Windows installer includes the native desktop engine. No Python, Docker, or
          external database installation needed.
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
