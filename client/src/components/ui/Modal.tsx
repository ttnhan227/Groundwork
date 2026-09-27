import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  eyebrow?: string;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => {
    if (el.hasAttribute("disabled") || el.getAttribute("aria-hidden") === "true") {
      return false;
    }
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
  });
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  eyebrow,
  maxWidth = "lg",
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusInitial = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const autofocus = dialog.querySelector<HTMLElement>("[autofocus]");
      const nodes = getFocusable(dialog);
      (autofocus || nodes[0] || dialog).focus();
    };
    const focusTimer = window.setTimeout(focusInitial, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const nodes = getFocusable(dialog);
      if (nodes.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      const restore = previouslyFocused.current;
      if (restore && typeof restore.focus === "function") {
        restore.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const widthClasses: Record<string, string> = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
    full: "max-w-4xl",
  };

  const labelledBy =
    title && typeof title === "string" ? titleId : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog Surface */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`relative z-10 w-full ${widthClasses[maxWidth]} bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-lg)] shadow-[var(--shadow-modal)] flex flex-col max-h-[90vh] overflow-hidden select-text outline-none`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {(title || eyebrow) && (
          <header className="flex items-start justify-between px-6 py-4 border-b border-[var(--hairline)] bg-[var(--surface)]">
            <div>
              {eyebrow && (
                <p className="text-[10px] font-semibold tracking-wider uppercase text-[var(--ink-muted)] mb-0.5 font-mono">
                  {eyebrow}
                </p>
              )}
              {typeof title === "string" ? (
                <h3
                  id={titleId}
                  className="font-serif text-lg font-semibold text-[var(--ink)] tracking-tight"
                >
                  {title}
                </h3>
              ) : (
                title
              )}
            </div>
            <Button
              variant="ghost"
              size="xs"
              onClick={onClose}
              className="text-[var(--ink-muted)] hover:text-[var(--ink)] -mr-1.5"
              aria-label="Close dialog"
            >
              <X size={16} />
            </Button>
          </header>
        )}

        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
};

export default Modal;
