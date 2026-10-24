"use client";

import { Search } from "lucide-react";

import { Segmented } from "@/components/common/segmented";
import { Input } from "@/components/ui/input";
import { KIND_OPTIONS, STATUS_OPTIONS, type KindFilter, type StatusFilter } from "@/lib/activity/filters";

type LogToolbarProps = {
  kind: KindFilter;
  status: StatusFilter;
  search: string;
  onKind: (kind: KindFilter) => void;
  onStatus: (status: StatusFilter) => void;
  onSearch: (value: string) => void;
};

/** design.md §4.10 toolbar. The status filter is hidden on narrow screens (mockup). */
export function LogToolbar({ kind, status, search, onKind, onStatus, onSearch }: LogToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented label="Kind" value={kind} onChange={onKind} options={KIND_OPTIONS} />
      <Segmented
        label="Status"
        value={status}
        onChange={onStatus}
        options={STATUS_OPTIONS}
        className="hidden md:inline-flex"
      />
      <div className="relative ml-auto hidden w-60 md:block">
        <Search aria-hidden className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Request id"
          placeholder="Request id"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          className="h-8 pl-8 font-mono text-xs md:text-xs"
        />
      </div>
    </div>
  );
}
