import { apiFetch, apiJson } from "@/lib/api/client";
import type { IngestStep, Knowledge, KnowledgeDetail, KnowledgeKind } from "@/lib/api/types";

import { readSse, type SseMessage } from "./sse";

export const PAGE_SIZE = 50;
export const INGEST_STEPS: IngestStep[] = ["summarise", "tag", "embed", "save"];

export type KindFilter = "all" | KnowledgeKind;
export type KnowledgeFilters = { q: string; kind: KindFilter; tags: string[] };
export type KnowledgePage = { items: Knowledge[]; total: number };
export type TagCount = { name: string; knowledge_count: number };
export type IngestInput = { kind: KnowledgeKind; title: string; body: string };
export type IngestTag = { name: string; new: boolean };
export type IngestResult = { knowledge: KnowledgeDetail; tags: IngestTag[] };
export type IngestEvent =
  | { type: "step"; step: IngestStep }
  | ({ type: "done" } & IngestResult)
  | { type: "error"; code: string; message: string };
export type KnowledgePatch = { title?: string; body?: string; tags?: string[] };

export const knowledgeKeys = {
  all: ["knowledge"] as const,
  list: (filters: KnowledgeFilters) => ["knowledge", "list", filters] as const,
  total: ["knowledge", "total"] as const,
  detail: (id: string) => ["knowledge", "detail", id] as const,
  tags: (q: string) => ["tags", q] as const,
};

export function knowledgeListPath(filters: KnowledgeFilters, offset: number, limit = PAGE_SIZE): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.kind !== "all") params.set("kind", filters.kind);
  if (filters.tags.length) params.set("tags", filters.tags.join(","));
  params.set("offset", String(offset));
  params.set("limit", String(limit));
  return `/v1/knowledge?${params}`;
}

export const fetchKnowledgePage = (filters: KnowledgeFilters, offset: number) =>
  apiJson<KnowledgePage>(knowledgeListPath(filters, offset));

export const fetchKnowledge = (id: string) => apiJson<KnowledgeDetail>(`/v1/knowledge/${encodeURIComponent(id)}`);

export const fetchTags = (q: string) =>
  apiJson<{ items: TagCount[] }>(`/v1/tags?${new URLSearchParams({ q, limit: "50" })}`).then((r) => r.items);

export const patchKnowledge = (id: string, patch: KnowledgePatch) =>
  apiJson<KnowledgeDetail>(`/v1/knowledge/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });

export const deleteKnowledge = (id: string) =>
  apiJson<void>(`/v1/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" });

export function parseIngestMessage(message: SseMessage): IngestEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(message.data);
  } catch {
    return null;
  }
  const data = payload as Record<string, unknown>;
  if (message.event === "step" && INGEST_STEPS.includes(data.step as IngestStep)) {
    return { type: "step", step: data.step as IngestStep };
  }
  if (message.event === "done" && data.knowledge) {
    return { type: "done", knowledge: data.knowledge as KnowledgeDetail, tags: (data.tags as IngestTag[]) ?? [] };
  }
  if (message.event === "error") {
    return { type: "error", code: String(data.code ?? "error"), message: String(data.message ?? "Request failed") };
  }
  return null;
}

/** POST /v1/knowledge streams SSE progress; yields typed events until the stream ends. */
export async function* streamIngest(input: IngestInput, signal?: AbortSignal): AsyncGenerator<IngestEvent> {
  const response = await apiFetch("/v1/knowledge", {
    method: "POST",
    body: input,
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!response.body) throw new Error("Empty response");
  for await (const message of readSse(response.body)) {
    const event = parseIngestMessage(message);
    if (event) yield event;
  }
}
