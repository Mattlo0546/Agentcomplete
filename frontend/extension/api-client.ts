/** Extension transport for the unchanged webapp API modules. Secrets remain in the service worker/bridge. */
export const DEFAULT_API_BASE = "http://127.0.0.1";
export const API_BASE_STORAGE_KEY = "pe.extension.apiBase";
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
export function getApiBase() {
  return DEFAULT_API_BASE;
}
type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown; base?: string };
type Runtime = { sendMessage: (message: unknown) => Promise<{ status: number; data: unknown; error?: string }> };
function runtime(): Runtime {
  const c = (globalThis as unknown as { chrome?: { runtime?: Runtime } }).chrome;
  if (!c?.runtime)
    throw new ApiError(0, "extension_unavailable", "Open this workspace from the Prompt Enhance extension.", null);
  return c.runtime;
}
export async function apiFetch(path: string, { body, signal, method = "GET" }: RequestOptions = {}) {
  if (!/^\/v1\//.test(path)) throw new ApiError(400, "invalid_path", "Unsupported extension API path", null);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const request = runtime().sendMessage({ type: "api", path, method, body });
  let remove = () => {};
  try {
    const result = await (signal
      ? Promise.race([
          request,
          new Promise<never>((_, reject) => {
            const cancel = () => reject(new DOMException("Aborted", "AbortError"));
            signal.addEventListener("abort", cancel, { once: true });
            remove = () => signal.removeEventListener("abort", cancel);
          }),
        ])
      : request);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const data = result?.data as { __sse?: string; error?: { code?: string; message?: string } } | undefined;
    if (!result || result.status < 200 || result.status >= 400 || data?.error || result.error)
      throw new ApiError(
        result?.status || 0,
        data?.error?.code || "bridge_error",
        result?.error || data?.error?.message || "Local bridge unavailable",
        null,
      );
    const isSse = typeof data?.__sse === "string";
    return new Response(result.status === 204 ? null : isSse ? data.__sse : JSON.stringify(result.data), {
      status: result.status || 200,
      headers: { "Content-Type": isSse ? "text/event-stream" : "application/json" },
    });
  } catch (error) {
    if (error instanceof ApiError || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new ApiError(0, "network_error", "Local OpenAI bridge unavailable. Start the bridge and try again.", null);
  } finally {
    remove();
  }
}
export async function apiJson<T>(path: string, options?: RequestOptions): Promise<T> {
  const response = await apiFetch(path, options);
  return (response.status === 204 ? undefined : await response.json()) as T;
}
export function newRequestId() {
  return `req_${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
