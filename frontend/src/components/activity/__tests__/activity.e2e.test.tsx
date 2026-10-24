import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityView } from "../activity-view";

const apiRow = (n: number, status = 200) => ({
  time: `2026-10-24T14:02:${String(10 + n).padStart(2, "0")}.418Z`,
  request_id: `req_${n}aaaaaaaaaa`,
  method: "POST",
  path: "/v1/enhance",
  status,
  latency_ms: 1570,
  error: null,
  children: [
    {
      time: "2026-10-24T14:02:29.866Z",
      request_id: `req_${n}aaaaaaaaaa`,
      operation: "extract_tags",
      model: "gemini-flash",
      status: "ok",
      latency_ms: 184,
      input_tokens: 412,
      output_tokens: 38,
      error: null,
    },
  ],
});

const stats = {
  suggestions: 1284,
  accepted_pct: 41,
  declined_pct: 17,
  p50_latency_ms: 1420,
  classifier: { auc: 0.81, trained_at: "2026-10-22T10:00:00Z" },
  log_entries: 10,
  log_bytes: 100,
};

let urls: string[];

beforeEach(() => {
  urls = [];
  // jsdom has no layout: give the virtualised scroller a size.
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      urls.push(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (input.includes("/v1/stats")) return json(stats);
      if (input.includes("/v1/logs/")) {
        const row = apiRow(1);
        return json({
          api: row,
          ai: row.children,
          trace: { result_type: "autocomplete", prompt_revision: 14 },
          outcome: { event: "accepted", time_to_action_ms: 2100 },
        });
      }
      if (input.includes("/v1/logs")) return json({ items: [apiRow(1), apiRow(2, 502)] });
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ActivityView />
    </QueryClientProvider>,
  );
}

describe("Activity journey", () => {
  it("renders stats and rows, expands children, and opens the detail", async () => {
    const user = userEvent.setup();
    renderView();

    expect(await screen.findByText("1,284")).toBeInTheDocument();
    expect(screen.getByText("41%")).toBeInTheDocument();
    expect(screen.getByText("1.42 s")).toBeInTheDocument();
    expect(screen.getByText("Classifier AUC · 22 Oct")).toBeInTheDocument();

    const rows = await screen.findAllByRole("row", { name: /API POST \/v1\/enhance/ });
    expect(rows).toHaveLength(2);
    expect(screen.queryByText("extract_tags")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /Expand POST/ })[0]);
    expect(await screen.findByText("extract_tags")).toBeInTheDocument();

    await user.click(rows[0]);
    const inspector = await screen.findByRole("complementary", { name: "Request detail" });
    expect(await within(inspector).findByText("Accepted after 2.10 s")).toBeInTheDocument();
    expect(within(inspector).getByText("autocomplete · rev 14")).toBeInTheDocument();
    expect(within(inspector).getAllByTestId("timeline-bar")).toHaveLength(1);
    expect(within(inspector).getByRole("button", { name: "Copy request id" })).toBeInTheDocument();
  });

  it("sends filter values as request params", async () => {
    const user = userEvent.setup();
    renderView();
    await screen.findAllByRole("row", { name: /API POST/ });

    // jsdom has no layout, so the resizable-panel separator would swallow pointer focus; change the value directly.
    fireEvent.change(screen.getByRole("searchbox", { name: "Request id" }), { target: { value: "req_1a" } });
    await waitFor(() => expect(urls.at(-1)).toContain("request_id=req_1a"));

    await user.click(screen.getByRole("radio", { name: "AI calls" }));
    await user.click(screen.getByRole("radio", { name: "5xx" }));
    await waitFor(() => expect(urls.at(-1)).toMatch(/kind=ai&status=5xx.*request_id=req_1a/));
  });
});
