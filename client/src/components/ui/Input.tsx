// src/components/ui/Input.tsx
import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

/**
 * Styled input component that follows the design-system tokens.
 * Uses var(--control-height) for height and appropriate focus styles.
 */
export const Input: React.FC<InputProps> = ({ className = "", ...rest }) => {
  const baseClasses =
    "w-full px-3 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" +
    " bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)]" +
    " hover:bg-[var(--bg-surface-hover)]";
  const combined = `${baseClasses} ${className}`;
  return <input className={combined} {...rest} />;
};

export default Input;
