import type { Edit } from "@/lib/api/types";

import { sortEdits } from "./edits";

export type DiffSegment = { kind: "same" | "insert" | "delete" | "gap"; text: string };
export type DiffStats = { edits: number; added: number; removed: number };

export const DIFF_CONTEXT = 40;
const ELLIPSIS = "…";

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** First `n` UTF-16 units without splitting a surrogate pair. */
function head(text: string, n: number): string {
  const end = n > 0 && isHigh(text.charCodeAt(n - 1)) ? n - 1 : n;
  return text.slice(0, end);
}

/** Last `n` UTF-16 units without splitting a surrogate pair. */
function tail(text: string, n: number): string {
  const start = text.length - n;
  return text.slice(isLow(text.charCodeAt(start)) ? start + 1 : start);
}

/** Unchanged text kept around each edit; longer stretches collapse into a `gap` marker. */
function contextSegments(text: string, position: "lead" | "between" | "trail", context: number): DiffSegment[] {
  if (text === "") return [];
  if (position === "lead") {
    return text.length > context
      ? [
          { kind: "gap", text: ELLIPSIS },
          { kind: "same", text: tail(text, context) },
        ]
      : [{ kind: "same", text }];
  }
  if (position === "trail") {
    return text.length > context
      ? [
          { kind: "same", text: head(text, context) },
          { kind: "gap", text: ELLIPSIS },
        ]
      : [{ kind: "same", text }];
  }
  return text.length > context * 2
    ? [
        { kind: "same", text: head(text, context) },
        { kind: "gap", text: ELLIPSIS },
        { kind: "same", text: tail(text, context) },
      ]
    : [{ kind: "same", text }];
}

/** The resulting prompt region around the edits (±`context` units), as same / delete / insert segments. */
export function diffSegments(prompt: string, edits: readonly Edit[], context = DIFF_CONTEXT): DiffSegment[] {
  const sorted = sortEdits(edits);
  const segments: DiffSegment[] = [];
  let cursor = 0;
  sorted.forEach((edit, i) => {
    segments.push(...contextSegments(prompt.slice(cursor, edit.start), i === 0 ? "lead" : "between", context));
    if (edit.end > edit.start) segments.push({ kind: "delete", text: prompt.slice(edit.start, edit.end) });
    if (edit.text) segments.push({ kind: "insert", text: edit.text });
    cursor = edit.end;
  });
  segments.push(...contextSegments(prompt.slice(cursor), "trail", context));
  return segments;
}

export function diffStats(edits: readonly Edit[]): DiffStats {
  return {
    edits: edits.length,
    added: edits.reduce((sum, edit) => sum + edit.text.length, 0),
    removed: edits.reduce((sum, edit) => sum + edit.end - edit.start, 0),
  };
}

/** `2 edits · +46 −0` */
export function formatDiffStats({ edits, added, removed }: DiffStats): string {
  return `${edits} ${edits === 1 ? "edit" : "edits"} · +${added} −${removed}`;
}
