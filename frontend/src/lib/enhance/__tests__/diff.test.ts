import { describe, expect, it } from "vitest";

import { diffSegments, diffStats, formatDiffStats } from "../diff";

describe("diffSegments", () => {
  it("renders deletions before insertions with surrounding text", () => {
    const prompt = "Write a migration plan for moving.";
    expect(diffSegments(prompt, [{ start: 6, end: 22, text: "a runbook" }])).toEqual([
      { kind: "same", text: "Write " },
      { kind: "delete", text: "a migration plan" },
      { kind: "insert", text: "a runbook" },
      { kind: "same", text: " for moving." },
    ]);
  });

  it("limits context to ±40 units and collapses long gaps between edits", () => {
    const prompt = "x".repeat(100) + "TARGET" + "y".repeat(100) + "OTHER" + "z".repeat(100);
    const segments = diffSegments(prompt, [
      { start: 206, end: 211, text: "o" },
      { start: 100, end: 106, text: "t" },
    ]);
    expect(segments.map((s) => s.kind)).toEqual([
      "gap",
      "same",
      "delete",
      "insert",
      "same",
      "gap",
      "same",
      "delete",
      "insert",
      "same",
      "gap",
    ]);
    expect(segments[1].text).toBe("x".repeat(40));
    expect(segments[4].text).toBe("y".repeat(40));
    expect(segments[9].text).toBe("z".repeat(40));
  });

  it("keeps short stretches between edits intact", () => {
    const segments = diffSegments("abc def", [
      { start: 0, end: 3, text: "A" },
      { start: 4, end: 7, text: "D" },
    ]);
    expect(segments).toEqual([
      { kind: "delete", text: "abc" },
      { kind: "insert", text: "A" },
      { kind: "same", text: " " },
      { kind: "delete", text: "def" },
      { kind: "insert", text: "D" },
    ]);
  });

  it("never splits a surrogate pair at the context boundary", () => {
    // 39 units of "a" then an emoji (2 units): the 40-unit tail would start inside the emoji.
    const lead = "🚀" + "a".repeat(39);
    const segments = diffSegments(lead + "!", [{ start: lead.length, end: lead.length + 1, text: "?" }], 40);
    const kept = segments.find((s) => s.kind === "same")!.text;
    expect(kept).toBe("a".repeat(39));
    expect(/[\ud800-\udfff]/.test(kept)).toBe(false);
  });
});

describe("diffStats", () => {
  it("counts edits, added and removed units", () => {
    const stats = diffStats([
      { start: 6, end: 22, text: "a step-by-step runbook" },
      { start: 30, end: 30, text: "1234" },
    ]);
    expect(stats).toEqual({ edits: 2, added: 26, removed: 16 });
    expect(formatDiffStats(stats)).toBe("2 edits · +26 −16");
    expect(formatDiffStats({ edits: 1, added: 0, removed: 3 })).toBe("1 edit · +0 −3");
  });
});
