import type { EnhanceResponse, Option } from "@/lib/api/types";

import { applyEdits, responseIsValid } from "./edits";

// Revision / staleness state machine for the Refine editor (docs/brief.md §4).
// Every text change bumps `revision`; edits invalidate suggestions except typing an exact ghost prefix.
// Exact responses retain strict revision checks. A separate action can salvage a validated in-flight suffix.

export type Snapshot = { requestId: string; revision: number; prompt: string; cursor: number };

type SuggestionSource = {
  requestId: string;
  revision: number;
  /** Original request revision, retained when the user types through a ghost suffix. */
  sourceRevision: number;
  shownAt: number;
};

export type Suggestion = SuggestionSource &
  (
    | { type: "autocomplete"; text: string }
    | {
        type: "multiple_choice";
        question: string;
        options: Option[];
      }
  );

export type EnhanceError = { status: number; message: string };

export type EnhanceState = {
  prompt: string;
  selectionStart: number;
  selectionEnd: number;
  revision: number;
  pending: Snapshot | null;
  /** At most one in-flight request retained through uninterrupted end-of-prompt typing. */
  retained: Snapshot | null;
  suggestion: Suggestion | null;
  error: EnhanceError | null;
  /** Latest validated response for the current input, including `none`; drives context displays. */
  traceId: string | null;
};

export type EnhanceAction =
  | { type: "hydrate"; prompt: string }
  | { type: "restore"; prompt: string }
  | { type: "change"; prompt: string; selectionStart: number; selectionEnd: number; retainInFlight?: boolean }
  | { type: "select"; selectionStart: number; selectionEnd: number }
  | { type: "request"; snapshot: Snapshot }
  | { type: "response"; response: EnhanceResponse; now: number }
  | { type: "retainedResponse"; requestId: string; response: EnhanceResponse; now: number }
  | { type: "discardRetained" }
  | { type: "failure"; requestId: string; error: EnhanceError }
  | { type: "cancel" }
  | { type: "acceptGhost" }
  | { type: "dismiss" }
  | { type: "apply"; optionId: string };

export const initialEnhanceState: EnhanceState = {
  prompt: "",
  selectionStart: 0,
  selectionEnd: 0,
  revision: 0,
  pending: null,
  retained: null,
  suggestion: null,
  error: null,
  traceId: null,
};

const invalidated = { pending: null, retained: null, suggestion: null, error: null, traceId: null } as const;

