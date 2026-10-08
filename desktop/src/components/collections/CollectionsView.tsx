import { useEffect, useRef, useState } from "react";
import { api, waitForJob, previewFile, type FileCollection, type CollectionSuggestions } from "../../services/api";
import { useSelection } from "../../services/selection";
import { Button, Card } from "../ui";
import { LoadingState } from "../ui/LoadingState";

const newId = () => crypto.randomUUID().replaceAll("-", "");
const basename = (path: string) => path.split(/[\\/]/).pop() || path;
function restoreDraft(): {draft?: FileCollection; proposals?: FileCollection[]; dirty?: boolean; coverage?: string; unassigned?: string[]} {
  try {
    const value = JSON.parse(sessionStorage.getItem("groundwork-collection-draft") || "{}");
    const valid = (c: FileCollection) => c && typeof c.id === "string" && typeof c.title === "string" && Number.isInteger(c.revision) && Array.isArray(c.members) && c.members.every(m => m && typeof m.path === "string" && typeof m.reason === "string");
    return {draft: valid(value?.draft) ? value.draft : undefined, proposals: Array.isArray(value?.proposals) ? value.proposals.filter(valid) : [], dirty: value?.dirty === true && valid(value?.draft), coverage: typeof value?.coverage === "string" ? value.coverage : "", unassigned: Array.isArray(value?.unassigned) ? value.unassigned.filter((p: unknown) => typeof p === "string") : []};
  }
  catch { return {}; }
}

