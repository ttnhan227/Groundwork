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
  Search,
  ShieldCheck,
  Upload,
  ExternalLink,
  Layers,
  Lock,
  FileSpreadsheet,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { BrandMark } from "../../components/common/BrandMark";
import { AUTH_EXPIRED_EVENT, AUTH_REFRESHED_EVENT, getStoredAuth } from "../../api/client";

const DOCUMENT_UPLOAD_ACCEPT = ".pdf,.docx,.pptx,.md,.markdown,.txt,.rtf,.png,.jpg,.jpeg,.webp";

export function LandingPage({
  onOpen,
  onUpload,
}: {
  onOpen: () => void;
  onUpload: (file: File) => void;
}) {
  const [prompt, setPrompt] = useState("");
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

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) return;
    sessionStorage.setItem("groundwork-pending-prompt", prompt.trim());
    sessionStorage.setItem("insightpdf-pending-prompt", prompt.trim());
    onOpen();
  }

  return (
    <main className="ai-landing">
      {/* Navigation */}
      <header className="ai-landing-nav">
        <a className="ai-landing-brand" href="/" aria-label="Groundwork home">
          <BrandMark size={20} />
          <span>Ground<b>work</b></span>
        </a>
        <nav aria-label="Landing navigation">
          <a href="#workflow">Architecture</a>
          <a href="#verification">Verification Engine</a>
          <a href="#security">Security & Isolation</a>
          <span className="nav-privacy-tag"><LockKeyhole size={13} /> Private workspace</span>
          <button onClick={onOpen} className="btn-nav-action">
            {isAuthenticated ? "Open Workspace" : "Sign In"}
            <ArrowRight size={14} />
          </button>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="ai-landing-hero">
        <div className="ai-landing-copy">
          <div className="ai-eyebrow">
            <ShieldCheck size={14} /> Deterministic Deliverable Verification
          </div>
          <h1>
            AI drafts your deliverables.<br />
            <span>Groundwork audits them before you ship.</span>
          </h1>
          <p>
            Bring scattered RFPs, specifications, and research into one unified workspace. The agent drafts your proposal, continuous automated audits verify every claim against source documentation, and the export gate guarantees nothing unverified leaves the workspace.
          </p>

          <div className="hero-cta-buttons-row">
            <button onClick={onOpen} className="btn-hero-primary">
              <span>Open Workspace</span>
              <ArrowRight size={15} />
            </button>
            <label className="btn-hero-upload">
              <Upload size={15} />
              <span>Upload RFP or Spec</span>
              <input
                type="file"
                accept={DOCUMENT_UPLOAD_ACCEPT}
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(file);
                }}
              />
            </label>
          </div>

          {/* Quick Prompt Input */}
          <form className="ai-hero-composer" onSubmit={submitPrompt}>
            <div className="composer-input-row">
              <Search size={16} className="composer-icon" />
              <input
                aria-label="Describe deliverable"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Or describe a deliverable to draft & audit (e.g. Cloud Modernization Proposal, Compliance Audit)…"
              />
              <button type="submit" disabled={!prompt.trim()} className="btn-send">
                <span>Start</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </form>
        </div>

        {/* ================= HIGH-FIDELITY PRODUCT SHOWCASE & SIMULATOR ================= */}
        <div className="ai-product-stage" id="verification" aria-label="Groundwork workspace preview">
          <div className="preview-window">
            <header className="preview-header">
              <div className="preview-dots">
                <span />
                <span />
                <span />
              </div>
              <div className="preview-title">
                <BrandMark size={14} />
                <span>Apex Horizon Cloud Modernization · Technical Proposal</span>
              </div>
              <div className="preview-meta">
                <span className="badge-grounded">● 3 Evidence Sources Active</span>
                <span className={`badge-readiness ${simulatorState === "resolved" ? "ready" : "blocked"}`}>
                  {simulatorState === "resolved" ? "Readiness: 100% (Verified)" : "Readiness: 83% (Export Blocked)"}
                </span>
              </div>
            </header>

            {/* Interactive Simulator Toggle Bar */}
            <div className="simulator-banner-bar">
              <span className="simulator-banner-label">
                <strong>Interactive Verification Gate Simulator:</strong> {simulatorState === "blocked" ? "1 unsupported claim detected in draft — export blocked." : "Claim resolved with cited 99.99% SLA — export unlocked."}
              </span>
              <div className="simulator-toggle-buttons">
                <button
                  type="button"
                  className={`btn-sim-toggle ${simulatorState === "blocked" ? "active" : ""}`}
                  onClick={() => setSimulatorState("blocked")}
                >
                  <Lock size={12} />
                  <span>1. Blocked State (83%)</span>
                </button>
                <button
                  type="button"
                  className={`btn-sim-toggle ${simulatorState === "resolved" ? "active" : ""}`}
                  onClick={() => setSimulatorState("resolved")}
                >
                  <CheckCircle2 size={12} />
                  <span>2. Resolved State (100%)</span>
                </button>
              </div>
            </div>

            {/* 3-Column Professional Workspace Layout */}
            <div className="preview-workspace-layout">
              {/* Column 1: Sources */}
              <aside className="preview-col-sources">
                <div className="preview-section-title">
                  <span>Evidence Sources</span>
                  <span className="count-pill">3 linked</span>
                </div>
                <div className="preview-source-item active">
                  <FileText size={13} />
                  <div>
                    <strong>Apex-Horizon-RFP.pdf</strong>
                    <small>Client Brief · Indexed</small>
                  </div>
                  <Check size={11} className="text-success" />
                </div>
                <div className="preview-source-item active">
                  <FileText size={13} />
                  <div>
                    <strong>Cloud-Security-Spec.pdf</strong>
                    <small>99.99% SLA · p. 4</small>
                  </div>
                  <Check size={11} className="text-success" />
                </div>
                <div className="preview-source-item active">
                  <FileText size={13} />
                  <div>
                    <strong>Benchmark-Report.pdf</strong>
                    <small>RTO &lt; 15m · Indexed</small>
                  </div>
                  <Check size={11} className="text-success" />
                </div>
              </aside>

              {/* Column 2: Draft Document with Citations / Callouts */}
              <section className="preview-col-draft">
                <div className="preview-draft-header">
                  <span className="preview-doc-tag">Deliverables, Artifacts & Studio</span>
                  <h4>Cloud Architecture & High Availability SLA</h4>
                </div>

                <div className="preview-draft-body">
                  <p className="preview-normal-text">
                    Apex Horizon requires a resilient, multi-region cloud architecture that delivers zero-trust data protection and automated failover across active-active cloud regions.
                  </p>

                  {simulatorState === "blocked" ? (
                    <div className="preview-flagged-block">
                      <p className="preview-claim-text-flagged">
                        "The modernized cloud infrastructure guarantees <strong>99.999% uptime</strong> with under 10-second automated failover across all multi-region clusters."
                      </p>
                      <div className="preview-finding-inline-callout">
                        <div className="callout-header">
                          <AlertTriangle size={13} className="icon-amber" />
                          <strong>Verification Finding: Unsupported SLA Metric</strong>
                        </div>
                        <p className="callout-desc">
                          Security spec establishes 99.99% availability with sub-minute failover (p. 4). The 99.999% claim lacks source evidence.
                        </p>
                        <button
                          type="button"
                          className="btn-callout-quick-resolve"
                          onClick={() => setSimulatorState("resolved")}
                        >
                          <CheckCircle2 size={12} />
                          <span>Apply Verified Revision (99.99% SLA)</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="preview-resolved-block">
                      <p className="preview-claim-text">
                        "The modernized cloud infrastructure guarantees <strong>99.99% high availability</strong> with sub-minute automated failover across all multi-region clusters."
                      </p>
                      <span className="preview-citation-chip">
                        <ExternalLink size={10} />
                        <span>Cloud-Security-Spec.pdf</span>
                        <strong>p. 4</strong>
                      </span>
                    </div>
                  )}

                  <p className="preview-normal-text" style={{ marginTop: "8px" }}>
                    Automated snapshot replication guarantees a Recovery Point Objective (RPO) under 1 minute and Recovery Time Objective (RTO) under 15 minutes. [Source: Benchmark-Report.pdf, p. 1]
                  </p>
                </div>
              </section>

              {/* Column 3: Verification & Export Gate */}
              <aside className="preview-col-audit">
                <div className="preview-section-title">
                  <span>Verification Gate</span>
                  <span className={`gate-status-pill ${simulatorState === "resolved" ? "unlocked" : "blocked"}`}>
                    {simulatorState === "resolved" ? (
                      <>
                        <ShieldCheck size={11} />
                        <span>Audit Passed (100%)</span>
                      </>
                    ) : (
                      <>
                        <Lock size={11} />
                        <span>Export Blocked (83%)</span>
                      </>
                    )}
                  </span>
                </div>

                {simulatorState === "resolved" ? (
                  <div className="preview-passed-card">
                    <div className="card-top-alert">
                      <CheckCircle2 size={16} className="text-emerald" />
                      <strong>100% Verified Readiness</strong>
                    </div>
                    <p className="finding-body-text">
                      All 6 RFP requirements verified against source evidence. Zero unsupported claims detected.
                    </p>
                    <button className="btn-interactive-export" onClick={onOpen}>
                      <Download size={13} />
                      <span>Export Deliverable (.pdf, .docx) ✓</span>
                    </button>
                    <div className="preview-footer-note">
                      <small>Includes Cryptographic Audit Provenance Appendix</small>
                    </div>
                  </div>
                ) : (
                  <div className="preview-blocked-card">
                    <div className="card-top-alert alert-blocked">
                      <Lock size={16} className="text-danger" />
                      <strong>Export Gate: Blocked</strong>
                    </div>
                    <p className="finding-body-text">
                      1 high-severity finding requires evidence resolution before deliverable export is permitted.
                    </p>
                    <button
                      type="button"
                      className="btn-interactive-resolve"
                      onClick={() => setSimulatorState("resolved")}
                    >
                      <CheckCircle2 size={13} />
                      <span>Resolve 99.99% Finding</span>
                    </button>
                    <div className="preview-footer-note">
                      <small>Policy Enforcement: Unverified claims blocked</small>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Strip */}
      <section className="ai-trust-strip" aria-label="Product guarantees">
        <span><FileCheck2 size={15} /> Grounded in your uploaded sources</span>
        <i />
        <span><LockKeyhole size={15} /> Private, isolated workspace per account</span>
        <i />
        <span><ShieldCheck size={15} /> Continuous automated claim auditing</span>
        <i />
        <span><Download size={15} /> Clean exports with cryptographic audit appendix</span>
      </section>

      {/* Workflow Section */}
      <section className="ai-workflow-section" id="workflow">
        <header>
          <div className="ai-eyebrow"><ShieldCheck size={13} /> Verification-First Architecture</div>
          <h2>From raw documentation to audited deliverables.</h2>
          <p>Groundwork replaces risky, hallucinated AI text with an audited, evidence-backed deliverable workflow.</p>
        </header>

        <div className="ai-workflow-grid">
          <article>
            <span className="step-num">01</span>
            <div className="step-icon"><Upload size={20} /></div>
            <h3>Ingest Sources</h3>
            <p>Upload RFPs, technical specifications, and research notes. Text, page structure, and geometry are indexed into local vector storage.</p>
          </article>
          <article>
            <span className="step-num">02</span>
            <div className="step-icon"><PenLine size={20} /></div>
            <h3>Agentic Drafting</h3>
            <p>The workspace agent extracts acceptance criteria, structures the deliverable, and drafts sections grounded in evidence.</p>
          </article>
          <article>
            <span className="step-num">03</span>
            <div className="step-icon"><ShieldCheck size={20} /></div>
            <h3>Automated Verification</h3>
            <p>The audit engine checks every generated claim against source evidence, flags unsupported metrics, and blocks unverified export.</p>
          </article>
          <article>
            <span className="step-num">04</span>
            <div className="step-icon"><Download size={20} /></div>
            <h3>Verified Export</h3>
            <p>Once all issues are resolved, export clean PDF, Word (.docx), or Markdown deliverables with a stamped audit appendix.</p>
          </article>
        </div>
      </section>

      {/* Security & Privacy Section */}
      <section className="ai-security-section" id="security">
        <div className="security-badge"><ShieldCheck size={20} /><span>Enterprise Workspace Storage</span></div>
        <h2>Privacy and source integrity come first.</h2>
        <p>
          Your documents are never used to train public models. Files are stored securely in your isolated workspace, processed with durable background jobs, and remain completely under your control with one-click data deletion and export.
        </p>
        <button onClick={onOpen} className="btn-security-cta">
          {isAuthenticated ? "Continue to your workspace" : "Get started with Groundwork"}
          <ArrowRight size={15} />
        </button>
      </section>

      {/* Footer */}
      <footer className="ai-landing-footer">
        <div className="footer-brand">
          <BrandMark size={16} />
          <span>Ground<b>work</b></span>
        </div>
        <p>Verification-gated agentic document workspace. Draft, audit, and ship evidence-backed deliverables.</p>
        <button onClick={onOpen} className="footer-open-btn">
          Open workspace <ArrowRight size={14} />
        </button>
      </footer>
    </main>
  );
}
