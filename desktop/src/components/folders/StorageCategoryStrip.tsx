import { X } from "lucide-react";
import type { StorageCategory, StorageCategorySummary } from "../../types/api";

export const categoryColors: Record<StorageCategory, string> = {
  media: "#8b5cf6", archives: "#f59e0b", documents: "#3b82f6", code: "#10b981", other: "#94a3b8",
};
export function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB`
    : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function StorageCategoryStrip({ categories, active, onChange, folderName, provisional }: {
  categories: StorageCategorySummary[];
  active: StorageCategory | "";
  onChange: (category: StorageCategory | "") => void;
  folderName: string;
  provisional: boolean;
}) {
  const select = (category: StorageCategory) => onChange(active === category ? "" : category);
  const description = (item: StorageCategorySummary) =>
    `${item.label} · ${formatBytes(item.size_bytes)} · ${item.file_count.toLocaleString()} files · ${item.percentage.toFixed(1)}%`;
  return <section aria-label="Storage categories" className="space-y-3">
    <p className="text-sm text-[var(--ink-secondary)] break-words">Storage in {folderName} · includes all subfolders
      {provisional && <span className="block text-xs">Cached totals are provisional until the scan finishes.</span>}
    </p>
    <div className="flex h-6 overflow-hidden rounded-full bg-[var(--paper-subtle)] border border-[var(--hairline)]" aria-label="Share of inventoried file bytes">
      {categories.filter((item) => item.size_bytes > 0).map((item) => <button key={item.category}
        type="button" tabIndex={-1} aria-label={description(item)} title={description(item)} aria-pressed={active === item.category}
        onClick={() => select(item.category)} className="h-full hover:opacity-80 transition-opacity"
        style={{width: `${item.percentage}%`, backgroundColor: categoryColors[item.category]}} />)}
    </div>
    <div className="flex flex-wrap gap-2">
      {categories.map((item) => <button key={item.category} type="button"
        aria-pressed={active === item.category} aria-label={`${description(item)}${active === item.category ? ". Clear category filter" : ". Filter files across this added folder"}`}
        onClick={() => select(item.category)}
        className={`min-h-10 inline-flex flex-wrap items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-[var(--ink)] ${active === item.category ? "border-[var(--ink-blue)] bg-[var(--ink-blue-subtle)]" : "border-[var(--hairline)] bg-[var(--surface)] hover:bg-[var(--paper-subtle)]"}`}>
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{backgroundColor: categoryColors[item.category]}} />
        <span>{item.label}</span><span>{formatBytes(item.size_bytes)} ({item.percentage.toFixed(1)}%)</span>
        <span className="text-[var(--ink-secondary)]">{item.file_count.toLocaleString()} files</span>
        {active === item.category && <X size={14} aria-hidden="true" />}
      </button>)}
    </div>
    {categories.every((item) => !item.file_count) && <p className="text-xs text-[var(--ink-secondary)]">No inventoried file sizes yet. Files remain browsable while scanning continues.</p>}
  </section>;
}
