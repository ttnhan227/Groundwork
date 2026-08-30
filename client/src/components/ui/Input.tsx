import React, { forwardRef } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  endAdornment?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ icon, endAdornment, className = "", disabled, ...rest }, ref) => {
    return (
      <div
        className={`relative inline-flex items-center w-full rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] transition-all focus-within:border-[var(--ink-blue-border)] focus-within:ring-2 focus-within:ring-[var(--ink-blue-faint)] ${
          disabled
            ? "opacity-50 cursor-not-allowed bg-[var(--paper-subtle)]"
            : "hover:border-[var(--hairline-strong)]"
        }`}
      >
        {icon && (
          <span className="flex items-center justify-center pl-2.5 text-[var(--ink-muted)] pointer-events-none select-none">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          disabled={disabled}
          className={`w-full h-[34px] px-3 bg-transparent text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] outline-none border-0 ${
            icon ? "pl-2" : ""
          } ${endAdornment ? "pr-2" : ""} ${className}`}
          {...rest}
        />
        {endAdornment && (
          <span className="flex items-center justify-center pr-2 text-[var(--ink-muted)]">
            {endAdornment}
          </span>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
export default Input;
