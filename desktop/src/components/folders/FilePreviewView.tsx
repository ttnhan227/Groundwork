import { useEffect, useRef, useState } from "react";
import { api, type FilePreview } from "../../services/api";
import { Button } from "../ui";
import { formatBytes } from "./StorageCategoryStrip";
import { LoadingState } from "../ui/LoadingState";

export function FilePreviewView({path, line = 1, showAI = true, onAsk, onBack, onPreviousFile, onNextFile}: {path: string; line?: number; showAI?: boolean; onAsk: (question: string, line: number) => void; onBack: () => void; onPreviousFile?: () => void; onNextFile?: () => void}) {
  const canvas = useRef<HTMLDivElement>(null);
  const options = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {if (!options.current?.contains(event.target as Node) && options.current) options.current.open = false;};
    const escape = (event: KeyboardEvent) => {if (event.key === "Escape" && options.current) options.current.open = false;};
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", escape);
    return () => {window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape);};
  }, []);
  const firstPage = path.toLowerCase().endsWith(".pdf") ? 1 : Math.floor((line - 1) / 200) + 1;
  const [page, setPage] = useState(firstPage);
  const [preview, setPreview] = useState<FilePreview>();
  const [loading, setLoading] = useState(true);
  const [renderingImage, setRenderingImage] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [question, setQuestion] = useState("");
  const [zoom, setZoom] = useState(100);
  const [fit, setFit] = useState(true);
  const pageCache = useRef(new Map<number, FilePreview>());
  const [showLines, setShowLines] = useState(false);
  useEffect(() => {pageCache.current.clear(); setPage(firstPage); setZoom(100); setFit(true); setQuestion(""); setShowLines(/\.(py|js|ts|tsx|jsx|json|css|html|java|cs|sql|sh|rs)$/i.test(path));}, [path, line]);
  useEffect(() => {pageCache.current.clear();}, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setPreview(undefined);
    const cached = pageCache.current.get(page);
    const request = cached ? Promise.resolve(cached) : api.previewFile(path, page, controller.signal);
    request.then(value => {if (!controller.signal.aborted) {pageCache.current.set(page, value); for (const key of pageCache.current.keys()) if (Math.abs(key - page) > 1) pageCache.current.delete(key); setPreview(value); setRenderingImage(["image", "pdf"].includes(value.kind));}})
      .catch(e => {if (!controller.signal.aborted) setError(e.message === "Failed to fetch" ? "Could not connect to the file preview service. Try again." : e.message);})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [path, page, revision]);
  useEffect(() => {
    if (!preview || preview.page !== page || page >= preview.pages || pageCache.current.has(page + 1)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.previewFile(path, page + 1, controller.signal).then(value => {
        if (!controller.signal.aborted && value.modified === preview.modified) {
          pageCache.current.set(page + 1, value);
          for (const key of pageCache.current.keys()) if (Math.abs(key - page) > 1) pageCache.current.delete(key);
        }
      }).catch(() => {/* Foreground navigation shows actionable errors. */});
    }, 150);
    return () => {clearTimeout(timer); controller.abort();};
  }, [preview, page, path]);
  useEffect(() => {canvas.current?.scrollTo({top: 0, left: 0});}, [preview?.page, path]);
  const changeZoom = (delta: number) => {setFit(false); setZoom(value => Math.min(250, Math.max(50, value + delta)));};
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "F5") {event.preventDefault(); setRevision(value => value + 1); return;}
      if (event.altKey && event.key === "ArrowLeft") {event.preventDefault(); onBack(); return;}
      if ((event.target as HTMLElement)?.closest("input, textarea, select, button, summary")) return;
      if (!loading && preview?.kind === "image" && event.key === "ArrowLeft" && onPreviousFile) {event.preventDefault(); onPreviousFile();}
      else if (!loading && preview?.kind === "image" && event.key === "ArrowRight" && onNextFile) {event.preventDefault(); onNextFile();}
      else if (!loading && preview && event.key === "PageDown" && page < preview.pages) {event.preventDefault(); setPage(v => v + 1);}
      else if (!loading && event.key === "PageUp" && page > 1) {event.preventDefault(); setPage(v => v - 1);}
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [loading, preview, page, onBack, onPreviousFile, onNextFile]);
  return <div className="file-preview-view">
    <div className="file-preview-tools"><Button variant="ghost" title="Back to files (Alt+Left)" onClick={onBack}>Back to files</Button><div className="reader-file-title"><strong>{path.split(/[\\/]/).pop()}</strong><small>{path}</small></div><details ref={options} className="panel-options"><summary>File options</summary><div><small className="file-option-path">{path}</small><Button disabled={loading} onClick={() => setRevision(v => v + 1)}>Reload file</Button><Button onClick={() => api.openFile(path).catch(e => setError(e.message))}>Open with default app</Button><Button onClick={() => api.revealFile(path).catch(e => setError(e.message))}>Show in Explorer</Button></div></details></div>
    {loading && <LoadingState title="Opening file" detail={path.split(/[\\/]/).pop()} skeleton/>}
    {error && <div role="alert" className="gw-notice">{error}<Button disabled={loading} onClick={() => setRevision(v => v + 1)}>Try again</Button>{page > 1 && <Button onClick={() => setPage(1)}>Return to first page</Button>}</div>}
    {preview && preview.path === path && preview.page === page && <>
      <div className="reader-controls" role="toolbar" aria-label="Reading controls"><Button aria-label="Previous file" title="Previous file in the file list" disabled={!onPreviousFile || loading} onClick={onPreviousFile}>←</Button><Button aria-label="Next file" title="Next file in the file list" disabled={!onNextFile || loading} onClick={onNextFile}>→</Button>
        <Button aria-label="Zoom out" disabled={preview.kind === "unsupported" || zoom <= 50} onClick={() => changeZoom(-25)}>−</Button><span className="reader-zoom-value">{fit ? "Fit" : `${zoom}%`}</span><Button aria-label="Zoom in" disabled={preview.kind === "unsupported" || zoom >= 250} onClick={() => changeZoom(25)}>+</Button><Button aria-pressed={fit} onClick={() => {setFit(true); setZoom(100);}}>Fit to view</Button>
        {preview.pages > 1 && <div className="reader-page-controls"><Button disabled={loading || page <= 1} onClick={() => setPage(v => v - 1)}>Previous page</Button><span>{page} / {preview.pages}</span><Button disabled={loading || page >= preview.pages} onClick={() => setPage(v => v + 1)}>Next page</Button></div>}
        {preview.kind === "text" && <button className="preview-line-toggle" aria-pressed={showLines} onClick={() => setShowLines(v => !v)}>Line numbers</button>}
      </div>
      <div ref={canvas} tabIndex={0} role="region" aria-label="Reader content" className={`file-preview-content reader-canvas reader-kind-${preview.kind} ${fit ? "is-fit" : "is-zoomed"}`}><div className="workflow-section-title"><strong>{preview.kind === "text" ? "Document text" : preview.kind === "pdf" ? "PDF document" : "Image"}</strong><span>{preview.kind === "pdf" ? `Page ${page} of ${preview.pages}` : preview.kind === "text" ? `${preview.total_lines || preview.text.split("\n").length} lines` : preview.kind === "image" ? "Image" : "Unavailable"}</span></div>
      {preview.kind === "text" && <div className={`file-preview-text ${showLines ? "" : "document-reading-view"}`} style={{fontSize: `${14 * zoom / 100}px`}} aria-label="File text preview">{preview.text.split("\n").map((text, index) => <div key={index} className={line > 1 && preview.line_start + index === line ? "is-highlighted" : ""}>{showLines && <span>{preview.line_start + index}</span>}<code>{text || " "}</code></div>)}</div>}
      {(preview.kind === "image" || preview.kind === "pdf") && <>{renderingImage && <LoadingState title="Displaying page" detail="Preparing the image…"/>}<img key={`${path}:${page}:${revision}`} className={`file-preview-image ${renderingImage ? "is-rendering" : ""}`} style={fit ? undefined : {width: `${zoom}%`, maxWidth: "none", flex: "none"}} src={preview.image} onLoad={() => setRenderingImage(false)} onError={() => {setRenderingImage(false); setError("The preview image could not be displayed. Try refreshing it.");}} alt={`${preview.name}${preview.kind === "pdf" ? ` page ${page}` : ""}`}/></>}
      {preview.kind === "unsupported" && <p className="preview-help">{preview.message}</p>}
      {preview.truncated && <p className="text-xs">Very long lines were truncated for this preview.</p>}
      </div><div className="reader-status"><span>{formatBytes(preview.size)} · Read-only{preview.kind === "text" && /\.(docx|xlsx|pptx|odt|ods|odp|epub)$/i.test(path) ? " · Extracted text; original layout omitted" : ""}</span><details className="preview-help"><summary>Reading details</summary><p>{preview.message}</p></details></div>
      {showAI && <form className="file-preview-ai" onSubmit={event => {event.preventDefault(); if (!loading && question.trim()) onAsk(question.trim(), preview.line_start);}}>
        {["image", "unsupported"].includes(preview.kind) && <p className="preview-help">{preview.kind === "image" ? "AI can read written text using OCR. Image scenes are not interpreted." : "AI can explain file details. Contents cannot be read."}</p>}
        <label className="block text-sm">Ask about this file<input aria-label="Preview file question" className="gw-input mt-1" maxLength={2000} value={question} placeholder={preview.kind === "unsupported" ? "What type of file is this?" : "What do I need to know or do?"} onChange={e => setQuestion(e.target.value)}/></label>
        <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" disabled={loading || !question.trim()}>Ask about this file</Button><Button type="button" disabled={loading} onClick={() => onAsk(preview.kind === "unsupported" ? "Explain this file using its metadata. Clearly say its contents were not read. Do not claim it is safe to delete or execute." : "Summarize this file and cite the evidence. State when the excerpts are insufficient.", 1)}>{preview.kind === "unsupported" ? "Explain file" : "Summarize file"}</Button></div>
      </form>}
    </>}
  </div>;
}
