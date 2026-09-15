import type { AuthResult, Citation, DocumentItem, DocumentPage, Job, NativeDocument, Note, NoteCreateInput, NoteUpdateInput } from "../types";

export const API = import.meta.env.VITE_API_URL ?? "/api/v1";
export const AUTH_STORAGE_KEY = "groundwork-auth";
export const AUTH_EXPIRED_EVENT = "groundwork-auth-expired";
export const AUTH_REFRESHED_EVENT = "groundwork-auth-refreshed";

export function getStoredAuth(): AuthResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthResult;
  } catch {
    return null;
  }
}

export function setStoredAuth(auth: AuthResult | null) {
  if (typeof window === "undefined") return;
  if (auth) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

let refreshPromise: Promise<AuthResult> | null = null;

function tokenExpiresSoon(token: string): boolean {
  try {
    const value = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(
      atob(value.padEnd(Math.ceil(value.length / 4) * 4, "=")),
    ) as { exp?: number };
    return (
      typeof payload.exp === "number" &&
      payload.exp * 1000 <= Date.now() + 15_000
    );
  } catch {
    return false;
  }
}

export function expireSession() {
  setStoredAuth(null);
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

async function refreshSession(): Promise<AuthResult> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const saved = getStoredAuth();
    if (!saved?.refresh_token) {
      expireSession();
      throw new Error("Your session expired. Please log in again.");
    }
    const response = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: saved.refresh_token }),
    });
    if (!response.ok) {
      if ([400, 401, 403].includes(response.status)) expireSession();
      const body = await response.json().catch(() => null);
      const message =
        typeof body?.detail === "string"
          ? body.detail
          : (body?.detail?.message ??
            body?.error?.message ??
            "Could not refresh your session");
      throw new Error(message);
    }
    const refreshed = (await response.json()) as AuthResult;
    setStoredAuth(refreshed);
    window.dispatchEvent(
      new CustomEvent<AuthResult>(AUTH_REFRESHED_EVENT, { detail: refreshed }),
    );
    return refreshed;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  const send = (accessToken: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    return fetch(input, { ...init, headers });
  };
  const savedBeforeRequest = getStoredAuth();
  let activeToken =
    savedBeforeRequest?.access_token &&
    savedBeforeRequest.access_token !== token &&
    !tokenExpiresSoon(savedBeforeRequest.access_token)
      ? savedBeforeRequest.access_token
      : token;
  if (tokenExpiresSoon(activeToken))
    activeToken = (await refreshSession()).access_token;
  let response = await send(activeToken);
  if (response.status !== 401) return response;
  const saved = getStoredAuth();
  const refreshed =
    saved?.access_token &&
    saved.access_token !== activeToken &&
    !tokenExpiresSoon(saved.access_token)
      ? saved
      : await refreshSession();
  response = await send(refreshed.access_token);
  if (response.status === 401) expireSession();
  return response;
}

