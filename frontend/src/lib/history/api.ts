import { apiJson } from "@/lib/api/client";

export type PromptVersion = {
  id: string;
  prompt: string;
  suggestion_text: string | null;
  saved_text: string;
  title: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type VersionSnapshot = { prompt: string; suggestion_text?: string | null };
export type VersionMetadata = { title: string | null; description: string | null };
export type VersionPage = { items: PromptVersion[]; total: number };
export const HISTORY_PAGE_SIZE = 30;

export function listVersions(offset = 0, signal?: AbortSignal) {
  return apiJson<VersionPage>(`/v1/prompt-history?limit=${HISTORY_PAGE_SIZE}&offset=${offset}`, { signal });
}

export function saveVersion(snapshot: VersionSnapshot & VersionMetadata) {
  return apiJson<PromptVersion>("/v1/prompt-history", { method: "POST", body: snapshot });
}

export function updateVersion(id: string, metadata: VersionMetadata) {
  return apiJson<PromptVersion>(`/v1/prompt-history/${encodeURIComponent(id)}`, { method: "PATCH", body: metadata });
}

export function deleteVersion(id: string) {
  return apiJson<void>(`/v1/prompt-history/${encodeURIComponent(id)}`, { method: "DELETE" });
}
