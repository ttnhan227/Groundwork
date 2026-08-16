export type NativeBlock = {
  type: "heading" | "paragraph" | "bullet";
  text: string;
};

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
  kind:
    | "missing_requirement"
    | "unsupported_claim"
    | "contradiction"
    | "weak_section"
    | "repetition"
    | "tone_inconsistency"
    | "source_conflict";
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

export type AIResult = {
  id: string;
  feature: string;
  document_ids: string[];
  parameters: Record<string, unknown>;
  result: Record<string, unknown>;
  cached: boolean;
  created_at: string;
};
