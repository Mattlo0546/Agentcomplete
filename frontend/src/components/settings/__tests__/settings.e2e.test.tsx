import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsView } from "../settings-view";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const settings = {
  trigger_delay_ms: 400,
  autocomplete_enabled: true,
  questions_enabled: true,
  max_options: 4,
  retention_days: 30,
  store_payloads: false,
};

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let overrides: Record<string, () => Response>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  calls = [];
  overrides = {};
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const key = `${method} ${new URL(url).pathname}`;
      if (overrides[key]) return overrides[key]();
      switch (key) {
        case "GET /v1/settings":
          return json(settings);
        case "PUT /v1/settings":
          return json({ ...settings, ...JSON.parse(String(init!.body)) });
        case "GET /v1/health":
          return json({ status: "ok", latency_ms: 23, db: "ok", gemini: "ok" });
        case "GET /v1/stats":
          return json({
            suggestions: 1,
            accepted_pct: 1,
            declined_pct: 1,
            p50_latency_ms: 1,
            classifier: null,
            log_entries: 18402,
            log_bytes: 6400000,
          });
        case "GET /v1/analytics/status":
          return json({
            last_export_at: "2026-10-24T13:00:00Z",
            last_export_count: 1284,
            classifier: { auc: 0.81, trained_at: "2026-10-22T10:00:00Z", rows: 90 },
          });
        case "DELETE /v1/logs":
          return new Response(null, { status: 204 });
        case "POST /v1/analytics/export":
          return json({ exported: 12 });
        case "POST /v1/analytics/train":
          return json({ auc: 0.83, rows: 100, trained_at: "2026-10-24T14:00:00Z" });
        default:
          return json({ error: { code: "not_found", message: "nope" } }, 404);
      }
    }),
  );
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsView />
    </QueryClientProvider>,
  );
}
const puts = () => calls.filter((c) => c.method === "PUT");

describe("Settings journey", () => {
  it("shows read-only logging values, storage stats and snowflake status", async () => {
    renderView();
    expect(await screen.findByText("Not stored")).toBeInTheDocument();
    expect(screen.getByText("30 days")).toBeInTheDocument();
    expect(await screen.findByText("18,402 entries · 6.1 MB")).toBeInTheDocument();
    expect(await screen.findByText("AUC 0.81 · 22 Oct")).toBeInTheDocument();
    expect(await screen.findByText("healthy · 23 ms · db ok · gemini ok")).toBeInTheDocument();
  });

  it("PUTs a toggled switch and max options", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("switch", { name: "Autocomplete" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toEqual({
      ...settings,
      autocomplete_enabled: false,
      retention_days: undefined,
      store_payloads: undefined,
    });
    await user.click(screen.getByRole("radio", { name: "6" }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].body).toMatchObject({ autocomplete_enabled: false, max_options: 6 });
  });

  it("rolls back and toasts when a PUT fails", async () => {
    overrides["PUT /v1/settings"] = () => json({ error: { code: "boom", message: "db down" } }, 503);
    const user = userEvent.setup();
    renderView();
    const questions = await screen.findByRole("switch", { name: "Questions" });
    await user.click(questions);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't save settings: db down"));
    await waitFor(() => expect(questions).toBeChecked());
  });

  it("debounces the trigger delay slider into one PUT", async () => {
    const user = userEvent.setup();
    renderView();
    const slider = await screen.findByRole("slider");
    slider.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByText("500 ms")).toBeInTheDocument();
    expect(puts()).toHaveLength(0);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toMatchObject({ trigger_delay_ms: 500 });
  });

  it("clears logs after confirmation", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: "Clear logs" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Clear logs" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/v1/logs"))).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Logs cleared"));
  });

  it("exports and retrains with toasts, surfacing a 409 message", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: "Export now" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Exported 12 events"));

    await user.click(screen.getByRole("button", { name: "Retrain" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("AUC 0.83")));

    overrides["POST /v1/analytics/train"] = () =>
      json({ error: { code: "conflict", message: "Need at least 20 labelled rows" } }, 409);
    await user.click(screen.getByRole("button", { name: "Retrain" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Need at least 20 labelled rows"));
  });

  it("tests the typed backend URL and reports an unreachable one", async () => {
    const user = userEvent.setup();
    renderView();
    await screen.findByText("healthy · 23 ms · db ok · gemini ok");

    const input = screen.getByRole("textbox", { name: "URL" });
    await user.clear(input);
    await user.type(input, "nope");
    expect(screen.getByText("Enter an http(s) URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test" })).toBeDisabled();

    await user.clear(input);
    await user.type(input, "http://10.0.0.5:9000/");
    await user.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(calls.some((c) => c.url === "http://10.0.0.5:9000/v1/health?deep=1")).toBe(true));
    await waitFor(() => expect(localStorage.getItem("pe.apiBase")).toBe("http://10.0.0.5:9000"));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("fail"))),
    );
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Backend unreachable")).toBeInTheDocument();
  });
});
