export const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
export const API_BASE_STORAGE_KEY = "pe.apiBase";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getApiBase(): string {
  if (typeof window === "undefined") return DEFAULT_API_BASE;
  try {
    return window.localStorage.getItem(API_BASE_STORAGE_KEY) || DEFAULT_API_BASE;
  } catch {
    return DEFAULT_API_BASE;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown; base?: string };

export async function apiFetch(path: string, { body, base, headers, ...init }: RequestOptions = {}) {
  let response: Response;
  try {
    response = await fetch(`${base ?? getApiBase()}${path}`, {
      ...init,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "network_error", "Backend unreachable", null);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      payload?.error?.code ?? "http_error",
      payload?.error?.message ?? response.statusText,
      response.headers.get("X-Request-ID"),
    );
  }
  return response;
}

export async function apiJson<T>(path: string, options?: RequestOptions): Promise<T> {
  const response = await apiFetch(path, options);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `req_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
