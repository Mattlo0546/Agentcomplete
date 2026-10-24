// Small, safe markdown subset for skill bodies: headings, lists, fenced code, paragraphs,
// inline code and bold. Produces plain data; rendering is done with React elements (no raw HTML).

export type Inline = { type: "text" | "code" | "strong"; text: string };
export type MdBlock =
  | { type: "heading"; level: number; inline: Inline[] }
  | { type: "list"; ordered: boolean; items: { depth: number; inline: Inline[] }[] }
  | { type: "code"; text: string }
  | { type: "paragraph"; inline: Inline[] };

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push({ type: "text", text: text.slice(last, match.index) });
    out.push(match[1] !== undefined ? { type: "code", text: match[1] } : { type: "strong", text: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", inline: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      flushParagraph();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith("```"); i++) code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1].length, inline: parseInline(heading[2]) });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      const ordered = /\d/.test(item[2]);
      const entry = {
        depth: Math.min(Math.floor(item[1].replace(/\t/g, "  ").length / 2), 4),
        inline: parseInline(item[3]),
      };
      const prev = blocks[blocks.length - 1];
      if (prev?.type === "list" && prev.ordered === ordered) prev.items.push(entry);
      else blocks.push({ type: "list", ordered, items: [entry] });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}
