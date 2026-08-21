import { AlertTriangle, Bell, Check, CheckCircle2, Clock3, Info, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { Job, NotificationItem } from "../../types";
import { Button } from '../../components/ui/Button';

type Filter = "all" | "unread" | "attention";

function NotificationIcon({ severity }: { severity: NotificationItem["severity"] }) {
  if (severity === "error" || severity === "warning") return <AlertTriangle size={18} />;
  if (severity === "success") return <CheckCircle2 size={18} />;
  return <Info size={18} />;
}

export function NotificationCenter({ token, onClose, onUnread, onNavigate }: {
  token: string;
  onClose: () => void;
  onUnread: (count: number) => void;
  onNavigate: (action: string | null) => void;
}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [notifications, allJobs] = await Promise.all([
        api<NotificationItem[]>("/notifications?limit=100", token),
        api<Job[]>("/jobs", token),
      ]);
      setItems(notifications);
      setJobs(allJobs.filter((job) => ["queued", "running"].includes(job.status)));
      onUnread(notifications.filter((item) => !item.read_at).length);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load notifications"); }
  }, [onUnread, token]);

  useEffect(() => {
    const initial = window.setTimeout(load, 0);
    const timer = window.setInterval(load, 3000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);

  const visible = useMemo(() => items.filter((item) => {
    if (filter === "unread") return !item.read_at;
    if (filter === "attention") return ["error", "warning"].includes(item.severity);
    return true;
  }), [filter, items]);

  async function markRead(item: NotificationItem) {
    if (!item.read_at) {
      const updated = await api<NotificationItem>(`/notifications/${item.id}/read`, token, { method: "PATCH" });
      setItems((current) => current.map((value) => value.id === item.id ? updated : value));
      onUnread(Math.max(0, items.filter((value) => !value.read_at).length - 1));
    }
    onNavigate(item.action);
  }

  async function markAllRead() {
    await api("/notifications/read-all", token, { method: "POST" });
    const timestamp = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? timestamp })));
    onUnread(0);
  }

  async function remove(item: NotificationItem) {
    await api(`/notifications/${item.id}`, token, { method: "DELETE" });
    const remaining = items.filter((value) => value.id !== item.id);
    setItems(remaining); onUnread(remaining.filter((value) => !value.read_at).length);
  }

  const unread = items.filter((item) => !item.read_at).length;
  return <div className="notification-wrap"><Button className="history-backdrop" aria-label="Close notifications" onClick={onClose} /><section className="notification-panel" role="dialog" aria-label="Notifications">
    <header><div><span><Bell size={18} /></span><div><p>Activity center</p><h2>Notifications</h2></div></div><Button aria-label="Close notifications" onClick={onClose}><X size={19} /></Button></header>
    <div className="notification-summary"><span>{unread ? `${unread} unread update${unread === 1 ? "" : "s"}` : "You're all caught up"}</span>{unread > 0 && <Button onClick={() => markAllRead().catch((reason) => setError(reason.message))}><Check size={14} /> Mark all read</Button>}</div>
    {jobs.length > 0 && <section className="notification-live"><div className="notification-section-label"><span><i /> Live now</span><small>{jobs.length} active</small></div>{jobs.map((job) => <article key={job.id}><span className="live-job-icon"><RefreshCw className="spin" size={17} /></span><div><strong>{(job.operation ?? "Document processing").replaceAll("_", " ")}</strong><small>{job.status === "queued" ? "Waiting to start" : `Working · ${job.progress}%`}</small><div className="notification-progress"><i style={{ width: `${Math.max(4, job.progress)}%` }} /></div></div><b>{job.progress}%</b></article>)}</section>}
    <nav className="notification-filters"><Button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</Button><Button className={filter === "unread" ? "active" : ""} onClick={() => setFilter("unread")}>Unread {unread > 0 && <b>{unread}</b>}</Button><Button className={filter === "attention" ? "active" : ""} onClick={() => setFilter("attention")}>Needs attention</Button></nav>
    <main>{error && <div className="form-error">{error}</div>}{visible.map((item) => <article className={`notification-item ${item.severity} ${item.read_at ? "read" : "unread"}`} key={item.id}><Button className="notification-open" onClick={() => markRead(item).catch((reason) => setError(reason.message))}><span className="notification-item-icon"><NotificationIcon severity={item.severity} /></span><div><strong>{item.title}</strong><p>{item.message}</p><small><Clock3 size={12} /> {new Date(item.created_at).toLocaleString()}</small></div>{!item.read_at && <i className="unread-dot" />}</Button><Button className="notification-delete" aria-label={`Delete ${item.title}`} onClick={() => remove(item).catch((reason) => setError(reason.message))}><Trash2 size={14} /></Button></article>)}{!visible.length && <div className="notification-empty"><Bell size={27} /><h3>{filter === "unread" ? "No unread notifications" : filter === "attention" ? "Nothing needs attention" : "No notifications yet"}</h3><p>Processing updates, completed exports, reviews, and team activity will appear here.</p></div>}</main>
  </section></div>;
}
