import { useEffect, useMemo, useState } from "react";
import {
  FolderOpen,
  FolderTree,
  FileText,
  Wand,
  RotateCcw,
  Play,
  Trash2,
  HelpCircle,
  ExternalLink,
  Tag,
  CheckCircle2,
} from "lucide-react";
import { api, waitForJob } from "../../services/api";
import { useSelection } from "../../services/selection";
import { Button, Card, Modal } from "../ui";

interface Row {
  source: string;
  relative: string;
  included: boolean;
  leave_unchanged?: boolean;
  tags?: string[];
  reason?: string;
  understanding?: string;
  coverage?: string;
}

export interface PlanItem {
  source: string;
  target: string;
  relative?: string;
  status: string;
  error: string | null;
  tags?: string[];
  reason?: string;
  understanding?: string;
  coverage?: string;
}

export interface Plan {
  id: string;
  created: number;
  status: string;
  instruction: string;
  rule_id?: string;
  rule_name?: string;
  items: PlanItem[];
  summary?: {
    completed: number;
    skipped: number;
    failed: number;
    total: number;
  };
}

interface SavedRule {
  id: string;
  folder_path: string;
  name: string;
  rule_type: string;
  instruction: string;
  categories: string[];
  created_at: number;
  updated_at: number;
}

interface SavedPreference {
  id: string;
  name: string;
  categories: string[];
  instructions: string;
  created_at: number;
  updated_at: number;
}

const ruleLabels: Record<string, string> = {by_type: "File type", by_date_year: "Modified year", by_date_month: "Modified month", custom_categories: "Filename categories", ai_instruction: "Content suggestions"};

