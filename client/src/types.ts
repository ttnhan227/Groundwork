export type DocumentItem = {
  id: string;
  filename: string;
  size_bytes: number;
  status: string;
  page_count: number | null;
  error_message: string | null;
  display_title: string | null;
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