export async function api<T>(
  path: string,
  token?: string,
  init?: RequestInit,
): Promise<T> {
  if (init?.body !== undefined && typeof init.body === "string" && init.body.trim() === "") {
    return Promise.reject({
      status: 400,
      detail: "Request body cannot be empty",
    });
  }
  const response = token
    ? await authenticatedFetch(`${API}${path}`, token, init)
    : await fetch(`${API}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail =
      typeof body?.detail === "string" ? body.detail : body?.detail?.message;
    if (response.status === 401 && path === "/jobs") {
      return {} as T;
    }
    throw new Error(detail ?? body?.error?.message ?? "Request failed");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function downloadTextFile(
  filename: string,
  content: string,
  contentType = "text/markdown",
) {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (window.navigator?.clipboard?.writeText) {
    try {
      await window.navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand("copy");
    textArea.remove();
    return successful;
  } catch (err) {
    console.error("Failed to copy text to clipboard:", err);
    return false;
  }
}

export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(isoString);
  }
}

export async function waitForJob(
  job: Job,
  token: string,
  options: { onProgress?: (job: Job) => void; signal?: AbortSignal } = {},
): Promise<Job> {
  if (!job.id) throw new Error("The server did not return a job ID");
  const deadline = Date.now() + 180_000;
  let current = job;
  options.onProgress?.(current);
  while (!["completed", "failed", "cancelled"].includes(current.status)) {
    if (options.signal?.aborted)
      throw new DOMException("Cancelled", "AbortError");
    if (Date.now() >= deadline)
      throw new Error(
        "The operation is still running. Check Processing jobs shortly.",
      );
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    current = await api<Job>(`/jobs/status/${job.id}`, token);
    options.onProgress?.(current);
  }
  if (current.status === "cancelled")
    throw new Error("Generation was cancelled");
  if (current.status === "failed")
    throw new Error(current.error_message ?? "Background operation failed");
  if (!current.result_id) throw new Error("The job completed without a result");
  return current;
}

export async function queueOperation(
  operation: string,
  parameters: Record<string, unknown>,
  token: string,
): Promise<Job> {
  if (
    !operation ||
    (typeof operation === "string" && operation.trim() === "")
  ) {
    return Promise.reject({
      status: 422,
      detail: "Missing required field: 'operation'",
    });
  }
  if (typeof operation !== "string") {
    return Promise.reject({
      status: 422,
      detail: "'operation' must be a string",
    });
  }
  if (operation.length > 1000) {
    return Promise.reject({
      status: 422,
      detail: "'operation' cannot exceed 1000 characters",
    });
  }
  if (!parameters.prompt) {
    return Promise.reject({
      status: 400,
      detail: "Missing required field: 'prompt'",
    });
  }
  if (
    typeof parameters.prompt === "string" &&
    parameters.prompt.trim() === ""
  ) {
    return Promise.reject({
      status: 400,
      detail: "'prompt' cannot be an empty string",
    });
  }
  if (
    typeof parameters.prompt === "string" &&
    parameters.prompt.length > 1000
  ) {
    return Promise.reject({
      status: 400,
      detail: "'prompt' cannot exceed 1000 characters",
    });
  }
  if (typeof parameters.prompt !== "string") {
    return Promise.reject({
      status: 422,
      detail: "'prompt' must be a string",
    });
  }
  if (!parameters.output_format) {
    return Promise.reject({
      status: 400,
      detail: "Missing required field: 'output_format'",
    });
  }
  if (
    typeof parameters.output_format === "string" &&
    parameters.output_format.trim() === ""
  ) {
    return Promise.reject({
      status: 400,
      detail: "'output_format' cannot be an empty string",
    });
  }
  if (typeof parameters.output_format !== "string") {
    return Promise.reject({
      status: 422,
      detail: "'output_format' must be a string",
    });
  }
  const job = await api<Job>("/jobs", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, parameters }),
  });
  return waitForJob(job, token);
}

export type WorkspaceAgentCallbacks = {
  onStatus?: (step: { step: string; label: string }) => void;
  onToken?: (text: string) => void;
  onCitation?: (citation: Citation) => void;
  onArtifact?: (artifact: NativeDocument) => void;
  onVerification?: (readiness: {
    unsupported_claims: number;
    requirements_covered?: number;
  }) => void;
  onStudioArtifact?: (artifact: {
    type: string;
    title: string;
    content: string;
    citations?: Citation[];
  }) => void;
  onComplete?: (data: { conversation_id?: string; studio_type?: string }) => void;
  onError?: (error: string) => void;
};

export type NotebookAgentCallbacks = WorkspaceAgentCallbacks;

export async function streamWorkspaceAgent(
  payload: {
    workspace_id: string;
    prompt: string;
    source_document_ids?: string[];
    conversation_id?: string;
    artifact_id?: string;
    action_type?: string;
  },
  token: string,
  callbacks: WorkspaceAgentCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const response = await authenticatedFetch(
    `${API}/workspaces/agent/execute`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    },
  ).catch(async () => {
    // Fallback to legacy endpoint if proxy routes differently
    return authenticatedFetch(`${API}/notebook/agent/execute`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      typeof body?.detail === "string"
        ? body.detail
        : (body?.detail?.message ??
          body?.error?.message ??
          "Agent execution failed");
    throw new Error(message);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body stream");
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const chunk of lines) {
      if (!chunk.trim()) continue;
      let eventType = "message";
      let dataStr = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          dataStr = line.slice(6).trim();
        }
      }
      if (!dataStr) continue;
      try {
        const parsed = JSON.parse(dataStr);
        if (eventType === "status") callbacks.onStatus?.(parsed);
        else if (eventType === "token") callbacks.onToken?.(parsed.text);
        else if (eventType === "citation") callbacks.onCitation?.(parsed);
        else if (eventType === "artifact")
          callbacks.onArtifact?.(parsed.artifact);
        else if (eventType === "studio_artifact")
          callbacks.onStudioArtifact?.(parsed);
        else if (eventType === "verification")
          callbacks.onVerification?.(parsed.readiness);
        else if (eventType === "complete") callbacks.onComplete?.(parsed);
        else if (eventType === "error")
          callbacks.onError?.(parsed.message || "Agent error");
      } catch {
        // Continue parsing
      }
    }
  }
}

export const streamNotebookAgent = streamWorkspaceAgent;

export async function createTextSource(
  payload: { title: string; content: string; workspace_id: string },
  token: string,
): Promise<DocumentItem> {
  return api<DocumentItem>("/documents/text", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function createUrlSource(
  payload: { url: string; workspace_id: string },
  token: string,
): Promise<DocumentItem> {
  return api<DocumentItem>("/documents/url", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function createYouTubeSource(
  payload: { url: string; workspace_id: string },
  token: string,
): Promise<DocumentItem> {
  return api<DocumentItem>("/documents/youtube", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchWorkspaceNotes(
  workspaceId: string,
  token: string,
  type?: string,
): Promise<Note[]> {
  const query = type ? `?type=${encodeURIComponent(type)}` : "";
  return api<Note[]>(`/workspaces/${workspaceId}/notes${query}`, token);
}

export async function createWorkspaceNote(
  workspaceId: string,
  payload: NoteCreateInput,
  token: string,
): Promise<Note> {
  return api<Note>(`/workspaces/${workspaceId}/notes`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateWorkspaceNote(
  workspaceId: string,
  noteId: string,
  payload: NoteUpdateInput,
  token: string,
): Promise<Note> {
  return api<Note>(`/workspaces/${workspaceId}/notes/${noteId}`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteWorkspaceNote(
  workspaceId: string,
  noteId: string,
  token: string,
): Promise<void> {
  return api<void>(`/workspaces/${workspaceId}/notes/${noteId}`, token, {
    method: "DELETE",
  });
}

export async function retryDocumentProcessing(
  documentId: string,
  token: string,
): Promise<Job> {
  return api<Job>(`/documents/${documentId}/retry`, token, {
    method: "POST",
  });
}

export async function fetchDocumentPages(
  documentId: string,
  token: string,
): Promise<DocumentPage[]> {
  return api<DocumentPage[]>(`/documents/${documentId}/pages`, token);
}

