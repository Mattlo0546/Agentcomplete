import { describe, expect, it } from "vitest";

import { versionDiff } from "../diff";

describe("version comparisons", () => {
  it.each([
    ["", ""],
    ["", "Add tests"],
    ["Delete this", ""],
    ["Use Python and test the cache", "Use Rust and test the API"],
    ["Keep 👩🏽‍💻\n\tand tests", "Keep 👩🏽‍💻\n\tand benchmarks"],
    ["same ".repeat(3000) + "before", "same ".repeat(3000) + "after"],
    ["old ".repeat(5000), "new ".repeat(5000)],
  ])("reconstructs both versions exactly, including bounded large diffs", (before, after) => {
    const segments = versionDiff(before, after);
    expect(
      segments
        .filter((part) => part.kind !== "insert")
        .map((part) => part.text)
        .join(""),
    ).toBe(before);
    expect(
      segments
        .filter((part) => part.kind !== "delete")
        .map((part) => part.text)
        .join(""),
    ).toBe(after);
  });

  it("preserves unchanged words between multiple edits", () => {
    const segments = versionDiff("Use Python and test the cache", "Use Rust and test the API");
    expect(segments).toContainEqual({ kind: "same", text: " and test the " });
    expect(segments).toContainEqual({ kind: "delete", text: "Python" });
    expect(segments).toContainEqual({ kind: "insert", text: "Rust" });
  });
});
