"use client";

import { useDebouncedValue } from "@mantine/hooks";
import { useCallback, useMemo, useState } from "react";

import { PageLayout } from "@/components/shell/page-layout";
import type { KindFilter, StatusFilter } from "@/lib/activity/filters";
import { useLogs } from "@/lib/activity/queries";
import { buildRows, type TableRow } from "@/lib/activity/rows";

import { LogDetailBody, LogDetailStatus, LogDetailTitle } from "./log-detail";
import { LogTable } from "./log-table";
import { LogToolbar } from "./log-toolbar";
import { OutcomeSummary } from "./outcome-summary";

export function ActivityView() {
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("any");
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 250);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<{ key: string; requestId: string } | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const logs = useLogs({ kind, status, requestId: debouncedSearch });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = logs;
  const rows = useMemo(
    () => buildRows(logs.data?.pages.flatMap((page) => page.items) ?? [], expanded),
    [logs.data, expanded],
  );

  const toggle = useCallback(
    (key: string) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  const select = useCallback((row: TableRow) => {
    setSelected({ key: row.key, requestId: row.requestId });
    setInspectorOpen(true);
  }, []);
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  const requestId = selected?.requestId ?? null;
  return (
    <PageLayout
      title="Activity"
      inspector={{
        label: "Request detail",
        title: requestId ? <LogDetailTitle requestId={requestId} /> : "Request",
        actions: requestId ? <LogDetailStatus requestId={requestId} /> : undefined,
        content: <LogDetailBody requestId={requestId} />,
        open: inspectorOpen,
        onOpenChange: setInspectorOpen,
      }}
    >
      <OutcomeSummary />
      <LogToolbar
        kind={kind}
        status={status}
        search={search}
        onKind={setKind}
        onStatus={setStatus}
        onSearch={setSearch}
      />
      {logs.isError ? (
        <p className="text-sm text-destructive">{logs.error.message}</p>
      ) : logs.data && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requests yet</p>
      ) : (
        <LogTable
          rows={rows}
          selectedKey={selected?.key ?? null}
          onSelect={select}
          onToggle={toggle}
          hasMore={Boolean(hasNextPage)}
          loadingMore={isFetchingNextPage}
          onLoadMore={loadMore}
        />
      )}
    </PageLayout>
  );
}