export function enhanceReducer(state: EnhanceState, action: EnhanceAction): EnhanceState {
  switch (action.type) {
    case "restore":
      return {
        ...state,
        ...invalidated,
        prompt: action.prompt,
        selectionStart: action.prompt.length,
        selectionEnd: action.prompt.length,
        revision: state.revision + 1,
        traceId: null,
      };
    case "hydrate":
      if (state.prompt !== "" || action.prompt === "") return state;
      return {
        ...state,
        prompt: action.prompt,
        selectionStart: action.prompt.length,
        selectionEnd: action.prompt.length,
      };

    case "change": {
      const { prompt, selectionStart, selectionEnd } = action;
      if (prompt === state.prompt) return enhanceReducer(state, { type: "select", selectionStart, selectionEnd });
      const revision = state.revision + 1;
      const suffix = ghostText(state);
      const added = prompt.startsWith(state.prompt) ? prompt.slice(state.prompt.length) : "";
      const consumesGhost =
        added !== "" && suffix.startsWith(added) && selectionStart === prompt.length && selectionEnd === prompt.length;
      const suggestion =
        consumesGhost && state.suggestion?.type === "autocomplete" && added.length < suffix.length
          ? { ...state.suggestion, revision, text: suffix.slice(added.length) }
          : null;
      const endAppend =
        action.retainInFlight &&
        added !== "" &&
        state.selectionStart === state.prompt.length &&
        state.selectionEnd === state.prompt.length &&
        selectionStart === prompt.length &&
        selectionEnd === prompt.length;
      const candidate = state.pending ?? state.retained;
      const retained =
        endAppend && !suggestion && candidate && candidate.cursor === candidate.prompt.length ? candidate : null;
      return { ...state, ...invalidated, prompt, selectionStart, selectionEnd, revision, suggestion, retained };
    }

    case "select":
      if (action.selectionStart === state.selectionStart && action.selectionEnd === state.selectionEnd) return state;
      return { ...state, ...invalidated, selectionStart: action.selectionStart, selectionEnd: action.selectionEnd };

    case "request":
      if (action.snapshot.revision !== state.revision || action.snapshot.prompt !== state.prompt) return state;
      return { ...state, pending: action.snapshot, error: null, traceId: null };

    case "response": {
      const { response, now } = action;
      const pending = state.pending;
      if (!isCurrent(state, response.request_id, response.prompt_revision)) return state;
      if (!pending || !responseIsValid(response, pending.prompt, pending.cursor)) {
        return { ...state, pending: null, retained: null, error: { status: 0, message: "Invalid suggestion" } };
      }
      const base = { ...state, pending: null, retained: null, error: null, traceId: response.request_id };
      if (response.type === "none") return { ...base, suggestion: null };
      const common = {
        requestId: response.request_id,
        revision: response.prompt_revision,
        sourceRevision: response.prompt_revision,
        shownAt: now,
      };
      const suggestion: Suggestion =
        response.type === "autocomplete"
          ? { ...common, type: "autocomplete", text: response.text }
          : { ...common, type: "multiple_choice", question: response.question, options: response.options };
      return { ...base, suggestion };
    }

    case "retainedResponse": {
      const source = state.retained;
      if (!source || source.requestId !== action.requestId) return state;
      const { response, now } = action;
      const base = { ...state, retained: null };
      if (
        response.type !== "autocomplete" ||
        response.request_id !== source.requestId ||
        response.prompt_revision !== source.revision ||
        !responseIsValid(response, source.prompt, source.cursor) ||
        state.suggestion ||
        !state.prompt.startsWith(source.prompt) ||
        state.selectionStart !== state.prompt.length ||
        state.selectionEnd !== state.prompt.length
      ) {
        return base;
      }
      const consumed = state.prompt.slice(source.prompt.length);
      const remainder = response.text.slice(consumed.length);
      // Exact document equality, including UTF-16 units. Never split a surrogate pair or normalize text.
      if (
        !consumed ||
        !response.text.startsWith(consumed) ||
        !remainder ||
        !wholeCodePoints(consumed) ||
        !wholeCodePoints(remainder)
      ) {
        return base;
      }
      return {
        ...base,
        error: null,
        traceId: source.requestId,
        suggestion: {
          type: "autocomplete",
          requestId: source.requestId,
          revision: state.revision,
          sourceRevision: source.revision,
          text: remainder,
          shownAt: now,
        },
      };
    }

    case "discardRetained":
      return state.retained ? { ...state, retained: null } : state;

    case "failure":
      if (state.retained?.requestId === action.requestId) return { ...state, retained: null };
      if (state.pending?.requestId !== action.requestId) return state;
      return { ...state, pending: null, retained: null, error: action.error };

    case "cancel":
      return state.pending || state.retained || state.suggestion || state.error || state.traceId
        ? { ...state, ...invalidated }
        : state;

    case "acceptGhost": {
      if (!ghostText(state)) return state;
      const prompt = state.prompt + ghostText(state);
      return {
        ...state,
        ...invalidated,
        prompt,
        selectionStart: prompt.length,
        selectionEnd: prompt.length,
        revision: state.revision + 1,
      };
    }

    case "dismiss":
      return state.suggestion || state.pending || state.retained
        ? { ...state, suggestion: null, pending: null, retained: null }
        : state;

    case "apply": {
      const option = activeQuestion(state)?.options.find((candidate) => candidate.id === action.optionId);
      if (!option) return state;
      const { text, cursor } = applyEdits(state.prompt, option.edits);
      return {
        ...state,
        ...invalidated,
        prompt: text,
        selectionStart: cursor,
        selectionEnd: cursor,
        revision: state.revision + 1,
      };
    }
  }
}

function wholeCodePoints(text: string): boolean {
  return [...text].every((point) => point.length === 2 || point.charCodeAt(0) < 0xd800 || point.charCodeAt(0) > 0xdfff);
}

function isCurrent(state: EnhanceState, requestId: string, revision: number): boolean {
  return state.pending?.requestId === requestId && state.pending.revision === revision && revision === state.revision;
}

/** Ghost suffix to render, or "" — only for the current revision with a collapsed cursor at the end. */
export function ghostText(state: EnhanceState): string {
  const { suggestion, prompt, selectionStart, selectionEnd, revision } = state;
  if (suggestion?.type !== "autocomplete" || suggestion.revision !== revision) return "";
  return selectionStart === prompt.length && selectionEnd === prompt.length ? suggestion.text : "";
}

export function activeQuestion(state: EnhanceState) {
  const { suggestion } = state;
  return suggestion?.type === "multiple_choice" && suggestion.revision === state.revision ? suggestion : null;
}

export function canRequest(state: EnhanceState): boolean {
  return state.prompt.trim() !== "";
}
