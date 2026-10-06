import { FolderTree, Sparkles, Wand2, Monitor, History, NotebookPen, Bookmark, Settings, UserRound, Search, X, Maximize2, Minimize2 } from "lucide-react";
import { BrandMark } from "../common/BrandMark";

export const desktopTools = [
  {id: "assistant", label: "Assistant", icon: Sparkles},
  {id: "organize", label: "Organize", icon: Wand2},
  {id: "computer", label: "Computer", icon: Monitor},
  {id: "activity", label: "Activity", icon: History},
  {id: "sessions", label: "Saved work", icon: Bookmark},
  {id: "notes", label: "Notes", icon: NotebookPen},
  {id: "settings", label: "Settings", icon: Settings},
  {id: "account", label: "Account", icon: UserRound},
];

export function DesktopCommandBar({active, onTool, onSearch}: {active: string; onTool: (id: string) => void; onSearch: () => void}) {
  return <header className="desktop-command-bar">
    <span className="desktop-brand"><BrandMark size={16}/>Groundwork</span>
    <button aria-pressed={active === "folders"} onClick={() => onTool("folders")}><FolderTree size={14}/>Files & storage</button>
    <span className="explorer-separator"/>
    {desktopTools.map((tool) => <button key={tool.id} title={tool.label} aria-label={tool.label} aria-pressed={active === tool.id} onClick={() => onTool(active === tool.id ? "folders" : tool.id)}><tool.icon size={14}/><span>{tool.label}</span></button>)}
    <button className="desktop-find" title="Search files (Ctrl+K)" onClick={onSearch}><Search size={14}/><span>Find</span><kbd>Ctrl+K</kbd></button>
  </header>;
}
export function ToolPanelHeader({active, close, expanded, toggle}: {active: string; close: () => void; expanded: boolean; toggle: () => void}) {
  return <div className="desktop-panel-header"><strong>{desktopTools.find((tool) => tool.id === active)?.label ?? (active === "ai-settings" ? "AI setup" : "File investigation")}</strong><div className="flex gap-1"><button aria-label={expanded ? "Dock tool panel" : "Expand tool panel"} title={expanded ? "Return to docked view" : "More room for this tool"} onClick={toggle}>{expanded ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}</button><button aria-label="Close tool panel" title="Return to full file workspace" onClick={close}><X size={15}/></button></div></div>;
}
