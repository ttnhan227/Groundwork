// src/components/ui/ResizablePanel.tsx
import React, { useRef, useEffect } from "react";

interface ResizablePanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Width in CSS units (e.g., "200px", "20%") */
  width?: string;
  /** Height in CSS units */
  height?: string;
  /** Optional callback when resize occurs */
  onResize?: () => void;
  children: React.ReactNode;
}

/**
 * Wrapper that provides a smooth CSS transition for size changes.
 * Useful for the three-column workspace panels.
 */
export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  width,
  height,
  onResize,
  className = "",
  children,
  ...rest
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (onResize) {
      const observer = new ResizeObserver(() => onResize());
      if (ref.current) observer.observe(ref.current);
      return () => observer.disconnect();
    }
  }, [onResize]);

  const style: React.CSSProperties = {
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    transition: "all 0.2s ease", // smooth resize
  };

  const baseClasses = "overflow-auto"; // ensure scroll when needed
  const combined = `${baseClasses} ${className}`;

  return (
    <div ref={ref} style={style} className={combined} {...rest}>
      {children}
    </div>
  );
};

export default ResizablePanel;
