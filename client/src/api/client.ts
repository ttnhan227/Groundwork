import type { AuthResult, Job } from "../types";

export const API = import.meta.env.VITE_API_URL ?? "/api/v1";
export const AUTH_EXPIRED_EVENT = "insightpdf-auth-expired";
export const AUTH_REFRESHED_EVENT = "insightpdf-auth-refreshed";

let refreshPromise: Promise<AuthResult> | null = null;

export function expireSession() {
  localStorage.removeItem("insightpdf-auth");
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

async function refreshSession(): Promise<AuthResult> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const saved = JSON.parse(localStorage.getItem("insightpdf-auth") ?? "null") as AuthResult | null;
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
      throw new Error(body?.detail ?? "Could not refresh your session");
    }
    const refreshed = await response.json() as AuthResult;
    localStorage.setItem("insightpdf-auth", JSON.stringify(refreshed));
    window.dispatchEvent(new CustomEvent<AuthResult>(AUTH_REFRESHED_EVENT, { detail: refreshed }));
    return refreshed;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function authenticatedFetch(input: RequestInfo | URL, token: string, init: RequestInit = {}): Promise<Response> {
  const send = (accessToken: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    return fetch(input, { ...init, headers });
  };
  let response = await send(token);
  if (response.status !== 401) return response;
  const saved = JSON.parse(localStorage.getItem("insightpdf-auth") ?? "null") as AuthResult | null;
  const refreshed = saved?.access_token && saved.access_token !== token ? saved : await refreshSession();
  response = await send(refreshed.access_token);
  if (response.status === 401) expireSession();
  return response;
}

export async function api<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = token
    ? await authenticatedFetch(`${API}${path}`, token, init)
    : await fetch(`${API}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? body?.error?.message ?? "Request failed");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function downloadTextFile(filename: string, content: string, contentType = "text/markdown") {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function waitForJob(job: Job, token: string): Promise<Job> {
  if (!job.id) throw new Error("The server did not return a job ID");
  const deadline = Date.now() + 180_000;
  let current = job;
  while (!["completed", "failed"].includes(current.status)) {
    if (Date.now() >= deadline) throw new Error("The operation is still running. Check Processing jobs shortly.");
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    current = await api<Job>(`/jobs/status/${job.id}`, token);
  }
  if (current.status === "failed") throw new Error(current.error_message ?? "Background operation failed");
  if (!current.result_id) throw new Error("The job completed without a result");
  return current;
}

export async function queueOperation(operation: string, parameters: Record<string, unknown>, token: string): Promise<Job> {
  const job = await api<Job>("/jobs", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, parameters }),
  });
  return waitForJob(job, token);
}
