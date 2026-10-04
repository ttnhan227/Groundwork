import type {
  ActivityItem,
  AIQueryResponse,
  ContextSession,
  IndexProgress,
  Note,
  Project,
  ProjectOverview,
  SavedSearch,
  SearchResponse,
  SystemStatus,
  Workspace,
} from "../types/api";

import { invoke, isTauri } from "@tauri-apps/api/core";

let connectionPromise: Promise<{ url: string; token?: string }> | undefined;
function getConnection() {
  if (!connectionPromise) {
    connectionPromise = isTauri()
      ? invoke<{ url: string; token: string }>("start_local_core").catch((error) => { connectionPromise = undefined; throw error; })
      : Promise.resolve({ url: "http://127.0.0.1:8000" });
  }
  return connectionPromise;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const connection = await getConnection();
  const url = `${connection.url}${path}`;
  const res = await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
      ...(options.headers || {}),
    },
  }).catch((error) => { if (isTauri()) connectionPromise = undefined; throw error; });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API Error ${res.status}: ${errorText}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  restartLocalCore: async () => {
    if (!isTauri()) throw new Error("Service restart is available in the installed desktop app");
    await invoke("stop_local_core");
    connectionPromise = undefined;
    return getConnection();
  },
  getFileHistory: (projectId: string, path: string) => request<{path: string; diff: string; commits: Array<{hash: string; message: string}>}>(`/api/git/projects/${encodeURIComponent(projectId)}/file-history?path=${encodeURIComponent(path)}`),
  getPreferences: () => request<Record<string, string | boolean | null>>("/api/system/preferences"),
  updatePreferences: (values: Record<string, string | null>) => request<Record<string, string | boolean | null>>("/api/system/preferences", { method: "PUT", body: JSON.stringify(values) }),
  loginCloud: (url: string, email: string, password: string, register = false) => request<{status: string}>("/api/sync/login", { method: "POST", body: JSON.stringify({url, email, password, register}) }),
  logoutCloud: () => request<{status: string}>("/api/sync/logout", {method: "POST"}),

  // System
  getSystemStatus: () => request<SystemStatus>("/api/system/status"),
  openFile: (path: string) => request<{ success: boolean }>("/api/system/open-file", { method: "POST", body: JSON.stringify({ path }) }),
  openFolder: (path: string) => request<{ success: boolean }>("/api/system/open-folder", { method: "POST", body: JSON.stringify({ path }) }),
  revealFile: (path: string) => request<{ success: boolean }>("/api/system/reveal-file", { method: "POST", body: JSON.stringify({ path }) }),

  pickWorkspaceFolder: () => isTauri() ? invoke<string | null>("pick_workspace_folder") : Promise.resolve(null),

  // Workspaces
  listWorkspaces: () => request<Workspace[]>("/api/workspaces"),
  createWorkspace: (name: string, path: string) =>
    request<Workspace>("/api/workspaces", { method: "POST", body: JSON.stringify({ name, path }) }),
  deleteWorkspace: (id: string) =>
    request<{ deleted: boolean }>(`/api/workspaces/${id}`, { method: "DELETE" }),

  // Projects
  listProjects: (workspaceId?: string) =>
    request<Project[]>(workspaceId ? `/api/projects?workspace_id=${workspaceId}` : "/api/projects"),
  getProjectOverview: (projectId: string) =>
    request<ProjectOverview>(`/api/projects/${projectId}/overview`),

  // Indexer
  getIndexProgress: () => request<IndexProgress>("/api/index/status"),
  startIndexing: (workspaceId?: string) =>
    request<IndexProgress>(workspaceId ? `/api/index/start?workspace_id=${encodeURIComponent(workspaceId)}` : "/api/index/start", {
      method: "POST",
      body: JSON.stringify({ workspace_id: workspaceId }),
    }),
  cancelIndexing: () => request<IndexProgress>("/api/index/cancel", { method: "POST" }),

  // Search
  searchWorkspace: (q: string, mode: string = "hybrid", projectId?: string, limit: number = 25, fileType?: string, modifiedAfter?: number) => {
    const params = new URLSearchParams({ q, mode, limit: limit.toString() });
    if (projectId) params.append("project_id", projectId);
    if (fileType) params.append("file_type", fileType);
    if (modifiedAfter !== undefined) params.append("modified_after", String(modifiedAfter));
    return request<SearchResponse>(`/api/search?${params.toString()}`);
  },

  // Git
  getGitCommits: (query?: string, projectId?: string) => {
    const params = new URLSearchParams();
    if (query) params.append("query", query);
    if (projectId) params.append("project_id", projectId);
    return request<Array<{ hash: string; short_hash: string; author: string; date: string; message: string; project_name: string }>>(`/api/git/commits?${params.toString()}`);
  },

  // Activity
  listActivities: (days: number = 7, projectId?: string) => {
    const params = new URLSearchParams({ days: days.toString() });
    if (projectId) params.append("project_id", projectId);
    return request<ActivityItem[]>(`/api/activity?${params.toString()}`);
  },
  getActivitySummary: (days: number = 2) =>
    request<{
      period_days: number;
      concise_summary: string;
      active_projects: string[];
      modified_files: Array<{ filename: string; path: string; project: string; mtime: string }>;
      recent_commits: Array<{ hash: string; author: string; date: string; message: string; project: string }>;
      active_sessions: Array<{ title: string; status: string; project: string }>;
    }>(`/api/activity/summary?days=${days}`),

  // Context Sessions
  listSessions: (projectId?: string) =>
    request<ContextSession[]>(projectId ? `/api/context-sessions?project_id=${projectId}` : "/api/context-sessions"),
  createSession: (title: string, projectId?: string, summary?: string, filesInspected: string[] = []) =>
    request<ContextSession>("/api/context-sessions", {
      method: "POST",
      body: JSON.stringify({ title, project_id: projectId, summary, files_inspected: filesInspected }),
    }),
  updateSession: (id: string, updates: Partial<ContextSession>) =>
    request<ContextSession>(`/api/context-sessions/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),

  // Notes
  listNotes: (query?: string, projectId?: string) => {
    const params = new URLSearchParams();
    if (query) params.append("q", query);
    if (projectId) params.append("project_id", projectId);
    return request<Note[]>(`/api/notes?${params.toString()}`);
  },
  createNote: (title: string, content: string, projectId?: string, filePath?: string, tags: string[] = []) =>
    request<Note>("/api/notes", {
      method: "POST",
      body: JSON.stringify({ title, content, project_id: projectId, file_path: filePath, tags }),
    }),
  updateNote: (id: string, updates: Partial<Note>) => request<Note>(`/api/notes/${id}`, { method: "PUT", body: JSON.stringify(updates) }),
  deleteNote: (id: string) => request<{ deleted: boolean }>(`/api/notes/${id}`, { method: "DELETE" }),

  // Saved Searches
  listSavedSearches: () => request<SavedSearch[]>("/api/saved-searches"),
  createSavedSearch: (title: string, query: string) =>
    request<SavedSearch>("/api/saved-searches", {
      method: "POST",
      body: JSON.stringify({ title, query }),
    }),
  deleteSavedSearch: (id: string) =>
    request<{ deleted: boolean }>(`/api/saved-searches/${id}`, { method: "DELETE" }),

  // AI
  queryAI: (question: string, projectId?: string, provider?: string, focusedPath?: string, focusedLine?: number, sessionId?: string) =>
    request<AIQueryResponse>("/api/ai/query", {
      method: "POST",
      body: JSON.stringify({ question, project_id: projectId, provider, focused_path: focusedPath, focused_line: focusedLine, session_id: sessionId }),
    }),
  investigateProblem: (problemStatement: string, projectId?: string, provider?: string, focusedPath?: string, focusedLine?: number, sessionId?: string) =>
    request<{
      session_id: string;
      title: string;
      analysis: string;
      provider_used: string;
      citations: AIQueryResponse["citations"];
      inspected_files: string[];
      related_commits: any[];
      evidence_count: number;
    }>("/api/ai/investigate", {
      method: "POST",
      body: JSON.stringify({ problem_statement: problemStatement, project_id: projectId, provider, files: focusedPath ? [focusedPath] : [], focused_line: focusedLine || 1, session_id: sessionId }),
    }),
  listProviders: () =>
    request<Array<{ id: string; name: string; is_local: boolean; active: boolean }>>("/api/ai/providers"),
  executeTool: (toolName: string, args: Record<string, any>, confirmationToken?: string) =>
    request<any>("/api/ai/tools/execute", {
      method: "POST",
      body: JSON.stringify({ tool_name: toolName, arguments: args, confirmation_token: confirmationToken }),
    }),

  // Sync
  getSyncStatus: () => request<{ enabled: boolean; cloud_url: string; is_authenticated: boolean; pending_items: number; state: string }>("/api/sync/status"),
  triggerSync: () => request<{ status: string; synced_count?: number; message?: string; error?: string }>("/api/sync/trigger", { method: "POST" }),
};
