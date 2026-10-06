import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronRight, Copy, File, Folder, FolderOpen, FolderPlus, HardDrive, RefreshCw, Search, X, Filter, PanelLeft, Clock, ListTree, ExternalLink, Sparkles, Wand2, Files } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { api } from "../../services/api";
import { useSelection } from "../../services/selection";
import type { IndexProgress, InventoryItem, InventoryResult, Project, StorageCategory, Workspace } from "../../types/api";
import { categoryColors, formatBytes } from "./StorageCategoryStrip";
import { AddFolderDialog } from "./FoldersView";
import { StorageInsightsModal } from "./StorageInsightsModal";
import { Modal } from "../ui";

type Location = { workspace: string; path: string };
type Branch = { items: InventoryItem[]; total: number; loading?: boolean; error?: string };
type FileRow = { item: InventoryItem; depth: number; parentBytes: number };
const pageSize = 200;
const branchKey = (workspace: string, path: string) => `${workspace}\n${path}`;
const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
const inside = (path: string, root: string) => samePath(path, root) || path.toLowerCase().startsWith(root.replace(/[\\/]+$/, "").toLowerCase() + (root.includes("\\") ? "\\" : "/"));
const displayShare = (bytes: number, total: number) => {
  const share = total > 0 ? Math.min(100, bytes / total * 100) : 0;
  return share > 0 && share < 0.1 ? "<0.1%" : `${share.toFixed(1)}%`;
};

