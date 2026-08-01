import {
  ArrowRight,
  Check,
  Download,
  FileText,
  LockKeyhole,
  PenLine,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
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
      <header className="ai-landing-nav">
        <a className="ai-landing-brand" href="/" aria-label="InsightPDF home">
          <BrandMark />
          <span>InsightPDF</span>
        </a>
        <nav aria-label="Landing navigation">
          <a href="#workflow">How it works</a>
          <span><LockKeyhole size={13} /> Private by default</span>
          <button onClick={onOpen}>{isAuthenticated ? "Open workspace" : "Sign in"}<ArrowRight size={15} /></button>
        </nav>
      </header>

      <section className="ai-landing-hero">
        <div className="ai-landing-copy">
          <div className="ai-eyebrow"><Sparkles size={14} /> AI workspace for serious document work</div>
          <h1>Your source material,<br /><span>ready to answer.</span></h1>
          <p>Bring scattered PDFs, reports, slides, and notes into one focused workspace. Research with citations, shape the argument, and ship a polished deliverable.</p>

          <form className="ai-hero-composer" onSubmit={submitPrompt}>
            <div>
              <Sparkles size={18} />
              <input
                aria-label="Ask InsightPDF"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask a question or describe what you need to create"
              />
              <button type="submit" aria-label="Send question" disabled={!prompt.trim()}><Send size={17} /></button>
            </div>
            <footer>
              <label>
                <Upload size={14} /> Attach source
                <input
                  type="file"
                  accept={DOCUMENT_UPLOAD_ACCEPT}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onUpload(file);
                  }}
                />
              </label>
              <span>PDF, Word, slides, text, or images</span>
            </footer>
          </form>

          <div className="ai-hero-assurance">
            <span><Check size={14} /> Page-level citations</span>
            <span><Check size={14} /> Reviewable AI edits</span>
            <span><Check size={14} /> Real file exports</span>
          </div>
        </div>

        <div className="ai-product-stage" aria-label="InsightPDF workspace preview">
          <div className="ai-product-window">
            <header>
              <div><i /><i /><i /></div>
              <span><ShieldCheck size={12} /> Private research workspace</span>
              <b>Ready</b>
            </header>
            <div className="ai-product-body">
              <aside>
                <div className="ai-preview-brand"><BrandMark /><strong>InsightPDF</strong></div>
                <small>BRIEF WORKSPACE</small>
                <span className="active"><Search size={14} /> Research</span>
                <span><FileText size={14} /> Sources <b>3</b></span>
                <span><PenLine size={14} /> Deliverables <b>1</b></span>
                <div className="ai-preview-source">
                  <FileText size={15} />
                  <div><strong>Q2-board-report.pdf</strong><small>42 pages · searchable</small></div>
                  <Check size={12} />
                </div>
              </aside>
              <section>
                <div className="ai-preview-context"><Sparkles size={14} /><span>Researching across 3 linked sources</span></div>
                <h2>What changed in Q2, and what needs attention?</h2>
                <article className="ai-preview-answer">
                  <div className="ai-answer-label"><Sparkles size={14} /> Grounded answer <span>3 citations</span></div>
                  <p>Revenue accelerated while operating margin improved, but enterprise churn remains the clearest risk to the second-half plan.</p>
                  <div className="ai-preview-metrics">
                    <span><small>Revenue</small><strong>$48.2M</strong><em>↑ 18.4%</em></span>
                    <span><small>Margin</small><strong>24.1%</strong><em>↑ 7.2 pts</em></span>
                    <span><small>Retention</small><strong>92%</strong><em className="warn">Watch</em></span>
                  </div>
                  <footer>
                    <button>Revenue · p.12</button>
                    <button>Margin · p.27</button>
                    <button>Retention · p.31</button>
                  </footer>
                </article>
                <div className="ai-preview-composer"><span>Ask a follow-up…</span><button><Send size={14} /></button></div>
              </section>
            </div>
          </div>
          <div className="ai-floating-card ai-floating-source"><FileText size={16} /><span><strong>Source connected</strong><small>Evidence stays traceable</small></span><Check size={14} /></div>
          <div className="ai-floating-card ai-floating-export"><Download size={16} /><span><strong>Brief ready</strong><small>PDF · Word · Markdown</small></span></div>
        </div>
      </section>

      <section className="ai-trust-strip" aria-label="Product principles">
        <span>Grounded in your sources</span><i />
        <span>Original files preserved</span><i />
        <span>Changes stay reviewable</span><i />
        <span>Outputs remain editable</span>
      </section>

      <section className="ai-workflow-section" id="workflow">
        <header>
          <div className="ai-eyebrow"><Sparkles size={14} /> A workflow, not another chat box</div>
          <h2>One workspace from first read to final draft.</h2>
          <p>Each step has a clear purpose, visible state, and a natural next action.</p>
        </header>
        <div className="ai-workflow-grid">
          <article><span>01</span><div><FileText size={20} /></div><h3>Collect</h3><p>Add source material and see exactly what is ready, processing, or needs attention.</p></article>
          <article><span>02</span><div><Search size={20} /></div><h3>Understand</h3><p>Ask across selected sources, inspect citations, and move from claims back to pages.</p></article>
          <article><span>03</span><div><PenLine size={20} /></div><h3>Create</h3><p>Turn evidence into an editable brief with linked sources, comments, and AI suggestions.</p></article>
          <article><span>04</span><div><Download size={20} /></div><h3>Review & ship</h3><p>Compare versions, resolve feedback, then export a real PDF, Word, or Markdown file.</p></article>
        </div>
      </section>

      <section className="ai-security-section">
        <div><ShieldCheck size={26} /><span>Private workspace</span></div>
        <h2>AI that shows its work.</h2>
        <p>InsightPDF keeps the evidence visible. Citations open the source page, suggestions wait for your approval, and original uploads stay available.</p>
        <button onClick={onOpen}>{isAuthenticated ? "Continue your work" : "Create your workspace"}<ArrowRight size={16} /></button>
      </section>

      <footer className="ai-landing-footer">
        <div className="ai-landing-brand"><BrandMark /><span>InsightPDF</span></div>
        <p>Research, write, and deliver from the same source of truth.</p>
        <button onClick={onOpen}>Open workspace <ArrowRight size={14} /></button>
      </footer>
    </main>
  );
}
