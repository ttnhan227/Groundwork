import React, { useEffect } from "react";
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

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  eyebrow,
  maxWidth = "lg",
  children,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
        className={`relative z-10 w-full ${widthClasses[maxWidth]} bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-lg)] shadow-[var(--shadow-modal)] flex flex-col max-h-[90vh] overflow-hidden`}
        role="dialog"
        aria-modal="true"
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
                <h3 className="font-serif text-lg font-semibold text-[var(--ink)] tracking-tight">
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
