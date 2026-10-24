import type { CSSProperties } from "react";

import { KindIcon } from "@/components/common/kind-icon";
import { TagChip } from "@/components/common/tag-chip";
import { Skeleton } from "@/components/ui/skeleton";
import type { Knowledge } from "@/lib/api/types";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

export const rowId = (id: string) => `knowledge-option-${id}`;
const MAX_CHIPS = 2;

type RowProps = {
  item: Knowledge;
  narrow: boolean;
  selected: boolean;
  active: boolean;
  style: CSSProperties;
  index: number;
  onSelect: () => void;
};

/** design.md §4.7 row. Narrow rows drop tags/date like the mobile mockup. */
export function KnowledgeRow({ item, narrow, selected, active, style, index, onSelect }: RowProps) {
  const extra = item.tags.length - MAX_CHIPS;
  return (
    <div
      id={rowId(item.id)}
      role="option"
      aria-selected={selected}
      data-index={index}
      data-active={active || undefined}
      onClick={onSelect}
      style={style}
      className={cn(
        "absolute inset-x-0 flex cursor-pointer items-center gap-4 border-b border-border px-4 hover:bg-accent/60",
        selected && "bg-accent shadow-[inset_2px_0_0_var(--foreground)]",
        active && "group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50 group-focus-visible:ring-inset",
      )}
    >
      <KindIcon kind={item.kind} className="size-[18px] shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{item.title}</div>
        <div className="truncate text-sm text-muted-foreground">{item.summary}</div>
      </div>
      {!narrow && (
        <div className="flex shrink-0 items-center gap-2">
          {item.tags.slice(0, MAX_CHIPS).map((name) => (
            <TagChip key={name} name={name} />
          ))}
          {extra > 0 && <span className="text-data">+{extra}</span>}
          <span className="w-14 text-right text-data">{formatDay(item.updated_at)}</span>
        </div>
      )}
    </div>
  );
}

export function KnowledgeRowSkeleton({ style, narrow }: { style: CSSProperties; narrow: boolean }) {
  return (
    <div style={style} className="absolute inset-x-0 flex items-center gap-4 border-b border-border px-4" aria-hidden>
      <Skeleton className="size-[18px] shrink-0" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      {!narrow && <Skeleton className="h-5 w-32" />}
    </div>
  );
}
