import React from "react";

export type BadgeVariant = "human" | "agent" | "neutral" | "success" | "warning" | "danger" | "outline";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = "neutral",
  icon,
  className = "",
  children,
  ...rest
}) => {
  const baseClasses =
    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-xs)] text-[11px] font-medium tracking-tight select-none";

  const variantClasses: Record<BadgeVariant, string> = {
    human: "bg-[var(--ink-blue-subtle)] text-[var(--ink-blue)] border border-[var(--ink-blue-border)]",
    agent: "bg-[var(--ink-sepia-subtle)] text-[var(--ink-sepia)] border border-[var(--ink-sepia-border)] font-mono",
    neutral: "bg-[var(--paper-subtle)] text-[var(--ink-secondary)] border border-[var(--hairline)]",
    outline: "bg-transparent text-[var(--ink-secondary)] border border-[var(--hairline-strong)]",
    success: "bg-[var(--success-bg)] text-[var(--success)] border border-[var(--success-border)]",
    warning: "bg-[var(--warning-bg)] text-[var(--warning)] border border-[var(--warning-border)]",
    danger: "bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger-border)]",
  };

  return (
    <span className={`${baseClasses} ${variantClasses[variant]} ${className}`} {...rest}>
      {icon && <span className="flex-shrink-0 text-current">{icon}</span>}
      <span>{children}</span>
    </span>
  );
};

export default Badge;
