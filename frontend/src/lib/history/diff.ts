import type { DiffSegment } from "@/lib/enhance/diff";

// Bound quadratic work for long, unrelated prompts. A replacement of the middle
// remains an exact diff when a word-level LCS would exceed this memory budget.
const MAX_CELLS = 250_000;
const tokens = (text: string) => text.match(/\s+|[^\s]+/gu) ?? [];

export function versionDiff(before: string, after: string): DiffSegment[] {
  const a = tokens(before);
  const b = tokens(after);
  const result: DiffSegment[] = [];
  const push = (kind: DiffSegment["kind"], text: string) => {
    if (!text) return;
    const last = result.at(-1);
    if (last?.kind === kind) last.text += text;
    else result.push({ kind, text });
  };
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }
  push("same", a.slice(0, start).join(""));
  const n = aEnd - start;
  const m = bEnd - start;
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    push("delete", a.slice(start, aEnd).join(""));
    push("insert", b.slice(start, bEnd).join(""));
  } else {
    const width = m + 1;
    const table = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] =
          a[start + i] === b[start + j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        push("same", a[start + i++]);
        j++;
      } else if (j < m && (i === n || table[i * width + j + 1] > table[(i + 1) * width + j])) {
        push("insert", b[start + j++]);
      } else {
        push("delete", a[start + i++]);
      }
    }
  }
  push("same", a.slice(aEnd).join(""));
  return result;
}
