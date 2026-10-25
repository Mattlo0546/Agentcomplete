import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnhanceRequest, EnhanceResponse } from "@/lib/api/types";

import { postEnhance, postOutcome } from "../api";
import { ghostText } from "../state";
import { DRAFT_STORAGE_KEY, useEnhance } from "../use-enhance";

vi.mock("../api", () => ({ postEnhance: vi.fn(), postOutcome: vi.fn() }));

const response = (body: EnhanceRequest, text = " it safely"): EnhanceResponse => ({
  schema_version: 1,
  request_id: body.request_id,
  prompt_revision: body.prompt_revision,
  type: "autocomplete",
  insert_at: body.prompt.length,
  text,
});

const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
type Controller = ReturnType<typeof useEnhance>;
const type = (result: { current: Controller }, prompt: string) =>
  act(() => result.current.change(prompt, prompt.length, prompt.length));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  window.localStorage.clear();
  vi.mocked(postEnhance).mockImplementation(async (body) => response(body));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("autocomplete scheduling", () => {
  it("sends once after 150 ms of quiet time and uses the latest input", async () => {
    const { result } = renderHook(() => useEnhance());
    type(result, "S");
    await advance(100);
    type(result, "Ship");
    await advance(149);
    expect(postEnhance).not.toHaveBeenCalled();
    await advance(1);
    expect(postEnhance).toHaveBeenCalledTimes(1);
    expect(vi.mocked(postEnhance).mock.calls[0][0]).toMatchObject({ prompt: "Ship", prompt_revision: 2 });
    expect(ghostText(result.current.state)).toBe(" it safely");
  });

  it("preserves elapsed quiet time when settings arrive during the debounce", async () => {
    const { result, rerender } = renderHook(({ delay }) => useEnhance(delay), { initialProps: { delay: 400 } });
    type(result, "Ship");
    await advance(100);
    rerender({ delay: 150 });
    await advance(49);
    expect(postEnhance).not.toHaveBeenCalled();
    await advance(1);
    expect(postEnhance).toHaveBeenCalledTimes(1);
  });

  it("aborts superseded work immediately and rejects its late result", async () => {
    let resolveFirst!: (value: EnhanceResponse) => void;
    vi.mocked(postEnhance).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = renderHook(() => useEnhance());
    type(result, "Ship");
    await advance(200);
    const [first, signal] = vi.mocked(postEnhance).mock.calls[0];
    type(result, "Ship tests");
    expect(signal.aborted).toBe(true);
    await act(async () => resolveFirst(response(first, " STALE")));
    expect(ghostText(result.current.state)).toBe("");
    await advance(200);
    expect(ghostText(result.current.state)).toBe(" it safely");
    expect(postEnhance).toHaveBeenCalledTimes(2);
  });

  it("keeps a matching ghost suffix instantly without more requests and credits its original revision", async () => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Ship");
    await advance(200);
    const original = vi.mocked(postEnhance).mock.calls[0][0];
    type(result, "Ship it");
    expect(ghostText(result.current.state)).toBe(" safely");
    expect(result.current.state.revision).toBe(2);
    await advance(1000);
    expect(postEnhance).toHaveBeenCalledTimes(1);
    expect(postOutcome).toHaveBeenCalledTimes(1);
    act(() => result.current.acceptGhost());
    expect(result.current.state.prompt).toBe("Ship it safely");
    expect(postOutcome).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: "accepted",
        request_id: original.request_id,
        prompt_revision: original.prompt_revision,
      }),
    );
  });

  it("invalidates a reused suffix when typing diverges and preserves source attribution", async () => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Ship");
    await advance(200);
    type(result, "Ship it");
    type(result, "Ship it now");
    expect(ghostText(result.current.state)).toBe("");
    expect(postOutcome).toHaveBeenLastCalledWith(expect.objectContaining({ event: "superseded", prompt_revision: 1 }));
    await advance(200);
    expect(postEnhance).toHaveBeenCalledTimes(2);
    expect(vi.mocked(postEnhance).mock.calls[1][0]).toMatchObject({ prompt: "Ship it now", prompt_revision: 3 });
  });

  it("records acceptance when the entire ghost is typed", async () => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Ship");
    await advance(200);
    type(result, "Ship it safely");
    expect(ghostText(result.current.state)).toBe("");
    expect(postOutcome).toHaveBeenLastCalledWith(expect.objectContaining({ event: "accepted", prompt_revision: 1 }));
  });

  it("does not send intermediate IME text and aborts work when composition starts", async () => {
    vi.mocked(postEnhance).mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useEnhance());
    type(result, "Ship");
    await advance(200);
    const signal = vi.mocked(postEnhance).mock.calls[0][1];
    act(() => result.current.setComposing(true));
    expect(signal.aborted).toBe(true);
    expect(result.current.state.pending).toBeNull();
    type(result, "Ship 日本");
    await advance(1000);
    expect(postEnhance).toHaveBeenCalledTimes(1);
    act(() => result.current.setComposing(false));
    await advance(200);
    expect(postEnhance).toHaveBeenCalledTimes(2);
    expect(vi.mocked(postEnhance).mock.calls[1][0].prompt).toBe("Ship 日本");
  });

  it("cancels queued and in-flight requests when suggestions are disabled", async () => {
    vi.mocked(postEnhance).mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useEnhance(200, {
          autocompleteEnabled: enabled,
          questionsEnabled: enabled,
        }),
      { initialProps: { enabled: true } },
    );
    type(result, "Ship");
    rerender({ enabled: false });
    await advance(1000);
    expect(postEnhance).not.toHaveBeenCalled();
    rerender({ enabled: true });
    type(result, "Ship tests");
    await advance(200);
    const signal = vi.mocked(postEnhance).mock.calls[0][1];
    rerender({ enabled: false });
    expect(signal.aborted).toBe(true);
    expect(result.current.state.pending).toBeNull();
  });

  it("skips impossible autocomplete requests away from the end, but allows questions there", async () => {
    const { result, rerender } = renderHook(({ questions }) => useEnhance(200, { questionsEnabled: questions }), {
      initialProps: { questions: false },
    });
    act(() => result.current.change("Ship", 1, 1));
    await advance(1000);
    expect(postEnhance).not.toHaveBeenCalled();
    rerender({ questions: true });
    act(() => result.current.select(2, 2));
    await advance(200);
    expect(postEnhance).toHaveBeenCalledTimes(1);
    expect(vi.mocked(postEnhance).mock.calls[0][0].cursor).toBe(2);
  });

  it.each(["autocomplete", "multiple_choice"] as const)(
    "removes a displayed %s when that mode is disabled",
    async (mode) => {
      vi.mocked(postEnhance).mockImplementation(async (body) =>
        mode === "autocomplete"
          ? response(body)
          : {
              schema_version: 1,
              request_id: body.request_id,
              prompt_revision: body.prompt_revision,
              type: "multiple_choice",
              question: "Which format?",
              options: [
                { id: "a", label: "A", edits: [{ start: 0, end: 0, text: "A " }] },
                { id: "b", label: "B", edits: [{ start: 0, end: 0, text: "B " }] },
              ],
            },
      );
      const { result, rerender } = renderHook(
        ({ enabled }) =>
          useEnhance(200, {
            autocompleteEnabled: mode === "autocomplete" ? enabled : true,
            questionsEnabled: mode === "multiple_choice" ? enabled : true,
          }),
        { initialProps: { enabled: true } },
      );
      type(result, "Ship");
      await advance(200);
      expect(result.current.state.suggestion?.type).toBe(mode);
      rerender({ enabled: false });
      expect(result.current.state.suggestion).toBeNull();
      expect(postOutcome).toHaveBeenLastCalledWith(
        expect.objectContaining({ event: "superseded", prompt_revision: 1 }),
      );
    },
  );

  it("cancels an old-mode response even when the other suggestion mode remains enabled", async () => {
    let resolveFirst!: (value: EnhanceResponse) => void;
    vi.mocked(postEnhance).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result, rerender } = renderHook(({ autocompleteEnabled }) => useEnhance(200, { autocompleteEnabled }), {
      initialProps: { autocompleteEnabled: true },
    });
    type(result, "Ship");
    await advance(200);
    const [first, signal] = vi.mocked(postEnhance).mock.calls[0];
    rerender({ autocompleteEnabled: false });
    expect(signal.aborted).toBe(true);
    await act(async () => resolveFirst(response(first)));
    expect(result.current.state.suggestion).toBeNull();
    await advance(200);
    expect(postEnhance).toHaveBeenCalledTimes(2);
    expect(result.current.state.suggestion).toBeNull();
    expect(result.current.state.pending).toBeNull();
  });

  it("clears queued work and aborts pending work on unmount", async () => {
    const first = renderHook(() => useEnhance());
    type(first.result, "Ship");
    first.unmount();
    await advance(1000);
    expect(postEnhance).not.toHaveBeenCalled();

    vi.mocked(postEnhance).mockImplementation(() => new Promise(() => {}));
    const second = renderHook(() => useEnhance());
    type(second.result, "Ship tests");
    await advance(200);
    const signal = vi.mocked(postEnhance).mock.calls[0][1];
    second.unmount();
    expect(signal.aborted).toBe(true);
  });
});

