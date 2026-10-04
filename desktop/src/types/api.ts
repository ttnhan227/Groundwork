export interface Workspace {
  id: string;
  name: string;
  path: string;
  is_active: boolean;
  ignore_patterns: string[];
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  path: string;
  detected_type: string;
  language: string;
  frameworks: string[];
  git_remote: string | null;
  git_branch: string | null;
  last_modified: string | null;
  metadata: Record<string, any>;
}

export interface ProjectOverview extends Project {
  working_tree: { branch?: string; changed_files?: Array<{status: string; file: string}>; diff_stat?: string };
  readme_preview: string | null;
  entry_points: string[];
  dependencies: string[];
  recent_commits: Array<{
    hash: string;
    author: string;
    date: string;
    message: string;
  }>;
  key_files: Array<{
    name: string;
    is_dir: boolean;
    size: number;
  }>;
}

export interface SearchResultItem {
  file_id: string;
  path: string;
  filename: string;
  relative_path: string;
  project_id: string | null;
  project_name: string | null;
  file_type: string;
  line_number: number | null;
  snippet: string;
  matched_terms: string[];
  score: number;
  score_breakdown: {
    lexical: number;
    semantic: number;
    filename: number;
    project_boost: number;
    recency: number;
  };
  last_modified: string | null;
}

export interface SearchResponse {
  query: string;
  total_matches: number;
  results: SearchResultItem[];
  duration_ms: number;
  search_mode: string;
}

export interface IndexProgress {
  run_id: string | null;
  status: "idle" | "indexing" | "paused" | "completed" | "cancelled" | "failed";
  current_workspace: string | null;
  files_discovered: number;
  files_indexed: number;
  files_skipped: number;
  percent: number;
  current_file: string | null;
  started_at: string | null;
  finished_at: string | null;
  errors: string[];
}

export interface ActivityItem {
  id: string;
  workspace_id: string | null;
  project_id: string | null;
  project_name: string | null;
  activity_type:
    | "file_modified"
    | "file_created"
    | "file_deleted"
    | "git_commit"
    | "project_opened"
    | "note_created"
    | "investigation_started"
    | "search_executed";
  summary: string;
  details: Record<string, any>;
  timestamp: string;
}

export interface ContextSession {
  id: string;
  title: string;
  project_id: string | null;
  project_name: string | null;
  status: "active" | "paused" | "completed";
  started_at: string;
  last_active_at: string;
  files_inspected: string[];
  git_commits: string[];
  notes: string[];
  todos: string[];
  last_command: string | null;
  summary: string | null;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  project_id: string | null;
  project_name: string | null;
  file_path: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  sync_status: string;
}

export interface SavedSearch {
  id: string;
  title: string;
  query: string;
  filters: Record<string, any>;
  created_at: string;
}

export interface CitationItem {
  path: string;
  filename: string;
  line_start: number | null;
  line_end: number | null;
  snippet: string;
}

export interface AIQueryResponse {
  answer: string;
  citations: CitationItem[];
  evidence_count: number;
  provider_used: string;
  suggested_actions: Array<{
    label: string;
    action: string;
    path?: string;
    title?: string;
  }>;
  session_id: string | null;
}

export interface SystemStatus {
  status: string;
  app_name: string;
  app_version: string;
  database_path: string;
  counts: {
    workspaces: number;
    projects: number;
    files: number;
    chunks: number;
    notes: number;
  };
}
