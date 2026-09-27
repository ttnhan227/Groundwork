import React from "react";

export interface PanelHeaderProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  title: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  title,
  actions,
  className = "",
  ...rest
}) => {
  const baseClasses =
    "flex items-center justify-between px-3 py-2 border-b border-[var(--hairline)] bg-[var(--paper-subtle)]";
  const combined = `${baseClasses} ${className}`;
  return (
    <div className={combined} {...rest}>
      <div className="font-medium text-[var(--ink)]">{title}</div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
};

export default PanelHeader;
