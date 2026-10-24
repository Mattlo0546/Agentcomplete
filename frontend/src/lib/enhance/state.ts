import type { EnhanceResponse, Option } from "@/lib/api/types";

import { applyEdits, responseIsValid } from "./edits";

// Revision / staleness state machine for the Refine editor (docs/brief.md §4).
// Every text change bumps `revision`; any text or selection change invalidates the visible suggestion;
// a response is accepted only when it answers the latest request for the current revision.

export type Snapshot = { requestId: string; revision: number; prompt: string; cursor: number };

export type Suggestion =
  | { type: "autocomplete"; requestId: string; revision: number; text: string; shownAt: number }
  | {
      type: "multiple_choice";
      requestId: string;
      revision: number;
      question: string;
      options: Option[];
      shownAt: number;
    };

export type EnhanceError = { status: number; message: string };

export type EnhanceState = {
  prompt: string;
  selectionStart: number;
  selectionEnd: number;
  revision: number;
  pending: Snapshot | null;
  suggestion: Suggestion | null;
  error: EnhanceError | null;
  /** Request id of the latest non-`none` response; drives the inspector trace. */
  traceId: string | null;
};

export type EnhanceAction =
  | { type: "hydrate"; prompt: string }
  | { type: "change"; prompt: string; selectionStart: number; selectionEnd: number }
  | { type: "select"; selectionStart: number; selectionEnd: number }
  | { type: "request"; snapshot: Snapshot }
  | { type: "response"; response: EnhanceResponse; now: number }
  | { type: "failure"; requestId: string; error: EnhanceError }
  | { type: "acceptGhost" }
  | { type: "dismiss" }
  | { type: "apply"; optionId: string };

export const initialEnhanceState: EnhanceState = {
  prompt: "",
  selectionStart: 0,
  selectionEnd: 0,
  revision: 0,
  pending: null,
  suggestion: null,
  error: null,
  traceId: null,
};

const invalidated = { pending: null, suggestion: null, error: null } as const;

export function enhanceReducer(state: EnhanceState, action: EnhanceAction): EnhanceState {
  switch (action.type) {
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
      return { ...state, ...invalidated, prompt, selectionStart, selectionEnd, revision: state.revision + 1 };
    }

    case "select":
      if (action.selectionStart === state.selectionStart && action.selectionEnd === state.selectionEnd) return state;
      return { ...state, ...invalidated, selectionStart: action.selectionStart, selectionEnd: action.selectionEnd };

    case "request":
      if (action.snapshot.revision !== state.revision || action.snapshot.prompt !== state.prompt) return state;
      return { ...state, pending: action.snapshot, error: null };

    case "response": {
      const { response, now } = action;
      const pending = state.pending;
      if (!isCurrent(state, response.request_id, response.prompt_revision)) return state;
      if (!pending || !responseIsValid(response, pending.prompt, pending.cursor)) {
        return { ...state, pending: null, error: { status: 0, message: "Invalid suggestion" } };
      }
      const base = { ...state, pending: null, error: null };
      if (response.type === "none") return { ...base, suggestion: null };
      const common = { requestId: response.request_id, revision: response.prompt_revision, shownAt: now };
      const suggestion: Suggestion =
        response.type === "autocomplete"
          ? { ...common, type: "autocomplete", text: response.text }
          : { ...common, type: "multiple_choice", question: response.question, options: response.options };
      return { ...base, suggestion, traceId: response.request_id };
    }

    case "failure":
      if (state.pending?.requestId !== action.requestId) return state;
      return { ...state, pending: null, error: action.error };

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
      return state.suggestion ? { ...state, suggestion: null } : state;

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
