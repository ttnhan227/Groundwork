import React, { forwardRef } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  endAdornment?: React.ReactNode;
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      icon,
      endAdornment,
      className = "",
      disabled,
      error = false,
      "aria-invalid": ariaInvalid,
      ...rest
    },
    ref,
  ) => {
    const isInvalid =
      error || ariaInvalid === true || ariaInvalid === "true";

    const wrapperState = disabled
      ? "opacity-50 cursor-not-allowed bg-[var(--paper-subtle)]"
      : isInvalid
        ? "border-[var(--danger-border)] bg-[var(--danger-bg)] focus-within:border-[var(--danger)] focus-within:ring-2 focus-within:ring-[var(--danger-border)]"
        : "hover:border-[var(--hairline-strong)] focus-within:border-[var(--ink-blue-border)] focus-within:ring-2 focus-within:ring-[var(--ink-blue-faint)]";

    return (
      <div
        className={`relative inline-flex items-center w-full rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] transition-all ${wrapperState}`}
      >
        {icon && (
          <span
            className={`flex items-center justify-center pl-2.5 pointer-events-none select-none ${
              isInvalid ? "text-[var(--danger)]" : "text-[var(--ink-muted)]"
            }`}
          >
            {icon}
          </span>
        )}
        <input
          ref={ref}
          disabled={disabled}
          aria-invalid={isInvalid || undefined}
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
