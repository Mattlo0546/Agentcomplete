"use client";

import { useDebouncedCallback } from "@mantine/hooks";
import { Plus, Search } from "lucide-react";
import { useState } from "react";

import { Segmented } from "@/components/common/segmented";
import { TagChip } from "@/components/common/tag-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { KindFilter, KnowledgeFilters } from "@/lib/knowledge/api";

import { TagFilter } from "./tag-filter";

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "skill", label: "Skills" },
  { value: "prompt", label: "Prompts" },
  { value: "graph", label: "Graphs" },
];

type ToolbarProps = {
  filters: KnowledgeFilters;
  onFiltersChange: (filters: KnowledgeFilters) => void;
  narrow: boolean;
  /** Result count and unfiltered total for the `n of total` readout. */
  shown: number;
  total: number | undefined;
  onAdd: () => void;
};

/** design.md §4.7 toolbar: search, kind, tags, Add knowledge; selected tag chips below. */
export function KnowledgeToolbar({ filters, onFiltersChange, narrow, shown, total, onAdd }: ToolbarProps) {
  const [text, setText] = useState(filters.q);
  const pushQuery = useDebouncedCallback((q: string) => onFiltersChange({ ...filters, q }), 250);
  const filtered = filters.q !== "" || filters.kind !== "all" || filters.tags.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className={narrow ? "relative min-w-0 flex-1" : "relative w-72"}>
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search knowledge"
            placeholder="Search knowledge"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              pushQuery(e.target.value);
            }}
            className="pl-9"
          />
        </div>
        {!narrow && (
          <>
            <Segmented
              label="Kind"
              value={filters.kind}
              onChange={(kind) => onFiltersChange({ ...filters, kind })}
              options={KIND_OPTIONS}
            />
            <TagFilter selected={filters.tags} onChange={(tags) => onFiltersChange({ ...filters, tags })} />
          </>
        )}
        <Button onClick={onAdd} className="ml-auto shrink-0">
          <Plus />
          Add knowledge
        </Button>
      </div>
      {filtered && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.tags.map((name) => (
            <TagChip
              key={name}
              name={name}
              selected
              className="h-7 px-2.5"
              onRemove={() => onFiltersChange({ ...filters, tags: filters.tags.filter((t) => t !== name) })}
            />
          ))}
          <span className="text-data" aria-live="polite">
            {shown} of {total ?? "—"}
          </span>
        </div>
      )}
    </div>
  );
}
