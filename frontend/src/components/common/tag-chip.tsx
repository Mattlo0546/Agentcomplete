import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type TagChipProps = {
  name: string;
  /** Similarity or other trailing data, rendered as `text-data`. */
  meta?: ReactNode;
  selected?: boolean;
  onRemove?: () => void;
  className?: string;
};

/** design.md §4.6. */
export function TagChip({ name, meta, selected, onRemove, className }: TagChipProps) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 font-mono text-[11.5px] whitespace-nowrap",
        selected ? "bg-foreground text-background" : "bg-muted",
        className,
      )}
    >
      {name}
      {meta !== undefined && <span className="text-data text-[11px]">{meta}</span>}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove tag ${name}`}
          onClick={onRemove}
          className="-mr-1 grid size-4 place-items-center"
        >
          <X className={cn("size-3", selected ? "text-background" : "text-muted-foreground")} />
        </button>
      )}
    </span>
  );
}
