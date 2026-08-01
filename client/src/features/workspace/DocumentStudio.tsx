import { CheckCircle2, ChevronRight, Download, Eye, FileOutput, FileText, Pencil, Presentation, RefreshCw, Sparkles } from "lucide-react";
import { type CSSProperties, type FormEvent, useState } from "react";
import { API, api, authenticatedFetch, waitForJob } from "../../api/client";
import type { Artifact, Conversation, DocumentItem, Job, NativeDocument } from "../../types";

type DesignFormat = "pdf" | "docx" | "pptx";
type VisualStyle = "editorial" | "executive" | "technical" | "formal" | "operational";
type TemplateField = { id: string; label: string; placeholder: string };
type CreationTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  visual: VisualStyle;
  accent: string;
  starter: string;
  sections: string[];
  fields: TemplateField[];
  formats: DesignFormat[];
};
type SlideDraft = { eyebrow: string; title: string; body: string; variant: "title" | "section-1" | "section-2" | "section-3" };
type SlidePalette = { navy: string; accent: string; soft: string };
type DocumentPreviewPage = {
  kind: "cover" | "table" | "sections";
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  metadata?: Array<{ label: string; value: string }>;
  sections?: Array<{ heading: string; body: string }>;
  table?: { headers: string[]; rows: string[][] };
  callout?: string;
};

const field = (id: string, label: string, placeholder: string): TemplateField => ({ id, label, placeholder });
const docs: DesignFormat[] = ["pdf", "docx"];
const template = (value: CreationTemplate) => value;

