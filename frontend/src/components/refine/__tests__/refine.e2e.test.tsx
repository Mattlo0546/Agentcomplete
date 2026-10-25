import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import type { EnhanceRequest, EnhanceResponse, Trace } from "@/lib/api/types";
import type { PromptVersion } from "@/lib/history/api";

import { RefineView } from "../refine-view";

// Journeys through the Refine tab with only `fetch` mocked at the network boundary.

type EnhanceHandler = (body: EnhanceRequest) => Promise<Response> | Response;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

let enhanceHandler: EnhanceHandler;
let calls: { path: string; body: unknown }[];
let versions: PromptVersion[];
let historySaveFails: boolean;
let waitForSettings: Promise<void> | null;

const trace = (requestId: string): Trace => ({
  request_id: requestId,
  created_at: "2026-10-24T14:02:00Z",
  prompt_revision: 1,
  result_type: "autocomplete",
  general: false,
  tags: [{ name: "retry", similarity: 0.93 }],
  knowledge: [
    { id: "k1", kind: "skill", title: "python-retry-backoff", score: 0.91, kept: true },
    { id: "k2", kind: "prompt", title: "celery-beat-schedules", score: 0.41, kept: false },
  ],
  steps: [
    { step: "tags", model: "gemini-3.5-flash-lite", latency_ms: 184, status: "ok", detail: "" },
    { step: "retrieve", model: "pgvector", latency_ms: 38, status: "ok", detail: "1 tags → 2 candidates" },
    { step: "judge", model: "gemini-3.6-flash", latency_ms: 612, status: "ok", detail: "2 calls" },
    { step: "generate", model: "gemini-3.8-flash", latency_ms: 731, status: "ok", detail: "" },
  ],
});

const enhanceCalls = () =>
  calls.filter((call) => call.path === "/v1/enhance").map((call) => call.body as EnhanceRequest);
const outcomes = () =>
  calls.filter((call) => call.path === "/v1/outcomes").map((call) => call.body as { event: string });

const autocomplete = (body: EnhanceRequest, text: string): EnhanceResponse => ({
  schema_version: 1,
  request_id: body.request_id,
  prompt_revision: body.prompt_revision,
  type: "autocomplete",
  insert_at: body.prompt.length,
  text,
});

