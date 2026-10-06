import { useEffect, useMemo, useState } from "react";
import { AppWindow, RefreshCw, Search } from "lucide-react";
import { api, type InstalledApp } from "../../services/api";

export function InstalledApps() {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<InstalledApp>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [launching, setLaunching] = useState(false);
  const [supported, setSupported] = useState(true);
  const load = async (refresh = false) => {
    setLoading(true); setError("");
    try {
      const result = await api.getInstalledApps(refresh);
      setApps(result.apps); setSupported(result.supported);
      setSelected(previous => result.apps.find(app => app.id === previous?.id) || result.apps[0]);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't read installed apps."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => apps.filter(app => `${app.name} ${app.publisher} ${app.description}`.toLowerCase().includes(query.toLowerCase().trim())), [apps, query]);
  useEffect(() => { setSelected(previous => filtered.find(app => app.id === previous?.id) || filtered[0]); }, [filtered]);
  const launch = async (app: InstalledApp) => {
    setLaunching(true); setError(""); setMessage("");
    try { await api.launchInstalledApp(app.id); setMessage(`Opened ${app.name}.`); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't launch this app."); }
    finally { setLaunching(false); }
  };
  const icon = (app: InstalledApp, size = 32) => app.icon
    ? <img src={app.icon} alt="" width={size} height={size} className="object-contain shrink-0" />
    : <AppWindow size={size} className="shrink-0 text-[var(--ink-secondary)]" aria-label="Windows did not provide an icon" />;
  return <section className="installed-apps" aria-label="Installed apps">
    <div className="flex items-center gap-2"><h2 className="font-semibold flex-1">Installed apps</h2><button className="gw-button" title="Refresh installed apps" aria-label="Refresh installed apps" disabled={loading} onClick={() => void load(true)}><RefreshCw size={14} /></button></div>
    <div className="flex items-center gap-2"><Search size={14} /><input className="gw-input" type="search" aria-label="Find installed apps" placeholder="Find an app or publisher…" value={query} onChange={e => setQuery(e.target.value)} /></div>
    {loading && <p role="status">Reading apps and icons from Windows…</p>}
    {error && <p role="alert" className="gw-notice">{error} <button onClick={() => void load(true)}>Retry</button></p>}
    {message && <p role="status">{message}</p>}
    {!supported && <p>Installed-app discovery is available on Windows.</p>}
    <div className="installed-app-list" role="listbox" aria-label="Applications">
      {filtered.map(app => <button key={app.id} role="option" aria-selected={selected?.id === app.id} className={`installed-app-row ${selected?.id === app.id ? "is-selected" : ""}`} onClick={() => setSelected(app)} onDoubleClick={() => !launching && void launch(app)} onKeyDown={e => { if (e.key === "Enter" && !launching) { e.preventDefault(); void launch(app); } }}>
        {icon(app)}<span className="min-w-0 text-left"><span className="block truncate">{app.name}</span><span className="block truncate text-[var(--ink-secondary)]">{app.publisher || app.kind}{app.version ? ` · ${app.version}` : ""}</span></span>
      </button>)}
      {!loading && supported && !filtered.length && <p className="p-3">{apps.length ? "No apps match your search." : "Windows reported no launchable apps."}</p>}
    </div>
    <p className="text-[var(--ink-secondary)]">{filtered.length} of {apps.length} apps · Double-click or press Enter to open</p>
    {selected && <div className="installed-app-details">
      <div className="flex items-center gap-3">{icon(selected, 48)}<div className="min-w-0 flex-1"><h3 className="font-semibold break-words">{selected.name}</h3><p>{selected.kind}</p></div><button className="gw-button" disabled={launching} onClick={() => void launch(selected)}>Open</button></div>
      <dl className="grid grid-cols-[70px_1fr] gap-1 mt-2">
        <dt>Publisher</dt><dd>{selected.publisher || "Not provided by Windows"}</dd>
        <dt>Version</dt><dd>{selected.version || "Not provided by Windows"}</dd>
        {selected.description && <><dt>About</dt><dd>{selected.description}</dd></>}
        {selected.location && <><dt>Location</dt><dd className="break-all">{selected.location}</dd></>}
      </dl>
      <details className="mt-2"><summary>App identifier</summary><p className="break-all select-text">{selected.id}</p></details>
    </div>}
  </section>;
}
