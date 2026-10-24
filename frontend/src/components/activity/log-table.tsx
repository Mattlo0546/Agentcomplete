"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";

import { StatusDot } from "@/components/common/status-dot";
import { Button } from "@/components/ui/button";
import { useLayoutMode } from "@/components/shell/use-layout-mode";
import type { TableRow } from "@/lib/activity/rows";
import { formatClock, formatLatency, formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";

const WIDE_COLUMNS = "grid-cols-[104px_44px_minmax(0,1.6fr)_minmax(0,1.2fr)_76px_80px_96px]";

type LogTableProps = {
  rows: TableRow[];
  selectedKey: string | null;
  onSelect: (row: TableRow) => void;
  onToggle: (key: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
};

function Disclosure({ row, onToggle }: { row: TableRow; onToggle: (key: string) => void }) {
  if (!row.expandable) return <span className="size-4 shrink-0" />;
  const Icon = row.expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      aria-label={`${row.expanded ? "Collapse" : "Expand"} ${row.operation}`}
      aria-expanded={row.expanded}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(row.key);
      }}
      className="grid size-4 shrink-0 place-items-center text-muted-foreground"
    >
      <Icon className="size-4" />
    </button>
  );
}

function Tokens({ row }: { row: TableRow }) {
  return row.tokens ? `${formatTokens(row.tokens.input)} / ${formatTokens(row.tokens.output)}` : "—";
}

function WideRow({ row, onToggle }: { row: TableRow; onToggle: (key: string) => void }) {
  return (
    <>
      <span className="text-data">{formatClock(row.time)}</span>
      <span className="w-fit rounded-sm border border-input px-1.5 font-mono text-[11px] leading-4 text-muted-foreground">
        {row.kind}
      </span>
      <span className={cn("flex min-w-0 items-center gap-1.5 truncate", row.depth ? "pl-5" : "")}>
        {row.kind === "API" && <Disclosure row={row} onToggle={onToggle} />}
        <span className={cn("truncate", row.kind === "AI" ? "font-mono text-xs" : "text-sm")}>{row.operation}</span>
      </span>
      <span className="truncate text-data">{row.model ?? "—"}</span>
      <span className="flex items-center gap-1.5 text-data text-foreground">
        <StatusDot tone={row.tone} />
        {row.statusLabel}
      </span>
      <span className="text-right text-data text-foreground">{formatLatency(row.latencyMs)}</span>
      <span className="text-right text-data">
        <Tokens row={row} />
      </span>
    </>
  );
}

function NarrowRow({ row, onToggle }: { row: TableRow; onToggle: (key: string) => void }) {
  return (
    <div className={cn("grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3", row.depth ? "pl-5" : "")}>
      <span className="flex min-w-0 items-center gap-1.5">
        {row.kind === "API" && <Disclosure row={row} onToggle={onToggle} />}
        <span className={cn("truncate", row.kind === "AI" ? "font-mono text-sm" : "text-sm")}>{row.operation}</span>
      </span>
      <span className="text-right text-data">{formatLatency(row.latencyMs)}</span>
      <span className="truncate pl-0 text-data">{formatClock(row.time)}</span>
      <span className="flex items-center justify-end gap-1.5 text-data text-foreground">
        <StatusDot tone={row.tone} />
        {row.statusLabel}
      </span>
    </div>
  );
}

/** design.md §4.10: virtualised table; API rows expand to their AI-call children. */
export function LogTable({ rows, selectedKey, onSelect, onToggle, hasMore, loadingMore, onLoadMore }: LogTableProps) {
  const narrow = useLayoutMode() === "narrow";
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeight = narrow ? 60 : 40;
  // eslint-disable-next-line react-hooks/incompatible-library -- virtualizer is only used in this component
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length ? items[items.length - 1].index : -1;

  useEffect(() => {
    if (hasMore && !loadingMore && lastIndex >= rows.length - 5) onLoadMore();
  }, [hasMore, loadingMore, lastIndex, rows.length, onLoadMore]);

  return (
    <div className="flex min-h-72 flex-1 flex-col overflow-hidden rounded-lg border border-border">
      {!narrow && (
        <div
          role="row"
          className={cn(
            "grid shrink-0 items-center gap-3 border-b border-border bg-muted px-4 py-2 text-label",
            WIDE_COLUMNS,
          )}
        >
          <span>Time</span>
          <span>Kind</span>
          <span>Operation</span>
          <span>Model</span>
          <span>Status</span>
          <span className="text-right">Latency</span>
          <span className="text-right">Tokens</span>
        </div>
      )}
      <div ref={scrollRef} role="table" aria-label="Request log" className="min-h-0 flex-1 overflow-auto">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((virtualRow) => {
            const row = rows[virtualRow.index];
            const selected = row.key === selectedKey;
            return (
              <div
                key={row.key}
                role="row"
                tabIndex={0}
                aria-selected={selected}
                aria-label={`${row.kind} ${row.operation} ${row.statusLabel}`}
                onClick={() => onSelect(row)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.target === event.currentTarget) onSelect(row);
                }}
                className={cn(
                  "absolute inset-x-0 flex cursor-pointer items-center border-b border-border px-4 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
                  !narrow && cn("grid gap-3", WIDE_COLUMNS),
                  selected && "bg-accent shadow-[inset_2px_0_0_var(--foreground)]",
                  row.depth === 1 && "bg-muted/40",
                )}
                style={{ top: virtualRow.start, height: virtualRow.size }}
              >
                {narrow ? <NarrowRow row={row} onToggle={onToggle} /> : <WideRow row={row} onToggle={onToggle} />}
              </div>
            );
          })}
        </div>
      </div>
      {hasMore && (
        <div className="shrink-0 border-t border-border p-1.5 text-center">
          <Button variant="ghost" size="sm" disabled={loadingMore} onClick={onLoadMore}>
            Load older
          </Button>
        </div>
      )}
    </div>
  );
}
