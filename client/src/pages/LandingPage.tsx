import {
  Download,
  ArrowRight,
  Wrench,
  HardDrive,
  ShieldCheck,
  Sparkles,
  Trash2,
  Cpu,
  Sliders,
  Folders,
} from "lucide-react";
import { HeroDemo } from "../components/site/HeroDemo";
import { AppLink } from "../components/common/AppLink";
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
            Groundwork 2.0 · Native Windows storage, diagnostics &amp; maintenance toolkit
          </p>
          <h1>
            Understand your PC.
            <br />
            <span>Optimize with confidence.</span>
          </h1>
          <p className="product-intro">
            High-speed multi-drive storage analysis, live hardware diagnostics,
            safe SHA-256 duplicate removal, Windows 11/10 power tweaks &amp;
            repair workflows, app uninstallation, and optional local or cloud AI
            in one native Windows app.
          </p>
          <div className="product-hero-actions">
            <AppLink to="/download" navigate={navigate} className="site-primary">
              <Download size={18} />
              Download for Windows
            </AppLink>
            <AppLink to="/docs" navigate={navigate} className="site-secondary">
              See how it works
              <ArrowRight size={17} />
            </AppLink>
          </div>
          <p className="product-hero-note">
            Windows 10 / 11 · 100% Offline Capable · No account needed
          </p>
          <HeroDemo />
        </div>
      </section>
      <section
        className="product-ai-feature"
        aria-labelledby="ai-feature-title"
      >
        <div className="product-ai-card">
          <div className="product-ai-header">
            <p className="product-eyebrow">Telemetry-grounded AI System Assistant</p>
            <h2 id="ai-feature-title">
              What changed? What is using my space?
            </h2>
            <p className="product-ai-summary">
              Ask about your hardware components, storage hotspots, space hogs,
              installed programs, startup items, network health, or Windows event logs.
              Use 100% offline local models via Ollama, or connect cloud providers
              (Gemini, OpenAI, Anthropic, Mistral) and Custom OpenAI-compatible
              endpoints such as Groq, LM Studio, or DeepSeek.
            </p>
          </div>

          <div className="product-ai-pillars">
            <div className="product-ai-pillar">
              <span className="ai-pillar-num">01</span>
              <h3>Check the source</h3>
              <p>Ground every answer in live Windows telemetry from typed inspection tools — hardware specs, folder scans, processes, and event logs with zero fabricated metrics.</p>
            </div>
            <div className="product-ai-pillar">
              <span className="ai-pillar-num">02</span>
              <h3>Choose where AI runs</h3>
              <p>Inspect hardware, storage, and diagnostics offline without AI, run local Ollama models, or connect Gemini, OpenAI, Claude, Mistral, or Custom OpenAI API endpoints.</p>
            </div>
            <div className="product-ai-pillar">
              <span className="ai-pillar-num">03</span>
              <h3>Stay in control</h3>
              <p>Every AI-proposed change — power plans, startup toggles, safe cleanups, DNS switches, and repairs — requires your single-use confirmation token.</p>
            </div>
          </div>

          <div className="product-ai-footer">
            <AppLink to="/docs" navigate={navigate} className="utility-ai-link">
              Explore Agent &amp; Settings
              <ArrowRight size={17} />
            </AppLink>
            <p className="product-ai-setup">
              AI replies require an Ollama server or configured provider in Settings. Storage scans, hardware inspection, tweaks, and cleanup tools work 100% locally without AI.
            </p>
          </div>
        </div>
      </section>
      <section className="product-benefits" aria-labelledby="benefits-title">
        <p className="product-eyebrow">Features &amp; benefits</p>
        <h2 id="benefits-title">Why use Groundwork?</h2>
        <div className="product-benefit-grid">
          {[
            {
              icon: Cpu,
              title: "Hardware & component topology",
              text: "Inspect live processor specs, motherboard and BIOS firmware, RAM SPD module timings, multi-GPU dedicated VRAM, and signed drivers with zero fabricated sensors.",
            },
            {
              icon: HardDrive,
              title: "High-speed storage analyzer",
              text: "Multi-threaded Win32 directory scanning with interactive proportional space maps, flat largest-files views, Space-Hog Forensics (caches, WSL & Docker VHDX), and CSV export.",
            },
            {
              icon: Wrench,
              title: "Windows tweaks & repair toolkit",
              text: "Apply Win11/10 optimization presets, audit runtime health, test DNS/TCP network connectivity, inspect Event Logs, and run guided SFC and DISM repair workflows.",
            },
            {
              icon: Sliders,
              title: "Power-user engine settings",
              text: "Tune parallel storage scan threads (2-16), configure folder exclusion rules, protect optional AI API keys with Windows DPAPI encryption, and review full operation history.",
            },
            {
              icon: Trash2,
              title: "App uninstaller & bloatware cleaner",
              text: "Browse Win32 desktop and Store apps, launch official uninstallers, scan AppData, ProgramData, and Registry leftovers, and remove built-in bloatware or install packages with winget.",
            },
            {
              icon: Sparkles,
              title: "Multi-provider AI System Assistant",
              text: "Connect local Ollama models or cloud providers (Gemini, OpenAI, Anthropic, Mistral, and Custom OpenAI-compatible APIs) backed by 27 typed system inspection and proposal tools.",
            },
            {
              icon: Folders,
              title: "Smart file organizer & preview plan",
              text: "Categorize cluttered Downloads and Desktop directories by file type with an interactive pre-execution move plan and one-click undo in Operation History.",
            },
            {
              icon: ShieldCheck,
              title: "10-step Safe Operation Engine",
              text: "Every modification validates prerequisites, captures original state, requires a single-use approval token, sends deletions to the Recycle Bin, and records rollback metadata.",
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
        <AppLink to="/download" navigate={navigate} className="site-primary">
          <Download size={18} />
          Get Groundwork for Windows
        </AppLink>
        <AppLink
          to="/about"
          navigate={navigate}
          className="product-roadmap-link"
        >
          macOS roadmap
        </AppLink>
      </section>
    </>
  );
}