const DOCUMENT_TEMPLATES: CreationTemplate[] = [
  template({ id: "verified-client-report", name: "Verified Client Report", description: "Brief-led client deliverable with traceable requirements, evidence, recommendations, and next steps.", category: "Reports", visual: "executive", accent: "#4f50c8", starter: "Create a verified client report for", sections: ["Executive summary", "Client brief and acceptance criteria", "Situation and evidence", "Key findings", "Analysis", "Recommendations", "Implementation plan", "Risks and assumptions", "Source notes", "Requirement coverage"], fields: [field("client", "Client and engagement", "Northstar Industries · Market assessment"), field("decision", "Decision this report supports", "What should the client decide or do?"), field("constraints", "Constraints and acceptance criteria", "Deadline, format, must-cover questions")], formats: docs }),
  template({ id: "annual-report", name: "Annual Report", description: "Leadership narrative, operating scorecard, outlook, and priorities.", category: "Reports", visual: "editorial", accent: "#b88742", starter: "Create the annual report for", sections: ["Leadership letter", "Year in review", "Performance scorecard", "Operating highlights", "Risks", "Outlook", "Next-year priorities"], fields: [field("organization", "Organization and year", "Acme Group · FY2026"), field("story", "Headline story", "What defined the year?"), field("outlook", "Next-year outlook", "Priorities and uncertainties")], formats: docs }),
  template({ id: "quarterly-business-review", name: "Quarterly Business Review", description: "Executive QBR with KPIs, risks, decisions, and commitments.", category: "Reports", visual: "executive", accent: "#5b5ce2", starter: "Create a QBR for", sections: ["Executive readout", "KPI scorecard", "Wins", "Misses", "Customer signals", "Risks", "Decisions", "Commitments"], fields: [field("period", "Quarter and team", "Q2 2026 · Customer Success"), field("performance", "Performance vs plan", "What changed?"), field("decisions", "Leadership decisions", "What needs approval?")], formats: docs }),
  template({ id: "incident-report", name: "Incident Report", description: "Blameless incident record with timeline and prevention plan.", category: "Engineering", visual: "technical", accent: "#e14b5a", starter: "Document the incident involving", sections: ["Impact", "Detection", "Timeline", "Root cause", "Contributing factors", "Response", "Corrective actions", "Prevention"], fields: [field("incident", "Incident and severity", "API outage · SEV-1"), field("window", "Incident window", "Start, detection, recovery"), field("impact", "Customer impact", "Who and what was affected?")], formats: docs }),
  template({ id: "audit-report", name: "Audit Report", description: "Control assessment with findings, severity, owners, and dates.", category: "Reports", visual: "formal", accent: "#ad7b32", starter: "Create an audit report for", sections: ["Scope", "Methodology", "Overall assessment", "Findings", "Control gaps", "Management response", "Remediation plan", "Conclusion"], fields: [field("scope", "Audit scope and period", "Processes, entities, dates"), field("standard", "Framework or criteria", "SOC 2, ISO 27001, internal policy"), field("audience", "Report audience", "Audit committee, management…")], formats: docs }),
  template({ id: "research-report", name: "Research Report", description: "Evidence synthesis with methods, limitations, and implications.", category: "Academic", visual: "editorial", accent: "#476c84", starter: "Create a research report answering", sections: ["Research question", "Methodology", "Evidence synthesis", "Findings", "Limitations", "Implications", "Recommendations", "Source notes"], fields: [field("question", "Research question", "What are we trying to understand?"), field("method", "Method and evidence", "Interviews, literature, dataset…"), field("audience", "Intended reader", "Policy team, academic audience…")], formats: docs }),
  template({ id: "client-proposal-document", name: "Client Proposal", description: "Commercial proposal with outcomes, scope, timeline, and investment.", category: "Business", visual: "editorial", accent: "#d65e48", starter: "Create a client proposal for", sections: ["Client situation", "Objectives", "Our point of view", "Approach", "Workstreams", "Deliverables", "Timeline", "Investment", "Success measures", "Next steps"], fields: [field("client", "Client name", "Northstar Industries"), field("goals", "Goals", "What must the engagement achieve?"), field("commercials", "Budget and timeline", "$75k · 12 weeks")], formats: docs }),
  template({ id: "product-requirements-document", name: "Product Requirements Document", description: "Buildable PRD with users, requirements, analytics, and acceptance.", category: "Product", visual: "technical", accent: "#6257e8", starter: "Create a PRD for", sections: ["Problem", "Users and jobs", "Goals / non-goals", "Scope", "User stories", "Requirements", "UX principles", "Analytics", "Dependencies", "Rollout", "Acceptance criteria"], fields: [field("product", "Feature or product", "Workspace sharing"), field("problem", "User problem", "Who struggles with what?"), field("success", "Success measures", "Activation, task completion…")], formats: docs }),
  template({ id: "business-plan", name: "Business Plan", description: "Investor-ready plan for market, model, execution, and assumptions.", category: "Business", visual: "executive", accent: "#a77735", starter: "Create a business plan for", sections: ["Company thesis", "Market", "Customer", "Product", "Business model", "Competition", "Go-to-market", "Operations", "Milestones", "Financial assumptions", "Funding use"], fields: [field("company", "Company and offer", "What are you building?"), field("customer", "Target customer", "Who buys and why?"), field("stage", "Stage and horizon", "Pre-seed · 24-month plan")], formats: docs }),
  template({ id: "status-report", name: "Project Status Report", description: "Operating update with health, progress, blockers, and owners.", category: "Business", visual: "operational", accent: "#3d7f67", starter: "Create a project status report for", sections: ["Overall health", "Progress vs plan", "Completed", "Milestones", "Metrics", "Blockers", "Risks", "Decisions", "Next period"], fields: [field("project", "Project and reporting date", "ERP migration · August 1"), field("health", "Current health", "Green / amber / red and why"), field("focus", "Current focus", "Most important work now")], formats: docs }),
  template({ id: "meeting-minutes", name: "Meeting Minutes", description: "Decision-oriented minutes with action owners and due dates.", category: "Business", visual: "operational", accent: "#5573b7", starter: "Create meeting minutes for", sections: ["Objective", "Attendees", "Discussion by topic", "Decisions", "Action items", "Open questions", "Next meeting"], fields: [field("meeting", "Meeting and date", "Product council · August 1"), field("participants", "Participants", "Names and roles"), field("decisions", "Known decisions or actions", "Raw notes are fine")], formats: docs }),
  template({ id: "offer-letter", name: "Offer Letter", description: "Professional employment offer with review-ready placeholders.", category: "HR", visual: "formal", accent: "#a65e4d", starter: "Create an offer letter for", sections: ["Offer", "Role and reporting", "Start and location", "Compensation", "Benefits", "Conditions", "Acceptance", "Signatures"], fields: [field("candidate", "Candidate and role", "Jordan Lee · Product Designer"), field("terms", "Start, location, reporting", "September 1 · Hybrid · VP Product"), field("compensation", "Compensation and benefits", "$120k + equity + benefits")], formats: docs }),
  template({ id: "employee-handbook", name: "Employee Handbook", description: "Usable policy system with reporting paths and acknowledgement.", category: "HR", visual: "editorial", accent: "#496b87", starter: "Create an employee handbook for", sections: ["Welcome and principles", "Employment basics", "Conduct", "Compensation and benefits", "Time off", "Security", "Acceptable use", "Reporting concerns", "Acknowledgement"], fields: [field("company", "Company and locations", "Acme · US and remote"), field("workforce", "Workforce model", "Employees, contractors, hybrid…"), field("policies", "Important policy choices", "Leave, hours, security")], formats: docs }),
  template({ id: "performance-review", name: "Performance Review", description: "Evidence-led review with balanced feedback and development goals.", category: "HR", visual: "operational", accent: "#a66352", starter: "Create a performance review for", sections: ["Role expectations", "Outcomes", "Competency evidence", "Strengths", "Development areas", "Feedback themes", "Rating rationale", "Goals", "Manager support"], fields: [field("person", "Employee and period", "Alex Chen · H1 2026"), field("outcomes", "Key outcomes", "Specific results and evidence"), field("growth", "Growth focus", "Skills or behaviors to develop")], formats: docs }),
  template({ id: "nda", name: "Mutual NDA", description: "Review-ready confidentiality agreement with jurisdiction flags.", category: "Legal", visual: "formal", accent: "#6b5f87", starter: "Draft a mutual NDA between", sections: ["Parties and purpose", "Confidential information", "Exclusions", "Permitted use", "Safeguards", "Compelled disclosure", "Term", "Return or destruction", "Remedies", "Governing law"], fields: [field("parties", "Parties", "Legal names and addresses"), field("purpose", "Permitted purpose", "Evaluate a potential partnership"), field("jurisdiction", "Term and governing law", "2 years · New York")], formats: docs }),
  template({ id: "service-agreement", name: "Service Agreement", description: "Services contract draft with scope, fees, IP, and risk terms.", category: "Legal", visual: "formal", accent: "#5d6388", starter: "Draft a service agreement between", sections: ["Parties", "Services", "Deliverables", "Fees", "Change control", "Responsibilities", "Acceptance", "IP", "Confidentiality", "Liability", "Termination", "Signatures"], fields: [field("parties", "Client and provider", "Legal entity names"), field("scope", "Services and deliverables", "What will be delivered?"), field("commercials", "Fees and term", "$50k · six months")], formats: docs }),
  template({ id: "privacy-policy", name: "Privacy Policy", description: "Plain-language policy built around real data practices and rights.", category: "Legal", visual: "formal", accent: "#47758a", starter: "Create a privacy policy for", sections: ["Scope", "Data collected", "How data is used", "Legal bases", "Sharing", "Retention", "Security", "International transfers", "Your rights", "Children", "Changes", "Contact"], fields: [field("product", "Company and product", "Acme Analytics"), field("data", "Data practices", "Accounts, usage, payments…"), field("regions", "Regions and users", "EU, US, B2B customers")], formats: docs }),
  template({ id: "software-requirements-specification", name: "Software Requirements Specification", description: "Traceable requirements, interfaces, constraints, and acceptance.", category: "Engineering", visual: "technical", accent: "#3154d8", starter: "Create an SRS for", sections: ["Purpose", "Actors", "Assumptions", "Functional requirements", "Interfaces", "Data requirements", "Non-functional requirements", "Constraints", "Traceability", "Acceptance criteria"], fields: [field("system", "System and purpose", "What does it enable?"), field("users", "Actors and workflows", "Primary user types"), field("constraints", "Key constraints", "Platform, compliance, scale")], formats: docs }),
  template({ id: "architecture-design", name: "Architecture Design", description: "Decision record for boundaries, flows, failure modes, and trade-offs.", category: "Engineering", visual: "technical", accent: "#2f6bff", starter: "Create an architecture design for", sections: ["Context", "Requirements", "System boundaries", "Components", "Data flows", "Interfaces", "Security", "Deployment", "Observability", "Failure modes", "Trade-offs", "Rollout"], fields: [field("system", "System or change", "Event ingestion platform"), field("scale", "Scale and quality attributes", "10k events/sec · 99.9%"), field("constraints", "Existing constraints", "Cloud, stack, compliance")], formats: docs }),
  template({ id: "api-documentation", name: "API Documentation", description: "Developer-ready reference with auth, examples, and errors.", category: "Engineering", visual: "technical", accent: "#276c66", starter: "Create API documentation for", sections: ["Overview", "Authentication", "Environments", "Conventions", "Endpoints", "Examples", "Errors", "Pagination", "Rate limits", "Idempotency", "Versioning"], fields: [field("api", "API and audience", "Payments API · external developers"), field("auth", "Authentication", "OAuth 2.0 / API key"), field("endpoints", "Core endpoints", "List the primary resources")], formats: docs }),
  template({ id: "test-plan", name: "Test Plan", description: "Risk-based release plan with scenarios and exit criteria.", category: "Engineering", visual: "operational", accent: "#4e6e9e", starter: "Create a test plan for", sections: ["Objectives", "Scope", "Quality risks", "Environments", "Test data", "Test types", "Scenarios", "Entry criteria", "Exit criteria", "Defects", "Schedule", "Reporting"], fields: [field("release", "Release and date", "Mobile v3.2 · September 10"), field("scope", "Scope and exclusions", "What is changing?"), field("risks", "Top quality risks", "Payments, migration, performance…")], formats: docs }),
  template({ id: "runbook", name: "Operational Runbook", description: "Operations guidance for alerts, recovery, rollback, and escalation.", category: "Engineering", visual: "technical", accent: "#3154d8", starter: "Create an operational runbook for", sections: ["Service overview", "Ownership", "Dependencies", "Access", "Health checks", "Alerts", "Procedures", "Incident triage", "Recovery", "Rollback", "Escalation", "Verification"], fields: [field("service", "Service and owner", "Checkout API · Commerce SRE"), field("operations", "Critical operations", "Deploy, restart, failover…"), field("alerts", "Important alerts", "Symptoms and thresholds")], formats: docs }),
  template({ id: "research-paper", name: "Research Paper", description: "Academic structure that preserves evidence and never invents citations.", category: "Academic", visual: "editorial", accent: "#536f82", starter: "Create a research paper about", sections: ["Abstract", "Research question", "Related context", "Methodology", "Results", "Discussion", "Limitations", "Conclusion", "References"], fields: [field("question", "Research question", "Precise question or hypothesis"), field("method", "Method and sample", "Study design, dataset, participants"), field("style", "Discipline and citation style", "HCI · APA 7")], formats: docs }),
];

