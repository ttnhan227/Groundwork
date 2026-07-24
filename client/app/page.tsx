"use client";

import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  FileCheck2,
  FileText,
  FolderOpen,
  Gauge,
  Grid2X2,
  HelpCircle,
  History,
  Library,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sparkles,
  Upload,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";

type DocumentItem = {
  id: number;
  name: string;
  meta: string;
  status: string;
  icon: string;
  tone: string;
  progress?: number;
};

const documents: DocumentItem[] = [
  { id: 1, name: "Q3 Financial Report.pdf", meta: "24 pages · 2.4 MB", status: "Ready", icon: "Q3", tone: "teal" },
  { id: 2, name: "Product Roadmap 2025.pdf", meta: "18 pages · 1.8 MB", status: "Ready", icon: "25", tone: "purple" },
  { id: 3, name: "Research Paper - AI Ethics.pdf", meta: "32 pages · 4.1 MB", status: "Ready", icon: "AI", tone: "blue" },
  { id: 4, name: "Scanned Contract.pdf", meta: "8 pages · 5.2 MB", status: "OCR processing", icon: "SC", tone: "orange", progress: 72 },
  { id: 5, name: "Market Analysis.pdf", meta: "16 pages · 1.2 MB", status: "Ready", icon: "MA", tone: "pink" },
];