export function ExplorerWorkspace() {
  const { selected, setSelected, navigate } = useSelection();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [location, setLocation] = useState<Location | null>(null);
  const [ready, setReady] = useState(false);
  const [indexProgress, setIndexProgress] = useState<IndexProgress>();
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const value = await api.getIndexProgress(); if(active) setIndexProgress(value); }
      catch { /* Connection recovery is already shown by the workspace. */ }
      finally { if(active) timer = setTimeout(poll, 3000); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"folder" | "location" | "all">("folder");
  const [category, setCategory] = useState<StorageCategory | "">("");
  const [extension, setExtension] = useState("");
  const [allFiles, setAllFiles] = useState(false);
  const [recent, setRecent] = useState(false);
  const [sort, setSort] = useState("size");
  const [descending, setDescending] = useState(true);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<InventoryResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [adding, setAdding] = useState(false);
  const [duplicates, setDuplicates] = useState(false);
  const [focused, setFocused] = useState<InventoryItem>();
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof api.fileStorage>>>();
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    let current = true;
    setStorage(undefined); setStorageError("");
    if (focused?.kind === "file") {
      api.fileStorage(focused.path).then(value => { if(current) setStorage(value); })
        .catch(error => { if(current) setStorageError(error.message); });
    }
    return () => { current = false; };
  }, [focused?.path, focused?.mtime, data?.updated_at]);
  const [context, setContext] = useState<{ x: number; y: number; item: InventoryItem }>();
  const [treeOpen, setTreeOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const [rowExpanded, setRowExpanded] = useState<Set<string>>(new Set());
  const [rowBranches, setRowBranches] = useState<Record<string, Branch>>({});
  const [history, setHistory] = useState<Location[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<Workspace>();
  const [treeWidth, setTreeWidth] = useState(200);
  const [detailsWidth, setDetailsWidth] = useState(230);
  const searchInput = useRef<HTMLInputElement>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | undefined>(undefined);
  const branchesRef = useRef(branches);
  const treeInitialized = useRef(false);
  branchesRef.current = branches;
  const workspace = workspaces.find((item) => item.id === location?.workspace);
  const filtered = !!(query || category || extension || recent || allFiles || searchScope !== "folder");

  const refreshLocations = useCallback(async () => {
    try {
      const values = await api.listWorkspaces();
      setWorkspaces(values);
      setLocation((previous) => {
        if (previous && values.some((item) => item.id === previous.workspace)) return previous;
        let saved: Location | undefined;
        try { saved = JSON.parse(localStorage.getItem("groundwork-explorer-location") || "null"); } catch { /* use first location */ }
        const match = values.find((item) => item.id === saved?.workspace);
        return match && saved && inside(saved.path, match.path) ? saved : values[0] ? {workspace: values[0].id, path: values[0].path} : null;
      });
      const projectValues = await api.listProjects();
      setProjects(projectValues);
      setError("");
    } catch { setError("Local service unavailable. Retry connection."); }
    finally { setReady(true); }
  }, []);

  useEffect(() => { void refreshLocations(); const timer = setInterval(refreshLocations, 10000); return () => clearInterval(timer); }, [refreshLocations]);
  useEffect(() => {
    if (location) localStorage.setItem("groundwork-explorer-location", JSON.stringify(location));
  }, [location]);
  useEffect(() => {
    const focus = () => { searchInput.current?.focus(); searchInput.current?.select(); };
    window.addEventListener("groundwork-focus-search", focus);
    return () => window.removeEventListener("groundwork-focus-search", focus);
  }, []);
  useEffect(() => {
    const close = () => setContext(undefined);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!context) return;
    const previous = document.activeElement as HTMLElement | null;
    menuElement.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [context]);
  useEffect(() => {
    setOffset(0); setRowExpanded(new Set()); setRowBranches({}); setFocused(undefined);
  }, [location?.workspace, location?.path, query, category, extension, recent, allFiles, searchScope, sort, descending]);

  useEffect(() => {
    if (!location) return;
    let active = true;
    let inFlight = false;
    setLoading(true);
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const values = {
          parent: searchScope === "location" ? workspace?.path : location.path, query: query.trim(), category, extension, recursive: String(filtered),
          kind: filtered ? "file" : undefined, modified_after: recent ? String(Date.now() / 1000 - 7 * 86400) : undefined,
          sort, descending: String(descending), offset: String(offset), limit: String(pageSize),
        };
        const result = searchScope === "all" ? await api.browseAllInventory(values) : await api.browseInventory(location.workspace, values);
        if (active) { setData(result); setError(""); }
      } catch { if (active) setError("Couldn't read this location. Retry or select another folder."); }
      finally { inFlight = false; if (active) setLoading(false); }
    };
    const initial = setTimeout(load, query ? 120 : 0);
    const timer = setInterval(load, 3000);
    return () => { active = false; clearTimeout(initial); clearInterval(timer); };
  }, [location?.workspace, location?.path, workspace?.path, query, category, extension, recent, allFiles, searchScope, filtered, sort, descending, offset, revision]);

  const loadBranch = useCallback(async (ws: string, path: string, more = false) => {
    const key = branchKey(ws, path);
    const previous = branchesRef.current[key];
    if (previous?.loading || (!more && previous && !previous.error)) return;
    setBranches((value) => ({...value, [key]: {items: previous?.items ?? [], total: previous?.total ?? 0, loading: true}}));
    try {
      const result = await api.browseInventory(ws, {parent: path, kind: "folder", sort: "name", limit: "200", offset: String(more ? previous?.items.length ?? 0 : 0)});
      setBranches((value) => ({...value, [key]: {items: more ? [...(previous?.items ?? []), ...result.items] : result.items, total: result.total}}));
    } catch { setBranches((value) => ({...value, [key]: {items: previous?.items ?? [], total: previous?.total ?? 0, error: "Couldn't load folders. Retry"}})); }
  }, []);

  const go = (next: Location, record = true) => {
    if (record && location && (!samePath(next.path, location.path) || next.workspace !== location.workspace)) {
      const previous = historyIndex < 0 ? [location] : history.slice(0, historyIndex + 1);
      setHistory([...previous, next]); setHistoryIndex(previous.length);
    }
    setLocation(next); setSearchScope("folder"); setOffset(0); setContext(undefined);
    const ws = workspaces.find((item) => item.id === next.workspace);
    if (ws) {
      const separator = ws.path.includes("\\") ? "\\" : "/";
      const segments = next.path.slice(ws.path.length).split(/[\\/]/).filter(Boolean);
      const ancestors = [ws.path, ...segments.map((_, index) => ws.path.replace(/[\\/]$/, "") + separator + segments.slice(0, index + 1).join(separator))];
      setExpanded((value) => new Set([...value, ...ancestors.map((path) => branchKey(ws.id, path))]));
      ancestors.forEach((path) => void loadBranch(ws.id, path));
    }
  };
  const toggleTree = (ws: string, path: string) => {
    const key = branchKey(ws, path);
    setExpanded((previous) => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    void loadBranch(ws, path);
  };
  useEffect(() => {
    if (location && workspace && !treeInitialized.current) {
      treeInitialized.current = true;
      const separator = workspace.path.includes("\\") ? "\\" : "/";
      const segments = location.path.slice(workspace.path.length).split(/[\\/]/).filter(Boolean);
      const ancestors = [workspace.path, ...segments.map((_, index) => workspace.path.replace(/[\\/]$/, "") + separator + segments.slice(0, index + 1).join(separator))];
      setExpanded(new Set(ancestors.map((path) => branchKey(workspace.id, path))));
      ancestors.forEach((path) => void loadBranch(workspace.id, path));
    }
  }, [location, workspace, loadBranch]);

  const addLocation = async () => {
    if (!isTauri()) { setAdding(true); return; }
    setBusy(true);
    try {
      const path = await api.pickWorkspaceFolder();
      if (path) {
        const existing = workspaces.find((item) => samePath(item.path, path));
        const added = existing ?? await api.createWorkspace(path.replace(/[\\/]$/, "").split(/[\\/]/).pop() || path, path);
        await refreshLocations(); go({workspace: added.id, path: added.path});
        setNotice(existing ? "Opened existing location" : "Location added. Scanning starts automatically.");
      }
    } catch { setError("Couldn't add this location. Try Choose folder again."); }
    finally { setBusy(false); }
  };
  const scan = async () => {
    if (!workspace) return;
    setBusy(true);
    try { await api.startIndexing(workspace.id); setNotice("Scan started. Results update automatically."); setBranches({}); setRowBranches({}); setRevision((value) => value + 1); }
    catch { setError("Couldn't start scanning. Retry connection."); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!location) return;
    // Refresh expanded branches when a scan finishes; never load the whole tree.
    setBranches({}); branchesRef.current = {};
    expanded.forEach((key) => { const split = key.indexOf("\n"); void loadBranch(key.slice(0, split), key.slice(split + 1)); });
    setRowBranches({}); setRowExpanded(new Set());
  }, [data?.updated_at, data?.scan_status, revision, loadBranch]);
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest("[role=dialog]")) return;
      if (event.key === "F5") { event.preventDefault(); void scan(); }
      if (event.altKey && event.key === "ArrowLeft" && historyIndex > 0) { event.preventDefault(); setHistoryIndex(historyIndex - 1); go(history[historyIndex - 1], false); }
      if (event.altKey && event.key === "ArrowRight" && historyIndex >= 0 && historyIndex < history.length - 1) { event.preventDefault(); setHistoryIndex(historyIndex + 1); go(history[historyIndex + 1], false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const clearFilters = () => { setQuery(""); setCategory(""); setExtension(""); setRecent(false); setAllFiles(false); };
  const resizePane = (event: PointerEvent<HTMLDivElement>, pane: "tree" | "details") => {
    const start = event.clientX, width = pane === "tree" ? treeWidth : detailsWidth;
    event.currentTarget.setPointerCapture(event.pointerId);
    const target = event.currentTarget;
    const move = (next: globalThis.PointerEvent) => {
      const value = Math.min(450, Math.max(pane === "tree" ? 120 : 180, width + (next.clientX - start) * (pane === "tree" ? 1 : -1)));
      if (pane === "tree") setTreeWidth(value); else setDetailsWidth(value);
    };
    const end = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", end); target.removeEventListener("pointercancel", end); };
    target.addEventListener("pointermove", move); target.addEventListener("pointerup", end); target.addEventListener("pointercancel", end);
  };
  const open = async (item: InventoryItem, reveal = false) => {
    try { const result = await (reveal ? api.revealFile(item.path) : item.kind === "folder" ? api.openFolder(item.path) : api.openFile(item.path)); if (!result.success) setError("Couldn't open this item. Try Show in Explorer."); }
    catch { setError("Couldn't open this item. Try Show in Explorer."); }
  };
  const copyPath = async (path: string) => {
    try { await navigator.clipboard.writeText(path); setNotice("Path copied"); }
    catch { setError("Couldn't copy the path. Select it in the details pane instead."); }
  };
  const toggleRow = async (item: InventoryItem, more = false) => {
    if (!location) return;
    if (!more) setRowExpanded((previous) => { const next = new Set(previous); if (next.has(item.path)) next.delete(item.path); else next.add(item.path); return next; });
    const previous = rowBranches[item.path];
    if (previous?.loading || (!more && previous && !previous.error)) return;
    setRowBranches((value) => ({...value, [item.path]: {items: previous?.items ?? [], total: previous?.total ?? 0, loading: true}}));
    try {
      const result = await api.browseInventory(location.workspace, {parent: item.path, sort, descending: String(descending), limit: "200", offset: String(more ? previous?.items.length ?? 0 : 0)});
      setRowBranches((value) => ({...value, [item.path]: {items: more ? [...(previous?.items ?? []), ...result.items] : result.items, total: result.total}}));
    } catch { setRowBranches((value) => ({...value, [item.path]: {items: previous?.items ?? [], total: previous?.total ?? 0, error: "Couldn't read this folder. Retry"}})); }
  };
  const rows: FileRow[] = [];
  const appendRows = (items: InventoryItem[], depth: number, parentBytes: number) => {
    for (const item of items) { rows.push({item, depth, parentBytes: filtered ? item.parent_size_bytes ?? parentBytes : parentBytes}); if (!filtered && rowExpanded.has(item.path)) appendRows(rowBranches[item.path]?.items ?? [], depth + 1, item.size_bytes); }
  };
  appendRows(data?.items ?? [], 0, data?.parent_bytes ?? 0);
  const chooseRow = (item: InventoryItem, event: MouseEvent | KeyboardEvent) => {
    if (loading) return;
    setFocused(item);
    if (item.kind !== "file") { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) setSelected([]); return; }
    if (event.shiftKey && anchor.current) {
      const first = rows.findIndex((row) => row.item.path === anchor.current);
      const last = rows.findIndex((row) => row.item.path === item.path);
      if (first >= 0 && last >= 0) { const range = rows.slice(Math.min(first, last), Math.max(first, last) + 1).filter((row) => row.item.kind === "file").map((row) => row.item.path); setSelected(event.ctrlKey ? [...new Set([...selected, ...range])] : range); return; }
    }
    anchor.current = item.path;
    setSelected(event.ctrlKey || event.metaKey ? selected.includes(item.path) ? selected.filter((path) => path !== item.path) : [...selected, item.path] : [item.path]);
  };
  const rowKey = (event: KeyboardEvent<HTMLTableRowElement>, row: FileRow, index: number) => {
    if (loading) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) { chooseRow(next.item, event); const elements = event.currentTarget.parentElement?.querySelectorAll<HTMLTableRowElement>("tr[data-file-row]"); elements?.[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus(); }
    } else if (event.key === "ArrowRight" && row.item.kind === "folder" && !rowExpanded.has(row.item.path)) { event.preventDefault(); void toggleRow(row.item); }
    else if (event.key === "ArrowLeft" && rowExpanded.has(row.item.path)) { event.preventDefault(); void toggleRow(row.item); }
    else if (event.key === "Enter") { event.preventDefault(); if (row.item.kind === "folder" && location) go({workspace: row.item.workspace_id ?? location.workspace, path: row.item.path}); else void open(row.item); }
    else if (event.key === " ") { event.preventDefault(); chooseRow(row.item, event); }
    else if (event.shiftKey && event.key === "F10") { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setContext({x: Math.min(box.left + 40, window.innerWidth - 210), y: Math.min(box.top, window.innerHeight - 280), item: row.item}); }
  };
  const renderTree = (ws: Workspace, path: string, name: string, depth: number) => {
    const key = branchKey(ws.id, path), branch = branches[key], isExpanded = expanded.has(key);
    return <div key={key} role="treeitem" aria-level={depth + 1} aria-expanded={isExpanded} aria-selected={location?.workspace === ws.id && samePath(location.path, path)}>
      <div className={`explorer-tree-row ${location?.workspace === ws.id && samePath(location.path, path) ? "is-current" : ""}`} style={{paddingLeft: 5 + depth * 14}}>
        <button tabIndex={-1} className="explorer-expander" aria-label={`${isExpanded ? "Collapse" : "Expand"} ${name}`} onClick={() => toggleTree(ws.id, path)}>{isExpanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</button>
        <button className="explorer-tree-label" title={path} onClick={() => go({workspace: ws.id, path})} onContextMenu={(event) => {
          event.preventDefault(); setContext({x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 315), item: {workspace_id: ws.id, path, parent: path, name, kind: "folder", extension: "", category: "", size_bytes: 0, mtime: 0}});
        }} onKeyDown={(event) => {
          if (event.key === "ArrowRight" && !isExpanded || event.key === "ArrowLeft" && isExpanded) { event.preventDefault(); toggleTree(ws.id, path); }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const nodes = Array.from(event.currentTarget.closest('[role="tree"]')?.querySelectorAll<HTMLButtonElement>(".explorer-tree-label") ?? []);
            const index = nodes.indexOf(event.currentTarget);
            const next = nodes[index + (event.key === "ArrowDown" ? 1 : -1)];
            if (next) { next.focus(); next.click(); }
          }
        }}>{depth === 0 ? <HardDrive size={14}/> : isExpanded ? <FolderOpen size={14}/> : <Folder size={14}/>}<span>{name}</span></button>
      </div>
      {isExpanded && <div role="group">
        {branch?.items.map((item) => renderTree(ws, item.path, item.name, depth + 1))}
        {branch?.loading && <p className="explorer-tree-note">Loading…</p>}
        {branch?.error && <button className="explorer-tree-note" onClick={() => void loadBranch(ws.id, path)}>{branch.error}</button>}
        {branch && branch.items.length < branch.total && !branch.loading && <button className="explorer-tree-note" onClick={() => void loadBranch(ws.id, path, true)}>More folders ({branch.total - branch.items.length})</button>}
      </div>}
    </div>;
  };
  const crumbs = workspace && location ? [{name: workspace.name, path: workspace.path}, ...location.path.slice(workspace.path.length).split(/[\\/]/).filter(Boolean).map((name, index, parts) => ({name, path: workspace.path.replace(/[\\/]$/, "") + (workspace.path.includes("\\") ? "\\" : "/") + parts.slice(0, index + 1).join(workspace.path.includes("\\") ? "\\" : "/")}))] : [];
  const categories = data?.category_breakdown ?? [];
  const setOrder = (value: string) => { if (sort === value) setDescending(!descending); else { setSort(value); setDescending(value !== "name" && value !== "type"); } };
  const commandTarget = context?.item ?? focused;

  return <section className="explorer" aria-label="Files and storage workspace">
    <div className="explorer-toolbar">
      <button onClick={() => void addLocation()} disabled={busy}><FolderPlus size={15}/>Choose folder</button>
      <select aria-label="Current location" value={workspace?.id ?? ""} onChange={(event) => { const ws = workspaces.find((item) => item.id === event.target.value); if (ws) go({workspace: ws.id, path: ws.path}); }}>
        {!workspaces.length && <option value="">No locations added</option>}{workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name} — {ws.path}</option>)}
      </select>
      <button disabled={!workspace || busy} onClick={() => void scan()} title="Refresh inventory (F5)"><RefreshCw size={14}/>Scan</button>
      {data?.scan_status === "scanning" && <button onClick={() => api.cancelIndexing().then(() => setNotice("Scan cancelled. Cached files remain available.")).catch(() => setError("Couldn't cancel the scan."))}>Stop scan</button>}
      <span className="explorer-separator"/>
      <button disabled={!focused} onClick={() => focused && void open(focused, true)}><ExternalLink size={14}/>Explorer</button>
      <button disabled={!selected.length} onClick={() => navigate("assistant")}><Sparkles size={14}/>Ask</button>
      <button disabled={!selected.length} onClick={() => navigate("organize")}><Wand2 size={14}/>Organize</button>
      <button disabled={!workspace} onClick={() => setDuplicates(true)}><Files size={14}/>Duplicates</button>
      <button title="Search inside indexed text and documents (Ctrl+Shift+F)" onClick={() => window.dispatchEvent(new CustomEvent("groundwork-content-search", {detail: query}))}><Search size={14}/>Contents</button>
    </div>
    <div className="explorer-address">
      <button title="Back (Alt+Left)" aria-label="Back" disabled={historyIndex <= 0} onClick={() => { setHistoryIndex(historyIndex - 1); go(history[historyIndex - 1], false); }}><ArrowLeft size={15}/></button>
      <button title="Forward (Alt+Right)" aria-label="Forward" disabled={historyIndex < 0 || historyIndex >= history.length - 1} onClick={() => { setHistoryIndex(historyIndex + 1); go(history[historyIndex + 1], false); }}><ArrowRight size={15}/></button>
      <button title="Up one folder" aria-label="Up one folder" disabled={!workspace || !location || samePath(location.path, workspace.path)} onClick={() => { if (workspace && location) { const cut = Math.max(location.path.lastIndexOf("\\"), location.path.lastIndexOf("/")); go({...location, path: cut < workspace.path.length ? workspace.path : location.path.slice(0, cut)}); } }}><ArrowUp size={15}/></button>
      <nav aria-label="Folder breadcrumbs">{crumbs.map((crumb, index) => <span key={crumb.path}>{index > 0 && <ChevronRight size={11}/>}<button aria-current={index === crumbs.length - 1 ? "location" : undefined} title={crumb.path} onClick={() => location && go({...location, path: crumb.path})}>{crumb.name}</button></span>)}</nav>
      <button title="Copy current folder path" aria-label="Copy current folder path" disabled={!location} onClick={() => location && void copyPath(location.path)}><Copy size={13}/></button>
    </div>
    <div className="explorer-searchbar">
      <Search size={15}/><input ref={searchInput} aria-label="Live file search" placeholder="Search this folder and subfolders · name, path, or *.pdf" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") clearFilters(); }}/>
      <select aria-label="Search scope" value={searchScope} onChange={(event) => setSearchScope(event.target.value as typeof searchScope)}><option value="folder">This folder</option><option value="location">Entire location</option><option value="all">All locations</option></select>
      {query && <button aria-label="Clear search" onClick={() => setQuery("")}><X size={13}/></button>}
      <button aria-pressed={allFiles} title="Show files from this folder and every subfolder" onClick={() => setAllFiles(!allFiles)}><ListTree size={14}/>All descendants</button>
      <button aria-pressed={recent} title="Files changed within the last 7 days" onClick={() => { setRecent(!recent); setSort("modified"); setDescending(true); }}><Clock size={14}/>Recent</button>
      <button title="Largest files throughout the current folder" onClick={() => { setAllFiles(true); setSort("size"); setDescending(true); }}>Largest files</button>
      <button aria-label="Toggle folder tree" aria-pressed={treeOpen} onClick={() => setTreeOpen(!treeOpen)}><PanelLeft size={15}/></button>
    </div>
    {(category || extension || recent || allFiles) && <div className="explorer-filters"><Filter size={12}/>
      {category && <button onClick={() => setCategory("")}>{categories.find((item) => item.category === category)?.label ?? category}<X size={11}/></button>}
      {extension && <button onClick={() => setExtension("")}>{extension}<X size={11}/></button>}
      {recent && <button onClick={() => setRecent(false)}>Last 7 days<X size={11}/></button>}
      {allFiles && <button onClick={() => setAllFiles(false)}>All descendants<X size={11}/></button>}
      <button onClick={clearFilters}>Clear filters</button><span>{searchScope === "all" ? "All added locations" : `Within ${searchScope === "location" ? workspace?.name : crumbs.at(-1)?.name ?? "selected folder"}`}</span>
    </div>}
    {error && <div className="explorer-error" role="alert">{error}<button onClick={() => { void refreshLocations(); setRevision((value) => value + 1); }}>Retry</button></div>}
    <div className="explorer-panes">
      {treeOpen && <aside className="explorer-tree" aria-label="Folder navigation" style={{width: treeWidth}}>
        <div className="explorer-pane-title">Folders & projects</div>
        <div className="explorer-tree-scroll" role="tree" aria-label="Folder tree">{workspaces.map((ws) => renderTree(ws, ws.path, ws.name, 0))}
          {!workspaces.length && ready && <button className="explorer-empty-action" onClick={() => void addLocation()}><FolderPlus size={20}/>Choose a folder or drive</button>}
        </div>
        {!!projects.length && <div className="explorer-projects"><div className="explorer-pane-title">Detected projects</div>{projects.map((project) => <button key={project.id} title={project.path} onClick={() => go({workspace: project.workspace_id, path: project.path})}><Folder size={13}/>{project.name}<small>{project.detected_type}</small></button>)}</div>}
        <div className="explorer-tree-footer"><button onClick={() => void addLocation()}><FolderPlus size={13}/>Add location</button></div>
      </aside>}
      {treeOpen && <div className="explorer-splitter" role="separator" tabIndex={0} aria-label="Resize folder pane" aria-orientation="vertical" aria-valuemin={120} aria-valuemax={450} aria-valuenow={treeWidth} onPointerDown={(event) => resizePane(event, "tree")} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setTreeWidth(Math.min(450, Math.max(120, treeWidth + (event.key === "ArrowRight" ? 20 : -20)))); } }}/>}
      <div className="explorer-file-pane">
        <div className="explorer-pane-title"><span>{filtered ? "Matching files" : "Directory tree"}</span><span>{data?.total.toLocaleString() ?? 0} items{loading ? " · Updating…" : ""}</span></div>
        <div className="explorer-table-scroll" onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); setSelected(rows.filter((row) => row.item.kind === "file").map((row) => row.item.path)); }
        }}>
          <table className={`explorer-table ${loading ? "is-updating" : ""}`} aria-busy={loading} aria-label="File tree and search results"><thead><tr>
            <th className="explorer-name-col" aria-sort={sort === "name" ? descending ? "descending" : "ascending" : "none"}><button onClick={() => setOrder("name")}>Name{sort === "name" && (descending ? " ▾" : " ▴")}</button></th>
            <th aria-sort={sort === "size" ? descending ? "descending" : "ascending" : "none"}><button onClick={() => setOrder("size")}>Size{sort === "size" && (descending ? " ▾" : " ▴")}</button></th>
            <th>Parent %</th><th>Files</th><th aria-sort={sort === "type" ? descending ? "descending" : "ascending" : "none"}><button onClick={() => setOrder("type")}>Type{sort === "type" && (descending ? " ▾" : " ▴")}</button></th>
            <th aria-sort={sort === "modified" ? descending ? "descending" : "ascending" : "none"}><button onClick={() => setOrder("modified")}>Modified{sort === "modified" && (descending ? " ▾" : " ▴")}</button></th>
          </tr></thead><tbody>
            {rows.map((row, index) => { const {item, depth, parentBytes} = row; const share = parentBytes > 0 ? Math.min(100, item.size_bytes / parentBytes * 100) : 0; const expandedRow = rowExpanded.has(item.path); const branch = rowBranches[item.path];
              return <tr key={`${item.workspace_id ?? location?.workspace}:${item.path}`} data-file-row tabIndex={focused?.path === item.path || !focused && index === 0 ? 0 : -1} aria-selected={selected.includes(item.path) || focused?.path === item.path}
                className={selected.includes(item.path) || focused?.path === item.path ? "is-selected" : ""}
                onClick={(event) => chooseRow(item, event)} onDoubleClick={() => item.kind === "folder" && location ? go({workspace: item.workspace_id ?? location.workspace, path: item.path}) : void open(item)}
                onKeyDown={(event) => rowKey(event, row, index)} onContextMenu={(event) => { event.preventDefault(); setFocused(item); if (item.kind === "file" && !selected.includes(item.path)) setSelected([item.path]); setContext({x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 285), item}); }}>
                <td title={item.path}><div className="explorer-file-name" style={{paddingLeft: depth * 16}}>
                  {item.kind === "folder" && !filtered ? <button className="explorer-expander" aria-label={`${expandedRow ? "Collapse" : "Expand"} ${item.name} in table`} onClick={(event) => { event.stopPropagation(); void toggleRow(item); }}>{expandedRow ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</button> : <span className="explorer-expander"/>}
                  {item.kind === "folder" ? <Folder size={14} className="explorer-folder-icon"/> : <File size={13} style={{color: categoryColors[item.category || "other"]}}/>}
                  <span>{item.name}</span>{branch?.loading && <small>…</small>}
                  {branch?.error && <button onClick={(event) => { event.stopPropagation(); void toggleRow(item); }} title={branch.error}>Retry</button>}
                  {expandedRow && branch && !branch.loading && branch.items.length < branch.total && <button onClick={(event) => { event.stopPropagation(); void toggleRow(item, true); }}>Load more ({branch.total - branch.items.length})</button>}
                </div>{filtered && <small className="explorer-result-path">{item.parent}</small>}</td>
                <td className="explorer-number">{formatBytes(item.size_bytes)}</td>
                <td><div className="explorer-share"><div><i style={{width: `${share}%`, minWidth: item.size_bytes ? 2 : 0, backgroundColor: item.kind === "folder" ? "var(--ink-blue)" : categoryColors[item.category || "other"]}}/></div><span>{displayShare(item.size_bytes, parentBytes)}</span></div></td>
                <td className="explorer-number">{item.kind === "folder" ? (item.file_count ?? 0).toLocaleString() : "1"}</td>
                <td>{item.kind === "folder" ? "Folder" : item.extension ? <button title={`Find ${item.extension} files within this folder`} onClick={(event) => { event.stopPropagation(); setCategory(""); setExtension(extension === item.extension ? "" : item.extension); }}>{item.extension}</button> : "File"}</td>
                <td className="explorer-date">{new Date(item.mtime * 1000).toLocaleString(undefined, {year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"})}</td>
              </tr>;
            })}
          </tbody></table>
          {loading && !rows.length && <div className="explorer-empty" role="status">Updating files…</div>}
          {!loading && !rows.length && <div className="explorer-empty">{!ready ? "Connecting to local service…" : !workspace ? <><FolderOpen size={32}/><strong>Your files, in one workspace</strong><span>Choose a folder or drive. Scanning and search start automatically.</span><button onClick={() => void addLocation()}>Choose folder</button></> : filtered ? <><Search size={24}/><strong>No matches in {crumbs.at(-1)?.name}</strong><span>Click another folder to search there, or clear your filters.</span><button onClick={clearFilters}>Clear filters</button></> : <><Folder size={24}/><strong>No inventoried items here</strong><span>{data?.scan_status === "scanning" ? "Files will appear as the scan progresses." : "Scan to refresh this folder."}</span><button onClick={() => void scan()}>Scan location</button></>}</div>}
        </div>
        <div className="explorer-file-footer"><span>{selected.length} selected{focused ? ` · ${focused.name}` : " · Click to select · Double-click to open · Right-click for actions"}</span>
          {!!data && data.total > pageSize && <div><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</button><span>{offset + 1}–{Math.min(offset + pageSize, data.total)} / {data.total.toLocaleString()}</span><button disabled={offset + pageSize >= data.total} onClick={() => setOffset(offset + pageSize)}>Next</button></div>}
        </div>
      </div>
      <div className="explorer-splitter explorer-details-splitter" role="separator" tabIndex={0} aria-label="Resize details pane" aria-orientation="vertical" aria-valuemin={180} aria-valuemax={450} aria-valuenow={detailsWidth} onPointerDown={(event) => resizePane(event, "details")} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setDetailsWidth(Math.min(450, Math.max(180, detailsWidth + (event.key === "ArrowLeft" ? 20 : -20)))); } }}/>
      <aside className="explorer-inspector" aria-label="Storage and selection details" style={{width: detailsWidth}}>
        <div className="explorer-pane-title" title="Logical file sizes. Allocated disk space can differ; each hard-linked pathname contributes to folder totals.">Storage by type · logical</div><p className="explorer-inspector-caption">{searchScope === "all" ? "All added locations" : workspace?.name ?? "No location"} · all subfolders</p>
        <div className="explorer-category-strip">{categories.filter((item) => item.size_bytes > 0).map((item) => <button key={item.category} title={`${item.label}: ${formatBytes(item.size_bytes)} · ${item.percentage.toFixed(1)}%`} aria-label={`Filter ${item.label}`} style={{width: `${item.percentage}%`, backgroundColor: categoryColors[item.category]}} onClick={() => { setExtension(""); setCategory(category === item.category ? "" : item.category); }}/>)}</div>
        <table className="explorer-category-table"><thead><tr><th>Category</th><th>Size</th><th>Files</th></tr></thead><tbody>{categories.map((item) => <tr key={item.category} className={category === item.category ? "is-selected" : ""}><td><button aria-pressed={category === item.category} onClick={() => { setExtension(""); setCategory(category === item.category ? "" : item.category); }}><i style={{backgroundColor: categoryColors[item.category]}}/>{item.label}{category === item.category && <X size={10}/>}</button></td><td>{formatBytes(item.size_bytes)}</td><td>{item.file_count.toLocaleString()}</td></tr>)}</tbody></table>
        <div className="explorer-summary"><span>{data?.files.toLocaleString() ?? 0} files</span><strong>{formatBytes(data?.bytes ?? 0)}</strong></div>
        {data?.scan_status && data.scan_status !== "completed" && <p className="explorer-inspector-caption">{data.scan_status === "scanning" ? "Scanning · totals are provisional" : "Partial or cached inventory"}</p>}
        <div className="explorer-pane-title">Selection details</div>
        {focused ? <div className="explorer-details"><strong>{focused.name}</strong><p className="explorer-selectable-path">{focused.path}</p><dl><dt>Size</dt><dd>{formatBytes(focused.size_bytes)}</dd>{focused.kind === "file" && <><dt>Allocated</dt><dd title={storage?.allocation_note}>{storage ? storage.allocated_bytes === null ? "Unavailable" : formatBytes(storage.allocated_bytes) : storageError ? "Unavailable" : "Reading…"}</dd><dt>Hard links</dt><dd>{storage?.hard_links ?? "—"}</dd></>}<dt>Type</dt><dd>{focused.kind === "folder" ? "Folder" : focused.extension || "File"}</dd><dt>Modified</dt><dd>{new Date(focused.mtime * 1000).toLocaleString()}</dd>{focused.kind === "folder" && <><dt>Files</dt><dd>{(focused.file_count ?? 0).toLocaleString()}</dd></>}</dl>
          {focused.kind === "file" && <p className="explorer-inspector-caption">{storageError || storage?.allocation_note}</p>}
          <button onClick={() => void open(focused)}><ExternalLink size={13}/>Open</button><button onClick={() => void open(focused, true)}><FolderOpen size={13}/>Show in Explorer</button><button onClick={() => void copyPath(focused.path)}><Copy size={13}/>Copy path</button>
          <button onClick={() => location && go({workspace: focused.workspace_id ?? location.workspace, path: focused.kind === "folder" ? focused.path : focused.parent})}><Search size={13}/>Search in this folder</button>
          {focused.extension && <button onClick={() => { setCategory(""); setExtension(focused.extension); }}><Filter size={13}/>Find same file type</button>}
        </div> : <p className="explorer-inspector-caption">Select a row to inspect it. Ctrl-click or Shift-click to select multiple files. Click a category or file type to find matching files.</p>}
        {selected.length > 0 && <div className="explorer-details"><strong>{selected.length} selected files</strong><button onClick={() => navigate("assistant")}><Sparkles size={13}/>Ask about selection</button><button onClick={() => navigate("organize")}><Wand2 size={13}/>Organize selection</button><button onClick={() => setSelected([])}>Clear selection</button></div>}
      </aside>
    </div>
    <footer className="explorer-status" role="status">
      <span className={`explorer-status-dot ${data?.scan_status === "scanning" || indexProgress?.status === "indexing" ? "is-scanning" : ""}`}/>
      <span>{data?.scan_status === "scanning" ? "Scanning" : indexProgress?.status === "indexing" ? "Preparing contents" : data?.scan_status === "completed" ? "Ready" : data?.scan_status?.replaceAll("_", " ") || (ready ? "Ready" : "Connecting")}</span>
      <span className="explorer-status-message">{indexProgress?.status === "indexing" ? `${indexProgress.current_workspace || "All locations"} · ${indexProgress.files_indexed + indexProgress.files_skipped} / ${indexProgress.files_discovered || "…"} contents checked` : indexProgress?.status === "cancelled" ? "Content indexing stopped · cached results remain available" : indexProgress?.status === "failed" ? "Content indexing failed · retry to continue" : notice || location?.path || "Choose a folder to begin"}</span>
      {indexProgress?.status === "indexing" && <button onClick={() => api.cancelIndexing().then(setIndexProgress).catch(error => setError(error.message))}>Stop indexing</button>}
      {(indexProgress?.status === "cancelled" || indexProgress?.status === "failed") && !!workspaces.length && <button onClick={() => api.startIndexing().then(setIndexProgress).catch(error => setError(error.message))}>Resume indexing</button>}
      <span>{data ? `${data.files.toLocaleString()} files · ${formatBytes(data.bytes)}` : "Local · offline"}</span>
    </footer>
    {!!data?.errors.length && <details className="explorer-scan-errors"><summary>{data.errors.length} scan errors</summary>{data.errors.map((message, index) => <p key={index}>{message}</p>)}</details>}
    {context && commandTarget && <div ref={menuElement} className="explorer-context-menu" role="menu" aria-label="File actions" style={{left: context.x, top: context.y}} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); setContext(undefined); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
        const index = nodes.indexOf(document.activeElement as HTMLButtonElement);
        nodes[(index + (event.key === "ArrowDown" ? 1 : -1) + nodes.length) % nodes.length]?.focus();
      }
    }}>
      <strong>{commandTarget.name}</strong>
      <button role="menuitem" onClick={() => { void open(commandTarget); setContext(undefined); }}>Open</button><button role="menuitem" onClick={() => { void open(commandTarget, true); setContext(undefined); }}>Show in Explorer</button><button role="menuitem" onClick={() => { void copyPath(commandTarget.path); setContext(undefined); }}>Copy path</button>
      <button role="menuitem" onClick={() => location && go({workspace: commandTarget.workspace_id ?? location.workspace, path: commandTarget.kind === "folder" ? commandTarget.path : commandTarget.parent})}>Search in this folder</button>
      {commandTarget.extension && <button role="menuitem" onClick={() => { setExtension(commandTarget.extension); setCategory(""); setContext(undefined); }}>Find same file type</button>}
      <hr/><button role="menuitem" disabled={!selected.length} onClick={() => { navigate("assistant"); setContext(undefined); }}>Ask about selection</button><button role="menuitem" disabled={!selected.length} onClick={() => { navigate("organize"); setContext(undefined); }}>Organize selection…</button>
      {workspaces.some((ws) => samePath(ws.path, commandTarget.path)) && <><hr/><button role="menuitem" onClick={() => { setRemoving(workspaces.find((ws) => samePath(ws.path, commandTarget.path))); setContext(undefined); }}>Remove added location…</button></>}
    </div>}
    {removing && <Modal isOpen onClose={() => setRemoving(undefined)} title="Remove added location?" maxWidth="sm"><p>Stop showing and indexing {removing.name} in Groundwork. The original folder and files stay on your computer.</p><div className="flex gap-2 mt-4"><button onClick={() => setRemoving(undefined)}>Keep location</button><button disabled={busy} onClick={async () => { setBusy(true); try { await api.deleteWorkspace(removing.id); setRemoving(undefined); await refreshLocations(); setNotice("Location removed from Groundwork"); } catch { setError("Couldn't remove this location. Try again."); } finally { setBusy(false); } }}>Remove from Groundwork</button></div></Modal>}
    {adding && <AddFolderDialog onClose={() => setAdding(false)} onAdded={() => { setAdding(false); void refreshLocations(); }}/>}
    {duplicates && workspace && <StorageInsightsModal workspaceId={workspace.id} workspaceName={workspace.name} onClose={() => setDuplicates(false)}/>}
  </section>;
}
