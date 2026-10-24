import { describe, expect, it } from "vitest";

import type { EnhanceResponse } from "@/lib/api/types";

import {
  activeQuestion,
  canRequest,
  enhanceReducer,
  ghostText,
  initialEnhanceState,
  type EnhanceAction,
  type EnhanceState,
} from "../state";

const run = (actions: EnhanceAction[], from: EnhanceState = initialEnhanceState) =>
  actions.reduce(enhanceReducer, from);
const type = (prompt: string): EnhanceAction => ({
  type: "change",
  prompt,
  selectionStart: prompt.length,
  selectionEnd: prompt.length,
});
const request = (state: EnhanceState, requestId: string): EnhanceAction => ({
  type: "request",
  snapshot: { requestId, revision: state.revision, prompt: state.prompt, cursor: state.selectionEnd },
});
const autocomplete = (requestId: string, revision: number, insertAt: number, text = " and jitter."): EnhanceAction => ({
  type: "response",
  now: 1000,
  response: {
    schema_version: 1,
    request_id: requestId,
    prompt_revision: revision,
    type: "autocomplete",
    insert_at: insertAt,
    text,
  },
});

describe("enhanceReducer", () => {
  it("bumps the revision on every text change but not on selection changes", () => {
    let state = run([type("a"), type("ab")]);
    expect(state.revision).toBe(2);
    state = enhanceReducer(state, { type: "select", selectionStart: 0, selectionEnd: 0 });
    expect(state.revision).toBe(2);
    expect(state.selectionStart).toBe(0);
  });

  it("shows a current autocomplete response as ghost text", () => {
    const typed = run([type("Retry with backoff")]);
    const state = run([request(typed, "req_1"), autocomplete("req_1", 1, 18)], typed);
    expect(ghostText(state)).toBe(" and jitter.");
    expect(state.traceId).toBe("req_1");
    expect(state.pending).toBeNull();
  });

  it("drops responses for an older revision or a superseded request id", () => {
    const typed = run([type("Retry")]);
    let state = enhanceReducer(typed, request(typed, "req_old"));
    state = enhanceReducer(state, type("Retry with"));
    expect(state.pending).toBeNull();
    state = enhanceReducer(state, autocomplete("req_old", 1, 5));
    expect(state.suggestion).toBeNull();

    state = enhanceReducer(state, request(state, "req_a"));
    state = enhanceReducer(state, request(state, "req_b"));
    expect(enhanceReducer(state, autocomplete("req_a", 2, 10))).toBe(state);
    expect(ghostText(enhanceReducer(state, autocomplete("req_b", 2, 10)))).toBe(" and jitter.");
  });

  it("ignores a request whose snapshot is no longer current", () => {
    const typed = run([type("ab")]);
    const stale = { type: "request", snapshot: { requestId: "r", revision: 0, prompt: "a", cursor: 1 } } as const;
    expect(enhanceReducer(typed, stale)).toBe(typed);
  });

  it("rejects an autocomplete that does not insert at the end", () => {
    const typed = run([type("abc")]);
    const state = run([request(typed, "r"), autocomplete("r", 1, 2)], typed);
    expect(state.suggestion).toBeNull();
    expect(state.error?.message).toBe("Invalid suggestion");
  });

  it("invalidates the visible suggestion on any text or cursor change", () => {
    const typed = run([type("abc")]);
    const shown = run([request(typed, "r"), autocomplete("r", 1, 3)], typed);
    expect(enhanceReducer(shown, { type: "select", selectionStart: 1, selectionEnd: 1 }).suggestion).toBeNull();
    expect(enhanceReducer(shown, type("abcd")).suggestion).toBeNull();
  });

  it("accepts ghost text as a new revision with the cursor at the end", () => {
    const typed = run([type("abc")]);
    const accepted = run([request(typed, "r"), autocomplete("r", 1, 3, " def"), { type: "acceptGhost" }], typed);
    expect(accepted.prompt).toBe("abc def");
    expect(accepted.revision).toBe(2);
    expect(accepted.selectionStart).toBe(7);
    expect(ghostText(accepted)).toBe("");
  });

  it("applies an option atomically and dismisses without changing the prompt", () => {
    const typed = run([type("Write a plan.")]);
    const question: EnhanceResponse = {
      schema_version: 1,
      request_id: "q",
      prompt_revision: 1,
      type: "multiple_choice",
      question: "Which?",
      options: [
        {
          id: "a",
          label: "A",
          edits: [
            { start: 8, end: 12, text: "runbook" },
            { start: 13, end: 13, text: " Go." },
          ],
        },
        { id: "b", label: "B", edits: [{ start: 0, end: 0, text: "Please " }] },
      ],
    };
    const shown = run([request(typed, "q"), { type: "response", response: question, now: 0 }], typed);
    expect(activeQuestion(shown)?.options).toHaveLength(2);

    const applied = enhanceReducer(shown, { type: "apply", optionId: "a" });
    expect(applied.prompt).toBe("Write a runbook. Go.");
    expect(applied.selectionStart).toBe(applied.prompt.length);
    expect(applied.revision).toBe(2);

    const declined = enhanceReducer(shown, { type: "dismiss" });
    expect(declined.prompt).toBe("Write a plan.");
    expect(activeQuestion(declined)).toBeNull();
  });

  it("records failures only for the pending request", () => {
    const typed = run([type("abc")]);
    const pending = enhanceReducer(typed, request(typed, "r"));
    const error = { status: 502, message: "upstream model timeout" };
    expect(enhanceReducer(pending, { type: "failure", requestId: "other", error })).toBe(pending);
    expect(enhanceReducer(pending, { type: "failure", requestId: "r", error }).error).toEqual(error);
  });

  it("never requests for an empty or whitespace prompt", () => {
    expect(canRequest(run([type("   \n")]))).toBe(false);
    expect(canRequest(run([type(" a")]))).toBe(true);
  });

  it("hydrates a stored draft only into an empty editor", () => {
    const state = enhanceReducer(initialEnhanceState, { type: "hydrate", prompt: "draft" });
    expect(state.prompt).toBe("draft");
    expect(state.selectionStart).toBe(5);
    expect(enhanceReducer(state, { type: "hydrate", prompt: "other" }).prompt).toBe("draft");
  });
});
