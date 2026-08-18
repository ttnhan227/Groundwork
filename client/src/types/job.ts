export type Job = {
  id?: string;
  status: string;
  progress: number;
  error_message: string | null;
  result_kind?: string | null;
  result_id?: string | null;
  operation?: string;
  parameters?: Record<string, unknown>;
  retry_count?: number;
  created_at?: string;
};

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
