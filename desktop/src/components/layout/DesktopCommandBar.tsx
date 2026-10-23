import { FolderTree, FolderGit2, Sparkles, Wand2, Monitor, History, NotebookPen, BookmarkCheck, Library, Settings, UserRound, Search, X, Maximize2, Minimize2, Trash2 } from "lucide-react";
import { BrandMark } from "../common/BrandMark";
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Eye } from "lucide-react";

export const desktopTools = [
  {id: "cleanup", label: "Cleanup", icon: Trash2},
  {id: "projects", label: "Projects", icon: FolderGit2},
  {id: "collections", label: "Collections", icon: Library},
  {id: "assistant", label: "Assistant", icon: Sparkles},
  {id: "organize", label: "Organize", icon: Wand2},
  {id: "computer", label: "Computer", icon: Monitor},
  {id: "activity", label: "Activity", icon: History},
  {id: "sessions", label: "Saved work", icon: BookmarkCheck},
  {id: "notes", label: "Notes", icon: NotebookPen},
  {id: "settings", label: "Settings", icon: Settings},
  {id: "account", label: "Account", icon: UserRound},
];

const primaryToolIds = ["cleanup", "computer", "assistant", "organize"];

export function DesktopCommandBar({active, onTool, onSearch}: {active: string; onTool: (id: string) => void; onSearch: () => void}) {
  const [more, setMore] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {if (!menu.current?.contains(event.target as Node)) setMore(false);};
    const escape = (event: KeyboardEvent) => {if(event.key === "Escape") setMore(false);};
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", escape);
    return () => {window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape);};
  }, []);
  return <header className="desktop-command-bar">
    <span className="desktop-brand"><BrandMark size={16}/>Groundwork</span>
    <button aria-pressed={active === "folders"} onClick={() => onTool("folders")}><FolderTree size={14}/>Files</button>
    <span className="explorer-separator"/>
    {desktopTools.filter(tool => primaryToolIds.includes(tool.id)).map((tool) => <button key={tool.id} title={tool.label} aria-label={tool.label} aria-pressed={active === tool.id} onClick={() => onTool(active === tool.id ? "folders" : tool.id)}><tool.icon size={16}/><span>{tool.label}</span></button>)}
    <div ref={menu} className="desktop-more"><button aria-label="More tools" aria-expanded={more} aria-controls="desktop-more-tools" onClick={() => setMore(!more)}><MoreHorizontal size={17}/><span>More</span></button>{more && <div id="desktop-more-tools" className="desktop-more-menu"><strong>More tools</strong>{desktopTools.filter(tool => !primaryToolIds.includes(tool.id)).map(tool => <button key={tool.id} onClick={() => {setMore(false); onTool(tool.id);}}><tool.icon size={16}/>{tool.label}</button>)}</div>}</div>
    <button className="desktop-find" title="Search files (Ctrl+K)" onClick={onSearch}><Search size={14}/><span>Find</span><kbd>Ctrl+K</kbd></button>
  </header>;
}
export function ToolPanelHeader({active, close, expanded, toggle, canExpand = true}: {active: string; close: () => void; expanded: boolean; toggle: () => void; canExpand?: boolean}) {
  const tool = desktopTools.find(tool => tool.id === active);
  const Icon = active === "preview" ? Eye : tool?.icon || Sparkles;
  const description = active === "preview" ? "Read the file here. Ask AI when you need help." : active === "cleanup" ? "Storage space map, largest folders, exact duplicates, and safe cleanup." : active === "computer" ? "Installed apps, guided uninstaller, leftover scanner, and system status." : active === "assistant" ? "Ask a question about files, storage, duplicates, or installed apps." : active === "projects" ? "Git repository status, branches, commits, and working tree diffs." : active === "collections" ? "Group related files. Their locations stay the same." : "Work with your selected files.";
  return <div className={`desktop-panel-header panel-${active}`}><div className="desktop-panel-identity"><span className="desktop-panel-icon"><Icon size={19}/></span><div><strong>{tool?.label ?? (active === "preview" ? "File preview" : active === "ai-settings" ? "AI setup" : "File investigation")}</strong><p>{description}</p></div></div><div className="flex gap-1">{canExpand && <button aria-label={expanded ? "Dock tool panel" : "Expand tool panel"} title={expanded ? "Return to docked view" : "More room for this tool"} onClick={toggle}>{expanded ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button>}<button aria-label="Close tool panel" title={canExpand ? "Return to full file workspace" : "Close Assistant and continue reading"} onClick={close}><X size={18}/></button></div></div>;
}
