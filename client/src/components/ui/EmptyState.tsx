import React from "react";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

/**
 * Lightweight empty / zero-data placeholder matching dual-ink surfaces.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = "",
  compact = false,
}) => {
  return (
    <div
      className={`${compact ? "py-6 px-3" : "py-10 px-4"} text-center space-y-1.5 ${className}`}
      role="status"
    >
      {icon && (
        <div className="mx-auto mb-1.5 flex justify-center text-[var(--ink-faint)] opacity-80">
          {icon}
        </div>
      )}
      <p className="font-serif text-sm font-semibold text-[var(--ink)]">{title}</p>
      {description && (
        <p className="text-xs text-[var(--ink-muted)] max-w-sm mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="pt-2.5 flex justify-center">{action}</div>}
    </div>
  );
};

export default EmptyState;
