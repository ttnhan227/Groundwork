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

export type AgentTaskStep = {
  step: string;
  label: string;
  status: "pending" | "in_progress" | "completed";
};

export type NotebookNote = {
  id: string;
  key: string;
  value: string;
  created_at?: string;
};

export type NotebookAgentEvent = {
  event: "status" | "token" | "citation" | "artifact" | "verification" | "complete" | "error";
  data: unknown;
};
