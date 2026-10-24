import type { AiLog, ApiLog } from "@/lib/api/types";

export type LogItem = ApiLog | AiLog;

export function isApiLog(item: LogItem): item is ApiLog {
  return "method" in item;
}

/** Consecutive-or-not calls of one operation collapsed to a single line (`judge_relevance ×5`). */
export type CallGroup = {
  operation: string;
  model: string;
  count: number;
  time: string;
  startMs: number;
  endMs: number;
  latencyMs: number;
  status: "ok" | "error";
  inputTokens: number | null;
  outputTokens: number | null;
  requestId: string;
};

function sumNullable(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/** Groups AI calls by operation, ordered by first start time. */
export function groupCalls(calls: AiLog[]): CallGroup[] {
  const groups = new Map<string, AiLog[]>();
  for (const call of [...calls].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))) {
    groups.set(call.operation, [...(groups.get(call.operation) ?? []), call]);
  }
  return [...groups.values()].map((items) => {
    const startMs = Math.min(...items.map((c) => Date.parse(c.time)));
    const endMs = Math.max(...items.map((c) => Date.parse(c.time) + c.latency_ms));
    return {
      operation: items[0].operation,
      model: items[0].model,
      count: items.length,
      time: items[0].time,
      startMs,
      endMs,
      latencyMs: Math.max(endMs - startMs, ...items.map((c) => c.latency_ms)),
      status: items.some((c) => c.status === "error") ? "error" : "ok",
      inputTokens: sumNullable(items.map((c) => c.input_tokens)),
      outputTokens: sumNullable(items.map((c) => c.output_tokens)),
      requestId: items[0].request_id,
    };
  });
}

export type TableRow = {
  key: string;
  requestId: string;
  kind: "API" | "AI";
  depth: 0 | 1;
  time: string;
  operation: string;
  model: string | null;
  /** HTTP code for API rows; AI rows report `200` or `error`. */
  statusLabel: string;
  tone: "ok" | "warn" | "err";
  latencyMs: number;
  tokens: { input: number | null; output: number | null } | null;
  expandable: boolean;
  expanded: boolean;
};

export function apiRowKey(log: ApiLog): string {
  return `api:${log.request_id}:${log.time}`;
}

/** Flattens fetched pages into table rows, inserting grouped children under expanded API rows. */
export function buildRows(items: LogItem[], expanded: ReadonlySet<string>): TableRow[] {
  const rows: TableRow[] = [];
  for (const item of items) {
    if (isApiLog(item)) {
      const key = apiRowKey(item);
      const open = expanded.has(key) && item.children.length > 0;
      rows.push({
        key,
        requestId: item.request_id,
        kind: "API",
        depth: 0,
        time: item.time,
        operation: `${item.method} ${item.path}`,
        model: null,
        statusLabel: String(item.status),
        tone: item.status >= 500 ? "err" : item.status >= 400 ? "warn" : "ok",
        latencyMs: item.latency_ms,
        tokens: null,
        expandable: item.children.length > 0,
        expanded: open,
      });
      if (open) {
        for (const group of groupCalls(item.children)) {
          rows.push({
            key: `${key}:${group.operation}`,
            requestId: group.requestId,
            kind: "AI",
            depth: 1,
            time: group.time,
            operation: group.count > 1 ? `${group.operation} ×${group.count}` : group.operation,
            model: group.model,
            statusLabel: group.status === "ok" ? "200" : "error",
            tone: group.status === "ok" ? "ok" : "err",
            latencyMs: group.latencyMs,
            tokens: { input: group.inputTokens, output: group.outputTokens },
            expandable: false,
            expanded: false,
          });
        }
      }
    } else {
      rows.push({
        key: `ai:${item.request_id}:${item.operation}:${item.time}`,
        requestId: item.request_id,
        kind: "AI",
        depth: 0,
        time: item.time,
        operation: item.operation,
        model: item.model,
        statusLabel: item.status === "ok" ? "200" : "error",
        tone: item.status === "ok" ? "ok" : "err",
        latencyMs: item.latency_ms,
        tokens: { input: item.input_tokens, output: item.output_tokens },
        expandable: false,
        expanded: false,
      });
    }
  }
  return rows;
}