function Logo() {
  return (
    <div className="brand">
      <div className="brand-mark"><BookOpen size={19} strokeWidth={2.4} /></div>
      <span>Insight<b>PDF</b></span>
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);

  const filtered = useMemo(
    () => documents.filter((doc) => doc.name.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="side-top">
          <Logo />
          <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={20} /></button>
        </div>
        <button className="new-document" onClick={() => setUploadOpen(true)}><Plus size={18} /> New document</button>
        <nav className="main-nav" aria-label="Main navigation">
          {[
            [Gauge, "Dashboard"],
            [FolderOpen, "Documents"],
            [MessageSquareText, "AI Chat"],
            [Sparkles, "AI Tools"],
            [Grid2X2, "PDF Tools"],
          ].map(([Icon, label]) => (
            <button
              key={label as string}
              className={activeTab === label ? "active" : ""}
              onClick={() => { setActiveTab(label as string); setMobileNav(false); notify(`${label} selected`); }}
            >
              <Icon size={18} /> {label as string}
            </button>
          ))}
        </nav>

        <div className="workspace">
          <p>Workspace</p>
          <button><FileText size={16} /> Recent <span>12</span></button>
          <button><FileCheck2 size={16} /> Favorites <span>4</span></button>
          <button><History size={16} /> Shared with me</button>
        </div>

        <div className="side-bottom">
          <div className="usage-label"><span>Storage</span><b>2.4 GB of 5 GB</b></div>
          <div className="usage-bar"><i /></div>
          <button className="upgrade" onClick={() => notify("Upgrade options are ready to view")}><Zap size={14} fill="currentColor" /> Upgrade plan</button>
          <div className="profile">
            <div className="avatar">JD</div>
            <div><strong>Jamie D.</strong><small>jamie@example.com</small></div>
            <MoreHorizontal size={18} />
          </div>
        </div>
      </aside>

      {mobileNav && <button className="backdrop" onClick={() => setMobileNav(false)} aria-label="Close menu" />}

      <section className="content">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu /></button>
          <div className="search">
            <Search size={17} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents..." aria-label="Search documents" />
            <kbd>⌘ K</kbd>
          </div>
          <button className="icon-button" aria-label="Help"><HelpCircle size={20} /></button>
          <button className="icon-button notification" aria-label="Notifications"><span>2</span><Zap size={19} /></button>
        </header>

        <div className="page">
          <div className="welcome">
            <div>
              <p className="eyebrow">Friday, July 24</p>
              <h1>Good morning, Jamie <span>👋</span></h1>
              <p>Your secure document workspace is ready.</p>
            </div>
            <button className="upload-button" onClick={() => setUploadOpen(true)}><Upload size={17} /> Upload PDF</button>
          </div>

          <section className="stats">
            <article>
              <div className="stat-icon purple"><Library size={20} /></div>
              <div><span>Total documents</span><strong>24</strong><small><b>+3</b> this month</small></div>
              <div className="spark-bars purple">{[5,9,7,13,10,17,15,20,16,23].map((h,i)=><i key={i} style={{height:h}} />)}</div>
            </article>
            <article>
              <div className="stat-icon blue"><FileText size={20} /></div>
              <div><span>Pages processed</span><strong>1,248</strong><small><b>+12%</b> vs last month</small></div>
              <div className="spark-bars blue">{[7,6,13,10,16,14,21,18,23,25].map((h,i)=><i key={i} style={{height:h}} />)}</div>
            </article>
            <article>
              <div className="stat-icon amber"><WandSparkles size={20} /></div>
              <div><span>AI requests</span><strong>86</strong><small><b>64</b> remaining</small></div>
              <div className="ring"><span>57%</span></div>
            </article>
            <article>
              <div className="stat-icon green"><Check size={20} /></div>
              <div><span>Time saved</span><strong>12.5h</strong><small><b>+2.4h</b> this week</small></div>
              <div className="spark-line">⌁</div>
            </article>
          </section>

          <section className="grid-main">
            <div className="recent panel">
              <div className="section-heading">
                <div><h2>Recent documents</h2><p>Pick up where you left off</p></div>
                <button onClick={() => notify("Showing all documents")}>View all <ArrowUpRight size={15} /></button>
              </div>
              <div className="doc-table">
                {filtered.map((doc) => (
                  <button className="doc-row" key={doc.id} onClick={() => notify(`Opening ${doc.name}`)}>
                    <div className={`doc-icon ${doc.tone}`}>{doc.icon}</div>
                    <div className="doc-name"><strong>{doc.name}</strong><span>{doc.meta}</span></div>
                    <div className={`status ${doc.status === "Ready" ? "ready" : "processing"}`}>
                      {doc.status === "Ready" ? <Check size={12} /> : <i />}
                      {doc.status}
                    </div>
                    <span className="updated">{doc.id === 1 ? "2 min ago" : doc.id === 2 ? "Yesterday" : `${doc.id + 1} days ago`}</span>
                    <MoreHorizontal className="more" size={18} />
                    {doc.progress && <span className="row-progress"><i style={{width: `${doc.progress}%`}} /></span>}
                  </button>
                ))}
                {filtered.length === 0 && <div className="empty">No documents match “{query}”.</div>}
              </div>
            </div>

            <aside className="ask-card">
              <div className="ai-orb"><Sparkles size={22} /></div>
              <p className="eyebrow">Ask InsightPDF</p>
              <h2>What would you like to know?</h2>
              <p>Chat with your documents and get answers grounded in your sources.</p>
              <button onClick={() => notify("Opening a new document chat")}>Start a conversation <ChevronRight size={16} /></button>
              <div className="suggestions">
                <span>Try asking</span>
                <button onClick={() => notify("Question added to chat")}>“Summarize the key findings”</button>
                <button onClick={() => notify("Question added to chat")}>“What are the action items?”</button>
              </div>
            </aside>
          </section>

          <section className="quick-section">
            <div className="section-heading">
              <div><h2>Quick actions</h2><p>Get things done faster</p></div>
            </div>
            <div className="quick-grid">
              {[
                ["purple", Sparkles, "Summarize", "Turn long documents into clear insights"],
                ["blue", MessageSquareText, "Ask questions", "Get sourced answers from your PDFs"],
                ["amber", FileCheck2, "Compare PDFs", "Spot changes between two documents"],
                ["green", Grid2X2, "Organize pages", "Merge, split, rotate, and extract"],
              ].map(([tone, Icon, title, desc]) => (
                <button key={title as string} className="quick-card" onClick={() => notify(`${title} tool opened`)}>
                  <div className={`quick-icon ${tone}`}><Icon size={19} /></div>
                  <div><strong>{title as string}</strong><span>{desc as string}</span></div>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
          </section>
        </div>
      </section>

      {uploadOpen && (
        <div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="upload-title">
          <button className="modal-backdrop" onClick={() => setUploadOpen(false)} aria-label="Close upload" />
          <div className="modal">
            <button className="modal-x" onClick={() => setUploadOpen(false)} aria-label="Close"><X size={20} /></button>
            <div className="upload-illustration"><Upload size={28} /></div>
            <h2 id="upload-title">Upload a document</h2>
            <p>Drop a PDF here or choose one from your device. We’ll extract, index, and prepare it for AI chat.</p>
            <label className="dropzone">
              <input type="file" accept=".pdf,application/pdf" onChange={(e) => {
                if (e.target.files?.[0]) { setUploadOpen(false); notify(`${e.target.files[0].name} queued for processing`); }
              }} />
              <FileText size={27} />
              <strong>Choose a PDF</strong>
              <span>Up to 50 MB · 500 pages</span>
            </label>
          </div>
        </div>
      )}

      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </main>
  );
}
