import { API_BASE_STORAGE_KEY, getApiBase } from "@/lib/api/client";

/** Normalised http(s) origin-style URL without trailing slash, or null when invalid. */
export function normalizeApiBase(input: string): string | null {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return trimmed.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function currentApiBase(): string {
  return getApiBase();
}

export function saveApiBase(value: string): void {
  try {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, value);
  } catch {
    // storage unavailable: the session keeps the default base
  }
}
