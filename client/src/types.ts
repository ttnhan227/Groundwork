export type DocumentItem = {
  id: string;
  filename: string;
  size_bytes: number;
  status: string;
  page_count: number | null;
  error_message: string | null;
  display_title: string | null;
  original_filename?: string | null;
  original_content_type?: string | null;
  tags: string[];
  collection_id: string | null;
  created_at: string;
};

export type Job = {
  id?: string;
  status: string;
  progress: number;
  error_message: string | null;
  result_kind?: string | null;
  result_id?: string | null;
  operation?: string;
  retry_count?: number;
  created_at?: string;
};

export type AuthResult = {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    display_name: string;
    email: string;
    role: "user" | "admin";
    is_active: boolean;
    google_linked: boolean;
  };
};

export type Citation = {
  document_id: string;
  document_name: string;
  page_number: number;
  snippet: string;
};

export type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  created_at?: string;
};

export type Conversation = {
  id: string;
  title: string;
  document_ids: string[];
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
};

export type AIResult = {
  id: string;
  feature: string;
  document_ids: string[];
  parameters: Record<string, unknown>;
  result: Record<string, unknown>;
  cached: boolean;
  created_at: string;
};

export type ReportReference = {
  document_id: string;
  document_name: string;
  page_number: number;
};

export type DocumentReport = {
  title: string;
  document_type: string;
  purpose: string;
  executive_summary: string;
  metrics: Array<{
    label: string;
    value: string;
    change: string;
    trend: "up" | "down" | "neutral";
    context: string;
    page_references: ReportReference[];
  }>;
  findings: Array<{
    title: string;
    detail: string;
    importance: "high" | "medium" | "low";
    page_references: ReportReference[];
  }>;
  risks: Array<{
    title: string;
    detail: string;
    severity: "high" | "medium" | "low";
    page_references: ReportReference[];
  }>;
  entities: Array<{ name: string; role: string }>;
  timeline: Array<{ date: string; event: string; page_references: ReportReference[] }>;
  missing_information: string[];
  next_actions: string[];
};

export type Artifact = {
  id: string;
  operation: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  parameters: Record<string, unknown>;
  linked_document_id: string | null;
  collection_id: string | null;
  created_at: string;
};

export type ArtifactVersion = {
  id: string;
  artifact_id: string;
  version_number: number;
  content_type: string;
  size_bytes: number;
  change_prompt: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

export type Collection = { id: string; name: string; color: string; created_at: string };

export type WorkflowPlan = {
  id: string;
  status: string;
  command: string;
  document_id: string;
  confirmation_required: boolean;
  estimated_ai_calls: number;
  steps: Array<{
    id: string;
    tool: string;
    title: string;
    parameters: Record<string, unknown>;
    risk: string;
    confirmation_required: boolean;
    verification: string;
  }>;
};

export type PersistedWorkflow = {
  id: string;
  status: string;
  confirmation_required: boolean;
  job_id: string | null;
  steps: Array<{
    id: string;
    position: number;
    capability: string;
    title: string;
    parameters: Record<string, unknown>;
    risk: string;
    verification: string;
    status: string;
  }>;
};

export type ConversationCommand = {
  message_id: string;
  planner_run_id: string;
  workflow: PersistedWorkflow;
  job: Job | null;
};

export type Stats = {
  document_count: number;
  page_count: number;
  storage_bytes: number;
  ai_requests: number;
  generated_files: number;
  failed_jobs: number;
};

export type AdminUser = AuthResult["user"] & Stats & { created_at: string };

export type SecuritySession = { id: string; created_at: string; expires_at: string };

export type UsageDetail = {
  storage_limit_bytes: number;
  storage_bytes: number;
  ai_requests_total: number;
  ai_requests_30_days: number;
  ai_requests_by_feature: Record<string, number>;
  jobs_by_status: Record<string, number>;
};

export type NotificationItem = {
  id: string;
  user_id: string;
  workspace_id: string | null;
  kind: string;
  title: string;
  message: string;
  severity: "info" | "success" | "warning" | "error";
  action: string | null;
  subject_type: string | null;
  subject_id: string | null;
  metadata_json: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type WorkspaceMember = {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: "owner" | "editor" | "viewer";
  created_at: string;
};

export type Workspace = {
  id: string;
  owner_id: string;
  name: string;
  kind: "personal" | "team";
  role: "owner" | "editor" | "viewer";
  created_at: string;
  updated_at: string;
};

export type NativeBlock = { type: "heading" | "paragraph" | "bullet"; text: string };

export type NativeDocument = {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  content: { type: "doc"; blocks: NativeBlock[] };
  status: "draft" | "review" | "complete";
  revision: number;
  source_document_ids: string[];
  created_at: string;
  updated_at: string;
};

export type NativeDocumentVersion = {
  id: string;
  native_document_id: string;
  version_number: number;
  title: string;
  content: NativeDocument["content"];
  change_summary: string | null;
  created_by: string;
  created_at: string;
};

export type DocumentComment = {
  id: string;
  native_document_id: string;
  author_id: string;
  body: string;
  anchor: Record<string, unknown>;
  status: "open" | "resolved";
  created_at: string;
  resolved_at: string | null;
};

export type AISuggestion = {
  id: string;
  native_document_id: string;
  created_by: string;
  instruction: string;
  before_text: string;
  proposed_text: string;
  status: "pending" | "accepted" | "rejected";
  citations: Array<{ document_id: string; document_name?: string; page_number: number }>;
  created_at: string;
  decided_at: string | null;
};

export type DeliverableCitation = {
  document_id: string;
  document_name: string;
  page_number: number;
  snippet?: string;
};

export type DeliverableRequirement = {
  id: string;
  native_document_id: string;
  created_by: string;
  text: string;
  kind: "section" | "question" | "format" | "evidence" | "deadline" | "content";
  status: "pending" | "partial" | "covered" | "waived";
  is_required: boolean;
  position: number;
  origin: "manual" | "ai";
  evidence: DeliverableCitation[];
  linked_sections: string[];
  created_at: string;
  updated_at: string;
};

export type DeliverableReviewFinding = {
  id: string;
  native_document_id: string;
  requirement_id: string | null;
  created_by: string;
  kind: "missing_requirement" | "unsupported_claim" | "contradiction" | "weak_section" | "repetition" | "tone_inconsistency" | "source_conflict";
  claim_type: "number_stat" | "timeline_date" | "user_quote" | "recommendation" | "assumption" | "other";
  severity: "low" | "medium" | "high";
  claim_text: string;
  explanation: string;
  proposed_text: string;
  citations: DeliverableCitation[];
  status: "open" | "accepted" | "rejected" | "resolved" | "superseded";
  created_at: string;
  decided_at: string | null;
};

export type DeliverableReadiness = {
  requirements_total: number;
  requirements_covered: number;
  requirements_required: number;
  required_covered: number;
  unsupported_claims: number;
  open_findings: number;
  unresolved_comments: number;
  sources_linked: number;
  sources_used: number;
  status: "setup_needed" | "needs_review" | "ready";
  blockers: string[];
};

export type ActivityEvent = {
  id: number;
  workspace_id: string;
  actor_id: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type WorkspaceSearchResult = {
  kind: "source" | "content" | "deliverable";
  id: string;
  title: string;
  snippet: string;
  score: number;
  document_id: string | null;
  page_number: number | null;
  status: string | null;
};
