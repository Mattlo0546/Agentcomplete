import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KnowledgeView } from "../knowledge-view";
import { FakeBackend, makeItem, renderWithProviders } from "./helpers";

let backend: FakeBackend;

beforeEach(() => {
  backend = new FakeBackend([
    makeItem(1, {
      title: "python-retry-backoff",
      tags: ["python", "retry", "resilience"],
      summary: "Retry with jitter",
    }),
    makeItem(2, { title: "Refactor with tests first", kind: "prompt", tags: ["refactor"], body: "Characterise first" }),
    makeItem(3, { title: "Bug triage loop", kind: "graph", tags: ["debugging", "python"] }),
  ]);
  backend.install();
});
afterEach(() => vi.unstubAllGlobals());

const rows = () => within(screen.getByRole("listbox", { name: "Knowledge" })).getAllByRole("option");
const lastListUrl = () =>
  backend
    .callsTo("GET", "/v1/knowledge")
    .filter((c) => c.url.pathname === "/v1/knowledge")
    .at(-1)!.url;

describe("Knowledge tab", () => {
  it("lists items and filters by search, kind and tag through the API", async () => {
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeView />);

    const list = await screen.findByRole("listbox", { name: "Knowledge" });
    expect(within(list).getAllByRole("option")).toHaveLength(3);
    expect(lastListUrl().searchParams.get("limit")).toBe("50");
    expect(lastListUrl().searchParams.get("offset")).toBe("0");

    // jsdom reports zero-size panels, so the resizable group swallows pointer focus; focus explicitly.
    screen.getByRole("searchbox", { name: "Search knowledge" }).focus();
    await user.keyboard("retry");
    await waitFor(() => expect(lastListUrl().searchParams.get("q")).toBe("retry"));
    await waitFor(() => expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1));
    expect(screen.getByText("1 of 3")).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox"));
    await waitFor(() => expect(lastListUrl().searchParams.has("q")).toBe(false));

    await user.click(screen.getByRole("radio", { name: "Prompts" }));
    await waitFor(() => expect(lastListUrl().searchParams.get("kind")).toBe("prompt"));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    await user.click(screen.getByRole("radio", { name: "All" }));
    await waitFor(() => expect(lastListUrl().searchParams.has("kind")).toBe(false));

    await user.click(screen.getByRole("combobox", { name: "Filter by tags" }));
    await user.click(await screen.findByRole("option", { name: /^python\s*2$/ }));
    await waitFor(() => expect(lastListUrl().searchParams.get("tags")).toBe("python"));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByText("2 of 3")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Remove tag python" }));
    await waitFor(() => expect(lastListUrl().searchParams.has("tags")).toBe(false));
  });

  it("shows the detail inspector when a row is selected and supports keyboard selection", async () => {
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeView />);
    await user.click(await screen.findByRole("option", { name: /python-retry-backoff/ }));

    const inspector = await screen.findByRole("complementary", { name: "Knowledge detail" });
    expect(await within(inspector).findByRole("heading", { name: "python-retry-backoff" })).toBeInTheDocument();
    expect(within(inspector).getByText(/used 1×/)).toBeInTheDocument();
    expect(within(inspector).getByText("Retry with jitter")).toBeInTheDocument();
    expect(within(inspector).getByRole("heading", { name: "item-1", level: 1 })).toBeInTheDocument();
    expect(within(inspector).getByText("first rule")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /python-retry-backoff/ })).toHaveAttribute("aria-selected", "true");

    screen.getByRole("listbox").focus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(await within(inspector).findByRole("heading", { name: "Refactor with tests first" })).toBeInTheDocument();
    expect(backend.callsTo("GET", "/v1/knowledge/id-2")).toHaveLength(1);
  });

  it("adds knowledge with streamed progress, reviews tags, then selects the new item", async () => {
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeView />);
    await user.click(await screen.findByRole("button", { name: "Add knowledge" }));
    const dialog = await screen.findByRole("dialog", { name: "Add knowledge" });

    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByText("Title is required")).toBeInTheDocument();
    expect(within(dialog).getByText("Body is required")).toBeInTheDocument();
    expect(backend.callsTo("POST", "/v1/knowledge")).toHaveLength(0);

    await user.click(within(dialog).getByRole("radio", { name: "Prompt" }));
    await user.type(within(dialog).getByLabelText("Title"), "postgres-session-store");
    await user.type(within(dialog).getByLabelText("Body"), "Store sessions in UNLOGGED tables");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    const steps = within(dialog).getByRole("list", { name: "Progress" });
    await waitFor(() => expect(within(steps).getByText("Tag").closest("li")).toHaveAttribute("data-state", "done"));
    expect(within(steps).getByText("Embed").closest("li")).toHaveAttribute("data-state", "active");
    expect(within(steps).getByText("Save").closest("li")).toHaveAttribute("data-state", "pending");
    expect(backend.callsTo("POST", "/v1/knowledge")[0].body).toEqual({
      kind: "prompt",
      title: "postgres-session-store",
      body: "Store sessions in UNLOGGED tables",
    });

    backend.releaseDone();
    expect(await within(dialog).findByText("Generated summary")).toBeInTheDocument();
    expect(within(steps).getByText("Save").closest("li")).toHaveAttribute("data-state", "done");
    expect(within(dialog).getByText("existing")).toBeInTheDocument();
    expect(within(dialog).getByText("new")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Remove tag postgres" }));
    await user.click(within(dialog).getByRole("button", { name: "Tag" }));
    await user.type(within(dialog).getByRole("textbox", { name: "New tag" }), "ttl{Enter}");
    await user.click(within(dialog).getByRole("button", { name: "Done" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add knowledge" })).not.toBeInTheDocument());
    expect(backend.callsTo("PATCH", "/v1/knowledge/new-1")[0].body).toEqual({ tags: ["sessions", "ttl"] });
    expect(await screen.findByText("Knowledge added")).toBeInTheDocument();
    const inspector = screen.getByRole("complementary", { name: "Knowledge detail" });
    expect(await within(inspector).findByRole("heading", { name: "postgres-session-store" })).toBeInTheDocument();
  });

  it("shows an inline error from the stream and allows retry", async () => {
    const user = userEvent.setup();
    backend.ingest.fail = "Embedding model unavailable";
    renderWithProviders(<KnowledgeView />);
    await user.click(await screen.findByRole("button", { name: "Add knowledge" }));
    const dialog = await screen.findByRole("dialog", { name: "Add knowledge" });
    await user.type(within(dialog).getByLabelText("Title"), "t");
    await user.type(within(dialog).getByLabelText("Body"), "b");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => backend.releaseDone());

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Embedding model unavailable");
    backend.ingest.fail = undefined;
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(backend.callsTo("POST", "/v1/knowledge")).toHaveLength(2));
    await waitFor(() => backend.releaseDone());
    expect(await within(dialog).findByText("Generated summary")).toBeInTheDocument();
  });

  it("edits a body inline, sending a PATCH that triggers regeneration", async () => {
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeView />);
    await user.click(await screen.findByRole("option", { name: /Refactor with tests first/ }));
    await screen.findByRole("heading", { name: "Refactor with tests first" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const body = screen.getByLabelText("Body");
    await user.clear(body);
    await user.keyboard("New body");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(backend.callsTo("PATCH", "/v1/knowledge/id-2")).toHaveLength(1), { timeout: 2000 });
    expect(backend.callsTo("PATCH", "/v1/knowledge/id-2")[0].body).toEqual({ body: "New body" });
    expect(await within(screen.getByRole("complementary")).findByText("Regenerated summary")).toBeInTheDocument();
  });

  it("deletes after confirmation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<KnowledgeView />);
    await user.click(await screen.findByRole("option", { name: /Bug triage loop/ }));
    await screen.findByRole("heading", { name: "Bug triage loop" });
    await user.click(screen.getByRole("button", { name: "Delete" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(backend.callsTo("DELETE", "/v1/knowledge")).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(backend.callsTo("DELETE", "/v1/knowledge/id-3")).toHaveLength(1));
    expect(await screen.findByText("Knowledge deleted")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("option", { name: /Bug triage loop/ })).not.toBeInTheDocument());
    expect(screen.getByText("Select an item")).toBeInTheDocument();
  });

  it("shows a single label and action when empty", async () => {
    backend.items = [];
    renderWithProviders(<KnowledgeView />);
    expect(await screen.findByText("No knowledge yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add knowledge" })).toHaveLength(2);
  });
});