const PRESENTATION_TEMPLATES: CreationTemplate[] = [
  template({ id: "startup-pitch", name: "Startup Pitch Deck", description: "Investor narrative from problem to traction and ask.", category: "Business", visual: "executive", accent: "#6257e8", starter: "Create an investor pitch for", sections: ["Problem", "Solution", "Market", "Product", "Traction", "Business model", "Go-to-market", "The ask"], fields: [field("company", "Company and product", "Acme builds…"), field("stage", "Stage and ask", "Seed · raising $2M"), field("proof", "Strongest proof", "Revenue, users, pilots, or insight")], formats: ["pptx"] }),
  template({ id: "quarterly-review", name: "Quarterly Business Review", description: "Executive operating review with decisions, not a data dump.", category: "Reports", visual: "executive", accent: "#c18b3f", starter: "Create a quarterly review covering", sections: ["Executive readout", "KPI scorecard", "Wins", "Misses", "Customer signals", "Risks", "Decisions", "Next quarter"], fields: [field("period", "Quarter and business unit", "Q2 2026 · Enterprise"), field("outcomes", "Headline outcomes", "What changed vs plan?"), field("decisions", "Decisions needed", "What must leadership decide?")], formats: ["pptx"] }),
  template({ id: "strategy-roadmap", name: "Strategy Roadmap", description: "Priorities, phased initiatives, owners, and outcomes.", category: "Strategy", visual: "editorial", accent: "#ef4967", starter: "Create a strategy roadmap for", sections: ["Strategic context", "North star", "Priorities", "Initiatives", "Phased roadmap", "Dependencies", "Risks", "Measures"], fields: [field("horizon", "Planning horizon", "12 months"), field("objective", "Strategic objective", "Outcome the roadmap must create"), field("constraints", "Constraints", "Budget, team, deadline")], formats: ["pptx"] }),
  template({ id: "product-launch", name: "Product Launch", description: "Launch story connecting customer need to execution and metrics.", category: "Product", visual: "editorial", accent: "#dc6849", starter: "Create a product launch presentation for", sections: ["Customer need", "Product promise", "Audience", "Positioning", "Capabilities", "Launch plan", "Channels", "Success measures"], fields: [field("product", "Product and launch date", "Product X · October 15"), field("audience", "Primary audience", "Who is it for?"), field("goal", "Launch goal", "Adoption, pipeline, retention…")], formats: ["pptx"] }),
  template({ id: "data-report", name: "Data & Insights Story", description: "Decision-focused narrative built around findings and implications.", category: "Reports", visual: "technical", accent: "#2f6bff", starter: "Create a data-led presentation about", sections: ["Headline", "Scorecard", "Trend", "Segments", "Drivers", "Implications", "Actions", "Appendix"], fields: [field("question", "Decision question", "What should the data help decide?"), field("period", "Analysis period", "January–June 2026"), field("finding", "Most important finding", "Known signal or hypothesis")], formats: ["pptx"] }),
  template({ id: "client-proposal", name: "Client Proposal Deck", description: "Persuasive pitch covering fit, approach, proof, and next steps.", category: "Business", visual: "formal", accent: "#d65e48", starter: "Create a client proposal for", sections: ["Client situation", "Objectives", "Our point of view", "Approach", "Workstreams", "Deliverables", "Timeline", "Investment", "Next step"], fields: [field("client", "Client name", "Northstar Industries"), field("goals", "Client goals", "What outcomes matter?"), field("scope", "Scope and budget", "Deliverables, range, timing")], formats: ["pptx"] }),
];