export function OrganizeView() {
  const { selected, setSelected, navigate } = useSelection();
  const [rows, setRows] = useState<Row[]>([]);
  const [rowOffset, setRowOffset] = useState(0);
  const [destination, setDestination] = useState("");
  const [folders, setFolders] = useState<{ path: string; name: string }[]>([]);
  const [instruction, setInstruction] = useState("");
  const [ruleType, setRuleType] = useState("by_type");
  const [customCategoriesInput, setCustomCategoriesInput] = useState("");
  const [provider, setProvider] = useState("builtin");
  const [providers, setProviders] = useState<Array<{id: string; name: string; is_local: boolean}>>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] =
    useState<Awaited<ReturnType<typeof api.organizationProgress>>>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [plan, setPlan] = useState<Plan>();
  const [history, setHistory] = useState<Plan[]>([]);
  const [undoPlan, setUndoPlan] = useState<Plan>();

  // Rules and preferences
  const [savedRules, setSavedRules] = useState<SavedRule[]>([]);
  const [savedPreferences, setSavedPreferences] = useState<SavedPreference[]>([]);
  const [ruleNameInput, setRuleNameInput] = useState("");
  const [showSaveRuleModal, setShowSaveRuleModal] = useState(false);
  const [showPreferencesModal, setShowPreferencesModal] = useState(false);
  const [prefNameInput, setPrefNameInput] = useState("");
  const [prefCategoriesInput, setPrefCategoriesInput] = useState("");
  const [prefInstructionsInput, setPrefInstructionsInput] = useState("");
  const activeRows = rows.filter((row) => row.included && !row.leave_unchanged);

  const loadHistory = () =>
    api
      .organizationHistory()
      .then((values) => { setHistory(values); setError(""); })
      .catch((e) => setError(e.message));

  const loadRules = () =>
    api
      .listRules()
      .then(setSavedRules)
      .catch(() => {});

  const loadPreferences = () =>
    api
      .listPreferences()
      .then(setSavedPreferences)
      .catch(() => {});

  useEffect(() => {
    if (!busy) return;
    let active = true;
    setProgress(undefined);
    const load = () =>
      api
        .organizationProgress()
        .then((value) => {
          if (active) setProgress(value);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 800);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [busy]);

  useEffect(() => {
    setRowOffset(0);
    setRows(
      selected.map((source) => ({
        source,
        relative: source.split(/[\\/]/).pop() || "",
        included: true,
        leave_unchanged: false,
      })),
    );
    setPlan(undefined);
  }, [selected]);

  useEffect(() => {
    api
      .listWorkspaces()
      .then((values) => {
        setFolders(values);
        setDestination(values[0]?.path || "");
      })
      .catch((e) => setError(e.message));
    loadHistory();
    loadRules();
    loadPreferences();
    api.listProviders().then(setProviders).catch(() => {});
  }, []);

  // Simple non-AI rule application
  const applySimpleRule = async (ruleType: string, customCategories?: string[]) => {
    if (!rows.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const items = activeRows.map((r) => ({ source: r.source }));
      const job = await api.organize<{ items: Array<{ source: string; relative: string; tags: string[]; reason: string; understanding: string; leave_unchanged: boolean }> }>({
        action: "simple_rule",
        items,
        rule_type: ruleType,
        categories: customCategories || [],
      });
      const result = await waitForJob(job);
      setRows((prev) =>
        prev.map((row) => {
          const match = result.items.find((item) => item.source === row.source);
          if (match) {
            return {
              ...row,
              relative: match.relative,
              tags: match.tags,
              reason: match.reason,
              understanding: match.understanding,
              leave_unchanged: match.leave_unchanged,
            };
          }
          return row;
        }),
      );
      setRuleType(ruleType);
      setPlan(undefined);
      setNotice(`${ruleLabels[ruleType] || "Organization"} suggestions ready. Review them before applying changes.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't apply rule.");
    } finally {
      setBusy(false);
    }
  };

  const task = async (action: string, values: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "suggest") {
        const result = await waitForJob(
          await api.organize<{ items: Omit<Row, "included">[] }>({
            action,
            ...values,
          }),
        );
        setRows((previous) => previous.map((row) => {
          const suggestion = result.items.find((item) => item.source === row.source);
          return suggestion ? {...row, ...suggestion} : row;
        }));
        setRuleType("ai_instruction");
        setPlan(undefined);
      } else {
        const result = await waitForJob(
          await api.organize<Plan>({ action, ...values }),
        );
        setPlan(action === "preview" ? result : undefined);
        if (action !== "preview") {
          const summary = result.summary;
          const summaryMsg = summary
            ? ` (${summary.completed} ${action === "undo" ? "restored" : "moved"}, ${summary.skipped} unchanged/skipped, ${summary.failed} failed)`
            : "";
          setNotice(
            result.status === "cancelled"
              ? `Cancelled. Completed changes can be undone from history.${summaryMsg}`
              : result.status === "needs-review"
              ? `Some files need review. See operation history below.${summaryMsg}`
              : action === "undo"
                ? `Undo finished.${summaryMsg}`
                : `File operation finished successfully.${summaryMsg}`,
          );
          loadHistory();
          loadRules();
        }
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't organize these files.",
      );
    } finally {
      setBusy(false);
    }
  };

  // Convert plan items into a proposed folder tree hierarchy for browsable preview
  const treeGroups = useMemo(() => {
    if (!plan) return {};
    const groups: Record<string, PlanItem[]> = {};
    for (const item of plan.items) {
      const parts = (item.relative || item.target).split(/[\\/]/);
      const folderKey = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root folder)";
      if (!groups[folderKey]) groups[folderKey] = [];
      groups[folderKey].push(item);
    }
    return groups;
  }, [plan]);

  return (
    <div className="gw-page w-full min-w-0 max-w-5xl" style={{ alignSelf: "flex-start" }}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="gw-title">Organize files</h1>
          <p className="gw-description">
            Organize only when asked. Review proposed folder structures virtually before approving any file changes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                const sample = await api.createSampleFolder();
                setSelected(sample.files);
                setDestination(sample.folder_path);
                setFolders((previous) => [...previous, {path: sample.folder_path, name: "Guided example"}]);
                setNotice("Sample folder loaded! You can safely test preview, rules, and undo here.");
              } catch {
                setError("Couldn't create sample folder.");
              }
            }}
          >
            <HelpCircle size={16} />
            Try guided example
          </Button>
          <Button variant="ghost" onClick={() => setShowPreferencesModal(true)}>
            <Tag size={16} />
            Saved preferences
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <Button onClick={() => navigate("folders")}>
          Choose files ({selected.length} selected)
        </Button>
        {selected.length > 0 && (
          <Button variant="ghost" onClick={() => setSelected([])}>
            Clear selection
          </Button>
        )}
      </div>

      {notice && (
        <div className="p-3 bg-[var(--paper-subtle)] border border-[var(--ink-blue)] rounded-lg text-sm flex items-center gap-2">
          <CheckCircle2 size={16} className="text-[var(--ink-blue)] shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <p role="alert" className="gw-notice">
          {error}
        </p>
      )}

      {/* Saved Rules Section */}
      {savedRules.length > 0 && (
        <Card className="space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <FolderTree size={16} className="text-[var(--ink-blue)]" />
            Saved folder rules (reusable setups)
          </h2>
          <p className="text-xs text-[var(--ink-secondary)]">
            Saved rules remember your approved categories and tracked files. Rerunning applies your structure to new or modified files without moving unchanged files. Applying still requires your explicit approval.
          </p>
          <div className="grid min-w-0 gap-2 lg:grid-cols-2">
            {savedRules.map((rule) => (
              <div
                key={rule.id}
                className="min-w-0 border border-[var(--hairline)] rounded-lg p-3 flex flex-wrap justify-between items-center gap-2 bg-[var(--paper-subtle)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{rule.name}</p>
                  <p className="text-xs text-[var(--ink-secondary)] truncate">
                    {rule.folder_path} · {ruleLabels[rule.rule_type] || "Saved rule"}
                  </p>
                  {rule.categories.length > 0 && (
                    <p className="text-xs text-[var(--ink-secondary)] truncate mt-0.5">
                      Categories: {rule.categories.join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      setNotice("");
                      try {
                        const job = await api.runRule(rule.id);
                        const result = await waitForJob(job);
                        if (result.status === "no_changes") {
                          setNotice(
                            "All files in this folder are already organized according to this rule. No new or changed files were found.",
                          );
                          setPlan(undefined);
                        } else {
                          setPlan(result);
                          setNotice(`Preview generated for rule "${rule.name}". Review the changes below.`);
                        }
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Couldn't run rule.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Play size={14} />
                    Run
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await api.deleteRule(rule.id);
                        loadRules();
                      } catch {
                        setError("Couldn't delete rule.");
                      }
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <span className="sr-only">Delete rule {rule.name}</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Main Setup Card */}
      <Card className="space-y-4">
        {/* Simple Non-AI Organization Rules */}
        <div>
          <h2 className="font-semibold text-sm mb-1">Group selected files</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={busy || !activeRows.length}
              onClick={() => applySimpleRule("by_type")}
            >
              Group by file type
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !activeRows.length}
              onClick={() => applySimpleRule("by_date_year")}
            >
              Group by modified year
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !activeRows.length}
              onClick={() => applySimpleRule("by_date_month")}
            >
              Group by modified month
            </Button>
          </div>
        </div>

        {/* Custom Categories Non-AI */}
        <div className="border-t border-[var(--hairline)] pt-3">
          <label className="block text-sm">
            Or organize with your own categories (non-AI)
            <div className="flex flex-col sm:flex-row gap-2 mt-1">
              <input
                className="gw-input min-w-0 flex-1"
                placeholder="e.g. Invoices, Receipts, Contracts, Taxes"
                value={customCategoriesInput}
                onChange={(e) => setCustomCategoriesInput(e.target.value)}
              />
              <Button
                disabled={busy || !activeRows.length || !customCategoriesInput.trim()}
                onClick={() => {
                  const cats = customCategoriesInput
                    .split(",")
                    .map((c) => c.trim())
                    .filter(Boolean);
                  applySimpleRule("custom_categories", cats);
                }}
              >
                Apply categories
              </Button>
            </div>
          </label>
          <div className="flex flex-wrap gap-1 mt-2" aria-label="Suggested categories">
            {["Invoices", "Receipts", "Contracts", "Taxes", "Reports", "Photos"].map((category) => {
              const categories = customCategoriesInput.split(",").map(value => value.trim()).filter(Boolean);
              const included = categories.includes(category);
              return <Button key={category} variant="ghost" disabled={busy} aria-pressed={included} onClick={() => setCustomCategoriesInput((included ? categories.filter(value => value !== category) : [...categories, category]).join(", "))}>{category}</Button>;
            })}
          </div>
        </div>

        {/* AI Suggestions (Optional) */}
        <details className="border-t border-[var(--hairline)] pt-3 space-y-2"><summary>Suggest names and folders with AI</summary>
          <label className="block text-sm">
            Suggest content with
            <select className="gw-input mt-1" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="builtin">Built-in AI (this computer)</option>
              {providers.filter((p) => !["builtin", "local"].includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {providers.find((p) => p.id === provider)?.is_local === false && <p className="gw-notice">Requesting suggestions sends your instructions, selected filenames and supported excerpts to this cloud provider.</p>}
          <label className="block text-sm">
            AI content suggestions (optional)
            <textarea
              className="gw-input mt-1 min-h-16"
              value={instruction}
              maxLength={2000}
              onChange={(e) => {
                setInstruction(e.target.value);
                setPlan(undefined);
              }}
              placeholder="e.g. Group research papers by topic and suggest descriptive filenames"
            />
          </label>
          <p className="text-xs text-[var(--ink-secondary)]">
            Content suggestions use a relevant section of up to 40 lines per supported file, with at most 6,000 excerpt characters across up to 6 files. Coverage is partial. Files without readable evidence remain unchanged.
          </p>
          <Button
            disabled={
              busy ||
              activeRows.length === 0 ||
              activeRows.length > 6 ||
              !instruction.trim()
            }
            onClick={() =>
              task("suggest", {
                paths: activeRows.map((row) => row.source),
                instruction,
                provider,
              })
            }
          >
            <Wand size={16} />
            Suggest names and folders
          </Button>
        </details>

        {/* Destination Picker */}
        <div className="border-t border-[var(--hairline)] pt-3 space-y-2">
          <label className="block text-sm font-medium">
            Destination folder
            <select
              className="gw-input mt-1"
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                setPlan(undefined);
              }}
            >
              {folders.map((folder) => (
                <option key={folder.path} value={folder.path}>
                  {folder.name} · {folder.path}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Destination location (inside an added folder)
            <input className="gw-input mt-1" value={destination} disabled={busy} onChange={(e) => {
              setDestination(e.target.value);
              setPlan(undefined);
            }} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  const folder = await api.pickWorkspaceFolder();
                  if (folder) {
                    setDestination(folder);
                    setPlan(undefined);
                  }
                } catch {
                  setError("Couldn't open the folder chooser. Enter the location manually.");
                }
              }}
            >
              <FolderOpen size={16} />
              Choose destination folder
            </Button>
          </div>
        </div>

        {/* Candidate File List */}
        <div className="space-y-3 border-t border-[var(--hairline)] pt-3">
          <div className="flex flex-wrap gap-2 justify-between items-center">
            <h2 className="font-semibold text-sm">
              Files to organize ({rows.length})
            </h2>
            <div className="flex gap-2 text-xs">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRows((prev) =>
                    prev.map((r) => ({ ...r, leave_unchanged: false, included: true })),
                  ); setPlan(undefined);
                }}
              >
                Include all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRows((prev) =>
                    prev.map((r) => ({ ...r, leave_unchanged: true })),
                  ); setPlan(undefined);
                }}
              >
                Leave all unchanged
              </Button>
            </div>
          </div>

          {rows.slice(rowOffset, rowOffset + 100).map((row, pageIndex) => {
            const index = rowOffset + pageIndex;
            return (
            <div
              key={row.source}
              className={`border rounded-lg p-3 space-y-2 transition-colors ${
                row.leave_unchanged
                  ? "border-[var(--hairline)] bg-[var(--paper-subtle)] opacity-75"
                  : "border-[var(--hairline)]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex gap-2 text-sm items-center min-w-0">
                  <input
                    type="checkbox"
                    checked={row.included}
                    onChange={(e) => {
                      setRows((values) =>
                        values.map((r, i) =>
                          i === index ? { ...r, included: e.target.checked } : r,
                        ),
                      );
                      setPlan(undefined);
                    }}
                  />
                  <span className="break-all font-mono text-xs">{row.source}</span>
                </label>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant={row.leave_unchanged ? "secondary" : "ghost"}
                    onClick={() => {
                      setRows((values) =>
                        values.map((r, i) =>
                          i === index
                            ? { ...r, leave_unchanged: !r.leave_unchanged }
                            : r,
                        ),
                      );
                      setPlan(undefined);
                    }}
                  >
                    {row.leave_unchanged ? "Leave unchanged ✓" : "Leave unchanged"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => api.openFile(row.source).catch((e) => setError(e.message))}
                    aria-label={`Open original ${row.source.split(/[\\/]/).pop()}`}
                  >
                    <ExternalLink size={14} />
                  </Button>
                </div>
              </div>

              {!row.leave_unchanged && (
                <label className="block text-sm">
                  Proposed subfolder and filename
                  <input
                    className="gw-input mt-1"
                    value={row.relative}
                    disabled={!row.included || busy}
                    onChange={(e) => {
                      setRows((values) =>
                        values.map((r, i) =>
                          i === index ? { ...r, relative: e.target.value } : r,
                        ),
                      );
                      setPlan(undefined);
                    }}
                  />
                </label>
              )}

              {row.reason && (
                <p className="text-xs text-[var(--ink-secondary)]">
                  {row.reason} {row.understanding ? `· ${row.understanding}` : ""}
                </p>
              )}
              {row.coverage && <p className="text-xs text-[var(--ink-secondary)]">Coverage: {row.coverage}</p>}
              {row.tags?.length ? (
                <p className="text-xs text-[var(--ink-secondary)]">
                  Tags: {row.tags.join(", ")}
                </p>
              ) : null}
            </div>
            );
          })}
          {rows.length > 100 && <div className="flex flex-wrap items-center gap-2">
            <Button disabled={rowOffset === 0} onClick={() => setRowOffset(Math.max(0, rowOffset - 100))}>Previous files</Button>
            <span className="text-sm">{rowOffset + 1}–{Math.min(rows.length, rowOffset + 100)} of {rows.length} selected files</span>
            <Button disabled={rowOffset + 100 >= rows.length} onClick={() => setRowOffset(rowOffset + 100)}>Next files</Button>
          </div>}
          {rows.filter((row) => row.included).length > 100 && <p className="gw-notice">Include up to 100 files in each reviewed plan. Exclude files or narrow your selection in Files.</p>}
        </div>

        <Button
          variant="primary"
          disabled={busy || !destination || !rows.some((r) => r.included) || rows.filter((r) => r.included).length > 100}
          onClick={() =>
            task("preview", {
              items: rows
                .filter((r) => r.included)
                .map((r) => ({
                  source: r.source,
                  relative: r.leave_unchanged ? r.source.split(/[\\/]/).pop() : r.relative,
                  leave_unchanged: r.leave_unchanged,
                  tags: r.tags,
                  reason: r.reason,
                  understanding: r.understanding,
                  coverage: r.coverage,
                })),
              destination,
              instruction,
            })
          }
        >
          <FolderTree size={16} />
          Preview changes
        </Button>

        {busy && (
          <div role="status" className="space-y-2 p-3 bg-[var(--paper-subtle)] rounded-lg text-sm">
            <p>Working… Files and search remain available.</p>
            {progress && ["checking", "running", "undoing"].includes(progress.phase) && (
              <>
                <p>
                  {progress.phase === "checking" ? "Checked" : "Processed"}{" "}
                  {progress.checked} of {progress.total} files · {progress.completed} completed
                </p>
                {progress.current_size !== undefined && (
                  <p>
                    Current copy: {(progress.bytes / 1048576).toFixed(1)} of{" "}
                    {(progress.current_size / 1048576).toFixed(1)} MB
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </Card>

      {/* Browsable Proposed Folder Tree Preview */}
      {plan && (
        <Card className="space-y-4 border-2 border-[var(--ink-blue)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--hairline)] pb-3">
            <div>
              <h2 className="font-semibold text-base flex items-center gap-2">
                <FolderTree className="text-[var(--ink-blue)]" size={20} />
                Proposed Folder Tree Preview
              </h2>
              <p className="text-xs text-[var(--ink-secondary)]">
                Virtual preview: no source files have been changed on disk. You can open originals, edit proposed locations, or exclude items before approving.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSaveRuleModal(true)}
              >
                Save as rule
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPlan(undefined)}>
                Cancel preview
              </Button>
            </div>
          </div>

          {/* Tree Structure */}
          <div className="space-y-4 bg-[var(--paper-subtle)] p-4 rounded-lg">
            <p className="text-xs font-semibold text-[var(--ink-secondary)] uppercase tracking-wider">
              Proposed locations (shown below each file)
            </p>

            {Object.entries(treeGroups).map(([folderKey, items]) => (
              <div key={folderKey} className="space-y-2 border-l-2 border-[var(--ink-blue)] pl-3 ml-2">
                <p className="font-medium text-sm flex items-center gap-1.5 text-[var(--ink-blue)]">
                  <FolderOpen size={16} />
                  {folderKey}
                </p>

                <div className="space-y-2">
                  {items.map((item) => (
                    <div
                      key={item.source}
                      className="bg-[var(--paper)] border border-[var(--hairline)] rounded-lg p-2.5 text-xs space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium min-w-0 break-all flex items-center gap-1">
                          <FileText size={14} className="text-[var(--ink-secondary)]" />
                          {item.target.split(/[\\/]/).pop()}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {item.status === "unchanged" && (
                            <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded text-[10px]">
                              Leave unchanged
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => api.openFile(item.source).catch((e) => setError(e.message))}
                            aria-label={`Open original ${item.source.split(/[\\/]/).pop()}`}
                          >
                            <ExternalLink size={12} /> Open
                          </Button>
                        </div>
                      </div>

                      <div className="text-[11px] text-[var(--ink-secondary)] space-y-0.5">
                        <p className="break-all">Current: {item.source}</p>
                        <p className="break-all font-semibold text-[var(--ink)]">
                          Proposed: {item.target}
                        </p>
                      </div>

                      {item.reason && (
                        <p className="text-[11px] text-[var(--ink-secondary)] italic">
                          Evidence / reason: {item.reason}
                        </p>
                      )}
                      {item.coverage && <p className="text-[11px] text-[var(--ink-secondary)]">Coverage: {item.coverage}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 bg-[var(--paper-subtle)] rounded-lg text-xs space-y-1 text-[var(--ink-secondary)]">
            <p className="font-medium text-[var(--ink)]">Explicit approval required</p>
            <p>
              Approving moves or renames {plan.items.filter((i) => i.status !== "unchanged").length} files. Files marked "Leave unchanged" ({plan.items.filter((i) => i.status === "unchanged").length}) remain untouched.
            </p>
            <p>
              Groundwork checks that each file still matches your preview and its destination is available before moving it. Existing files are never overwritten.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                task("execute", { plan_id: plan.id, approved: true })
              }
            >
              Apply changes to {plan.items.filter((item) => item.status !== "unchanged").length} files
            </Button>
            <Button variant="ghost" onClick={() => setPlan(undefined)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Operation History & Conflict-Aware Undo */}
      <Card className="space-y-4">
        <div className="flex flex-wrap gap-2 justify-between items-center">
          <h2 className="font-semibold">Change history & undo</h2>
          <Button variant="ghost" size="sm" onClick={loadHistory}>
            Refresh history
          </Button>
        </div>
        <p className="text-xs text-[var(--ink-secondary)]">
          Groundwork maintains a local operation journal. Every copy is verified before deleting sources, and conflict-aware undo is available.
        </p>

        {history.length === 0 ? (
          <p className="text-sm text-[var(--ink-secondary)]">No previous operations recorded.</p>
        ) : (
          history.map((operation) => (
            <details key={operation.id} className="border border-[var(--hairline)] rounded-lg p-3">
              <summary className="font-medium text-sm cursor-pointer">
                {new Date(operation.created * 1000).toLocaleString()} ·{" "}
                {operation.items.length} files · Status: {operation.status}
                {operation.summary && (
                  <span className="text-xs text-[var(--ink-secondary)] ml-2">
                    ({operation.summary.completed} completed, {operation.summary.skipped} skipped, {operation.summary.failed} failed)
                  </span>
                )}
              </summary>
              <div className="space-y-2 mt-3 pt-2 border-t border-[var(--hairline)] text-xs">
                {operation.items.map((item) => (
                  <div key={item.source} className="break-all border-b border-[var(--hairline)] pb-1">
                    <p>{item.source} → {item.target}</p>
                    <p className="text-[var(--ink-secondary)]">
                      Status: {item.status} {item.error ? `· Error: ${item.error}` : ""}
                    </p>
                  </div>
                ))}
                <div className="pt-2 flex gap-2">
                  {operation.status === "preview" && (
                    <Button disabled={busy} onClick={() => setPlan(operation)}>
                      Review saved preview
                    </Button>
                  )}
                  {!["undone", "preview"].includes(operation.status) && (
                    <Button disabled={busy} onClick={() => setUndoPlan(operation)}>
                      <RotateCcw size={14} />
                      Review undo
                    </Button>
                  )}
                </div>
              </div>
            </details>
          ))
        )}
      </Card>

      {/* Save Rule Modal */}
      {showSaveRuleModal && (
        <Modal
          isOpen
          onClose={() => setShowSaveRuleModal(false)}
          title="Save this setup as a reusable rule"
        >
          <div className="space-y-4 text-sm">
            <p className="text-[var(--ink-secondary)]">
              Store this folder's organization instructions, categories, and operation history locally. Rerunning will organize new/modified files without repeatedly moving unchanged files.
            </p>
            <label className="block font-medium">
              Rule name
              <input
                className="gw-input mt-1"
                placeholder="e.g. Monthly Invoice Rule"
                value={ruleNameInput}
                onChange={(e) => setRuleNameInput(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowSaveRuleModal(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!ruleNameInput.trim()}
                onClick={async () => {
                  try {
                    await api.saveRule(
                      destination,
                      ruleNameInput.trim(),
                      ruleType,
                      instruction,
                      customCategoriesInput
                        ? customCategoriesInput.split(",").map((c) => c.trim())
                        : [],
                    );
                    setShowSaveRuleModal(false);
                    setRuleNameInput("");
                    loadRules();
                    setNotice("Rule saved successfully.");
                  } catch {
                    setError("Couldn't save rule.");
                  }
                }}
              >
                Save rule
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Local Preferences Modal */}
      {showPreferencesModal && (
        <Modal
          isOpen
          onClose={() => setShowPreferencesModal(false)}
          title="Saved preferences"
          maxWidth="lg"
        >
          <div className="space-y-4 text-sm">
            <p className="text-[var(--ink-secondary)]">
              Preferences are saved on this computer. Using them fills in categories and instructions for your next task. If you choose a cloud provider, those instructions are sent when you request suggestions.
            </p>

            <div className="space-y-3">
              <h3 className="font-semibold text-xs uppercase tracking-wider text-[var(--ink-secondary)]">
                Saved Preferences
              </h3>
              {savedPreferences.length === 0 ? (
                <p className="text-xs text-[var(--ink-secondary)]">No saved preferences yet.</p>
              ) : (
                savedPreferences.map((pref) => (
                  <div
                    key={pref.id}
                    className="border border-[var(--hairline)] rounded-lg p-2.5 flex justify-between items-center gap-2 bg-[var(--paper-subtle)]"
                  >
                    <div>
                      <p className="font-medium text-xs">{pref.name}</p>
                      {pref.categories.length > 0 && (
                        <p className="text-[11px] text-[var(--ink-secondary)]">
                          Categories: {pref.categories.join(", ")}
                        </p>
                      )}
                      {pref.instructions && (
                        <p className="text-[11px] text-[var(--ink-secondary)]">
                          Instructions: {pref.instructions}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setCustomCategoriesInput(pref.categories.join(", "));
                        setInstruction(pref.instructions);
                        setPlan(undefined);
                        setShowPreferencesModal(false);
                        setNotice(`Loaded preferences: ${pref.name}. Choose a method, then preview changes.`);
                      }}
                    >Use</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await api.deletePreference(pref.id);
                        loadPreferences();
                      }}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                      <span className="sr-only">Delete preference {pref.name}</span>
                    </Button>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-[var(--hairline)] pt-3 space-y-2">
              <h3 className="font-semibold text-xs uppercase tracking-wider text-[var(--ink-secondary)]">
                Add Preferred Categories
              </h3>
              <input
                className="gw-input"
                aria-label="Preference name"
                placeholder="Preference name (e.g. Tax Documents)"
                value={prefNameInput}
                onChange={(e) => setPrefNameInput(e.target.value)}
              />
              <input
                className="gw-input"
                aria-label="Preferred categories"
                placeholder="Categories separated by comma (e.g. Invoices, 1099, Receipts)"
                value={prefCategoriesInput}
                onChange={(e) => setPrefCategoriesInput(e.target.value)}
              />
              <input
                className="gw-input"
                aria-label="Preference instructions"
                placeholder="Optional instructions"
                value={prefInstructionsInput}
                onChange={(e) => setPrefInstructionsInput(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!prefNameInput.trim()}
                onClick={async () => {
                  try {
                    await api.savePreference(
                      prefNameInput.trim(),
                      prefCategoriesInput.split(",").map((c) => c.trim()).filter(Boolean),
                      prefInstructionsInput.trim(),
                    );
                    setPrefNameInput("");
                    setPrefCategoriesInput("");
                    setPrefInstructionsInput("");
                    loadPreferences();
                  } catch {
                    setError("Couldn't save preference.");
                  }
                }}
              >
                Save preference
              </Button>
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={() => setShowPreferencesModal(false)}>Close</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Undo Approval Modal */}
      {undoPlan && (
        <Modal
          isOpen
          onClose={() => setUndoPlan(undefined)}
          title="Undo these file changes?"
        >
          <p className="mb-4 text-sm">
            Groundwork will return {undoPlan.items.length} files to their original names and folders. Changed files, occupied destinations, and interrupted copies are reported for manual review. Existing files are never overwritten.
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setUndoPlan(undefined)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                const id = undoPlan.id;
                setUndoPlan(undefined);
                task("undo", { plan_id: id, approved: true });
              }}
            >
              Approve undo
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
