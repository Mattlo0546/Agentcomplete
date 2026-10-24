"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import type { Knowledge } from "@/lib/api/types";

import { KnowledgeRow, KnowledgeRowSkeleton, rowId } from "./knowledge-row";

type ListProps = {
  items: Knowledge[];
  narrow: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  onRetry: () => void;
  filtered: boolean;
  onAdd: () => void;
  onClearFilters: () => void;
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
      {children}
    </div>
  );
}

function Centered({ label, action, onAction }: { label: string; action: string; onAction: () => void }) {
  return (
    <Frame>
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-label">{label}</p>
        <Button variant="outline" size="sm" onClick={onAction}>
          {action}
        </Button>
      </div>
    </Frame>
  );
}

/** design.md §4.7: virtualised, infinitely paged listbox. */
export function KnowledgeList(props: ListProps) {
  const { items, narrow, selectedId, onSelect, loading, error, hasNextPage, fetchNextPage } = props;
  const rowHeight = narrow ? 72 : 64;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const count = items.length + (hasNextPage ? 1 : 0);

  // eslint-disable-next-line react-hooks/incompatible-library -- virtualizer functions are only used in render
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? -1;

  useEffect(() => {
    if (hasNextPage && lastIndex >= items.length - 6) fetchNextPage();
  }, [hasNextPage, lastIndex, items.length, fetchNextPage]);

  if (error && items.length === 0)
    return <Centered label="Couldn't load knowledge" action="Retry" onAction={props.onRetry} />;
  if (loading) {
    return (
      <Frame>
        <div aria-busy="true" aria-label="Loading knowledge" className="relative flex-1">
          {Array.from({ length: 8 }, (_, i) => (
            <KnowledgeRowSkeleton key={i} narrow={narrow} style={{ top: i * rowHeight, height: rowHeight }} />
          ))}
        </div>
      </Frame>
    );
  }
  if (items.length === 0) {
    return props.filtered ? (
      <Centered label="No matches" action="Clear filters" onAction={props.onClearFilters} />
    ) : (
      <Centered label="No knowledge yet" action="Add knowledge" onAction={props.onAdd} />
    );
  }

  const activeIndex = Math.min(cursor, items.length - 1);
  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setCursor(next);
    virtualizer.scrollToIndex(next);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") moveTo(activeIndex + 1);
    else if (event.key === "ArrowUp") moveTo(activeIndex - 1);
    else if (event.key === "Home") moveTo(0);
    else if (event.key === "End") moveTo(items.length - 1);
    else if (event.key === "Enter" || event.key === " ") onSelect(items[activeIndex].id);
    else return;
    event.preventDefault();
  };

  return (
    <Frame>
      <div
        ref={scrollRef}
        role="listbox"
        aria-label="Knowledge"
        tabIndex={0}
        aria-activedescendant={rowId(items[activeIndex].id)}
        onKeyDown={onKeyDown}
        className="group min-h-0 flex-1 overflow-y-auto outline-none"
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((virtual) => {
            const style = { top: 0, height: virtual.size, transform: `translateY(${virtual.start}px)` };
            const item = items[virtual.index];
            return item ? (
              <KnowledgeRow
                key={item.id}
                item={item}
                index={virtual.index}
                narrow={narrow}
                style={style}
                selected={item.id === selectedId}
                active={virtual.index === activeIndex}
                onSelect={() => {
                  setCursor(virtual.index);
                  onSelect(item.id);
                }}
              />
            ) : (
              <KnowledgeRowSkeleton key="loading-more" narrow={narrow} style={style} />
            );
          })}
        </div>
      </div>
    </Frame>
  );
}
