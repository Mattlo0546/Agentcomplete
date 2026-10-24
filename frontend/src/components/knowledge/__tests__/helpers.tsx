import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { KnowledgeDetail } from "@/lib/api/types";

// jsdom has no layout: give scroll containers a size so the virtualiser renders rows.
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 640 });
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 900 });

export function makeItem(n: number, overrides: Partial<KnowledgeDetail> = {}): KnowledgeDetail {
  return {
    id: `id-${n}`,
    kind: "skill",
    title: `item-${n}`,
    summary: `Summary of item ${n}`,
    tags: ["python"],
    created_at: "2026-10-22T11:48:00Z",
    updated_at: `2026-10-${String(22 - (n % 20)).padStart(2, "0")}T11:48:00Z`,
    use_count: n,
    body: `# item-${n}\n\n- first rule\n- second rule`,
    ...overrides,
  };
}

export type Call = { method: string; url: URL; body: unknown };

const json = (data: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** In-memory stand-in for the HTTP API, installed at the `fetch` boundary. */
export class FakeBackend {
  calls: Call[] = [];
  /** When set, POST /v1/knowledge streams steps, then waits for `releaseDone()` before the terminal event. */
  ingest: { fail?: string } = {};
  private gate: (() => void) | null = null;

  constructor(public items: KnowledgeDetail[] = []) {}

  install() {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => this.handle(String(input), init));
  }

  callsTo(method: string, pathStartsWith: string) {
    return this.calls.filter((c) => c.method === method && c.url.pathname.startsWith(pathStartsWith));
  }

  releaseDone() {
    this.gate?.();
  }

  private async handle(url: string, init: RequestInit = {}): Promise<Response> {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    this.calls.push({ method, url: u, body });
    const path = u.pathname;
    const id = path.split("/")[3];

    if (path === "/v1/tags") {
      const q = u.searchParams.get("q") ?? "";
      const counts = new Map<string, number>();
      this.items.forEach((k) => k.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
      const items = [...counts]
        .filter(([name]) => name.includes(q))
        .map(([name, knowledge_count]) => ({ name, knowledge_count }));
      return json({ items });
    }
    if (path === "/v1/knowledge" && method === "GET") {
      const q = (u.searchParams.get("q") ?? "").toLowerCase();
      const kind = u.searchParams.get("kind");
      const tags = u.searchParams.get("tags")?.split(",") ?? [];
      const offset = Number(u.searchParams.get("offset") ?? 0);
      const limit = Number(u.searchParams.get("limit") ?? 50);
      const hits = this.items.filter(
        (k) =>
          (!q || `${k.title} ${k.summary} ${k.body}`.toLowerCase().includes(q)) &&
          (!kind || k.kind === kind) &&
          tags.every((t) => k.tags.includes(t)),
      );
      return json({
        items: hits.slice(offset, offset + limit).map((k) => ({ ...k, body: undefined })),
        total: hits.length,
      });
    }
    if (path === "/v1/knowledge" && method === "POST") return this.streamIngest(body);
    const item = this.items.find((k) => k.id === id);
    if (!item) return json({ error: { code: "not_found", message: "Not found" } }, 404);
    if (method === "GET") return json(item);
    if (method === "PATCH") {
      Object.assign(item, body, body.body ? { summary: "Regenerated summary" } : {});
      return json(item);
    }
    if (method === "DELETE") {
      this.items = this.items.filter((k) => k !== item);
      return json(null, 204);
    }
    return json({ error: { code: "bad_request", message: "Unhandled" } }, 400);
  }

  private streamIngest(input: { kind: KnowledgeDetail["kind"]; title: string; body: string }) {
    const enc = new TextEncoder();
    const frame = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const created = makeItem(900 + this.items.length, {
      ...input,
      id: "new-1",
      summary: "Generated summary",
      tags: ["postgres", "sessions"],
    });
    return new Response(
      new ReadableStream<Uint8Array>({
        start: async (controller) => {
          for (const step of ["summarise", "tag"]) controller.enqueue(frame("step", { step, status: "done" }));
          await new Promise<void>((resolve) => (this.gate = resolve));
          if (this.ingest.fail) {
            controller.enqueue(frame("error", { code: "upstream_error", message: this.ingest.fail }));
          } else {
            for (const step of ["embed", "save"]) controller.enqueue(frame("step", { step, status: "done" }));
            this.items = [created, ...this.items];
            controller.enqueue(
              frame("done", {
                knowledge: created,
                tags: [
                  { name: "postgres", new: false },
                  { name: "sessions", new: true },
                ],
              }),
            );
          }
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }
}

export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {ui}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}
