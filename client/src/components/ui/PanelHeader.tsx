// src/components/ui/PanelHeader.tsx
import React from "react";

export interface PanelHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Title text or element */
  title: React.ReactNode;
  /** Optional actions (e.g., buttons) placed on the right */
  actions?: React.ReactNode;
  /** Additional class names */
  className?: string;
}

/**
 * Standardized header for panels (e.g., workspace columns).
 * Uses design-system background and border tokens.
 */
export const PanelHeader: React.FC<PanelHeaderProps> = ({
  title,
  actions,
  className = "",
  ...rest
}) => {
  const baseClasses =
    "flex items-center justify-between px-3 py-2 border-b border-[var(--border-default)] bg-[var(--bg-subtle)]";
  const combined = `${baseClasses} ${className}`;
  return (
    <div className={combined} {...rest}>
      <div className="font-medium text-[var(--text-primary)]">{title}</div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
};

export default PanelHeader;
