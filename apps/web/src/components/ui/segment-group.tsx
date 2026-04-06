"use client";

import { createContext, useCallback, useContext, useMemo } from "react";

import { cn } from "~/lib/utils";

interface SegmentGroupContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const SegmentGroupContext = createContext<SegmentGroupContextValue | null>(null);

function SegmentGroup({
  value,
  onValueChange,
  className,
  children,
  ...props
}: {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "onChange">) {
  const contextValue = useMemo(() => ({ value, onValueChange }), [value, onValueChange]);
  return (
    <SegmentGroupContext.Provider value={contextValue}>
      <div
        className={cn(
          "inline-flex items-center gap-0.5 rounded-lg bg-muted/50 p-1 ring-1 ring-border/40",
          className,
        )}
        data-slot="segment-group"
        role="radiogroup"
        {...props}
      >
        {children}
      </div>
    </SegmentGroupContext.Provider>
  );
}

function SegmentItem({
  value,
  className,
  children,
  ...props
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onClick">) {
  const context = useContext(SegmentGroupContext);
  if (!context) {
    throw new Error("SegmentItem must be used within a SegmentGroup");
  }

  const isActive = context.value === value;
  const handleClick = useCallback(() => context.onValueChange(value), [context, value]);

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      data-slot="segment-item"
      data-active={isActive || undefined}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
        isActive
          ? "bg-accent/80 text-accent-foreground shadow-sm ring-1 ring-border/50"
          : "text-muted-foreground/50 hover:bg-accent/30 hover:text-foreground/70",
        className,
      )}
      onClick={handleClick}
      {...props}
    >
      {children}
    </button>
  );
}

export { SegmentGroup, SegmentItem };
