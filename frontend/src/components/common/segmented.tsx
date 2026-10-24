"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type SegmentedProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
};

/** design.md: segmented control (muted track, raised card thumb). */
export function Segmented<T extends string>({ value, onChange, options, label, className }: SegmentedProps<T>) {
  return (
    <ToggleGroup
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
      className={cn("inline-flex gap-0.5 rounded-md bg-muted p-0.5", className)}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className="h-7 rounded-sm border-0 px-2.5 text-xs font-medium text-muted-foreground shadow-none data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:ring-1 data-[state=on]:ring-border"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
