import {
  BarChart3, Bell, CheckCircle2, ChevronRight, Database, FileCog, LogOut,
  Shield, ShieldCheck, Trash2, UserRound, Users, X,
} from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { api, downloadTextFile } from "../../api/client";
import type { AdminUser, AuthResult, SecuritySession, Stats, UsageDetail, Workspace, WorkspaceMember } from "../../types";
import { applyPreferences, storedPreferences, type UserPreferences } from "./preferences";

type AccountTab = "profile" | "security" | "defaults" | "notifications" | "privacy" | "usage" | "team" | "admin";

const tabs: Array<{ id: AccountTab; label: string; detail: string; icon: ReactNode; admin?: boolean }> = [
  { id: "profile", label: "Profile", detail: "Identity and account", icon: <UserRound size={17} /> },
  { id: "security", label: "Security", detail: "Password and sessions", icon: <Shield size={17} /> },
  { id: "defaults", label: "Document Defaults", detail: "Writing and exports", icon: <FileCog size={17} /> },
  { id: "notifications", label: "Notifications", detail: "What keeps you informed", icon: <Bell size={17} /> },
  { id: "privacy", label: "Privacy & Data", detail: "History and account data", icon: <Database size={17} /> },
  { id: "usage", label: "Usage", detail: "Storage and AI activity", icon: <BarChart3 size={17} /> },
  { id: "team", label: "Team", detail: "Workspace access", icon: <Users size={17} /> },
  { id: "admin", label: "Admin", detail: "Manage all users", icon: <ShieldCheck size={17} />, admin: true },
];

function Toggle({ checked, onChange, title, detail }: { checked: boolean; onChange: (checked: boolean) => void; title: string; detail: string }) {
  return <label className="settings-toggle"><span><strong>{title}</strong><small>{detail}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}

function Heading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <div className="settings-heading"><p>{eyebrow}</p><h2>{title}</h2><span>{detail}</span></div>;
}