beforeEach(() => {
  window.localStorage.clear();
  calls = [];
  versions = [];
  historySaveFails = false;
  waitForSettings = null;
  enhanceHandler = (body) => json(autocomplete(body, " and jitter."));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      if (path === "/v1/prompt-history") {
        if (init?.method === "POST") {
          if (historySaveFails) return json({ error: { code: "unavailable", message: "History unavailable" } }, 503);
          const version = {
            id: crypto.randomUUID(),
            ...body,
            saved_text: body.prompt + (body.suggestion_text ?? ""),
            created_at: "2026-10-25T01:00:00Z",
            updated_at: "2026-10-25T01:00:00Z",
          };
          versions.unshift(version);
          return json(version, 201);
        }
        return json({ items: versions, total: versions.length });
      }
      if (path.startsWith("/v1/prompt-history/")) {
        const id = path.split("/").pop();
        if (init?.method === "DELETE") {
          versions = versions.filter((item) => item.id !== id);
          return new Response(null, { status: 204 });
        }
        const version = versions.find((item) => item.id === id);
        if (version && init?.method === "PATCH") Object.assign(version, body);
        return json(version);
      }
      if (path === "/v1/settings") {
        if (waitForSettings) await waitForSettings;
        return json({
          trigger_delay_ms: 150,
          autocomplete_enabled: true,
          questions_enabled: true,
          max_options: 3,
          retention_days: 30,
          store_payloads: false,
        });
      }
      if (path === "/v1/enhance") return enhanceHandler(body);
      if (path.startsWith("/v1/traces/")) return json(trace(path.split("/").pop()!));
      if (path === "/v1/outcomes") return new Response(null, { status: 204 });
      if (path === "/v1/handoff") return json({ id: "h1", created_at: "2026-10-24T14:02:00Z" });
      return json({ error: { code: "not_found", message: "Not found" } }, 404);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

// The shared shell's resizable-panel separator wins jsdom pointer hit-testing (all rects are 0×0), so focus the
// editor directly and type with the keyboard instead of clicking into it.
async function typeInto(user: ReturnType<typeof userEvent.setup>, editor: HTMLTextAreaElement, text: string) {
  if (document.activeElement !== editor) editor.focus();
  await user.keyboard(text);
}

function setup() {
  const user = userEvent.setup();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RefineView />
      <Toaster />
    </QueryClientProvider>,
  );
  const editor = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
  return { user, editor };
}

describe("Refine journeys", () => {
  it("preserves a queued suggestion when initial settings change the debounce delay", async () => {
    let releaseSettings!: () => void;
    waitForSettings = new Promise<void>((resolve) => {
      releaseSettings = resolve;
    });
    const { editor } = setup();
    fireEvent.change(editor, { target: { value: "Retry", selectionStart: 5, selectionEnd: 5 } });
    releaseSettings();
    expect(await screen.findByTestId("ghost-text")).toHaveTextContent("and jitter.");
    expect(enhanceCalls()).toHaveLength(1);
  });
  it("saves an unaccepted suggestion with a context menu, compares and restores history", async () => {
    const { user, editor } = setup();
    await typeInto(user, editor, "Retry with backoff");
    const ghost = await screen.findByTestId("ghost-text");
    fireEvent.contextMenu(within(ghost).getByText("and jitter."));
    await user.click(await screen.findByRole("menuitem", { name: "Save as prompt version" }));
    const dialog = await screen.findByRole("dialog", { name: "Save prompt version" });
    expect(editor.value).toBe("Retry with backoff");
    expect(within(dialog).getByLabelText("Version preview")).toHaveTextContent("Retry with backoff and jitter.");
    await user.type(within(dialog).getByLabelText("Name"), "Jitter variant");
    await user.type(within(dialog).getByLabelText("Description"), "Bound retries and spread load");
    await user.click(within(dialog).getByRole("button", { name: "Save version" }));
    const history = await screen.findByRole("dialog", { name: "Prompt history" });
    expect(await within(history).findByRole("button", { name: /Jitter variant/ })).toBeInTheDocument();
    expect(versions[0]).toMatchObject({
      prompt: "Retry with backoff",
      suggestion_text: " and jitter.",
      title: "Jitter variant",
      description: "Bound retries and spread load",
    });
    expect(within(history).getByLabelText("Version comparison").querySelector("ins")).toHaveTextContent("and jitter.");
    expect(outcomes().some((outcome) => outcome.event === "accepted")).toBe(false);
    await user.click(within(history).getByRole("button", { name: "Restore version" }));
    expect(editor.value).toBe("Retry with backoff");
    await user.click(within(history).getByRole("button", { name: "Restore selected version" }));
    expect(editor.value).toBe("Retry with backoff and jitter.");
    await waitFor(() => expect(JSON.parse(localStorage.getItem("pe.refine.draft")!)).toBe(editor.value));
  });

  it("offers a keyboard save action and keeps the frozen snapshot after a save failure", async () => {
    const { user, editor } = setup();
    await typeInto(user, editor, "Add tests");
    await screen.findByTestId("ghost-text");
    await user.click(screen.getByRole("button", { name: "Save suggestion as version" }));
    const dialog = await screen.findByRole("dialog", { name: "Save prompt version" });
    await user.type(within(dialog).getByLabelText("Name"), "Regression tests");
    historySaveFails = true;
    await user.click(within(dialog).getByRole("button", { name: "Save version" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("History unavailable");
    expect(editor.value).toBe("Add tests");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Regression tests");
    historySaveFails = false;
    await user.click(within(dialog).getByRole("button", { name: "Save version" }));
    expect(await screen.findByRole("dialog", { name: "Prompt history" })).toBeInTheDocument();
    expect(versions[0].saved_text).toBe("Add tests and jitter.");
  });

  it("sends the shared handoff to Claude when selected", async () => {
    const { user, editor } = setup();
    await typeInto(user, editor, "Review the parser");
    await user.selectOptions(screen.getByRole("combobox", { name: "Send target" }), "Claude");
    await user.click(screen.getByRole("button", { name: "Send to Claude" }));
    expect(await screen.findByText("Copied for Claude")).toBeInTheDocument();
    expect(calls.find((call) => call.path === "/v1/handoff")?.body).toEqual({ prompt: "Review the parser" });
  });
  it("debounces typing into one request, shows ghost text and accepts it with Tab", async () => {
    const { user, editor } = setup();
    expect(screen.getByText("No suggestion yet")).toBeInTheDocument();

    await typeInto(user, editor, "Retry with backoff");
    const ghost = await screen.findByTestId("ghost-text");
    expect(ghost).toHaveTextContent("and jitter.");

    expect(enhanceCalls()).toHaveLength(1);
    expect(enhanceCalls()[0]).toMatchObject({ prompt: "Retry with backoff", prompt_revision: 18, cursor: 18 });
    expect(enhanceCalls()[0].request_id).toMatch(/^req_[0-9a-f]{12}$/);

    // Inspector loads the trace for the response.
    expect(await screen.findByText("python-retry-backoff")).toBeInTheDocument();
    expect(screen.getByText("Show dropped (1)")).toBeInTheDocument();

    await user.keyboard("{Tab}");
    expect(editor.value).toBe("Retry with backoff and jitter.");
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(editor.value.length);
    expect(screen.queryByTestId("ghost-text")).not.toBeInTheDocument();
    expect(screen.getByText("rev 19 · 30:30")).toBeInTheDocument();
    await waitFor(() => expect(outcomes().map((o) => o.event)).toEqual(["shown", "accepted"]));
  });

  it("does not swallow Tab without a ghost and dismisses ghost text with Esc", async () => {
    enhanceHandler = (body) =>
      json({ schema_version: 1, request_id: body.request_id, prompt_revision: body.prompt_revision, type: "none" });
    const { user, editor } = setup();
    await typeInto(user, editor, "Hi");
    await waitFor(() => expect(enhanceCalls()).toHaveLength(1));
    await user.keyboard("{Tab}");
    expect(editor).not.toHaveFocus();
    expect(editor.value).toBe("Hi");

    enhanceHandler = (body) => json(autocomplete(body, " there"));
    await typeInto(user, editor, "!");
    await screen.findByTestId("ghost-text");
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("ghost-text")).not.toBeInTheDocument();
    expect(editor.value).toBe("Hi!");
    await waitFor(() => expect(outcomes().map((o) => o.event)).toContain("dismissed"));
  });

  it("ignores a stale response after further typing", async () => {
    let releaseFirst!: () => void;
    enhanceHandler = (body) => {
      if (enhanceCalls().length === 1) {
        return new Promise<Response>((resolve) => {
          releaseFirst = () => resolve(json(autocomplete(body, " STALE")));
        });
      }
      return json(autocomplete(body, " fresh"));
    };
    const { user, editor } = setup();
    await typeInto(user, editor, "Add tests");
    await waitFor(() => expect(enhanceCalls()).toHaveLength(1));
    expect(screen.getByRole("status", { name: "Generating suggestion" })).toBeInTheDocument();

    await typeInto(user, editor, " now");
    releaseFirst();
    const ghost = await screen.findByTestId("ghost-text");
    expect(ghost).toHaveTextContent("fresh");
    expect(enhanceCalls()).toHaveLength(2);
    expect(enhanceCalls()[1]).toMatchObject({ prompt: "Add tests now", prompt_revision: 13 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/STALE/)).not.toBeInTheDocument();
  });

  it("previews an option's diff and applies it to the prompt", async () => {
    const prompt = "Write a migration plan.";
    enhanceHandler = (body) =>
      json({
        schema_version: 1,
        request_id: body.request_id,
        prompt_revision: body.prompt_revision,
        type: "multiple_choice",
        question: "How should traffic move to Postgres?",
        options: [
          {
            id: "dual",
            label: "Dual-write, then switch reads behind a flag",
            edits: [
              { start: 8, end: 22, text: "step-by-step runbook" },
              { start: 23, end: 23, text: " Rollout: dual-write." },
            ],
          },
          {
            id: "cutover",
            label: "One cutover in a maintenance window",
            edits: [{ start: 23, end: 23, text: " One cutover." }],
          },
        ],
      });
    const { user, editor } = setup();
    await typeInto(user, editor, prompt);

    const card = await screen.findByRole("region", { name: "Question" });
    const apply = within(card).getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();

    const option = within(card).getByRole("radio", { name: /Dual-write/ });
    await user.click(option);
    expect(option).toHaveAttribute("aria-checked", "true");
    const diff = await within(card).findByTestId("diff-preview");
    expect(within(diff).getByText("migration plan")).toHaveClass("line-through");
    expect(within(diff).getByText("step-by-step runbook")).toHaveClass("underline");
    expect(within(card).getByText("2 edits · +41 −14")).toBeInTheDocument();

    // Keyboard: 2 selects the second option, ↑ goes back to the first.
    await user.keyboard("2");
    expect(within(card).getByRole("radio", { name: /cutover/ })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{ArrowUp}");
    expect(option).toHaveAttribute("aria-checked", "true");

    await user.click(apply);
    expect(editor.value).toBe("Write a step-by-step runbook. Rollout: dual-write.");
    expect(editor.selectionStart).toBe(editor.value.length);
    expect(screen.queryByRole("region", { name: "Question" })).not.toBeInTheDocument();
    await waitFor(() => expect(outcomes().at(-1)).toMatchObject({ event: "accepted", option_id: "dual" }));
  });

  it("declines all options with Esc and leaves the prompt unchanged", async () => {
    enhanceHandler = (body) =>
      json({
        schema_version: 1,
        request_id: body.request_id,
        prompt_revision: body.prompt_revision,
        type: "multiple_choice",
        question: "Which output format?",
        options: [
          { id: "md", label: "Markdown", edits: [{ start: 9, end: 9, text: " as Markdown" }] },
          { id: "json", label: "JSON", edits: [{ start: 9, end: 9, text: " as JSON" }] },
        ],
      });
    const { user, editor } = setup();
    await typeInto(user, editor, "Summarise");
    await screen.findByRole("region", { name: "Question" });

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Question" })).not.toBeInTheDocument();
    expect(editor.value).toBe("Summarise");
    await waitFor(() => expect(outcomes().map((o) => o.event)).toEqual(["shown", "declined"]));
  });

  it("shows a 502 inline and Retry re-requests", async () => {
    enhanceHandler = () => json({ error: { code: "upstream_timeout", message: "upstream model timeout" } }, 502);
    const { user, editor } = setup();
    await typeInto(user, editor, "Summarise the failing CI job");
    expect(await screen.findByRole("alert")).toHaveTextContent("502 · upstream model timeout");

    enhanceHandler = (body) => json(autocomplete(body, " and propose a fix."));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("ghost-text")).toHaveTextContent("and propose a fix.");
    expect(enhanceCalls()).toHaveLength(2);
    expect(enhanceCalls()[1].prompt).toBe("Summarise the failing CI job");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never requests for a whitespace-only prompt", async () => {
    const { user, editor } = setup();
    await typeInto(user, editor, "   ");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(enhanceCalls()).toHaveLength(0);
  });

  it("sends to Codex: stores the hand-off, copies the prompt and persists the draft", async () => {
    enhanceHandler = (body) =>
      json({ schema_version: 1, request_id: body.request_id, prompt_revision: body.prompt_revision, type: "none" });
    const { user, editor } = setup();
    await typeInto(user, editor, "Ship it; rm -rf $(echo hi)");
    expect(JSON.parse(window.localStorage.getItem("pe.refine.draft")!)).toBe("Ship it; rm -rf $(echo hi)");

    await user.click(screen.getByRole("button", { name: "Send to Codex" }));
    expect(await screen.findByText("Copied for Codex")).toBeInTheDocument();
    expect(calls.find((call) => call.path === "/v1/handoff")?.body).toEqual({ prompt: "Ship it; rm -rf $(echo hi)" });
    expect(await navigator.clipboard.readText()).toBe("Ship it; rm -rf $(echo hi)");
  });
});
