import { describe, expect, it } from "vitest";

import type { AiLog, ApiLog } from "@/lib/api/types";

import { buildLogsQuery, statusClass } from "../filters";
import { buildRows, groupCalls } from "../rows";
import { buildTimeline, sumTokens } from "../timeline";

const ai = (operation: string, time: string, latency: number, over: Partial<AiLog> = {}): AiLog => ({
  time,
  request_id: "req_1",
  operation,
  model: "gemini",
  status: "ok",
  latency_ms: latency,
  input_tokens: 10,
  output_tokens: 2,
  error: null,
  ...over,
});
const api: ApiLog = {
  time: "2026-10-24T14:00:00.000Z",
  request_id: "req_1",
  method: "POST",
  path: "/v1/enhance",
  status: 200,
  latency_ms: 1000,
  error: null,
  children: [
    ai("tags", "2026-10-24T14:00:00.000Z", 200),
    ai("judge", "2026-10-24T14:00:00.300Z", 400),
    ai("judge", "2026-10-24T14:00:00.350Z", 450, { input_tokens: null }),
  ],
};

describe("filters", () => {
  it("builds the query with optional cursor and request id", () => {
    expect(buildLogsQuery({ kind: "ai", status: "5xx", requestId: " req_9 " }, "2026-10-24T00:00:00Z")).toBe(
      "kind=ai&status=5xx&limit=100&request_id=req_9&before=2026-10-24T00%3A00%3A00Z",
    );
    expect(buildLogsQuery({ kind: "all", status: "any", requestId: "" })).toBe("kind=all&status=any&limit=100");
  });
  it("maps codes to status classes", () => {
    expect([200, 201, 404, 502, 302].map(statusClass)).toEqual(["2xx", "2xx", "4xx", "5xx", "other"]);
  });
});

describe("grouping", () => {
  it("groups calls by operation with counts and summed tokens", () => {
    const groups = groupCalls(api.children);
    expect(groups.map((g) => [g.operation, g.count])).toEqual([
      ["tags", 1],
      ["judge", 2],
    ]);
    expect(groups[1]).toMatchObject({ inputTokens: 10, outputTokens: 4, latencyMs: 500 });
  });
  it("inserts children only for expanded API rows", () => {
    const collapsed = buildRows([api], new Set());
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({ expandable: true, expanded: false, tone: "ok" });
    const open = buildRows([api], new Set([collapsed[0].key]));
    expect(open.map((r) => r.operation)).toEqual(["POST /v1/enhance", "tags", "judge ×2"]);
    expect(open[2].depth).toBe(1);
  });
});

describe("timeline", () => {
  it("positions bars relative to the request start", () => {
    const bars = buildTimeline(api, api.children);
    expect(bars[0]).toMatchObject({ label: "tags", offsetPct: 0, widthPct: 20 });
    expect(bars[1].label).toBe("judge ×2");
    expect(bars[1].offsetPct).toBeCloseTo(30);
    expect(bars[1].widthPct).toBeCloseTo(50);
  });
  it("sums tokens", () => {
    expect(sumTokens(api.children)).toEqual({ input: 20, output: 6 });
    expect(sumTokens([])).toBeNull();
  });
});
