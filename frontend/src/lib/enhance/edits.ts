import type { Edit, EnhanceResponse, Option } from "@/lib/api/types";

// All positions are UTF-16 code units (JS string indices); ranges are half-open [start, end).

/** True when every edit is in bounds, changes something, and no two edits overlap. */
export function editsAreValid(prompt: string, edits: readonly Edit[]): boolean {
  if (edits.length === 0) return false;
  const sorted = sortEdits(edits);
  return sorted.every((edit, i) => {
    const { start, end, text } = edit;
    if (!Number.isInteger(start) || !Number.isInteger(end) || typeof text !== "string") return false;
    if (start < 0 || end < start || end > prompt.length) return false;
    if (prompt.slice(start, end) === text) return false;
    if (i === 0) return true;
    const previous = sorted[i - 1];
    if (start < previous.end) return false;
    // Two insertions at the same point have no defined order.
    return !(start === end && previous.start === previous.end && previous.start === start);
  });
}

export function sortEdits(edits: readonly Edit[]): Edit[] {
  return [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Applies all edits atomically, from end to start, so earlier positions stay valid.
 * Returns the new text and the cursor position just after the last applied edit (in document order).
 */
export function applyEdits(prompt: string, edits: readonly Edit[]): { text: string; cursor: number } {
  if (!editsAreValid(prompt, edits)) throw new Error("Invalid edits");
  const sorted = sortEdits(edits);
  let text = prompt;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const { start, end, text: insert } = sorted[i];
    text = text.slice(0, start) + insert + text.slice(end);
  }
  const last = sorted[sorted.length - 1];
  const shift = sorted.slice(0, -1).reduce((sum, edit) => sum + edit.text.length - (edit.end - edit.start), 0);
  return { text, cursor: last.start + shift + last.text.length };
}

export function optionsAreValid(prompt: string, options: readonly Option[]): boolean {
  if (options.length < 2) return false;
  if (new Set(options.map((option) => option.id)).size !== options.length) return false;
  return options.every((option) => editsAreValid(prompt, option.edits));
}

/** Client-side re-check of the response invariants against the snapshot the request was made from. */
export function responseIsValid(response: EnhanceResponse, prompt: string, cursor: number): boolean {
  if (response.schema_version !== 1) return false;
  switch (response.type) {
    case "autocomplete":
      return response.insert_at === prompt.length && cursor === prompt.length && response.text.length > 0;
    case "multiple_choice":
      return response.question.trim().length > 0 && optionsAreValid(prompt, response.options);
    case "none":
      return true;
    default:
      return false;
  }
}
