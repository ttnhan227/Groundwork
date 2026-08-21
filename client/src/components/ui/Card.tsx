// src/components/ui/Card.tsx
import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children: React.ReactNode;
}

/**
 * Simple card component that uses the design-system surface background,
 * border, and subtle shadow. It also provides a focus-visible style for
 * keyboard navigation when used as an interactive container.
 */
export const Card: React.FC<CardProps> = ({ className = "", children, ...rest }) => {
  const baseClasses =
    "bg-[var(--bg-surface)] border border-[var(--border-default)] rounded shadow-sm p-4" +
    " focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  const combined = `${baseClasses} ${className}`;
  return (
    <div className={combined} {...rest}>
      {children}
    </div>
  );
};

export default Card;
