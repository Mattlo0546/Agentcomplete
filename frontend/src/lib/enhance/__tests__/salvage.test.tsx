import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE_STORAGE_KEY } from "@/lib/api/client";
import type { EnhanceRequest, EnhanceResponse } from "@/lib/api/types";

import { postEnhance, postOutcome } from "../api";
import { ghostText } from "../state";
import { MAX_SALVAGE_AGE_MS, useEnhance } from "../use-enhance";

vi.mock("../api", () => ({ postEnhance: vi.fn(), postOutcome: vi.fn() }));

type Controller = { current: ReturnType<typeof useEnhance> };
type Deferred = { body: EnhanceRequest; signal: AbortSignal; resolve: (response: EnhanceResponse) => void };
let requests: Deferred[];
const type = (result: Controller, prompt: string, inputType = "insertText") =>
  act(() => result.current.change(prompt, prompt.length, prompt.length, inputType));
const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
const autocomplete = (request: Deferred, text = "ies with bounded backoff"): EnhanceResponse => ({
  schema_version: 1,
  request_id: request.body.request_id,
  prompt_revision: request.body.prompt_revision,
  type: "autocomplete",
  insert_at: request.body.prompt.length,
  text,
});
const resolve = (request: Deferred, response = autocomplete(request)) => act(async () => request.resolve(response));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  window.localStorage.clear();
  requests = [];
  vi.mocked(postEnhance).mockImplementation(
    (body, signal) => new Promise((resolve) => requests.push({ body, signal, resolve })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("validated in-flight suffix salvage", () => {
  it("shows only the untyped remainder and credits the original request on Tab", async () => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Add retr");
    await advance(150);
    type(result, "Add retries");
    expect(requests[0].signal.aborted).toBe(false);
    await resolve(requests[0]);
    expect(ghostText(result.current.state)).toBe(" with bounded backoff");
    expect(result.current.state.suggestion).toMatchObject({ revision: 2, sourceRevision: 1 });
    await advance(1000);
    expect(requests).toHaveLength(1);
    act(() => result.current.acceptGhost());
    expect(result.current.state.prompt).toBe("Add retries with bounded backoff");
    expect(postOutcome).toHaveBeenLastCalledWith(
      expect.objectContaining({ event: "accepted", request_id: requests[0].body.request_id, prompt_revision: 1 }),
    );
  });

  it("allows an already-running exact request to replace an adopted suffix with none", async () => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Add retr");
    await advance(150);
    type(result, "Add retries");
    await advance(150);
    await resolve(requests[0]);
    expect(ghostText(result.current.state)).toBe(" with bounded backoff");
    expect(requests[1].signal.aborted).toBe(false);
    await resolve(requests[1], { ...autocomplete(requests[1]), type: "none" });
    expect(ghostText(result.current.state)).toBe("");
    expect(result.current.state.pending).toBeNull();
    expect(postOutcome).toHaveBeenLastCalledWith(
      expect.objectContaining({ event: "superseded", request_id: requests[0].body.request_id, prompt_revision: 1 }),
    );
  });

  it.each(["none", "multiple_choice"] as const)(
    "never replaces a newer exact %s with a late older autocomplete",
    async (typeName) => {
      const { result } = renderHook(() => useEnhance());
      type(result, "Add retr");
      await advance(150);
      type(result, "Add retries");
      await advance(150);
      const current = requests[1];
      await resolve(
        current,
        typeName === "none"
          ? { ...autocomplete(current), type: "none" }
          : {
              ...autocomplete(current),
              type: "multiple_choice",
              question: "Which policy?",
              options: [
                { id: "a", label: "Bounded", edits: [{ start: 11, end: 11, text: " with a cap" }] },
                { id: "b", label: "No retries", edits: [{ start: 0, end: 11, text: "Fail immediately" }] },
              ],
            },
      );
      expect(requests[0].signal.aborted).toBe(true);
      await resolve(requests[0]);
      expect(ghostText(result.current.state)).toBe("");
      expect(result.current.state.suggestion?.type ?? "none").toBe(typeName);
    },
  );

  it("keeps at most one obsolete request and one current request without delaying current work", async () => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Add retr");
    await advance(150);
    type(result, "Add retri");
    await advance(150);
    expect(requests.filter((request) => !request.signal.aborted)).toHaveLength(2);
    type(result, "Add retries");
    expect(requests[0].signal.aborted).toBe(true);
    await advance(150);
    expect(requests).toHaveLength(3);
    expect(requests.filter((request) => !request.signal.aborted)).toHaveLength(2);
    await resolve(requests[0]);
    expect(ghostText(result.current.state)).toBe("");
    await resolve(requests[1], autocomplete(requests[1], "es with a cap"));
    expect(ghostText(result.current.state)).toBe(" with a cap");
  });

  it.each([
    ["divergence", "Add retrieval"],
    ["new negation", "Add retr without retries"],
    ["fully consumed prediction", "Add retries with bounded backoff"],
  ])("does not show or count an acceptance for %s", async (_label, prompt) => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Add retr");
    await advance(150);
    type(result, prompt);
    await resolve(requests[0]);
    expect(ghostText(result.current.state)).toBe("");
    expect(postOutcome).not.toHaveBeenCalled();
    await advance(150);
    expect(requests).toHaveLength(2);
    expect(requests[1].body.prompt).toBe(prompt);
  });

  it.each(["backspace", "selection", "interior edit", "paste", "replacement", "IME", "Escape"])(
    "permanently invalidates old work after %s, even if the final text matches again",
    async (event) => {
      const { result } = renderHook(() => useEnhance());
      type(result, "Add retr");
      await advance(150);
      type(result, "Add retries");
      if (event === "backspace") type(result, "Add retrie", "deleteContentBackward");
      if (event === "selection") act(() => result.current.select(1, 1));
      if (event === "interior edit") type(result, "Use retries");
      if (event === "paste") type(result, "Add retries ", "insertFromPaste");
      if (event === "replacement") type(result, "Add retries ", "insertReplacementText");
      if (event === "IME") {
        act(() => result.current.setComposing(true));
        act(() => result.current.setComposing(false));
      }
      if (event === "Escape") act(() => result.current.dismissGhost());
      type(result, "Add retries");
      expect(requests[0].signal.aborted).toBe(true);
      await resolve(requests[0]);
      expect(ghostText(result.current.state)).toBe("");
    },
  );

  it("rejects salvage after configuration changes or changing the backend", async () => {
    const { result, rerender } = renderHook(({ key }) => useEnhance(150, { configurationKey: key }), {
      initialProps: { key: "a" },
    });
    type(result, "Add retr");
    await advance(150);
    type(result, "Add retries");
    rerender({ key: "b" });
    expect(requests[0].signal.aborted).toBe(true);
    await resolve(requests[0]);
    expect(ghostText(result.current.state)).toBe("");
    await advance(150);
    type(result, "Add retries with");
    window.localStorage.setItem(API_BASE_STORAGE_KEY, "https://changed.invalid");
    await resolve(requests[1], autocomplete(requests[1], " with bounded backoff"));
    expect(ghostText(result.current.state)).toBe("");
    expect(result.current.state.retained).toBeNull();
  });

  it("rejects a response beyond the bounded age and never caches it for retyping", async () => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Add retr");
    await advance(150);
    type(result, "Add retries");
    await advance(MAX_SALVAGE_AGE_MS + 1);
    await resolve(requests[0]);
    expect(ghostText(result.current.state)).toBe("");
    type(result, "Add retr", "deleteContentBackward");
    type(result, "Add retries");
    expect(ghostText(result.current.state)).toBe("");
  });

  it("cancels competing exact work on acceptance and ignores its late answer", async () => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Add retr");
    await advance(150);
    type(result, "Add retries");
    await advance(150);
    await resolve(requests[0]);
    act(() => result.current.acceptGhost());
    expect(requests[1].signal.aborted).toBe(true);
    await resolve(requests[1], autocomplete(requests[1], " incorrect replacement"));
    expect(result.current.state.prompt).toBe("Add retries with bounded backoff");
    expect(ghostText(result.current.state)).toBe("");
    expect(vi.mocked(postOutcome).mock.calls.filter(([body]) => body.event === "accepted")).toHaveLength(1);
  });
});
