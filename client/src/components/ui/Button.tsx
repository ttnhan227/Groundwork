// src/components/ui/Button.tsx
import React, { forwardRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children?: React.ReactNode;
}

/**
 * Reusable button component that uses the design-system CSS custom properties.
 * Supports "primary", "secondary", "ghost", and "danger" visual variants.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className = "", children, ...rest }, ref) => {
    const baseClasses =
      "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
    
    let variantClasses = "";
    if (variant === "primary") {
      variantClasses = "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]";
    } else if (variant === "secondary") {
      variantClasses = "bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] hover:bg-[var(--bg-subtle)]";
    } else if (variant === "ghost") {
      variantClasses = "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]";
    } else if (variant === "danger") {
      variantClasses = "bg-[var(--danger-bg)] text-[var(--danger)] border border-[var(--danger-border)] hover:bg-[var(--danger)] hover:text-white";
    }

    const combined = `${baseClasses} ${variantClasses} ${className}`;

    return (
      <button ref={ref} className={combined} {...rest}>
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;
