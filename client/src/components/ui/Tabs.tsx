import React from "react";

export interface TabItem<T extends string = string> {
  id: T;
  label: React.ReactNode;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
}

export interface TabsProps<T extends string = string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  variant?: "segment" | "line";
  size?: "sm" | "md";
  className?: string;
}

export function Tabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  variant = "segment",
  size = "md",
  className = "",
}: TabsProps<T>) {
  if (variant === "line") {
    return (
      <div
        className={`flex items-center gap-4 border-b border-[var(--hairline)] ${className}`}
        role="tablist"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={`inline-flex items-center gap-1.5 pb-2.5 pt-1 text-[13px] font-medium transition-all relative border-b-2 -mb-[1px] ${
                isActive
                  ? "border-[var(--ink-blue)] text-[var(--ink)] font-semibold"
                  : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)] hover:border-[var(--hairline-strong)]"
              }`}
            >
              {tab.icon && <span className="text-current">{tab.icon}</span>}
              <span>{tab.label}</span>
              {tab.badge && <span className="ml-1">{tab.badge}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  // Segmented variant
  const paddingClass = size === "sm" ? "p-0.5" : "p-1";
  const buttonClass =
    size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-[13px]";

  return (
    <div
      className={`inline-flex items-center bg-[var(--paper-subtle)] border border-[var(--hairline)] rounded-[var(--radius-sm)] ${paddingClass} ${className}`}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`inline-flex items-center justify-center gap-1.5 font-medium rounded-[var(--radius-xs)] transition-all cursor-pointer select-none ${buttonClass} ${
              isActive
                ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-subtle)] font-semibold"
                : "text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[rgba(0,0,0,0.02)]"
            }`}
          >
            {tab.icon && <span className="text-current">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge && <span className="ml-1">{tab.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
