import { describe, expect, it } from "vitest";

import type { EnhanceResponse } from "@/lib/api/types";

import { applyEdits, editsAreValid, optionsAreValid, responseIsValid } from "../edits";

describe("editsAreValid", () => {
  const prompt = "Write a migration plan.";

  it("accepts in-bounds, non-overlapping edits in any order", () => {
    expect(
      editsAreValid(prompt, [
        { start: 22, end: 23, text: " for Postgres." },
        { start: 6, end: 7, text: "the" },
      ]),
    ).toBe(true);
  });

  it("rejects out-of-bounds, inverted and negative ranges", () => {
    expect(editsAreValid(prompt, [{ start: 0, end: 99, text: "x" }])).toBe(false);
    expect(editsAreValid(prompt, [{ start: 5, end: 3, text: "x" }])).toBe(false);
    expect(editsAreValid(prompt, [{ start: -1, end: 0, text: "x" }])).toBe(false);
    expect(editsAreValid(prompt, [{ start: 0.5, end: 1, text: "x" }])).toBe(false);
  });

  it("rejects overlaps, duplicate insertion points, no-ops and empty lists", () => {
    expect(
      editsAreValid(prompt, [
        { start: 0, end: 10, text: "a" },
        { start: 9, end: 12, text: "b" },
      ]),
    ).toBe(false);
    expect(
      editsAreValid(prompt, [
        { start: 4, end: 4, text: "a" },
        { start: 4, end: 4, text: "b" },
      ]),
    ).toBe(false);
    expect(editsAreValid(prompt, [{ start: 0, end: 5, text: "Write" }])).toBe(false);
    expect(editsAreValid(prompt, [{ start: 3, end: 3, text: "" }])).toBe(false);
    expect(editsAreValid(prompt, [])).toBe(false);
  });

  it("allows adjacent edits and an insertion right before a replacement", () => {
    expect(
      editsAreValid(prompt, [
        { start: 0, end: 5, text: "Draft" },
        { start: 5, end: 5, text: " up" },
      ]),
    ).toBe(true);
    expect(
      editsAreValid(prompt, [
        { start: 6, end: 6, text: "X" },
        { start: 6, end: 7, text: "the" },
      ]),
    ).toBe(true);
  });
});

describe("applyEdits", () => {
  it("applies end to start atomically and puts the cursor after the last edit", () => {
    const prompt = "Write a migration plan for moving our session store.";
    const result = applyEdits(prompt, [
      { start: 6, end: 22, text: "a step-by-step runbook" },
      { start: 52, end: 52, text: " Rollout: dual-write." },
    ]);
    expect(result.text).toBe("Write a step-by-step runbook for moving our session store. Rollout: dual-write.");
    expect(result.cursor).toBe(result.text.length);
  });

  it("puts the cursor after the last edit in document order, accounting for earlier shifts", () => {
    const result = applyEdits("aaa bbb ccc", [
      { start: 4, end: 7, text: "BBBBB" },
      { start: 0, end: 3, text: "A" },
    ]);
    expect(result.text).toBe("A BBBBB ccc");
    expect(result.text.slice(0, result.cursor)).toBe("A BBBBB");
  });

  it("throws on invalid edits instead of producing a partial result", () => {
    expect(() => applyEdits("abc", [{ start: 2, end: 9, text: "x" }])).toThrow();
  });

  it("uses UTF-16 code units for emoji and CJK", () => {
    const prompt = "修复 🚀 bug";
    // "修复 " = 3 units, "🚀" = 2 units (surrogate pair) at [3, 5).
    expect(prompt.length).toBe(9);
    const result = applyEdits(prompt, [
      { start: 3, end: 5, text: "🔥🔥" },
      { start: 6, end: 9, text: "错误" },
    ]);
    expect(result.text).toBe("修复 🔥🔥 错误");
    expect(result.cursor).toBe(result.text.length);
  });
});

describe("responseIsValid", () => {
  const base = { schema_version: 1 as const, request_id: "req_1", prompt_revision: 1 };

  it("requires autocomplete at the end of the snapshot with the cursor there", () => {
    const ok: EnhanceResponse = { ...base, type: "autocomplete", insert_at: 3, text: " more" };
    expect(responseIsValid(ok, "abc", 3)).toBe(true);
    expect(responseIsValid(ok, "abc", 1)).toBe(false);
    expect(responseIsValid({ ...ok, insert_at: 2 }, "abc", 3)).toBe(false);
  });

  it("requires ≥ 2 options with unique ids and valid edits", () => {
    const option = (id: string) => ({ id, label: id, edits: [{ start: 0, end: 0, text: id }] });
    const question = (options: ReturnType<typeof option>[]): EnhanceResponse => ({
      ...base,
      type: "multiple_choice",
      question: "Which?",
      options,
    });
    expect(responseIsValid(question([option("a"), option("b")]), "abc", 0)).toBe(true);
    expect(responseIsValid(question([option("a")]), "abc", 0)).toBe(false);
    expect(responseIsValid(question([option("a"), option("a")]), "abc", 0)).toBe(false);
    expect(optionsAreValid("abc", [option("a"), { id: "b", label: "b", edits: [] }])).toBe(false);
  });
});