describe("previous request context", () => {
  it("chains validated responses including none, across acceptance and further edits", async () => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Ship");
    await advance(200);
    const first = vi.mocked(postEnhance).mock.calls[0][0];
    expect(first).not.toHaveProperty("previous_request_id");
    act(() => result.current.acceptGhost());
    vi.mocked(postEnhance).mockImplementationOnce(async (body) => ({
      schema_version: 1,
      request_id: body.request_id,
      prompt_revision: body.prompt_revision,
      type: "none",
    }));
    type(result, "Ship it safely with tests");
    await advance(200);
    const second = vi.mocked(postEnhance).mock.calls[1][0];
    expect(second.previous_request_id).toBe(first.request_id);
    // A none response does not change the visible trace, but must become the next context reference.
    expect(result.current.state.traceId).toBe(first.request_id);
    type(result, "Ship it safely with tests and docs");
    await advance(200);
    expect(vi.mocked(postEnhance).mock.calls[2][0].previous_request_id).toBe(second.request_id);
  });

  it("does not let a canceled response overwrite newer validated context", async () => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Ship");
    await advance(200);
    let resolveCanceled!: (value: EnhanceResponse) => void;
    vi.mocked(postEnhance).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCanceled = resolve;
        }),
    );
    type(result, "Ship tests");
    await advance(200);
    const [canceled, signal] = vi.mocked(postEnhance).mock.calls[1];
    type(result, "Ship tests and docs");
    await advance(200);
    const current = vi.mocked(postEnhance).mock.calls[2][0];
    expect(signal.aborted).toBe(true);
    await act(async () => resolveCanceled(response(canceled)));
    type(result, "Ship tests and docs today");
    await advance(200);
    expect(vi.mocked(postEnhance).mock.calls[3][0].previous_request_id).toBe(current.request_id);
  });

  it.each([
    ["wrong request ID", (body: EnhanceRequest): EnhanceResponse => ({ ...response(body), request_id: "req_wrong" })],
    [
      "wrong revision",
      (body: EnhanceRequest): EnhanceResponse => ({ ...response(body), prompt_revision: body.prompt_revision - 1 }),
    ],
    [
      "invalid insertion",
      (body: EnhanceRequest): EnhanceResponse => ({
        ...response(body),
        type: "autocomplete",
        insert_at: 0,
        text: " invalid",
      }),
    ],
  ] as const)("does not advance context for a response with %s", async (_name, invalidResponse) => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Ship");
    await advance(200);
    const first = vi.mocked(postEnhance).mock.calls[0][0];
    vi.mocked(postEnhance).mockImplementationOnce(async (body) => invalidResponse(body));
    type(result, "Ship tests");
    await advance(200);
    type(result, "Ship tests and docs");
    await advance(200);
    expect(vi.mocked(postEnhance).mock.calls[2][0].previous_request_id).toBe(first.request_id);
  });

  it("keeps the last validated context after a failed request", async () => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Ship");
    await advance(200);
    const first = vi.mocked(postEnhance).mock.calls[0][0];
    vi.mocked(postEnhance).mockRejectedValueOnce(new Error("Network failed"));
    type(result, "Ship tests");
    await advance(200);
    expect(result.current.state.error).not.toBeNull();
    act(() => result.current.retry());
    expect(vi.mocked(postEnhance).mock.calls[2][0].previous_request_id).toBe(first.request_id);
    await advance(0);
  });

  it.each(["", "   \n"])("resets context when the draft is cleared to %j", async (empty) => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Ship");
    await advance(200);
    type(result, empty);
    type(result, "A new task");
    await advance(200);
    expect(vi.mocked(postEnhance).mock.calls[1][0]).not.toHaveProperty("previous_request_id");
  });

  it("starts a new context chain when restoring a history version", async () => {
    const { result } = renderHook(() => useEnhance());
    type(result, "Ship");
    await advance(200);
    expect(vi.mocked(postEnhance).mock.calls[0][0]).not.toHaveProperty("previous_request_id");

    act(() => result.current.restore("Saved history"));
    await advance(200);

    expect(vi.mocked(postEnhance).mock.calls[1][0]).toMatchObject({ prompt: "Saved history" });
    expect(vi.mocked(postEnhance).mock.calls[1][0]).not.toHaveProperty("previous_request_id");
  });

  it("starts a new context chain after remounting even when the draft is restored", async () => {
    const first = renderHook(() => useEnhance());
    type(first.result, "Ship");
    await advance(200);
    first.unmount();
    const second = renderHook(() => useEnhance());
    expect(second.result.current.state.prompt).toBe("Ship");
    type(second.result, "Ship tests");
    await advance(200);
    expect(vi.mocked(postEnhance).mock.calls[1][0]).not.toHaveProperty("previous_request_id");
  });
});

describe("draft persistence", () => {
  it("batches a typing burst and flushes the last edit on page hide", async () => {
    const { result } = renderHook(() => useEnhance());
    const writes = vi.spyOn(Storage.prototype, "setItem");
    type(result, "S");
    type(result, "Ship");
    await advance(249);
    expect(writes).not.toHaveBeenCalled();
    await advance(1);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY)!)).toBe("Ship");
    type(result, "Ship tests");
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY)!)).toBe("Ship tests");
  });

  it("loads the existing draft and saves the last edit on unmount", () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify("Saved draft"));
    const { result, unmount } = renderHook(() => useEnhance());
    expect(result.current.state.prompt).toBe("Saved draft");
    type(result, "Edited draft");
    unmount();
    expect(JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY)!)).toBe("Edited draft");
  });
});
