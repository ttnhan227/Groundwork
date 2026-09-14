import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Command, Search, X } from "lucide-react";

export type WorkspaceCommand = {
  id: string;
  label: string;
  detail: string;
  icon: ReactNode;
  shortcut?: string;
  run: () => void;
};

export interface CommandPaletteProps {
  commands: WorkspaceCommand[];
  onClose: () => void;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term
      ? commands.filter((item) =>
          `${item.label} ${item.detail}`.toLowerCase().includes(term),
        )
      : commands;
  }, [commands, query]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function choose(command: WorkspaceCommand | undefined) {
    if (!command) return;
    onClose();
    command.run();
  }

  return (
    <div
      className="command-palette-wrap fixed inset-0 z-50 flex items-start justify-center pt-[15vh] sm:pt-[18vh] p-4 sm:p-6"
      role="presentation"
    >
      {/* Backdrop */}
      <div
        className="command-palette-backdrop fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Palette Container */}
      <section
        className="command-palette relative z-10 w-full max-w-xl bg-[var(--surface)] border border-[var(--hairline-strong)] rounded-[var(--radius-lg)] shadow-[var(--shadow-modal)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-label="Groundwork commands"
      >
        {/* Search Header */}
        <header className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--hairline)] bg-[var(--surface)]">
          <Search size={18} className="text-[var(--ink-muted)] flex-shrink-0" />
          <input
            ref={input}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((value) => Math.min(visible.length - 1, value + 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((value) => Math.max(0, value - 1));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                choose(visible[selected]);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder="Go somewhere or start an action…"
            aria-label="Search commands"
            className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] font-sans h-auto p-0"
          />
          <kbd className="text-[11px] font-mono font-medium text-[var(--ink-muted)] px-1.5 py-0.5 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] flex-shrink-0 select-none">
            Esc
          </kbd>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-hover)] p-1 rounded-[var(--radius-xs)] transition-colors flex-shrink-0 cursor-pointer"
            aria-label="Close command palette"
          >
            <X size={15} />
          </button>
        </header>

        {/* Command Items List */}
        <div className="max-h-[360px] overflow-y-auto p-1.5 space-y-0.5">
          {visible.map((item, index) => {
            const isSelected = selected === index;
            return (
              <button
                key={item.id}
                type="button"
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] text-left transition-colors cursor-pointer group min-w-0 ${
                  isSelected
                    ? "bg-[var(--surface-hover)] text-[var(--ink)]"
                    : "text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
                }`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => choose(item)}
              >
                <span
                  className={`flex-shrink-0 p-1.5 rounded-[var(--radius-sm)] transition-colors ${
                    isSelected
                      ? "bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)]"
                      : "bg-[var(--paper-subtle)] text-[var(--ink-muted)] group-hover:text-[var(--ink-secondary)]"
                  }`}
                >
                  {item.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs sm:text-[13px] font-medium text-[var(--ink)] truncate">
                    {item.label}
                  </div>
                  {item.detail && (
                    <div className="text-[11px] text-[var(--ink-muted)] truncate">
                      {item.detail}
                    </div>
                  )}
                </div>
                {item.shortcut && (
                  <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--paper-subtle)] border border-[var(--hairline)] text-[var(--ink-muted)] flex-shrink-0">
                    {item.shortcut}
                  </kbd>
                )}
              </button>
            );
          })}
          {!visible.length && (
            <div className="py-8 text-center text-xs text-[var(--ink-muted)] font-sans">
              No matching workspace command.
            </div>
          )}
        </div>

        {/* Footer Navigation Hints */}
        <footer className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--hairline)] bg-[var(--paper-subtle)] text-[11px] text-[var(--ink-muted)] font-sans select-none">
          <div className="flex items-center gap-1.5">
            <Command
              size={12}
              className="text-[var(--ink-muted)] flex-shrink-0"
            />
            <span>Command Palette</span>
          </div>
          <div className="flex items-center gap-1">
            <span>Use</span>
            <kbd className="px-1 py-0.5 rounded bg-[var(--surface)] border border-[var(--hairline)] text-[10px] font-mono">
              ↑
            </kbd>
            <kbd className="px-1 py-0.5 rounded bg-[var(--surface)] border border-[var(--hairline)] text-[10px] font-mono">
              ↓
            </kbd>
            <span>to navigate,</span>
            <kbd className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--hairline)] text-[10px] font-mono">
              Enter
            </kbd>
            <span>to open</span>
          </div>
        </footer>
      </section>
    </div>
  );
}

export default CommandPalette;