async function downloadArtifact(artifact: Artifact, token: string) {
  const response = await authenticatedFetch(`${API}/pdf-tools/artifacts/${artifact.id}/download`, token);
  if (!response.ok) throw new Error("Could not download the generated file");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function TemplateMiniature({ item }: { item: CreationTemplate }) {
  return <div className={`real-template-preview visual-${item.visual}`} style={{ "--template-accent": item.accent } as CSSProperties}>
    <span>{item.category}</span><strong>{item.name}</strong><i />
    <div>{item.sections.slice(0, 4).map((section, index) => <b key={section}><em>{String(index + 1).padStart(2, "0")}</em>{section}</b>)}</div>
    <footer><small>{item.sections.length} structured sections</small><small>AI</small></footer>
  </div>;
}

function TemplateGallery({ templates, onUse }: { templates: CreationTemplate[]; onUse: (item: CreationTemplate) => void }) {
  const [category, setCategory] = useState("All");
  const categories = ["All", ...Array.from(new Set(templates.map((item) => item.category)))] as const;
  const visible = category === "All" ? templates : templates.filter((item) => item.category === category);
  return <section className="template-gallery real-template-gallery">
    <div className="creation-steps"><strong><i>1</i> Template</strong><span /><em><i>2</i> Context</em><span /><em><i>3</i> Draft & preview</em><span /><em><i>4</i> Edit & export</em></div>
    <header><div><span>PRODUCTION BLUEPRINTS</span><h2>Generate from a real template</h2><p>Every template has a purpose-built section architecture, intake questions, and a document-level visual system.</p></div></header>
    <nav className="template-filters" aria-label="Template categories">{categories.map((item) => <button type="button" key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</nav>
    <div className="template-card-grid">{visible.map((item) => <article key={item.id}>
      <button type="button" className="template-thumbnail-real" onClick={() => onUse(item)} aria-label={`Generate from ${item.name}`}><TemplateMiniature item={item} /></button>
      <div><small>{item.category}</small><strong>{item.name}</strong><p>{item.description}</p><span className="template-structure">{item.sections.slice(0, 3).join(" · ")}</span><button type="button" onClick={() => onUse(item)}><Sparkles size={14} /> Generate with AI <ChevronRight size={14} /></button></div>
    </article>)}</div>
  </section>;
}

function DocumentDesignPreview({ pages, template: selected, selectedPage, onPage }: { pages: DocumentPreviewPage[]; template: CreationTemplate; selectedPage: number; onPage: (page: number) => void }) {
  const blueprint: DocumentPreviewPage = { kind: "cover", eyebrow: selected.category.toUpperCase(), title: selected.name, subtitle: selected.description, metadata: selected.fields.map((item) => ({ label: item.label, value: item.placeholder })), callout: `${selected.sections.length} purpose-built sections` };
  const blueprintContent: DocumentPreviewPage = { kind: "sections", eyebrow: "DOCUMENT STRUCTURE", sections: selected.sections.slice(0, 2).map((heading) => ({ heading, body: "AI drafts this section using your brief, linked sources, and active research context." })) };
  const visiblePages = pages.length ? pages : [blueprint, blueprintContent];
  const page = visiblePages[Math.min(selectedPage, visiblePages.length - 1)];
  return <>
    <div className={`document-design-stage visual-${selected.visual}`} style={{ "--document-accent": selected.accent } as CSSProperties}>
      <article className={`document-design-page page-${page.kind}`}>
        <header><span>{page.eyebrow ?? selected.category}</span><b>InsightPDF</b></header>
        {page.kind === "cover" && <><h2>{page.title}</h2><p className="document-preview-subtitle">{page.subtitle}</p><div className="document-preview-rule" />{!!page.metadata?.length && <div className="document-preview-metadata">{page.metadata.slice(0, 6).map((item) => <span key={item.label}><small>{item.label}</small><strong>{item.value}</strong></span>)}</div>}{page.callout && <blockquote>{page.callout}</blockquote>}</>}
        {page.kind === "sections" && <div className="document-preview-sections">{page.sections?.map((section, index) => <section key={section.heading}><small>{String(index + 1 + selectedPage * 2).padStart(2, "0")}</small><h3>{section.heading}</h3><p>{section.body}</p></section>)}</div>}
        {page.kind === "table" && <><h2>{page.title}</h2>{page.table && <div className="document-preview-table"><div>{page.table.headers.map((header) => <strong key={header}>{header}</strong>)}</div>{page.table.rows.slice(0, 6).map((row, rowIndex) => <div key={rowIndex}>{row.map((cell, index) => <span key={`${index}-${cell}`}>{cell}</span>)}</div>)}</div>}{page.callout && <blockquote>{page.callout}</blockquote>}</>}
        <footer><span>{selected.name}</span><b>{String(selectedPage + 1).padStart(2, "0")}</b></footer>
      </article>
    </div>
    <div className="document-page-strip" aria-label="Document pages">{visiblePages.map((item, index) => <button type="button" className={selectedPage === index ? "active" : ""} onClick={() => onPage(index)} key={`${item.kind}-${index}`}><span>{index + 1}</span><strong>{item.kind === "cover" ? "Cover" : item.kind === "table" ? item.title ?? "Overview" : item.sections?.[0]?.heading ?? "Content"}</strong></button>)}</div>
  </>;
}

export function DocumentStudio({ documents, artifacts, token, conversation, onCreated, onOpenGenerated }: {
  documents: DocumentItem[];
  artifacts: Artifact[];
  token: string;
  conversation: Conversation | null;
  onCreated: (artifact: Artifact) => void;
  onOpenGenerated: (document: NativeDocument) => void;
}) {
  const [outputFormat, setOutputFormat] = useState<DesignFormat>("pdf");
  const [templateId, setTemplateId] = useState("");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("Executive leadership");
  const [tone, setTone] = useState("Clear and confident");
  const [sourceIds, setSourceIds] = useState<string[]>(() => conversation?.document_ids.filter((id) => documents.some((item) => item.id === id)) ?? []);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [generationJob, setGenerationJob] = useState<Job | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [nativeDocument, setNativeDocument] = useState<NativeDocument | null>(null);
  const [previewPages, setPreviewPages] = useState<DocumentPreviewPage[]>([]);
  const [selectedPreviewPage, setSelectedPreviewPage] = useState(0);
  const [slides, setSlides] = useState<SlideDraft[]>([]);
  const [selectedSlide, setSelectedSlide] = useState(0);
  const [palette, setPalette] = useState<SlidePalette>({ navy: "#0A183D", accent: "#EF2949", soft: "#F3F5F8" });
  const [error, setError] = useState("");
  const isPresentation = outputFormat === "pptx";
  const templates = isPresentation ? PRESENTATION_TEMPLATES : DOCUMENT_TEMPLATES;
  const selectedTemplate = templates.find((item) => item.id === templateId);
  const activeSlide = slides[selectedSlide];
  const workspaceContext = [
    conversation ? `Active research thread: ${conversation.title}` : "",
    ...(conversation?.messages.slice(-8).map((message) => `${message.role === "assistant" ? "Research finding" : "User direction"}: ${message.content.slice(0, 1200)}`) ?? []),
    documents.length ? `Available source library: ${documents.map((item) => item.display_title || item.filename).slice(0, 12).join(", ")}` : "",
    artifacts.length ? `Recent generated deliverables: ${artifacts.map((item) => item.filename).slice(0, 8).join(", ")}` : "",
  ].filter(Boolean).join("\n");

  function changeFormat(format: DesignFormat) {
    setOutputFormat(format); setTemplateId(""); setTopic(""); setAnswers({}); setArtifact(null); setNativeDocument(null); setPreviewPages([]); setSlides([]); setSelectedPreviewPage(0); setError("");
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!selectedTemplate || !topic.trim()) return;
    setGenerating(true); setError("");
    try {
      const queued = await api<Job>("/create/jobs", token, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `${topic}. Audience: ${audience}. Tone: ${tone}.`, output_format: outputFormat, theme: "minimal", template_id: templateId, source_document_ids: sourceIds, conversation_id: conversation?.id ?? null, workspace_context: workspaceContext, template_answers: answers }),
      });
      setGenerationJob(queued);
      const completed = await waitForJob(queued, token, { onProgress: setGenerationJob });
      const created = await api<Artifact>(`/pdf-tools/artifacts/${completed.result_id}`, token);
      const pages = Array.isArray(created.parameters.preview_pages) ? created.parameters.preview_pages as DocumentPreviewPage[] : [];
      const generatedSlides = Array.isArray(created.parameters.preview_slides) ? created.parameters.preview_slides as SlideDraft[] : [];
      const generatedPalette = created.parameters.preview_palette as SlidePalette | undefined;
      if (!isPresentation && !pages.length) throw new Error("The file was created, but its document preview is missing.");
      if (isPresentation && !generatedSlides.length) throw new Error("The deck was created, but its slide preview is missing.");
      setPreviewPages(pages); setSlides(generatedSlides); setSelectedPreviewPage(0); setSelectedSlide(0); setArtifact(created);
      if (generatedPalette?.navy && generatedPalette.accent && generatedPalette.soft) setPalette(generatedPalette);
      const nativeId = String(created.parameters.native_document_id ?? "");
      if (nativeId) setNativeDocument(await api<NativeDocument>(`/native-documents/${nativeId}`, token));
      onCreated(created);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not generate this document");
    } finally { setGenerating(false); }
  }

  async function cancelGeneration() {
    if (!generationJob?.id) return;
    try {
      const cancelled = await api<Job>(`/jobs/status/${generationJob.id}/cancel`, token, { method: "POST" });
      setGenerationJob(cancelled);
      setError("Generation was cancelled. Your intake and linked sources are still here.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not cancel generation");
    }
  }

  return <section className="presentation-studio document-studio-v2">
    <header className="presentation-heading"><div><span className="presentation-kicker"><Sparkles size={15} /> Context-aware document studio</span><h1>From evidence to a designed deliverable</h1><p>Use a real template, bring forward research context, preview every page, and continue in the editor.</p></div><span className="presentation-format">{isPresentation ? "16:9 · PPTX" : outputFormat.toUpperCase()}</span></header>
    <nav className="template-filters creation-format-switch" aria-label="Output format"><button type="button" className={outputFormat === "pdf" ? "active" : ""} onClick={() => changeFormat("pdf")}><FileText size={14} /> PDF</button><button type="button" className={outputFormat === "docx" ? "active" : ""} onClick={() => changeFormat("docx")}><FileOutput size={14} /> Word</button><button type="button" className={outputFormat === "pptx" ? "active" : ""} onClick={() => changeFormat("pptx")}><Presentation size={14} /> Slides</button></nav>
    {!selectedTemplate ? <TemplateGallery key={outputFormat} templates={templates} onUse={(item) => { setTemplateId(item.id); setTopic(item.starter); setAnswers({}); setSelectedPreviewPage(0); }} /> : <div className="presentation-layout contextual-design-flow">
      <form className="presentation-builder" onSubmit={generate}>
        <button type="button" className="change-template" onClick={() => setTemplateId("")}>← All templates</button>
        <div className="selected-template-summary"><TemplateMiniature item={selectedTemplate} /><div><small>SELECTED BLUEPRINT</small><strong>{selectedTemplate.name}</strong><span>{selectedTemplate.sections.length} structured sections</span></div></div>
        <div className="context-continuity"><header><span><Sparkles size={14} /> Workspace context</span><b>{sourceIds.length || workspaceContext ? "Connected" : "Optional"}</b></header><p>{conversation ? `Continuing from “${conversation.title}” with ${conversation.messages.length} research messages.` : workspaceContext ? "Source-library and recent deliverable context will guide this draft." : "Start here or connect sources below. Context stays attached through drafting and editing."}</p><div><span>{sourceIds.length} linked source{sourceIds.length === 1 ? "" : "s"}</span><span>{conversation ? "Research thread included" : "Workspace history included"}</span></div></div>
        <div className="presentation-builder-title"><Sparkles size={18} /><div><strong>Tell AI what matters</strong><small>Real intake questions for this document type.</small></div></div>
        <div className="template-intake-fields">{selectedTemplate.fields.map((item) => <label key={item.id}>{item.label}<input value={answers[item.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.value }))} placeholder={item.placeholder} /></label>)}</div>
        <label>Additional direction<textarea value={topic} onChange={(event) => setTopic(event.target.value)} rows={4} placeholder="Priorities, constraints, must-include details, and the desired outcome" /></label>
        <fieldset className="design-source-picker"><legend>Evidence to use</legend>{documents.filter((item) => item.status === "ready").map((item) => <label key={item.id}><input type="checkbox" checked={sourceIds.includes(item.id)} onChange={() => setSourceIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><FileText size={14} /><span><strong>{item.display_title || item.filename}</strong><small>{item.page_count ?? "—"} pages · ready</small></span></label>)}{!documents.some((item) => item.status === "ready") && <p>No ready sources. The template can still generate from your intake.</p>}</fieldset>
        <div className="presentation-options"><label>Audience<select value={audience} onChange={(event) => setAudience(event.target.value)}><option>Executive leadership</option><option>Clients and partners</option><option>Internal team</option><option>Investors</option><option>Technical reviewers</option></select></label><label>Tone<select value={tone} onChange={(event) => setTone(event.target.value)}><option>Clear and confident</option><option>Concise and analytical</option><option>Persuasive</option><option>Educational</option><option>Formal and precise</option></select></label></div>
        {error && <div className="form-error">{error}</div>}
        <button className="generate-deck" disabled={generating || !topic.trim()}>{generating ? <><RefreshCw className="spin" size={17} /> Researching, writing, and designing… {generationJob ? `${generationJob.progress}%` : ""}</> : <><Sparkles size={17} /> Generate from template</>}</button>
        {generating && generationJob?.id && <button type="button" className="cancel-generation" onClick={cancelGeneration}>Cancel generation</button>}
        <p className="presentation-note">Creates the export and an editable workspace document from one structured draft.</p>
      </form>
      <section className={`deck-preview design-live-preview ${slides.length || previewPages.length ? "has-slides" : ""}`}>
        <header className="live-preview-heading"><div><span><Eye size={14} /> {artifact ? "Generated design" : "Template preview"}</span><strong>{artifact ? artifact.filename : selectedTemplate.name}</strong></div><b>{isPresentation ? "16:9" : `${Math.max(previewPages.length, 2)} pages`}</b></header>
        {!isPresentation ? <DocumentDesignPreview pages={previewPages} template={selectedTemplate} selectedPage={selectedPreviewPage} onPage={setSelectedPreviewPage} /> : !activeSlide ? <div className="deck-empty"><span><Presentation size={28} /></span><strong>Your deck preview will appear here</strong><p>The template structure is ready. AI will fill it with your evidence and brief.</p><div><i /><i /><i /></div></div> : <><div className="slide-stage"><div className={`generated-slide ${activeSlide.variant}`} style={{ "--slide-navy": palette.navy, "--slide-accent": palette.accent, "--slide-soft": palette.soft } as CSSProperties}><span>{activeSlide.eyebrow}</span><h2>{activeSlide.title}</h2><p>{activeSlide.body}</p>{activeSlide.variant === "section-1" && <i className="slide-marker" />}{activeSlide.variant === "section-2" && <i className="slide-panel"><b>{activeSlide.eyebrow}</b></i>}<footer><b>InsightPDF</b><i>{String(selectedSlide + 1).padStart(2, "0")}</i></footer></div></div><div className="slide-strip">{slides.map((slide, index) => <button type="button" key={`${slide.title}-${index}`} className={selectedSlide === index ? "active" : ""} onClick={() => setSelectedSlide(index)}><span>{index + 1}</span><strong>{slide.title}</strong></button>)}</div></>}
        {artifact && <div className="document-result-actions"><span><CheckCircle2 size={15} /> Draft, preview, and editable version are ready</span><div><button type="button" onClick={() => downloadArtifact(artifact, token)}><Download size={15} /> Download {outputFormat.toUpperCase()}</button><button type="button" className="continue-editor" disabled={!nativeDocument} onClick={() => nativeDocument && onOpenGenerated(nativeDocument)}><Pencil size={15} /> Continue in editor</button></div></div>}
      </section>
    </div>}
    {!!artifacts.length && <section className="saved-presentations"><header><div><strong>Recently designed</strong><span>Generated exports and editable drafts remain in this workspace.</span></div></header><div>{artifacts.slice(0, 8).map((item) => <article key={item.id}><span>{item.filename.endsWith(".pptx") ? <Presentation size={18} /> : <FileText size={18} />}</span><div><strong>{item.filename}</strong><small>{item.filename.split(".").pop()?.toUpperCase()} · {(item.size_bytes / 1024).toFixed(1)} KB</small></div><button onClick={() => downloadArtifact(item, token)}><Download size={15} /> Download</button></article>)}</div></section>}
  </section>;
}
