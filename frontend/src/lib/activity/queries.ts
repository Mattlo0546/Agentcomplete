import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { apiJson } from "@/lib/api/client";
import type { LogDetail, Stats } from "@/lib/api/types";

import { buildLogsQuery, LOG_PAGE_SIZE, type LogFilters } from "./filters";
import type { LogItem } from "./rows";

export const REFRESH_MS = 5000;

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => apiJson<Stats>("/v1/stats"),
    refetchInterval: REFRESH_MS,
  });
}

export function useLogs(filters: LogFilters) {
  return useInfiniteQuery({
    queryKey: ["logs", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => apiJson<{ items: LogItem[] }>(`/v1/logs?${buildLogsQuery(filters, pageParam)}`),
    getNextPageParam: (last) =>
      last.items.length < LOG_PAGE_SIZE ? undefined : last.items[last.items.length - 1].time,
    refetchInterval: REFRESH_MS,
  });
}

export function useLogDetail(requestId: string | null) {
  return useQuery({
    queryKey: ["log", requestId],
    queryFn: () => apiJson<LogDetail>(`/v1/logs/${encodeURIComponent(requestId!)}`),
    enabled: requestId !== null,
  });
}
