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

export type Collection = {
  id: string;
  name: string;
  color: string;
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
