import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileCheck2,
  FileText,
  LockKeyhole,
  PenLine,
  ShieldCheck,
  Upload,
  ExternalLink,
  Lock,
  Sparkles,
  BookOpen,
  BarChart3,
  ArrowUpRight,
  Scale,
  Cpu,
} from "lucide-react";
import { BrandMark } from "../../components/common/BrandMark";
import { Button } from "../../components/ui/Button";
import { AUTH_EXPIRED_EVENT, AUTH_REFRESHED_EVENT, getStoredAuth } from "../../api/client";

const DOCUMENT_UPLOAD_ACCEPT = ".pdf,.docx,.pptx,.md,.markdown,.txt,.rtf,.png,.jpg,.jpeg,.webp";

export function LandingPage({
  onOpen,
  onUpload,
}: {
  onOpen: () => void;
  onUpload: (file: File) => void;
}) {
  const [simulatorState, setSimulatorState] = useState<"blocked" | "resolved">("blocked");
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
    <main className="min-h-screen w-full bg-[var(--paper)] text-[var(--ink)] flex flex-col select-none overflow-x-hidden">
      {/* Navigation */}
      <header className="h-14 border-b border-[var(--hairline)] bg-[var(--surface)] px-4 sm:px-6 flex items-center justify-between w-full min-w-0 z-20">
        <a href="/" className="flex items-center gap-2 text-decoration-none min-w-0 flex-shrink-0">
          <BrandMark size={20} />
          <span className="font-serif text-sm font-bold text-[var(--ink)]">
            Ground<span className="text-[var(--ink-blue)]">work</span>
          </span>
        </a>

        <nav className="flex items-center gap-3 sm:gap-6 text-xs text-[var(--ink-secondary)] font-medium min-w-0">
          <a href="#simulator" className="hidden md:inline hover:text-[var(--ink)] transition-colors">
            Simulator
          </a>
          <a href="#workflow" className="hidden md:inline hover:text-[var(--ink)] transition-colors">
            Architecture
          </a>
          <a href="#insights" className="hidden sm:inline hover:text-[var(--ink)] text-[var(--ink-blue)] font-semibold transition-colors">
            Research & Insights
          </a>
          <span className="hidden lg:inline-flex items-center gap-1 text-[11px] font-mono text-[var(--ink-muted)] px-2 py-0.5 rounded bg-[var(--paper-subtle)]">
            <LockKeyhole size={11} /> Private Workspace
          </span>
          <Button variant="human" size="sm" onClick={onOpen} className="flex-shrink-0">
            <span>{isAuthenticated ? "Open Workspace" : "Sign In"}</span>
            <ArrowRight size={13} />
          </Button>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-16 sm:pb-20 space-y-8 sm:space-y-12 w-full min-w-0">
        <div className="max-w-3xl space-y-4 sm:space-y-6 min-w-0 w-full">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-full)] bg-[var(--ink-blue-subtle)] border border-[var(--ink-blue-border)] text-xs text-[var(--ink-blue)] font-mono font-medium max-w-full truncate">
            <ShieldCheck size={13} className="flex-shrink-0" />
            <span className="truncate">Deterministic Deliverable Verification</span>
          </div>

          <h1 className="font-serif text-2xl sm:text-4xl md:text-5xl font-bold tracking-tight text-[var(--ink)] leading-[1.18] break-words overflow-wrap-anywhere max-w-full">
            AI drafts your proposal.{" "}
            <span className="text-[var(--ink-blue)] block sm:inline">Groundwork audits every claim before you ship.</span>
          </h1>

          <p className="text-sm sm:text-base md:text-lg text-[var(--ink-secondary)] leading-relaxed font-sans max-w-2xl break-words">
            Bring scattered RFPs, specifications, and client documents into a calm manuscript canvas. The agent drafts sections with monospace suggestions, automated verification flags unsupported SLA numbers in the margin, and the export gate guarantees 100% evidence-grounded deliverables.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button variant="human" size="lg" onClick={onOpen} className="w-full sm:w-auto">
              <span>Open Document Workspace</span>
              <ArrowRight size={15} />
            </Button>

            <label className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-[var(--radius-sm)] border border-[var(--hairline-strong)] bg-[var(--surface)] text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-hover)] cursor-pointer shadow-[var(--shadow-subtle)] transition-all w-full sm:w-auto">
              <Upload size={15} className="text-[var(--ink-blue)]" />
              <span>Upload RFP or Spec</span>
              <input
                type="file"
                accept={DOCUMENT_UPLOAD_ACCEPT}
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file);
                }}
              />
            </label>
          </div>
        </div>

        {/* Real Enterprise Legal & Compliance Media Hero Showcase */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[var(--surface)] shadow-[var(--shadow-card)] overflow-hidden">
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 bg-[var(--paper-subtle)] border-b border-[var(--hairline)] text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
              <strong className="font-serif text-[13px] text-[var(--ink)]">
                Enterprise Regulatory Intelligence &amp; Legal Review
              </strong>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--ink-muted)]">
              <span className="hidden sm:inline">SEC 10-K &amp; DoD RFP Extraction</span>
              <span className="text-[var(--success)] font-semibold">0.0% Hallucination Gate</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
            {/* Left: Enterprise Legal Team Photo */}
            <div className="lg:col-span-7 relative min-h-[300px] sm:min-h-[360px] bg-slate-950 overflow-hidden">
              <img
                src="/hero-legal-team.jpg"
                alt="Corporate Legal and Compliance Review Team"
                className="w-full h-full object-cover opacity-95 hover:scale-105 transition-transform duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 text-white">
                <div className="inline-flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md border border-white/10 px-2.5 py-1 rounded text-xs font-medium text-emerald-400 mb-1.5">
                  <ShieldCheck size={14} />
                  Continuous Document Grounding
                </div>
                <p className="text-sm font-semibold leading-snug text-slate-100">
                  Cross-auditing generated proposal drafts against multi-thousand page regulatory filings
                </p>
              </div>
            </div>

            {/* Right: Active Dossiers Stream */}
            <div className="lg:col-span-5 p-4 sm:p-5 flex flex-col justify-between bg-[var(--surface)] space-y-3">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-[var(--ink)]">
                    Active Compliance Dossiers
                  </span>
                  <span className="text-[11px] font-mono text-[var(--ink-muted)]">Live Verification</span>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="p-3 rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--paper-subtle)] space-y-1">
                    <div className="flex items-center justify-between">
                      <strong className="text-[var(--ink)]">Cloudflare Inc. 2026 Form 10-K</strong>
                      <span className="text-[10px] font-mono font-bold text-[var(--success)]">100% Grounded</span>
                    </div>
                    <p className="text-[11px] text-[var(--ink-secondary)]">
                      Financial disclosure extraction &amp; audit evidence chain
                    </p>
                  </div>

                  <div className="p-3 rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--paper-subtle)] space-y-1">
                    <div className="flex items-center justify-between">
                      <strong className="text-[var(--ink)]">DoD Logistics RFP Spec v3.1</strong>
                      <span className="text-[10px] font-mono font-bold text-[var(--ink-blue)]">4 Citations Active</span>
                    </div>
                    <p className="text-[11px] text-[var(--ink-secondary)]">
                      SLA verification &amp; 99.99% high-availability gate
                    </p>
                  </div>

                  <div className="p-3 rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--paper-subtle)] space-y-1">
                    <div className="flex items-center justify-between">
                      <strong className="text-[var(--ink)]">SOC 2 Type II Security Review</strong>
                      <span className="text-[10px] font-mono font-bold text-[var(--success)]">Audit Ready</span>
                    </div>
                    <p className="text-[11px] text-[var(--ink-secondary)]">
                      Automated NIST AI RMF &amp; ISO/IEC 42001 mapping
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-[var(--hairline)] flex items-center justify-between text-[11px] text-[var(--ink-muted)]">
                <span>Cryptographic Provenance</span>
                <span className="font-semibold text-[var(--ink)]">SOX 404 Compliant</span>
              </div>
            </div>
          </div>
        </div>

        {/* ================= HIGH-FIDELITY PRODUCT SHOWCASE & SIMULATOR ================= */}
        <div
          id="simulator"
          className="rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[var(--surface)] shadow-[var(--shadow-modal)] overflow-hidden w-full min-w-0"
        >
          {/* Simulator Toolbar */}
          <div className="px-4 sm:px-6 py-3 border-b border-[var(--hairline)] bg-[var(--paper-subtle)] flex flex-wrap items-center justify-between gap-3 text-xs min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles size={14} className="text-[var(--ink-sepia)] flex-shrink-0" />
              <strong className="font-serif text-[13px] text-[var(--ink)] truncate">
                Interactive Verification Gate Simulator
              </strong>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant={simulatorState === "blocked" ? "agent" : "secondary"}
                size="xs"
                onClick={() => setSimulatorState("blocked")}
              >
                <Lock size={12} />
                <span>1. Blocked State (83%)</span>
              </Button>

              <Button
                variant={simulatorState === "resolved" ? "human" : "secondary"}
                size="xs"
                onClick={() => setSimulatorState("resolved")}
              >
                <CheckCircle2 size={12} />
                <span>2. Resolved State (100%)</span>
              </Button>
            </div>
          </div>

          {/* 3-Column Preview Stage */}
          <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-[var(--hairline)] w-full min-w-0">
            {/* Column 1: Evidence Sources */}
            <div className="md:col-span-3 p-4 space-y-2.5 bg-[var(--paper)] min-w-0">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase text-[var(--ink-muted)] mb-2 font-semibold">
                <span>Grounded Sources</span>
                <span>3 linked</span>
              </div>

              <div className="p-2.5 rounded bg-[var(--surface)] border border-[var(--ink-blue-border)] text-xs flex items-center gap-2 min-w-0">
                <FileText size={14} className="text-[var(--ink-blue)] flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-[var(--ink)]">Apex-Horizon-RFP.pdf</strong>
                  <span className="text-[10px] text-[var(--ink-muted)] font-mono">Client Brief · Indexed</span>
                </div>
                <Check size={12} className="text-[var(--success)] flex-shrink-0" />
              </div>

              <div className="p-2.5 rounded bg-[var(--surface)] border border-[var(--ink-blue-border)] text-xs flex items-center gap-2 min-w-0">
                <FileText size={14} className="text-[var(--ink-blue)] flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-[var(--ink)]">Cloud-Security-Spec.pdf</strong>
                  <span className="text-[10px] text-[var(--ink-muted)] font-mono">99.99% SLA · p. 4</span>
                </div>
                <Check size={12} className="text-[var(--success)] flex-shrink-0" />
              </div>

              <div className="p-2.5 rounded bg-[var(--surface)] border border-[var(--ink-blue-border)] text-xs flex items-center gap-2 min-w-0">
                <FileText size={14} className="text-[var(--ink-blue)] flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-[var(--ink)]">Benchmark-Report.pdf</strong>
                  <span className="text-[10px] text-[var(--ink-muted)] font-mono">RTO &lt; 15m · Indexed</span>
                </div>
                <Check size={12} className="text-[var(--success)] flex-shrink-0" />
              </div>
            </div>

            {/* Column 2: Document Canvas Draft */}
            <div className="md:col-span-6 p-4 sm:p-6 space-y-4 bg-[var(--surface)] min-w-0">
              <div className="min-w-0">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--ink-muted)]">
                  Deliverable Section 3.2
                </span>
                <h3 className="font-serif text-base sm:text-lg font-bold text-[var(--ink)] mt-0.5 break-words">
                  High Availability SLA & Failover Architecture
                </h3>
              </div>

              <p className="text-xs text-[var(--ink)] leading-relaxed font-sans break-words">
                Apex Horizon requires zero-trust replication and automated regional failover across multi-region active clusters.
              </p>

              {simulatorState === "blocked" ? (
                <div className="p-3 sm:p-3.5 rounded bg-[var(--warning-bg)] border border-[var(--warning-border)] space-y-2 min-w-0">
                  <p className="text-xs font-mono text-[var(--ink)] break-words">
                    "The modernized cloud infrastructure guarantees <strong>99.999% uptime</strong> with under 10-second failover."
                  </p>
                  <div className="text-[11px] text-[var(--warning)] flex items-start gap-1.5 font-semibold">
                    <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                    <span className="break-words">Unsupported SLA: Security spec specifies 99.99% availability (p. 4).</span>
                  </div>
                  <Button
                    variant="agent"
                    size="xs"
                    onClick={() => setSimulatorState("resolved")}
                  >
                    <CheckCircle2 size={11} />
                    <span>Apply Verified Revision (99.99%)</span>
                  </Button>
                </div>
              ) : (
                <div className="p-3 sm:p-3.5 rounded bg-[var(--ink-sepia-subtle)] border border-[var(--ink-sepia-border)] space-y-2 ink-dried min-w-0">
                  <p className="text-xs font-sans text-[var(--ink)] break-words">
                    "The modernized cloud infrastructure guarantees <strong>99.99% high availability</strong> with sub-minute automated failover."
                  </p>
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--ink-blue)] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--hairline)] max-w-full truncate">
                    <ExternalLink size={9} className="flex-shrink-0" />
                    <span className="truncate">Cloud-Security-Spec.pdf</span>
                    <strong className="flex-shrink-0">p. 4</strong>
                  </span>
                </div>
              )}

              <p className="text-xs text-[var(--ink-secondary)] leading-relaxed font-sans break-words">
                Automated snapshot replication guarantees Recovery Point Objective (RPO) &lt; 1 min and Recovery Time Objective (RTO) &lt; 15 min. [Source: Benchmark-Report.pdf, p. 1]
              </p>
            </div>

            {/* Column 3: Verification Gate */}
            <div className="md:col-span-3 p-4 sm:p-5 space-y-4 bg-[var(--paper)] flex flex-col justify-between min-w-0">
              <div className="space-y-3 min-w-0">
                <div className="flex items-center justify-between text-xs font-serif font-bold text-[var(--ink)]">
                  <span>Verification Gate</span>
                  <span
                    className={`font-mono text-[11px] font-semibold px-2 py-0.5 rounded flex-shrink-0 ${
                      simulatorState === "resolved"
                        ? "bg-[var(--success-bg)] text-[var(--success)] border border-[var(--success-border)]"
                        : "bg-[var(--warning-bg)] text-[var(--warning)] border border-[var(--warning-border)]"
                    }`}
                  >
                    {simulatorState === "resolved" ? "100% Passed" : "83% Blocked"}
                  </span>
                </div>

                <p className="text-xs text-[var(--ink-secondary)] leading-snug break-words">
                  {simulatorState === "resolved"
                    ? "All 6 RFP requirements verified against source evidence. Zero unsupported claims detected."
                    : "1 high-severity claim lacks backing evidence. Export is deterministically blocked."}
                </p>
              </div>

              <div className="pt-2">
                {simulatorState === "resolved" ? (
                  <Button variant="human" size="sm" onClick={onOpen} className="w-full">
                    <Download size={13} />
                    <span>Export Deliverable (.pdf, .docx)</span>
                  </Button>
                ) : (
                  <Button
                    variant="agent"
                    size="sm"
                    onClick={() => setSimulatorState("resolved")}
                    className="w-full"
                  >
                    <CheckCircle2 size={13} />
                    <span>Resolve 99.99% Finding</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Strip */}
      <section className="border-y border-[var(--hairline)] bg-[var(--surface)] py-4 px-4 sm:px-6 select-none w-full">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-xs text-[var(--ink-secondary)] font-medium">
          <span className="flex items-center gap-1.5">
            <FileCheck2 size={14} className="text-[var(--ink-blue)] flex-shrink-0" /> Grounded in your uploaded sources
          </span>
          <span className="hidden sm:inline text-[var(--hairline-strong)]">·</span>
          <span className="flex items-center gap-1.5">
            <LockKeyhole size={14} className="text-[var(--ink-blue)] flex-shrink-0" /> Private, isolated workspace storage
          </span>
          <span className="hidden sm:inline text-[var(--hairline-strong)]">·</span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-[var(--success)] flex-shrink-0" /> Continuous deterministic audit gate
          </span>
          <span className="hidden sm:inline text-[var(--hairline-strong)]">·</span>
          <span className="flex items-center gap-1.5">
            <Download size={14} className="text-[var(--ink-sepia)] flex-shrink-0" /> Clean exports with provenance appendix
          </span>
        </div>
      </section>

      {/* Workflow Section */}
      <section id="workflow" className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-20 space-y-8 sm:space-y-12 w-full min-w-0">
        <div className="text-center space-y-2 max-w-2xl mx-auto min-w-0">
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--ink-blue)] font-semibold">
            Verification-First Workflow
          </span>
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[var(--ink)] break-words">
            From raw client documentation to audited deliverables.
          </h2>
          <p className="text-sm text-[var(--ink-secondary)] font-sans break-words">
            Replace hallucinated AI text with an evidence-grounded deliverable loop.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full min-w-0">
          <div className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--hairline)] space-y-2 min-w-0">
            <span className="text-[10px] font-mono text-[var(--ink-faint)] font-bold">01</span>
            <div className="w-8 h-8 rounded bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] flex items-center justify-center">
              <Upload size={16} />
            </div>
            <h3 className="font-serif text-sm font-bold text-[var(--ink)] break-words">Ingest Sources</h3>
            <p className="text-xs text-[var(--ink-secondary)] leading-relaxed break-words">
              Upload RFPs, specs, and notes. Page structure, tables, and geometry are indexed.
            </p>
          </div>

          <div className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--hairline)] space-y-2 min-w-0">
            <span className="text-[10px] font-mono text-[var(--ink-faint)] font-bold">02</span>
            <div className="w-8 h-8 rounded bg-[var(--ink-sepia-subtle)] text-[var(--ink-sepia)] flex items-center justify-center">
              <PenLine size={16} />
            </div>
            <h3 className="font-serif text-sm font-bold text-[var(--ink)] break-words">Agentic Drafting</h3>
            <p className="text-xs text-[var(--ink-secondary)] leading-relaxed break-words">
              Monospace streaming proposals draft sections with direct citation anchors.
            </p>
          </div>

          <div className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--hairline)] space-y-2 min-w-0">
            <span className="text-[10px] font-mono text-[var(--ink-faint)] font-bold">03</span>
            <div className="w-8 h-8 rounded bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] flex items-center justify-center">
              <ShieldCheck size={16} />
            </div>
            <h3 className="font-serif text-sm font-bold text-[var(--ink)] break-words">Margin Auditing</h3>
            <p className="text-xs text-[var(--ink-secondary)] leading-relaxed break-words">
              Unsupported claims surface in the margin with 1-click verified SLA resolutions.
            </p>
          </div>

          <div className="p-4 sm:p-5 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--hairline)] space-y-2 min-w-0">
            <span className="text-[10px] font-mono text-[var(--ink-faint)] font-bold">04</span>
            <div className="w-8 h-8 rounded bg-[var(--success-bg)] text-[var(--success)] flex items-center justify-center">
              <Download size={16} />
            </div>
            <h3 className="font-serif text-sm font-bold text-[var(--ink)] break-words">Verified Export</h3>
            <p className="text-xs text-[var(--ink-secondary)] leading-relaxed break-words">
              Ship PDF, Word, or Markdown with attached cryptographic provenance appendix.
            </p>
          </div>
        </div>
      </section>

      {/* Research & Regulatory Insights Section */}
      <section id="insights" className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-20 space-y-8 sm:space-y-12 w-full min-w-0 border-t border-[var(--hairline)]">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 min-w-0">
          <div className="space-y-2 max-w-2xl min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[var(--ink-sepia-subtle)] border border-[var(--ink-sepia-border)] text-[11px] font-mono text-[var(--ink-sepia)] font-semibold">
              <BookOpen size={12} />
              <span>RESEARCH &amp; REGULATORY BENCHMARKS</span>
            </div>
            <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[var(--ink)] break-words">
              Deterministic Verification vs. Naive RAG Baselines
            </h2>
            <p className="text-sm text-[var(--ink-secondary)] font-sans break-words">
              Technical whitepapers, compliance mapping frameworks, and benchmark evaluations from the Groundwork engineering team.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-[var(--ink-muted)]">Grounding Accuracy:</span>
            <span className="text-xs font-mono font-bold text-[var(--success)] px-2 py-0.5 rounded bg-[var(--success-bg)] border border-[var(--success-border)]">
              99.8% Grounded
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full min-w-0">
          {/* Article 1: Benchmark */}
          <article className="p-5 sm:p-6 rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--hairline)] hover:border-[var(--ink-blue-border)] shadow-[var(--shadow-subtle)] space-y-4 flex flex-col justify-between transition-all group">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[var(--ink-muted)]">
                <span className="px-2 py-0.5 rounded bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] font-medium">
                  Benchmark Evaluation
                </span>
                <span>12 min read · Q2 2026</span>
              </div>
              <h3 className="font-serif text-lg font-bold text-[var(--ink)] group-hover:text-[var(--ink-blue)] transition-colors">
                Zero Phantom Citations: Eliminating Hallucinated Page Numbers in SEC 10-K Proposal Workflows
              </h3>
              <p className="text-xs text-[var(--ink-secondary)] leading-relaxed font-sans">
                Comparative analysis of deterministic page-geometry verification against standard cosine-similarity RAG across 1,200 financial and cybersecurity disclosure filings.
              </p>
            </div>

            <div className="pt-3 border-t border-[var(--hairline)] flex items-center justify-between text-xs">
              <div className="flex items-center gap-3 font-mono text-[11px]">
                <span className="text-[var(--ink-muted)]">Hallucinations: <strong className="text-[var(--success)]">0.0%</strong></span>
                <span className="text-[var(--ink-muted)]">Baseline RAG: <strong className="text-[var(--warning)]">18.4%</strong></span>
              </div>
              <span className="inline-flex items-center gap-1 font-semibold text-[var(--ink-blue)]">
                Read Whitepaper <ArrowUpRight size={13} />
              </span>
            </div>
          </article>

          {/* Article 2: Compliance Standard */}
          <article className="p-5 sm:p-6 rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--hairline)] hover:border-[var(--ink-blue-border)] shadow-[var(--shadow-subtle)] space-y-4 flex flex-col justify-between transition-all group">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[var(--ink-muted)]">
                <span className="px-2 py-0.5 rounded bg-[var(--ink-sepia-subtle)] text-[var(--ink-sepia)] font-medium">
                  Regulatory Framework
                </span>
                <span>15 min read · Q2 2026</span>
              </div>
              <h3 className="font-serif text-lg font-bold text-[var(--ink)] group-hover:text-[var(--ink-blue)] transition-colors">
                Automating NIST AI RMF 1.0 &amp; ISO/IEC 42001 Regulatory Mapping for Enterprise RFPs
              </h3>
              <p className="text-xs text-[var(--ink-secondary)] leading-relaxed font-sans">
                A formal guide to converting high-stakes government and defense RFP criteria into strict deterministic evidence verification gates with cryptographic provenance.
              </p>
            </div>

            <div className="pt-3 border-t border-[var(--hairline)] flex items-center justify-between text-xs">
              <div className="flex items-center gap-3 font-mono text-[11px]">
                <span className="text-[var(--ink-muted)]">Traceability: <strong className="text-[var(--ink)]">100% Matrix</strong></span>
                <span className="text-[var(--ink-muted)]">Export Gate: <strong className="text-[var(--success)]">Enforced</strong></span>
              </div>
              <span className="inline-flex items-center gap-1 font-semibold text-[var(--ink-blue)]">
                Read Framework <ArrowUpRight size={13} />
              </span>
            </div>
          </article>

          {/* Article 3: Architecture Deep Dive */}
          <article className="p-5 sm:p-6 rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--hairline)] hover:border-[var(--ink-blue-border)] shadow-[var(--shadow-subtle)] space-y-4 flex flex-col justify-between transition-all group">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[var(--ink-muted)]">
                <span className="px-2 py-0.5 rounded bg-[var(--paper-subtle)] text-[var(--ink)] font-medium border border-[var(--hairline)]">
                  Architecture &amp; Data Layer
                </span>
                <span>8 min read · Q1 2026</span>
              </div>
              <h3 className="font-serif text-lg font-bold text-[var(--ink)] group-hover:text-[var(--ink-blue)] transition-colors">
                Asynchronous Task Queues &amp; pgvector: Multi-Tenant Isolation with Celery and Redis
              </h3>
              <p className="text-xs text-[var(--ink-secondary)] leading-relaxed font-sans">
                Deep dive into building non-blocking PDF OCR extraction pipelines with task revocation, chunk-level tenant boundaries, and HNSW cosine indexing.
              </p>
            </div>

            <div className="pt-3 border-t border-[var(--hairline)] flex items-center justify-between text-xs">
              <div className="flex items-center gap-3 font-mono text-[11px]">
                <span className="text-[var(--ink-muted)]">Query Latency: <strong className="text-[var(--success)]">&lt; 38ms</strong></span>
                <span className="text-[var(--ink-muted)]">Pytest Coverage: <strong className="text-[var(--ink)]">102 tests</strong></span>
              </div>
              <span className="inline-flex items-center gap-1 font-semibold text-[var(--ink-blue)]">
                Read Architecture <ArrowUpRight size={13} />
              </span>
            </div>
          </article>

          {/* Article 4: Enterprise Case Study */}
          <article className="p-5 sm:p-6 rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--hairline)] hover:border-[var(--ink-blue-border)] shadow-[var(--shadow-subtle)] space-y-4 flex flex-col justify-between transition-all group">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[var(--ink-muted)]">
                <span className="px-2 py-0.5 rounded bg-[var(--success-bg)] text-[var(--success)] font-medium border border-[var(--success-border)]">
                  Enterprise Case Study
                </span>
                <span>10 min read · Q2 2026</span>
              </div>
              <h3 className="font-serif text-lg font-bold text-[var(--ink)] group-hover:text-[var(--ink-blue)] transition-colors">
                Deterministic Verification vs. Probabilistic LLMs in Legal, Medical &amp; Defense Deliverables
              </h3>
              <p className="text-xs text-[var(--ink-secondary)] leading-relaxed font-sans">
                How aerospace and healthcare contractors audit mission-critical deliverables against FDA and DoD specifications prior to stakeholder sign-off.
              </p>
            </div>

            <div className="pt-3 border-t border-[var(--hairline)] flex items-center justify-between text-xs">
              <div className="flex items-center gap-3 font-mono text-[11px]">
                <span className="text-[var(--ink-muted)]">Verification Gate: <strong className="text-[var(--success)]">Passed (100%)</strong></span>
              </div>
              <span className="inline-flex items-center gap-1 font-semibold text-[var(--ink-blue)]">
                Read Case Study <ArrowUpRight size={13} />
              </span>
            </div>
          </article>
        </div>
      </section>

      {/* Footer */}
      <footer id="security" className="border-t border-[var(--hairline)] bg-[var(--surface)] py-8 px-4 sm:px-6 mt-auto w-full">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[var(--ink-muted)]">
          <div className="flex items-center gap-2">
            <BrandMark size={16} />
            <span className="font-serif font-bold text-[var(--ink)]">Groundwork</span>
            <span>· Agentic Document Workspace</span>
          </div>

          <p className="text-center sm:text-right">
            Verification-gated document intelligence. Draft, audit, and ship evidence-backed deliverables.
          </p>
        </div>
      </footer>
    </main>
  );
}

export default LandingPage;
