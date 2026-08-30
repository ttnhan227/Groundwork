import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  padded?: boolean;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  interactive = false,
  padded = true,
  className = "",
  children,
  ...rest
}) => {
  const baseClasses =
    "bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-md)] shadow-[var(--shadow-card)] transition-all";
  const interactiveClasses = interactive
    ? "cursor-pointer hover:border-[var(--hairline-strong)] hover:shadow-[var(--shadow-popover)] active:bg-[var(--surface-hover)]"
    : "";
  const paddingClass = padded ? "p-4" : "";

  return (
    <div
      className={`${baseClasses} ${interactiveClasses} ${paddingClass} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
};

export default Card;