export function CollectionsView({onAsk}: {onAsk: (collection: FileCollection, question: string, paths?: string[]) => void}) {
  const { selected, navigate, setSelected } = useSelection();
  const [collections, setCollections] = useState<FileCollection[]>([]);
  const [draft, setDraft] = useState<FileCollection | undefined>(() => restoreDraft().draft);
  const [proposals, setProposals] = useState<FileCollection[]>(() => restoreDraft().proposals || []);
  const [coverage, setCoverage] = useState(() => restoreDraft().coverage || "");
  const [unassigned, setUnassigned] = useState<string[]>(() => restoreDraft().unassigned || []);
  const [provider, setProvider] = useState("builtin");
  const [choices, setChoices] = useState<Array<{id: string; name: string; is_local: boolean}>>([]);
  const [filter, setFilter] = useState("");
  const [question, setQuestion] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [providerLoading, setProviderLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(() => restoreDraft().dirty || false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const [deleteReview, setDeleteReview] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewing, setPreviewing] = useState("");
  const previewGuard = useRef(false);
  const guard = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    sessionStorage.setItem("groundwork-collection-draft", JSON.stringify({draft, proposals, dirty, coverage, unassigned}));
  }, [draft, proposals, dirty, coverage, unassigned]);
  const acceptSuggestions = (result: CollectionSuggestions) => {
    if (!mounted.current || !sessionStorage.getItem("groundwork-collection-job")) return;
    const values = result.groups.map(group => ({...group, id: newId(), revision: 0}));
    // A user can keep working in another panel while generation finishes.
    sessionStorage.setItem("groundwork-collection-draft", JSON.stringify({...restoreDraft(), proposals: values, coverage: result.coverage, unassigned: result.unassigned}));
    sessionStorage.removeItem("groundwork-collection-job");
    setProposals(values); setCoverage(result.coverage); setUnassigned(result.unassigned);
    setNotice(values.length ? "Review a proposed group. Nothing has been saved." : "No confident groups were suggested. You can create a collection yourself.");
  };

  const reload = async () => {
    const values = await api.listCollections();
    if (mounted.current) {
      setCollections(values);
      if (!dirtyRef.current) setDraft(current => current?.revision ? values.find(c => c.id === current.id) : current);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void reload().catch(e => {if(mounted.current) setError(e.message);}).finally(() => {if(mounted.current) setInitialLoading(false);});
    Promise.all([api.listProviders(), api.localAIStatus()]).then(([providers, status]) => {
      if (!mounted.current) return;
      const ready = status.supported && status.models.some(m => m.installed && m.id === status.selected);
      const available = providers.filter(p => p.id !== "local" && (p.id === "builtin" ? ready : p.active));
      setChoices(available);
      setProvider(available.find(p => p.active)?.id || available[0]?.id || "builtin");
    }).catch(e => { if (mounted.current) setError(e.message); }).finally(() => {if(mounted.current) setProviderLoading(false);});
    const previous = sessionStorage.getItem("groundwork-collection-job");
    if (previous) {
      guard.current = true; setBusy("Finding useful groups…");
      api.assistantJob<CollectionSuggestions>(previous).then(waitForJob).then(acceptSuggestions)
        .catch(e => {sessionStorage.removeItem("groundwork-collection-job"); if (mounted.current) setError(e.message);})
        .finally(() => {guard.current = false; if (mounted.current) setBusy("");});
    }
    return () => { mounted.current = false; };
  }, []);

  const run = async (label: string, work: () => Promise<void>) => {
    if (guard.current) return;
    guard.current = true; setBusy(label); setError(""); setNotice("");
    try { await work(); }
    catch(e) { if (mounted.current) setError(e instanceof Error ? e.message : "Couldn't finish this operation."); }
    finally { guard.current = false; if (mounted.current) setBusy(""); }
  };
  const edit = (value: FileCollection) => {setDraft(value); setDirty(true); setDeleteReview(false);};
  const open = (value: FileCollection) => {setDraft(structuredClone(value)); setDirty(false); setChecked([]); setFilter(""); setQuestion(""); setDeleteReview(false); setNotice("");};
  const create = () => edit({id: newId(), title: "New collection", revision: 0, members: selected.map(path => ({path, reason: "Added by you"}))});
  const preview = async (path: string) => {
    if (previewGuard.current) return;
    previewGuard.current = true; setPreviewing(path);
    try {
      const result = await api.executeTool("read_file", {path, start_line: 1, end_line: 20});
      if (mounted.current) setPreviews(values => ({...values, [path]: result.error || result.content || "No readable text."}));
    } catch(e) { if (mounted.current) setError(e instanceof Error ? e.message : "Couldn't preview this file."); }
    finally {previewGuard.current = false; if (mounted.current) setPreviewing("");}
  };
  const save = () => draft && run("Saving…", async () => {
    const result = await api.saveCollection(draft);
    if (!mounted.current) return;
    setDraft(result); setDirty(false); setProposals(values => values.filter(p => p.id !== result.id));
    await reload(); setNotice("Collection saved. Your files stayed in their original locations.");
  });
  const suggest = () => run("Finding useful groups…", async () => {
    const job = await api.suggestCollections(selected, provider);
    sessionStorage.setItem("groundwork-collection-job", job.id);
    try { acceptSuggestions(await waitForJob(job)); }
    catch(e) {sessionStorage.removeItem("groundwork-collection-job"); throw e;}
  });
  const visible = draft?.members.filter(m => `${basename(m.path)} ${m.reason} ${m.path}`.toLowerCase().includes(filter.toLowerCase())) || [];
  const availableChecked = checked.filter(path => draft?.members.some(m => m.path === path && m.available !== false));

  return <div className="gw-page collections-page max-w-4xl" style={{alignSelf: "flex-start"}}>
    <h1 className="gw-title">Collections</h1>
    <p className="text-sm text-[var(--ink-secondary)]">Group files by purpose without moving them. The same file can belong to several collections.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" disabled={initialLoading || !!busy || dirty || selected.length > 100} onClick={create}>New collection{selected.length ? ` (${selected.length} selected)` : ""}</Button>
      <Button disabled={!!busy} onClick={() => navigate("folders")}>Choose files</Button>
      <Button disabled={!!busy || dirty} onClick={() => run("Refreshing…", reload)}>Refresh</Button>
    </div>
    {initialLoading && <LoadingState title="Opening your collections" detail="Loading your saved file groups…" skeleton/>}
    {!initialLoading && <section className="collection-library"><div className="workflow-section-title"><strong>Your collections</strong><span>{collections.length} saved</span></div><div className="collection-library-items">{collections.map(c => <Button key={c.id} disabled={!!busy || dirty} onClick={() => open(c)}>{c.title} · {c.members.length}</Button>)}</div>{!collections.length && <p className="workflow-intro">No collections yet. Tick files on the left, then create a group or ask AI for suggestions.</p>}</section>}
    {selected.length > 100 && <p className="text-sm">Choose up to 100 files for one collection.</p>}
    {!draft && <Card className="space-y-3 collection-suggestion-card">
      <strong>Let AI suggest useful groups</strong>
      <p className="workflow-intro">Tick a few files on the left. Review the suggested groups before saving.</p>
      {providerLoading && <LoadingState title="Checking AI availability"/>}
      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-sm">Suggest groups with <select aria-label="Collection AI provider" className="gw-input" value={provider} disabled={!!busy || !choices.length} onChange={e => setProvider(e.target.value)}>{choices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <Button variant="primary" isLoading={busy === "Finding useful groups…"} disabled={initialLoading || !!busy || !choices.length || !selected.length || selected.length > 24 || dirty || !!proposals.length} onClick={suggest}>Suggest collections ({selected.length} files)</Button>
      </div>
      {!providerLoading && !choices.length && <p className="text-sm">Set up a model in Assistant to generate suggestions. Manual collections work without AI.</p>}
      <p className="text-xs text-[var(--ink-secondary)]">Select up to 24 files. {choices.find(p => p.id === provider)?.is_local === false ? "This sends selected filenames and bounded excerpts to the chosen online provider." : "Built-in AI keeps selected filenames and excerpts on this computer."} Suggestions use partial evidence and need your review.</p>
      {!!proposals.length && <div className="space-y-2"><strong>Proposed groups</strong>{proposals.map(p => <Button key={p.id} disabled={!!busy || dirty} onClick={() => {open(p); setDirty(true);}}>{p.title} · {p.members.length} files</Button>)}<p className="text-xs">{coverage}</p><Button disabled={!!busy || dirty} onClick={() => {setProposals([]); setUnassigned([]);}}>Discard proposals</Button></div>}
      {!!unassigned.length && <details><summary>{unassigned.length} files left ungrouped</summary>{unassigned.map(path => <p key={path} title={path}>{basename(path)}</p>)}</details>}
    </Card>}
    {busy && <LoadingState title={busy} detail="Your files stay in their original locations. You can keep browsing." elapsed skeleton={busy === "Finding useful groups…"}/>}
    {error && <p className="gw-notice" role="alert">{error}</p>}
    {notice && <p role="status" className="collection-feedback">{notice}</p>}
    {draft && <Card className="space-y-3 collection-editor-card">
      <Button variant="ghost" disabled={!!busy || dirty} onClick={() => setDraft(undefined)}>Back to collections</Button>
      <span className="workflow-eyebrow">{dirty ? "REVIEW YOUR GROUP" : "SAVED COLLECTION"}</span>
      <label className="block text-sm">Collection name<input aria-label="Collection name" className="gw-input mt-1" maxLength={100} value={draft.title} disabled={!!busy} onChange={e => edit({...draft, title: e.target.value})}/></label>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" isLoading={busy === "Saving…"} disabled={!!busy || !dirty || !draft.title.trim()} onClick={save}>Save collection</Button>
        {dirty && <Button disabled={!!busy} onClick={() => {const original = collections.find(c => c.id === draft.id); if(original) open(original); else {setDraft(undefined); setDirty(false);}}}>Discard edits</Button>}
        <Button disabled={!!busy || !selected.length || draft.members.length + selected.filter(p => !draft.members.some(m => m.path === p)).length > 100} onClick={() => edit({...draft, members: [...draft.members, ...selected.filter(path => !draft.members.some(m => m.path === path)).map(path => ({path, reason: "Added by you", available: true}))]})}>Add selected files</Button>
        <Button disabled={!!busy || dirty || !draft.revision} onClick={() => setDeleteReview(true)}>Remove collection</Button>
      </div>
      {deleteReview && <div className="gw-notice"><p>Remove “{draft.title}”? This removes only the collection. All files stay where they are.</p><Button disabled={!!busy} onClick={() => run("Removing collection…", async () => {await api.deleteCollection(draft); if (!mounted.current) return; setDraft(undefined); setDeleteReview(false); await reload(); setNotice("Collection removed. No files were deleted.");})}>Confirm remove collection</Button><Button disabled={!!busy} onClick={() => setDeleteReview(false)}>Keep collection</Button></div>}
      <input aria-label="Filter collection files" className="gw-input" placeholder="Filter by filename, path or reason" value={filter} onChange={e => setFilter(e.target.value)}/>
      <p className="text-xs">{draft.members.length} references · {draft.members.filter(m => m.available === false).length} unavailable · {checked.length} selected</p>
      <div className="space-y-2 max-h-80 overflow-auto">{visible.map(member => <div key={member.path} className="border-b border-[var(--hairline)] pb-2">
        <div className="flex items-center gap-2"><input type="checkbox" aria-label={`Select ${basename(member.path)}`} disabled={!!busy || member.available === false} checked={checked.includes(member.path)} onChange={e => setChecked(values => e.target.checked ? [...values, member.path] : values.filter(p => p !== member.path))}/><button className="text-left flex-1 truncate" title={member.path} disabled={member.available === false} onClick={() => previewFile(member.path)}>{basename(member.path)}</button><Button variant="ghost" disabled={!!busy} onClick={() => {edit({...draft, members: draft.members.filter(m => m.path !== member.path)}); setChecked(values => values.filter(p => p !== member.path));}}>Remove reference</Button></div>
        <p className="text-sm">{member.reason}</p>
        <details className="text-xs"><summary>Review evidence and reason</summary><p className="break-all">{member.path}</p><Button variant="ghost" disabled={!!previewing || member.available === false} onClick={() => preview(member.path)}>{previewing === member.path ? "Reading…" : "Preview opening text"}</Button>{previewing === member.path && <LoadingState title="Reading file excerpt"/>}{previews[member.path] && <pre className="whitespace-pre-wrap break-words">{previews[member.path]}</pre>}<label className="block">Edit grouping reason<input aria-label={`Reason for ${basename(member.path)}`} className="gw-input mt-1" maxLength={300} disabled={!!busy} value={member.reason} onChange={e => edit({...draft, members: draft.members.map(m => m.path === member.path ? {...m, reason: e.target.value} : m)})}/></label></details>
        {member.available === false && <p className="text-xs">Unavailable: missing, excluded, or its location was removed. Restore it or remove this reference.</p>}
      </div>)}</div>
      {!draft.members.length && <p>This collection is empty. Select files in the workspace, then add them here.</p>}
      <label className="block text-sm">Ask about this collection<input className="gw-input mt-1" aria-label="Collection question" placeholder="What changed in the launch plan?" value={question} maxLength={2000} onChange={e => setQuestion(e.target.value)}/></label>
      <div className="flex flex-wrap gap-2"><Button disabled={!!busy || dirty || !draft.revision || !question.trim() || !draft.members.some(m => m.available !== false)} onClick={() => onAsk(draft, question)}>Find and answer in collection</Button><Button disabled={!!busy || dirty || !draft.revision || !availableChecked.length || availableChecked.length > 6} onClick={() => onAsk(draft, "Compare these files. Explain differences and cite evidence. State when evidence is insufficient.", availableChecked)}>Compare selected ({availableChecked.length}/6)</Button><Button disabled={!!busy || !availableChecked.length} onClick={() => {setSelected(availableChecked); navigate("folders");}}>Use selection in workspace</Button></div>
      {dirty && <p className="text-xs">Save or discard these edits before switching collections or asking questions.</p>}
    </Card>}
  </div>;
}
