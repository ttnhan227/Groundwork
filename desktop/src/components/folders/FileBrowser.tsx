import { useEffect, useState } from "react";
import { api } from "../../services/api";
import type { Workspace, CitationItem } from "../../types/api";
import { Button, Modal } from "../ui";
import { useSelection } from "../../services/selection";
import { FileGlyph } from "../common/FileGlyph";

import { StorageCategoryStrip, categoryColors, formatBytes as size } from "./StorageCategoryStrip";
import type { InventoryItem, InventoryResult, StorageCategory } from "../../types/api";

function SizeBar({ item, parentBytes }: { item: InventoryItem; parentBytes: number }) {
  const percentage = parentBytes > 0 ? Math.min(100, Math.max(0, item.size_bytes / parentBytes * 100)) : 0;
  return <div className="space-y-1" title="Share of folder bytes, including subfolders">
    <span>{size(item.size_bytes)}</span>
    {item.kind === "folder" && <p className="text-xs text-[var(--ink-secondary)]">{(item.file_count ?? 0).toLocaleString()} files</p>}
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 rounded-full overflow-hidden bg-[var(--paper-subtle)]">
        <div className="h-full rounded-full" style={{ width: `${percentage}%`, minWidth: item.size_bytes > 0 ? 2 : 0,
          backgroundColor: item.kind === "folder" ? "var(--ink-blue, #2563eb)" : categoryColors[item.category || "other"] }} />
      </div>
      <span className="text-xs text-[var(--ink-secondary)]">{percentage > 0 && percentage < 0.1 ? "<0.1" : percentage.toFixed(1)}%</span>
    </div>
  </div>;
}
export function FileBrowser({ folder }: { folder: Workspace }) {
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [sources, setSources] = useState<CitationItem[]>([]);
  const [formats, setFormats] = useState<string[]>([]);
  const [answer, setAnswer] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [provider, setProvider] = useState("local");
  const [providers, setProviders] = useState<
    Array<{ id: string; name: string; is_local: boolean }>
  >([]);
  const [parent, setParent] = useState(folder.path);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<StorageCategory | "">("");
  const [extension, setExtension] = useState("");
  const [sort, setSort] = useState("name");
  const [descending, setDescending] = useState(false);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<InventoryResult>();
  const [pageLoading, setPageLoading] = useState(true);
  const { selected, setSelected, navigate } = useSelection();
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setParent(folder.path);
    setCategory("");
    setOffset(0);
  }, [folder.id, folder.path]);
  useEffect(() => {
    let active = true;
    setPageLoading(true);
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      return api
        .browseInventory(folder.id, {
          parent: query || category ? undefined : parent,
          category,
          query,
          extension,
          sort,
          descending: String(descending),
          offset: String(offset),
        })
        .then((result) => {
          if (active) {
            setData(result);
            setLoadError("");
          }
        })
        .catch(() => {
          if (active) setLoadError("Couldn't load files. Try again.");
        })
        .finally(() => {
          inFlight = false;
          if (active) setPageLoading(false);
        });
    };
    const initial = setTimeout(load, 200);
    const timer = setInterval(load, 2000);
    return () => {
      active = false;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [folder.id, parent, query, category, extension, sort, descending, offset]);
  const action = async (path: string, reveal = false) => {
    setError("");
    try {
      const result = await (reveal ? api.revealFile(path) : api.openFile(path));
      if (!result.success) setError("Couldn't open this item.");
    } catch {
      setError(
        "Couldn't open this file. For apps or scripts, use Show in folder.",
      );
    }
  };
  const navigateFolder = (path: string) => {
    setParent(path); setQuery(""); setCategory(""); setOffset(0);
  };
  const separator = folder.path.includes("\\") ? "\\" : "/";
  const relative = parent.slice(folder.path.length).split(/[\\/]/).filter(Boolean);
  const breadcrumbs = [{name: folder.name, path: folder.path}, ...relative.map((name, index) => ({
    name, path: folder.path.replace(/[\\/]$/, "") + separator + relative.slice(0, index + 1).join(separator),
  }))];
  return (
    <section className="space-y-4 mt-6" aria-label="File browser">
      <div className="flex flex-wrap gap-3 items-center">
        <Button disabled={!selected.length} onClick={() => navigate("assistant")}>Ask in Assistant</Button>
        <Button disabled={!selected.length} onClick={() => navigate("organize")}>Organize selection</Button>
        {selected.length > 0 && <Button variant="ghost" onClick={() => setSelected([])}>Clear selection ({selected.length})</Button>}
      </div>
      {asking && (
        <Modal
          isOpen
          onClose={() => setAsking(false)}
          title="Ask about selected files"
          maxWidth="lg"
        >
          <p className="mb-3">
            Only these {selected.length} selected files are used. AI can read
            text, source code, and PDFs with selectable text, up to 5 MB per
            file. Images, audio, video, and other binary formats are listed but
            cannot be understood. Excerpts are limited to 40 lines per file.
          </p>
          <details className="mb-3">
            <summary>Which formats can be read?</summary>
            <p className="text-xs break-all">
              {formats.join(", ") || "Opening format list..."}
            </p>
            <p className="text-sm">
              Credentials, excluded files, and image-only PDFs are not read.
              Office documents, images, audio, and video have metadata only.
            </p>
          </details>
          <ul className="text-xs mb-3">
            {selected.map((path) => (
              <li key={path} className="break-all">
                {path}
              </li>
            ))}
          </ul>
          <select
            aria-label="AI provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="my-3">
            {providers.find((p) => p.id === provider)?.is_local
              ? "This option processes excerpts on your computer. Ollama is optional and must be installed to use it."
              : "Sending this question shares selected file paths, readable excerpts, and your question with the chosen cloud provider. Cloud AI is optional."}
          </p>
          <textarea
            className="gw-input"
            aria-label="Question about selected files"
            placeholder="What would you like to know?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button
            disabled={!question.trim() || aiBusy}
            onClick={async () => {
              setAiBusy(true);
              try {
                const result = await api.queryAI(
                  question,
                  undefined,
                  provider,
                  undefined,
                  undefined,
                  undefined,
                  selected,
                );
                setAnswer(result.answer);
                setSources(result.citations);
              } catch {
                setAnswer(
                  "Couldn't get an answer. Check your AI settings or try again.",
                );
              } finally {
                setAiBusy(false);
              }
            }}
          >
            {aiBusy ? "Reading selected files..." : "Send question"}
          </Button>
          <p className="whitespace-pre-wrap mt-4" role="status">
            {answer}
          </p>
          {sources.map((source) => (
            <Button key={source.path} onClick={() => void action(source.path)}>
              Open {source.filename} (lines {source.line_start}-
              {source.line_end})
            </Button>
          ))}
        </Modal>
      )}
      <h2 className="text-xl font-semibold">Browse {folder.name}</h2>
      <p className="text-sm">
        {data ? data.files.toLocaleString() : "Opening inventory..."}{" "}
        {data ? "files" : ""} · {size(data?.bytes ?? 0)} · {selected.length}{" "}
        selected
      </p>
      {selected.length > 6 && (
        <p role="status">Choose up to six files for one question.</p>
      )}
      <p className="text-sm text-[var(--ink-secondary)]">
        All file types appear here. Search names and paths without AI. Counts
        and sizes update during scanning; content search is prepared separately.
      </p>
      <StorageCategoryStrip categories={data?.category_breakdown ?? []} active={category}
        folderName={folder.name} provisional={data?.scan_status !== "completed"}
        onChange={(value) => { setCategory(value); setOffset(0); }} />
      <div className="flex gap-2 flex-wrap">
        <input
          className="gw-input"
          aria-label="Search file names and paths"
          placeholder="Search file names and paths"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <input
          className="gw-input"
          aria-label="File extension filter"
          placeholder="File type, e.g. .pdf"
          value={extension}
          onChange={(e) => {
            setExtension(e.target.value);
            setOffset(0);
          }}
        />
        <select
          aria-label="Sort files"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setOffset(0);
          }}
        >
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="modified">Modified</option>
          <option value="type">Type</option>
        </select>
        <Button
          disabled={!selected.length || selected.length > 6}
          onClick={() => {
            setAsking(true);
            setAnswer("");
            setSources([]);
            api
              .getReadableFormats()
              .then((result) => setFormats(result.extensions))
              .catch(() => setError("Couldn't load supported formats."));
            api
              .listProviders()
              .then((values) => {
                setProviders(values);
                setProvider(values.find((p) => p.active)?.id ?? "local");
              })
              .catch(() => setError("Couldn't load AI options."));
          }}
        >
          Ask about selected files
        </Button>
        <Button onClick={() => setDescending(!descending)}>
          {descending ? "Descending" : "Ascending"}
        </Button>
        <Button
          disabled={parent === folder.path || !!query || !!category}
          onClick={() => {
            const separator = Math.max(
              parent.lastIndexOf("\\"),
              parent.lastIndexOf("/"),
            );
            const next = parent.slice(0, separator);
            setParent(next.length < folder.path.length ? folder.path : next);
            setOffset(0);
          }}
        >
          Up one folder
        </Button>
        <Button
          onClick={() => {
            setParent(folder.path);
            setQuery("");
            setCategory("");
            setOffset(0);
          }}
        >
          Folder root
        </Button>
        <Button
          onClick={() =>
            api
              .startIndexing(folder.id)
              .catch(() => setError("Couldn't start scanning."))
          }
        >
          Scan again
        </Button>
      </div>
      <p role="status">
        {data?.scan_status === "scanning"
          ? "Scanning files: totals are still growing"
          : data?.scan_status === "cancelled"
            ? "Scan cancelled: showing partial or previously scanned files"
            : data?.scan_status === "completed_with_errors"
              ? "Scan finished with access errors: some files may be missing or out of date"
              : data?.scan_status === "failed"
                ? "Scan failed — showing previously discovered files"
                : data?.scan_status === "completed"
                  ? "File scan complete"
                  : "Waiting for a file scan"}
      </p>
      {!!data?.errors.length && (
        <details>
          <summary>{data.errors.length} scan errors</summary>
          {data.errors.map((text, i) => (
            <p key={i} className="text-xs break-all">
              {text}
            </p>
          ))}
        </details>
      )}
      <nav aria-label="Folder breadcrumbs" className="flex flex-wrap items-center gap-2 text-sm break-all">
        {breadcrumbs.map((crumb, index) => <span key={crumb.path} className="inline-flex items-center gap-2">
          {index > 0 && <span aria-hidden="true">/</span>}
          <button className="min-h-10 underline underline-offset-4" onClick={() => navigateFolder(crumb.path)}
            aria-current={!query && !category && index === breadcrumbs.length - 1 ? "location" : undefined}>{crumb.name}</button>
        </span>)}
      </nav>
      {(query || category) && <p className="text-xs text-[var(--ink-secondary)]">Matching files across all subfolders · size bars show share of {folder.name}</p>}
      {(error || loadError) && <p role="alert">{error || loadError}</p>}
      <div className="overflow-auto">
        <table className="w-full table-fixed text-sm text-left">
          <thead>
            <tr>
              <th className="w-10"><span className="sr-only">Select</span></th>
              <th>Name / path</th>
              <th className="hidden lg:table-cell w-20">Type</th>
              <th className="hidden sm:table-cell w-36">Size</th>
              <th className="hidden xl:table-cell w-36">Modified</th>
              <th className="w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!pageLoading &&
              data?.items.map((item) => (
                <tr key={item.path} className="border-b border-[var(--border)]">
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.name}`}
                      disabled={item.kind !== "file"}
                      checked={selected.includes(item.path)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, item.path]
                            : selected.filter((p) => p !== item.path),
                        )
                      }
                    />
                  </td>
                  <td className="py-3">
                    <button
                      className="flex flex-wrap items-center gap-2 text-left break-all min-h-10"
                      onClick={() => {
                        if (item.kind === "folder") {
                          navigateFolder(item.path);
                        } else void action(item.path);
                      }}
                    >
                      <FileGlyph kind={item.kind} extension={item.extension} />
                      {item.name}
                    </button>
                    <p title={item.path} className="text-xs break-all line-clamp-2 text-[var(--ink-secondary)]">
                      {item.path}
                    </p>
                    <p className="xl:hidden text-xs text-[var(--ink-secondary)]">
                      Modified {new Date(item.mtime * 1000).toLocaleString()}
                    </p>
                    <div className="sm:hidden mt-2"><SizeBar item={item} parentBytes={data.parent_bytes} /></div>
                  </td>
                  <td className="hidden lg:table-cell break-all">
                    {item.kind === "file"
                      ? item.extension || "File"
                      : item.kind}
                  </td>
                  <td className="hidden sm:table-cell">
                    <SizeBar item={item} parentBytes={data.parent_bytes} />
                  </td>
                  <td className="hidden xl:table-cell">{new Date(item.mtime * 1000).toLocaleString()}</td>
                  <td>
                    <Button onClick={() => void action(item.path, true)}>
                      Show in folder
                    </Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {pageLoading && <p role="status">Opening files...</p>}
      {!pageLoading && data && !data.items.length && (
        <p>No matching items. Try clearing filters or scan again.</p>
      )}
      <div className="flex flex-wrap gap-3 items-center">
        <Button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          Previous
        </Button>
        <span>{data?.total ?? 0} matching items</span>
        <Button
          disabled={!data || offset + 100 >= data.total}
          onClick={() => setOffset(offset + 100)}
        >
          Next
        </Button>
      </div>
    </section>
  );
}