export function AccountPanel({ user, token, stats, onUser, onClose, onSignOut }: {
  user: AuthResult["user"];
  token: string;
  stats: Stats | null;
  onUser: (user: AuthResult["user"]) => void;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<AccountTab>("profile");
  const [preferences, setPreferences] = useState<UserPreferences>(storedPreferences);
  const [sessions, setSessions] = useState<SecuritySession[]>([]);
  const [usage, setUsage] = useState<UsageDetail | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const onUserRef = useRef(onUser);
  useEffect(() => { onUserRef.current = onUser; }, [onUser]);

  const loadMembers = useCallback((selected: string) => {
    if (!selected) return Promise.resolve();
    return api<WorkspaceMember[]>(`/workspaces/${selected}/members`, token).then(setMembers);
  }, [token]);

  useEffect(() => {
    Promise.all([
      api<AuthResult["user"]>("/auth/me", token).then((updated) => onUserRef.current(updated)),
      api<UserPreferences>("/profile/preferences", token).then((value) => { setPreferences(value); applyPreferences(value); }),
      api<Workspace[]>("/workspaces", token).then((items) => {
        setWorkspaces(items);
        const selected = items[0]?.id ?? "";
        setWorkspaceId(selected);
        return loadMembers(selected);
      }),
    ]).catch((reason) => setError(reason.message));
  }, [loadMembers, token]);

  useEffect(() => {
    if (tab === "security") api<SecuritySession[]>("/profile/sessions", token).then(setSessions).catch((reason) => setError(reason.message));
    if (tab === "usage") api<UsageDetail>("/profile/usage", token).then(setUsage).catch((reason) => setError(reason.message));
    if (tab === "admin" && user.role === "admin") api<AdminUser[]>("/admin/users", token).then(setAdmins).catch((reason) => setError(reason.message));
    if (tab === "team" && workspaceId) loadMembers(workspaceId).catch((reason) => setError(reason.message));
  }, [loadMembers, tab, token, user.role, workspaceId]);

  const selectTab = (next: AccountTab) => { setError(""); setMessage(""); setTab(next); };

  const perform = async (work: () => Promise<void>, success?: string) => {
    setBusy(true); setError(""); setMessage("");
    try { await work(); if (success) setMessage(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Something went wrong"); }
    finally { setBusy(false); }
  };

  async function savePreferences() {
    await perform(async () => {
      const updated = await api<UserPreferences>("/profile/preferences", token, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preferences),
      });
      setPreferences(updated); applyPreferences(updated);
    }, "Settings saved and applied.");
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await perform(async () => {
      const updated = await api<AuthResult["user"]>("/profile", token, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ display_name: form.get("display_name") }),
      });
      onUser(updated);
    }, "Profile updated.");
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await perform(async () => {
      await api("/profile/password", token, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: form.get("current_password"), new_password: form.get("new_password") }),
      });
      formElement.reset();
      setSessions([]);
    }, "Password changed. Existing refresh sessions were revoked.");
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await perform(async () => {
      await api(`/workspaces/${workspaceId}/members`, token, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), role: form.get("role") }),
      });
      await loadMembers(workspaceId); formElement.reset();
    }, "Team member added and notified.");
  }

  async function exportData() {
    await perform(async () => {
      const value = await api<Record<string, unknown>>("/profile/data-export", token);
      downloadTextFile(`groundwork-account-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(value, null, 2), "application/json");
    }, "Your account export was downloaded.");
  }

  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  const editableTeam = selectedWorkspace?.role === "owner";
  const storagePercent = usage ? Math.min(100, Math.round(usage.storage_bytes / usage.storage_limit_bytes * 100)) : 0;

  return <div className="account-wrap"><button className="history-backdrop" aria-label="Close account settings" onClick={onClose} />
    <section className="account-panel account-panel-full" role="dialog" aria-label="Account settings">
      <header className="account-shell-header"><div><p>Groundwork account</p><strong>{user.display_name}</strong><span>{user.email}</span></div><button aria-label="Close account settings" onClick={onClose}><X size={19} /></button></header>
      <div className="account-layout">
        <aside className="account-settings-nav"><nav>{tabs.filter((item) => !item.admin || user.role === "admin").map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => selectTab(item.id)}>{item.icon}<span><strong>{item.label}</strong><small>{item.detail}</small></span><ChevronRight size={14} /></button>)}</nav><button className="account-signout" onClick={onSignOut}><LogOut size={16} /> Sign out</button></aside>
        <main className="account-settings-main">{error && <div className="form-error">{error}</div>}{message && <div className="success-note"><CheckCircle2 size={16} /> {message}</div>}
          {tab === "profile" && <><Heading eyebrow="Profile" title="Your account" detail="Keep your identity clear wherever you collaborate or export work." />
            <div className="settings-grid profile-settings-grid"><section className="settings-card profile-card"><div className="profile-avatar">{user.display_name.slice(0, 2).toUpperCase()}</div><div><h3>{user.display_name}</h3><p>{user.email}</p><span>{user.role === "admin" ? "Administrator" : "Member"}</span></div></section>
              <section className={`settings-card identity-card ${user.google_linked ? "linked" : ""}`}><CheckCircle2 size={21} /><div><h3>Google account</h3><p>{user.google_linked ? "Connected for secure sign-in" : "Not connected to this account"}</p></div><strong>{user.google_linked ? "Connected" : "Not linked"}</strong></section></div>
            <form className="settings-card settings-form" onSubmit={updateProfile}><h3>Personal information</h3><p>This name appears in shared workspaces and document activity.</p><div className="settings-fields"><label>Display name<input name="display_name" defaultValue={user.display_name} minLength={2} required /></label><label>Email address<input value={user.email} disabled /></label></div><footer><button disabled={busy}>Save profile</button></footer></form></>}

          {tab === "security" && <><Heading eyebrow="Security" title="Password and sessions" detail="Control access to your account and remove sessions you no longer recognize." />
            <form className="settings-card settings-form" onSubmit={changePassword}><h3>Change password</h3><div className="settings-fields"><label>Current password<input name="current_password" type="password" autoComplete="current-password" required /></label><label>New password<input name="new_password" type="password" autoComplete="new-password" minLength={8} required /></label></div><footer><button disabled={busy}>Update password</button></footer></form>
            <section className="settings-card"><div className="settings-card-header"><div><h3>Active sessions</h3><p>Sessions are created when you sign in or refresh your access.</p></div>{sessions.length > 0 && <button className="secondary" onClick={() => perform(async () => { await api("/profile/sessions/revoke-all", token, { method: "POST" }); onSignOut(); })}>Sign out everywhere</button>}</div><div className="settings-list">{sessions.map((session, index) => <article key={session.id}><Shield size={18} /><span><strong>{index === 0 ? "Recent session" : "Signed-in session"}</strong><small>Started {new Date(session.created_at).toLocaleString()} · Expires {new Date(session.expires_at).toLocaleDateString()}</small></span><button onClick={() => perform(async () => { await api(`/profile/sessions/${session.id}`, token, { method: "DELETE" }); setSessions((current) => current.filter((item) => item.id !== session.id)); }, "Session revoked.")}>Revoke</button></article>)}{!sessions.length && <p className="settings-empty">No active refresh sessions are stored.</p>}</div></section></>}

          {tab === "defaults" && <><Heading eyebrow="Document defaults" title="Start every document your way" detail="These defaults guide new AI drafts and exports. You can still change them per document." /><section className="settings-card settings-form"><div className="settings-fields three"><label>Writing language<select value={preferences.document_language} onChange={(event) => setPreferences({ ...preferences, document_language: event.target.value })}><option>English</option><option>Vietnamese</option><option>French</option><option>German</option><option>Spanish</option><option>Japanese</option></select></label><label>Default tone<select value={preferences.default_tone} onChange={(event) => setPreferences({ ...preferences, default_tone: event.target.value as UserPreferences["default_tone"] })}><option value="professional">Professional</option><option value="concise">Concise</option><option value="technical">Technical</option><option value="academic">Academic</option><option value="friendly">Friendly</option></select></label><label>Citation style<select value={preferences.citation_style} onChange={(event) => setPreferences({ ...preferences, citation_style: event.target.value as UserPreferences["citation_style"] })}><option value="inline">Inline source links</option><option value="footnote">Footnotes</option><option value="apa">APA</option><option value="mla">MLA</option><option value="chicago">Chicago</option></select></label><label>Page size<select value={preferences.page_size} onChange={(event) => setPreferences({ ...preferences, page_size: event.target.value as UserPreferences["page_size"] })}><option value="a4">A4</option><option value="letter">US Letter</option></select></label><label>Default export<select value={preferences.default_export_format} onChange={(event) => setPreferences({ ...preferences, default_export_format: event.target.value as UserPreferences["default_export_format"] })}><option value="pdf">PDF</option><option value="docx">Word (DOCX)</option><option value="markdown">Markdown</option></select></label></div><footer><button onClick={savePreferences} disabled={busy}>Save document defaults</button></footer></section></>}

          {tab === "notifications" && <><Heading eyebrow="Notifications" title="Stay on top of background work" detail="Groundwork keeps a durable inbox, so you can leave a task and return when it is ready." /><section className="settings-card toggle-list"><Toggle checked={preferences.notify_processing_completed} onChange={(value) => setPreferences({ ...preferences, notify_processing_completed: value })} title="Completed processing and exports" detail="Tell me when uploads, AI tasks, and generated files are ready." /><Toggle checked={preferences.notify_processing_failed} onChange={(value) => setPreferences({ ...preferences, notify_processing_failed: value })} title="Failures that need attention" detail="Show errors and a direct path back to processing details." /><Toggle checked={preferences.notify_comments} onChange={(value) => setPreferences({ ...preferences, notify_comments: value })} title="Team comments" detail="Notify me when another member comments on a deliverable." /><Toggle checked={preferences.notify_reviews} onChange={(value) => setPreferences({ ...preferences, notify_reviews: value })} title="AI review results" detail="Tell me when review findings are ready to inspect." /><footer><button onClick={savePreferences} disabled={busy}>Save notification settings</button></footer></section></>}

          {tab === "privacy" && <><Heading eyebrow="Privacy & data" title="Your data, under your control" detail="Download your account data, manage activity retention, or permanently delete the account." /><section className="settings-card toggle-list"><Toggle checked={preferences.retain_activity_history} onChange={(value) => setPreferences({ ...preferences, retain_activity_history: value })} title="Keep activity history" detail="Retain document activity so workspace progress remains auditable." /><label className="inline-setting">Retain history for<select value={preferences.retention_days} onChange={(event) => setPreferences({ ...preferences, retention_days: Number(event.target.value) })}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option><option value={3650}>10 years</option></select></label><footer><button onClick={savePreferences} disabled={busy}>Save retention settings</button></footer></section><section className="settings-card data-actions"><article><Database size={20} /><div><h3>Download account data</h3><p>Export your profile, preferences, workspace list, and usage summary as JSON.</p></div><button onClick={exportData}>Download</button></article><article><Trash2 size={20} /><div><h3>Clear activity and AI history</h3><p>Removes conversations, AI results, usage records, notifications, and activity you authored.</p></div><button className="danger" onClick={() => { const confirmation = window.prompt('Type "clear history" to continue'); if (confirmation) perform(async () => api("/profile/history", token, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation }) }), "Account history cleared."); }}>Clear history</button></article><article className="danger-zone"><Trash2 size={20} /><div><h3>Delete Groundwork account</h3><p>Permanently removes your account and stored files. This cannot be undone.</p></div><button className="danger" onClick={() => { const confirmation = window.prompt(`Type ${user.email} to permanently delete your account`); if (confirmation) perform(async () => { await api("/profile/account", token, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation }) }); onSignOut(); }); }}>Delete account</button></article></section></>}

          {tab === "usage" && <><Heading eyebrow="Usage" title="Account activity at a glance" detail="See the files, storage, AI requests, and background work attached to your account." /><div className="account-stats usage-cards">{stats && <><article><strong>{stats.document_count}</strong><span>Documents</span></article><article><strong>{stats.page_count}</strong><span>Pages indexed</span></article><article><strong>{stats.generated_files}</strong><span>Generated files</span></article><article className={stats.failed_jobs ? "warn" : ""}><strong>{stats.failed_jobs}</strong><span>Failed jobs</span></article></>}</div>{usage && <><section className="settings-card usage-storage"><div><h3>Storage</h3><strong>{(usage.storage_bytes / 1024 / 1024).toFixed(1)} MB of {(usage.storage_limit_bytes / 1024 / 1024 / 1024).toFixed(0)} GB</strong></div><div className="usage-bar"><i style={{ width: `${storagePercent}%` }} /></div><small>{storagePercent}% used</small></section><div className="settings-grid"><section className="settings-card"><h3>AI activity</h3><div className="metric-emphasis"><strong>{usage.ai_requests_30_days}</strong><span>requests in the last 30 days</span></div><div className="usage-breakdown">{Object.entries(usage.ai_requests_by_feature).sort((a, b) => b[1] - a[1]).map(([key, value]) => <p key={key}><span>{key.replaceAll("_", " ")}</span><strong>{value}</strong></p>)}{!Object.keys(usage.ai_requests_by_feature).length && <p>No AI activity yet.</p>}</div></section><section className="settings-card"><h3>Background jobs</h3><div className="usage-breakdown">{Object.entries(usage.jobs_by_status).map(([key, value]) => <p key={key}><span className={`job-state ${key}`}>{key}</span><strong>{value}</strong></p>)}{!Object.keys(usage.jobs_by_status).length && <p>No jobs yet.</p>}</div></section></div></>}</>}

          {tab === "team" && <><Heading eyebrow="Team" title="Workspace access" detail="Invite existing Groundwork users and control what they can change." /><section className="settings-card settings-form"><label>Workspace<select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}</select></label>{editableTeam && <form className="team-invite" onSubmit={inviteMember}><label>Member email<input name="email" type="email" placeholder="teammate@company.com" required /></label><label>Access<select name="role" defaultValue="editor"><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label><button disabled={busy}>Add member</button></form>}</section><section className="settings-card"><div className="settings-card-header"><div><h3>Members</h3><p>{members.length} people can access this workspace.</p></div></div><div className="settings-list team-list">{members.map((member) => <article key={member.id}><div className="member-avatar">{member.display_name.slice(0, 2).toUpperCase()}</div><span><strong>{member.display_name}{member.user_id === user.id ? " (you)" : ""}</strong><small>{member.email}</small></span>{member.role === "owner" || !editableTeam ? <b>{member.role}</b> : <><select value={member.role} onChange={(event) => perform(async () => { const updated = await api<WorkspaceMember>(`/workspaces/${workspaceId}/members/${member.id}`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: event.target.value }) }); setMembers((current) => current.map((item) => item.id === updated.id ? updated : item)); }, "Member access updated.")}><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button className="danger-link" onClick={() => { if (window.confirm(`Remove ${member.display_name} from this workspace?`)) perform(async () => { await api(`/workspaces/${workspaceId}/members/${member.id}`, token, { method: "DELETE" }); setMembers((current) => current.filter((item) => item.id !== member.id)); }, "Member removed."); }}>Remove</button></>}</article>)}</div></section></>}

          {tab === "admin" && user.role === "admin" && <><Heading eyebrow="Admin" title="User management" detail="Review account activity and disable access when necessary." /><section className="settings-card admin-users"><div className="settings-card-header"><div><h3>All users</h3><p>{admins.length} registered accounts</p></div></div>{admins.map((item) => <article key={item.id}><div className="member-avatar">{item.display_name.slice(0, 2).toUpperCase()}</div><div><strong>{item.display_name}</strong><span>{item.email} · {item.role}</span></div><small>{item.document_count} docs · {item.ai_requests} AI requests</small><button className={item.is_active ? "danger-link" : "enable"} disabled={item.id === user.id} onClick={() => perform(async () => { const updated = await api<AuthResult["user"]>(`/admin/users/${item.id}/status`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !item.is_active }) }); setAdmins((current) => current.map((value) => value.id === item.id ? { ...value, is_active: updated.is_active } : value)); }, `Account ${item.is_active ? "disabled" : "enabled"}.`)}>{item.id === user.id ? "Current user" : item.is_active ? "Disable" : "Enable"}</button></article>)}</section></>}
        </main>
      </div>
    </section>
  </div>;
}
