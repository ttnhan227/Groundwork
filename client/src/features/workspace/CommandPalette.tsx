import { Command, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type WorkspaceCommand = {
  id: string;
  label: string;
  detail: string;
  icon: ReactNode;
  shortcut?: string;
  run: () => void;
};

export function CommandPalette({ commands, onClose }: { commands: WorkspaceCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? commands.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(term)) : commands;
  }, [commands, query]);

  useEffect(() => { input.current?.focus(); }, []);
  function choose(command: WorkspaceCommand | undefined) {
    if (!command) return;
    onClose();
    command.run();
  }

  return <div className="command-palette-wrap" role="presentation">
    <button className="command-palette-backdrop" aria-label="Close command palette" onClick={onClose} />
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="Workspace commands">
      <header><Search size={18} /><input ref={input} value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(visible.length - 1, value + 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)); }
        if (event.key === "Enter") { event.preventDefault(); choose(visible[selected]); }
        if (event.key === "Escape") onClose();
      }} placeholder="Go somewhere or start an action…" aria-label="Search commands" /><kbd>Esc</kbd><button aria-label="Close command palette" onClick={onClose}><X size={15} /></button></header>
      <div>{visible.map((item, index) => <button key={item.id} className={selected === index ? "selected" : ""} onMouseEnter={() => setSelected(index)} onClick={() => choose(item)}><span>{item.icon}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</button>)}{!visible.length && <p>No matching workspace command.</p>}</div>
      <footer><Command size={13} /> Use ↑↓ to navigate and Enter to open</footer>
    </section>
  </div>;
}
