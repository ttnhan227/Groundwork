import React, { forwardRef } from "react";

export type ButtonVariant =
  "primary" | "human" | "agent" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  children?: React.ReactNode;
}

/**
 * Reusable Button primitive adhering to the Groundwork Dual-Ink Design System.
 * - `human` / `primary`: ink-blue accent for human-authored actions
 * - `agent`: ink-sepia accent for AI/agent verification & actions
 * - `secondary`: tactile surface background with hairline border
 * - `ghost`: unobtrusive Notion-style hover reveal button
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "secondary",
      size = "md",
      isLoading = false,
      disabled = false,
      className = "",
      children,
      ...rest
    },
    ref,
  ) => {
    const baseClasses =
      "inline-flex items-center justify-center gap-1.5 font-medium transition-all select-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none rounded-[var(--radius-sm)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1";

    const sizeClasses: Record<ButtonSize, string> = {
      xs: "h-6 px-2 text-[11px] leading-tight",
      sm: "h-7 px-2.5 text-xs leading-none",
      md: "h-[34px] px-3.5 text-[13px] leading-none",
      lg: "h-10 px-4 text-sm leading-none",
    };

    const variantClasses: Record<ButtonVariant, string> = {
      primary:
        "bg-[var(--ink-blue)] text-white hover:bg-[var(--ink-blue-hover)] active:bg-[var(--ink-blue-hover)] shadow-[var(--shadow-subtle)] focus-visible:outline-[var(--ink-blue)] border border-transparent",
      human:
        "bg-[var(--ink-blue)] text-white hover:bg-[var(--ink-blue-hover)] active:bg-[var(--ink-blue-hover)] shadow-[var(--shadow-subtle)] focus-visible:outline-[var(--ink-blue)] border border-transparent",
      agent:
        "bg-[var(--ink-sepia)] text-white hover:bg-[var(--ink-sepia-hover)] active:bg-[var(--ink-sepia-hover)] shadow-[var(--shadow-subtle)] focus-visible:outline-[var(--ink-sepia)] border border-transparent",
      secondary:
        "bg-[var(--surface)] text-[var(--ink)] border border-[var(--hairline)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface-active)] shadow-[var(--shadow-subtle)] focus-visible:outline-[var(--ink-blue)]",
      outline:
        "bg-transparent text-[var(--ink)] border border-[var(--hairline-strong)] hover:bg-[var(--surface-hover)] focus-visible:outline-[var(--ink-blue)]",
      ghost:
        "bg-transparent text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] active:bg-[var(--surface-active)] focus-visible:outline-[var(--ink-blue)] border border-transparent",
      danger:
        "bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger-border)] hover:bg-[var(--danger)] hover:text-white active:opacity-90 focus-visible:outline-[var(--danger)]",
    };

    const combined = `${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`;

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={combined}
        {...rest}
      >
        {isLoading && (
          <span className="spin inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full mr-1" />
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
export default Button;
