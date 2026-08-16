import {
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  LockKeyhole,
  Layers,
  PenLine,
  Scissors,
  Search,
  Send,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { BrandMark } from "../../components/common/BrandMark";
import { AUTH_EXPIRED_EVENT } from "../../api/client";
import type { AuthResult } from "../../types";

const DOCUMENT_UPLOAD_ACCEPT = ".pdf,.docx,.pptx,.md,.markdown,.txt,.rtf,.png,.jpg,.jpeg,.webp";

export function LandingPage({
  onOpen,
  onUpload,
}: {
  onOpen: () => void;
  onUpload: (file: File) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("insightpdf-auth") ?? "null") as AuthResult | null;
      return Boolean(saved?.access_token && saved?.user);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const syncAuthentication = () => {
      try {
        const saved = JSON.parse(localStorage.getItem("insightpdf-auth") ?? "null") as AuthResult | null;
        setIsAuthenticated(Boolean(saved?.access_token && saved?.user));
      } catch {
        setIsAuthenticated(false);
      }
    };
    window.addEventListener("storage", syncAuthentication);
    window.addEventListener(AUTH_EXPIRED_EVENT, syncAuthentication);
    return () => {
      window.removeEventListener("storage", syncAuthentication);
      window.removeEventListener(AUTH_EXPIRED_EVENT, syncAuthentication);
    };
  }, []);

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) return;
    sessionStorage.setItem("insightpdf-pending-prompt", prompt.trim());
    onOpen();
  }

  return (
    <main className="ai-landing">
      {/* Navigation */}
      <header className="ai-landing-nav">
        <a className="ai-landing-brand" href="/" aria-label="InsightPDF home">
          <BrandMark />
          <span>Insight<b>PDF</b></span>
        </a>
        <nav aria-label="Landing navigation">
          <a href="#workflow">Workflow</a>
          <a href="#tools">Document Tools</a>
          <a href="#security">Security & Privacy</a>
          <span className="nav-privacy-tag"><LockKeyhole size={13} /> Private workspace</span>
          <button onClick={onOpen} className="btn-nav-action">
            {isAuthenticated ? "Open workspace" : "Sign in"}
            <ArrowRight size={14} />
          </button>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="ai-landing-hero">
        <div className="ai-landing-copy">
          <div className="ai-eyebrow">
            <ShieldCheck size={13} /> Grounded Document Intelligence
          </div>
          <h1>
            Turn complex PDFs into<br />
            <span>verified deliverables.</span>
          </h1>
          <p>
            Bring scattered reports, specifications, contracts, and decks into one focused workspace. Research with page-level citations, verify requirement coverage, and export structured documents.
          </p>

          <form className="ai-hero-composer" onSubmit={submitPrompt}>
            <div className="composer-input-row">
              <Search size={18} className="composer-icon" />
              <input
                aria-label="Ask InsightPDF"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask a question or describe a brief to draft…"
              />
              <button type="submit" aria-label="Send question" disabled={!prompt.trim()} className="btn-send">
                <Send size={15} />
              </button>
            </div>
            <footer>
              <label className="attach-source-btn">
                <Upload size={14} /> Attach document
                <input
                  type="file"
                  accept={DOCUMENT_UPLOAD_ACCEPT}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onUpload(file);
                  }}
                />
              </label>
              <span>PDF, Word, Markdown, text, slides, or scans</span>
            </footer>
          </form>

          <div className="ai-hero-assurance">
            <span><Check size={14} /> Exact page citations</span>
            <span><Check size={14} /> Requirement verification</span>
            <span><Check size={14} /> Export to PDF, Word & Markdown</span>
          </div>
        </div>

        {/* Realistic 3-Panel Product Stage */}
        <div className="ai-product-stage" aria-label="InsightPDF workspace preview">
          <div className="ai-product-window">
            <header className="product-window-header">
              <div className="window-dots"><i /><i /><i /></div>
              <span className="window-title">
                <FileText size={13} /> Technical Proposal & Compliance Audit · Workspace
              </span>
              <span className="window-status">
                <CheckCircle2 size={12} /> Grounded
              </span>
            </header>

            <div className="ai-product-body">
              {/* Column 1: Sources */}
              <aside className="preview-col-sources">
                <div className="preview-section-title">
                  <span>Sources</span>
                  <b>3 linked</b>
                </div>
                <div className="preview-source-item active">
                  <FileText size={14} className="text-accent" />
                  <div>
                    <strong>Q3-Engineering-Spec.pdf</strong>
                    <small>38 pages · Indexed</small>
                  </div>
                  <Check size={12} className="text-success" />
                </div>
                <div className="preview-source-item">
                  <FileText size={14} />
                  <div>
                    <strong>SOC2-Compliance-Report.pdf</strong>
                    <small>54 pages · Indexed</small>
                  </div>
                  <Check size={12} className="text-success" />
                </div>
                <div className="preview-source-item">
                  <FileSpreadsheet size={14} />
                  <div>
                    <strong>SLA-Requirements.docx</strong>
                    <small>12 pages · Indexed</small>
                  </div>
                  <Check size={12} className="text-success" />
                </div>
              </aside>

              {/* Column 2: Grounded QA & Synthesis */}
              <section className="preview-col-chat">
                <div className="preview-chat-context">
                  <Search size={13} />
                  <span>Cross-referencing 3 active sources</span>
                </div>
                <div className="preview-chat-question">
                  <strong>User:</strong> What are the mandatory encryption standards and SLA recovery targets?
                </div>
                <article className="ai-preview-answer">
                  <div className="ai-answer-label">
                    <CheckCircle2 size={13} /> Grounded Synthesis
                    <span className="citation-badge">2 citations</span>
                  </div>
                  <p>
                    All data at rest must use AES-256 with KMS envelope encryption, and TLS 1.3 is enforced in transit. The contract specifies an RTO of &lt; 15 minutes and RPO of &lt; 1 minute for Tier 1 services.
                  </p>
                  <footer className="preview-citation-list">
                    <span className="citation-chip">Spec · p.14</span>
                    <span className="citation-chip">SOC2 · p.27</span>
                    <span className="citation-chip">SLA · p.4</span>
                  </footer>
                </article>
              </section>

              {/* Column 3: Deliverable & Verification */}
              <aside className="preview-col-studio">
                <div className="preview-section-title">
                  <span>Deliverable</span>
                  <span className="badge-verified">✓ 100% Verified</span>
                </div>
                <div className="preview-deliverable-card">
                  <strong>Architecture & SLA Proposal</strong>
                  <small>Updated 2m ago · 4 sections</small>
                  <div className="preview-req-list">
                    <div className="req-row covered">
                      <Check size={11} /> <span>AES-256 Encryption requirement</span>
                    </div>
                    <div className="req-row covered">
                      <Check size={11} /> <span>15-min RTO target specified</span>
                    </div>
                    <div className="req-row covered">
                      <Check size={11} /> <span>Audit logging retention policy</span>
                    </div>
                  </div>
                  <div className="preview-export-row">
                    <button className="preview-btn-export"><Download size={12} /> Export PDF</button>
                    <button className="preview-btn-subtle">Word (.docx)</button>
                  </div>
                </div>
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
        <span><Search size={15} /> Clickable page-level citations</span>
        <i />
        <span><Download size={15} /> Clean exports in PDF, DOCX, and Markdown</span>
      </section>

      {/* Workflow Section */}
      <section className="ai-workflow-section" id="workflow">
        <header>
          <div className="ai-eyebrow"><Layers size={13} /> Architecture & Process</div>
          <h2>From raw documentation to verified deliverables.</h2>
          <p>InsightPDF is designed around an end-to-end document intelligence workflow with full evidence traceability.</p>
        </header>

        <div className="ai-workflow-grid">
          <article>
            <span className="step-num">01</span>
            <div className="step-icon"><Upload size={20} /></div>
            <h3>Ingest & Index</h3>
            <p>Upload PDFs, Word documents, decks, or scans. InsightPDF parses text, layout, and pages into a searchable local index.</p>
          </article>
          <article>
            <span className="step-num">02</span>
            <div className="step-icon"><Search size={20} /></div>
            <h3>Query & Ground</h3>
            <p>Ask questions across one or many linked documents. Every statement includes interactive citations jumping to the exact source page.</p>
          </article>
          <article>
            <span className="step-num">03</span>
            <div className="step-icon"><PenLine size={20} /></div>
            <h3>Draft & Verify</h3>
            <p>Generate structured proposals, executive summaries, or technical notes. Automated audits check every claim against source evidence.</p>
          </article>
          <article>
            <span className="step-num">04</span>
            <div className="step-icon"><Download size={20} /></div>
            <h3>Export & Manipulate</h3>
            <p>Export clean PDF, Word, or Markdown files, or run server-side tools to merge, split, watermark, and convert documents.</p>
          </article>
        </div>
      </section>

      {/* Document Tools Feature Section */}
      <section className="ai-tools-section" id="tools">
        <header>
          <div className="ai-eyebrow"><Scissors size={13} /> Server-Side Utilities</div>
          <h2>Full suite of built-in document tools.</h2>
          <p>No need for external converters or separate PDF utilities. Everything is handled securely within your workspace.</p>
        </header>
        <div className="tools-grid">
          <div className="tool-card">
            <div className="tool-card-icon"><Scissors size={18} /></div>
            <h4>Merge & Split</h4>
            <p>Combine multiple PDFs in custom order or split by page ranges, individual pages, or custom selections.</p>
          </div>
          <div className="tool-card">
            <div className="tool-card-icon"><Layers size={18} /></div>
            <h4>Extract & Rotate</h4>
            <p>Extract specific page sequences into a new PDF or rotate orientations by 90°, 180°, or 270°.</p>
          </div>
          <div className="tool-card">
            <div className="tool-card-icon"><FileSpreadsheet size={18} /></div>
            <h4>Format Conversions</h4>
            <p>Convert PDFs to PNG/JPEG images (up to 300 DPI), Images to PDF, Word (DOCX) to PDF, and Word to Markdown.</p>
          </div>
          <div className="tool-card">
            <div className="tool-card-icon"><LockKeyhole size={18} /></div>
            <h4>Watermark & Security</h4>
            <p>Apply text or image watermarks with precise positioning, custom opacity, and page selection.</p>
          </div>
        </div>
      </section>

      {/* Security & Privacy Section */}
      <section className="ai-security-section" id="security">
        <div className="security-badge"><ShieldCheck size={20} /><span>Private Workspace Storage</span></div>
        <h2>Privacy and source integrity come first.</h2>
        <p>
          Your documents are never used to train public models. Files are stored securely in your isolated workspace, processed with durable background jobs, and remain completely under your control with one-click data deletion and export.
        </p>
        <button onClick={onOpen} className="btn-security-cta">
          {isAuthenticated ? "Continue to your workspace" : "Get started with InsightPDF"}
          <ArrowRight size={15} />
        </button>
      </section>

      {/* Footer */}
      <footer className="ai-landing-footer">
        <div className="footer-brand">
          <BrandMark />
          <span>Insight<b>PDF</b></span>
        </div>
        <p>Document intelligence, traceable synthesis, and verifiable deliverables.</p>
        <button onClick={onOpen} className="footer-open-btn">
          Open workspace <ArrowRight size={14} />
        </button>
      </footer>
    </main>
  );
}
