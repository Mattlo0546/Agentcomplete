import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdown } from "../markdown";

describe("parseInline", () => {
  it("splits code and bold spans", () => {
    expect(parseInline("use `tenacity` and **cap** waits")).toEqual([
      { type: "text", text: "use " },
      { type: "code", text: "tenacity" },
      { type: "text", text: " and " },
      { type: "strong", text: "cap" },
      { type: "text", text: " waits" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("parses headings, lists, paragraphs and fenced code", () => {
    const blocks = parseMarkdown(
      "# Title\n\nIntro line\nsecond line\n\n## Rules\n- one\n  - nested\n- two\n\n1. first\n2. second\n\n```py\n@retry(x)\n```",
    );
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "heading", "list", "list", "code"]);
    expect(blocks[0]).toMatchObject({ level: 1 });
    expect(blocks[3]).toMatchObject({ ordered: false });
    expect((blocks[3] as { items: { depth: number }[] }).items.map((i) => i.depth)).toEqual([0, 1, 0]);
    expect(blocks[4]).toMatchObject({ ordered: true });
    expect(blocks[5]).toEqual({ type: "code", text: "@retry(x)" });
  });

  it("keeps html as inert text", () => {
    const [block] = parseMarkdown("<img src=x onerror=alert(1)>");
    expect(block).toEqual({ type: "paragraph", inline: [{ type: "text", text: "<img src=x onerror=alert(1)>" }] });
  });
});
