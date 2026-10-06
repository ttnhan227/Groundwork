import { File, FileText, FileImage, FileAudio, FileVideo, FileArchive, FileCode, Folder, Link } from "lucide-react";

/** Format hints only: an icon does not promise content extraction support. */
export function FileGlyph({ kind = "file", extension = "" }: { kind?: string; extension?: string }) {
  const ext = extension.replace(/^\./, "").toLowerCase();
  const Icon = kind === "folder" ? Folder : kind === "link" ? Link
    : /^(jpg|jpeg|png|gif|webp|svg|bmp|heic)$/.test(ext) ? FileImage
    : /^(mp3|wav|flac|aac|m4a|ogg)$/.test(ext) ? FileAudio
    : /^(mp4|mov|mkv|avi|webm)$/.test(ext) ? FileVideo
    : /^(zip|tar|gz|7z|rar)$/.test(ext) ? FileArchive
    : /^(py|js|ts|tsx|rs|go|c|cpp|html|css|json)$/.test(ext) ? FileCode
    : /^(pdf|doc|docx|txt|md|rtf|xls|xlsx|csv|ppt|pptx)$/.test(ext) ? FileText : File;
  return <span className="inline-flex shrink-0 items-center gap-1.5 text-[var(--ink-secondary)]">
    <Icon size={18} aria-hidden="true" />
    {kind === "file" && ext && <span className="rounded border border-[var(--hairline)] px-1 py-0.5 text-[10px] font-semibold break-all max-w-20">{ext.toUpperCase()}</span>}
  </span>;
}
