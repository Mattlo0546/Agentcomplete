"use client";

import { readLocalStorageValue, useDebouncedCallback, useLocalStorage } from "@mantine/hooks";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, newRequestId } from "@/lib/api/client";
import type { OutcomeEvent } from "@/lib/api/types";
import { DEFAULT_TRIGGER_DELAY_MS } from "@/lib/settings/defaults";

import { postEnhance, postOutcome } from "./api";
import {
  canRequest,
  enhanceReducer,
  ghostText,
  initialEnhanceState,
  type EnhanceAction,
  type EnhanceState,
  type Suggestion,
} from "./state";

export const DRAFT_STORAGE_KEY = "pe.refine.draft";
export { DEFAULT_TRIGGER_DELAY_MS } from "@/lib/settings/defaults";
export const DRAFT_SAVE_DELAY_MS = 250;

type EnhanceOptions = { autocompleteEnabled?: boolean; questionsEnabled?: boolean };

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Drives the Refine editor: debounced, abortable /v1/enhance requests plus outcome events. */
export function useEnhance(
  delayMs: number = DEFAULT_TRIGGER_DELAY_MS,
  { autocompleteEnabled = true, questionsEnabled = true }: EnhanceOptions = {},
) {
  const [state, setState] = useState<EnhanceState>(initialEnhanceState);
  // The ref is the synchronous source of truth; handlers read it so they never see a stale render.
  const stateRef = useRef(state);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedAtRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const previousModesRef = useRef({ autocompleteEnabled, questionsEnabled });
  const previousRequestIdRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const [, setDraft] = useLocalStorage({ key: DRAFT_STORAGE_KEY, defaultValue: "" });

  const dispatch = useCallback((action: EnhanceAction) => {
    const next = enhanceReducer(stateRef.current, action);
    if (next === stateRef.current) return;
    if (next.prompt !== stateRef.current.prompt && next.prompt.trim() === "") previousRequestIdRef.current = null;
    stateRef.current = next;
    setState(next);
  }, []);

  const emit = useCallback(
    (event: OutcomeEvent, optionId?: string, suggestion: Suggestion | null = stateRef.current.suggestion) => {
      if (!suggestion) return;
      postOutcome({
        request_id: suggestion.requestId,
        prompt_revision: suggestion.sourceRevision,
        event,
        ...(optionId ? { option_id: optionId } : {}),
        time_to_action_ms: Math.max(0, Date.now() - suggestion.shownAt),
      });
    },
    [],
  );

  const canSend = useCallback(
    (current: EnhanceState) => {
      if (composingRef.current || !canRequest(current)) return false;
      return (
        questionsEnabled ||
        (autocompleteEnabled &&
          current.selectionStart === current.prompt.length &&
          current.selectionEnd === current.prompt.length)
      );
    },
    [autocompleteEnabled, questionsEnabled],
  );

  const send = useCallback(() => {
    const current = stateRef.current;
    if (!canSend(current)) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const snapshot = {
      requestId: newRequestId(),
      revision: current.revision,
      prompt: current.prompt,
      cursor: current.selectionEnd,
    };
    dispatch({ type: "request", snapshot });
    postEnhance(
      {
        request_id: snapshot.requestId,
        ...(previousRequestIdRef.current ? { previous_request_id: previousRequestIdRef.current } : {}),
        prompt: snapshot.prompt,
        prompt_revision: snapshot.revision,
        cursor: snapshot.cursor,
      },
      controller.signal,
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        if (
          (response.type === "autocomplete" && !autocompleteEnabled) ||
          (response.type === "multiple_choice" && !questionsEnabled)
        ) {
          dispatch({ type: "cancel" });
          return;
        }
        const before = stateRef.current;
        dispatch({ type: "response", response, now: Date.now() });
        const after = stateRef.current;
        // A valid `none` response also carries reusable server context. Rejected responses never advance it.
        if (after !== before && after.pending === null && after.error === null) {
          previousRequestIdRef.current = response.request_id;
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        const apiError = error instanceof ApiError ? error : null;
        dispatch({
          type: "failure",
          requestId: snapshot.requestId,
          error: { status: apiError?.status ?? 0, message: apiError?.message ?? "Request failed" },
        });
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
      });
  }, [autocompleteEnabled, questionsEnabled, canSend, dispatch]);

  const runScheduled = useCallback(() => {
    timerRef.current = null;
    queuedAtRef.current = null;
    send();
  }, [send]);

  const schedule = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    queuedAtRef.current = Date.now();
    timerRef.current = setTimeout(runScheduled, delayMs);
  }, [delayMs, runScheduled]);

  /** Cancels whatever is in flight or queued before the state moves on. */
  const interrupt = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    queuedAtRef.current = null;
  }, []);

  // Settings can arrive after typing begins. Preserve the pending request and elapsed quiet time.
  useEffect(() => {
    const previous = previousModesRef.current;
    const modesChanged =
      previous.autocompleteEnabled !== autocompleteEnabled || previous.questionsEnabled !== questionsEnabled;
    previousModesRef.current = { autocompleteEnabled, questionsEnabled };
    const current = stateRef.current;
    const disabledSuggestion =
      current.suggestion?.type === "autocomplete"
        ? !autocompleteEnabled
        : current.suggestion?.type === "multiple_choice" && !questionsEnabled;
    if (modesChanged && (current.pending || disabledSuggestion)) {
      emit("superseded");
      interrupt();
      dispatch({ type: "cancel" });
      if (canSend(stateRef.current)) schedule();
      return;
    }
    if (!canSend(stateRef.current)) {
      emit("superseded");
      interrupt();
      dispatch({ type: "cancel" });
      return;
    }
    if (queuedAtRef.current !== null) {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(runScheduled, Math.max(0, delayMs - (Date.now() - queuedAtRef.current)));
    }
  }, [autocompleteEnabled, questionsEnabled, canSend, delayMs, dispatch, emit, interrupt, runScheduled, schedule]);

  const change = useCallback(
    (prompt: string, selectionStart: number, selectionEnd: number) => {
      const before = stateRef.current;
      if (
        prompt === before.prompt &&
        selectionStart === before.selectionStart &&
        selectionEnd === before.selectionEnd
      ) {
        return;
      }
      interrupt();
      dispatch({ type: "change", prompt, selectionStart, selectionEnd });
      const after = stateRef.current;
      if (before.suggestion && after.suggestion?.requestId !== before.suggestion.requestId) {
        const typedWholeGhost =
          ghostText(before) !== "" &&
          prompt === before.prompt + ghostText(before) &&
          selectionStart === prompt.length &&
          selectionEnd === prompt.length;
        emit(typedWholeGhost ? "accepted" : "superseded", undefined, before.suggestion);
      }
      // An exact prefix of the visible ghost is already computed: show its remainder immediately.
      if (!after.suggestion && canSend(after)) schedule();
    },
    [canSend, dispatch, emit, interrupt, schedule],
  );

  const select = useCallback(
    (selectionStart: number, selectionEnd: number) => change(stateRef.current.prompt, selectionStart, selectionEnd),
    [change],
  );

  const acceptGhost = useCallback(() => {
    emit("accepted");
    interrupt();
    dispatch({ type: "acceptGhost" });
  }, [dispatch, emit, interrupt]);

  const dismissGhost = useCallback(() => {
    emit("dismissed");
    dispatch({ type: "dismiss" });
  }, [dispatch, emit]);

  const declineQuestion = useCallback(() => {
    emit("declined");
    dispatch({ type: "dismiss" });
  }, [dispatch, emit]);

  const applyOption = useCallback(
    (optionId: string) => {
      emit("accepted", optionId);
      interrupt();
      dispatch({ type: "apply", optionId });
    },
    [dispatch, emit, interrupt],
  );

  const retry = useCallback(() => {
    interrupt();
    send();
  }, [interrupt, send]);

  const restore = useCallback(
    (prompt: string) => {
      if (stateRef.current.suggestion) emit("superseded");
      interrupt();
      // A restored history entry is unrelated to the previous draft's server context.
      previousRequestIdRef.current = null;
      dispatch({ type: "restore", prompt });
      if (canSend(stateRef.current)) schedule();
    },
    [canSend, dispatch, emit, interrupt, schedule],
  );

  const setComposing = useCallback(
    (composing: boolean) => {
      composingRef.current = composing;
      interrupt();
      if (composing) {
        emit("superseded");
        dispatch({ type: "cancel" });
      } else if (canSend(stateRef.current)) {
        schedule();
      }
    },
    [canSend, dispatch, emit, interrupt, schedule],
  );

  // "shown" fires once per displayed suggestion.
  const shownId = state.suggestion?.requestId;
  useEffect(() => {
    if (shownId) {
      const { suggestion } = stateRef.current;
      if (suggestion)
        postOutcome({ request_id: suggestion.requestId, prompt_revision: suggestion.sourceRevision, event: "shown" });
    }
  }, [shownId]);

  const saveDraft = useDebouncedCallback(setDraft, {
    delay: DRAFT_SAVE_DELAY_MS,
    maxWait: 1000,
    flushOnUnmount: true,
  });

  // Keep synchronous localStorage work off every keystroke, without losing the last edit on navigation.
  useEffect(() => {
    const flush = () => saveDraft.flush();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [saveDraft]);

  // The writer is declared before the loader so the first commit cannot overwrite the stored draft.
  useEffect(() => {
    if (hydratedRef.current) saveDraft(state.prompt);
  }, [state.prompt, saveDraft]);
  useEffect(() => {
    hydratedRef.current = true;
    dispatch({ type: "hydrate", prompt: readLocalStorageValue({ key: DRAFT_STORAGE_KEY, defaultValue: "" }) });
  }, [dispatch]);

  useEffect(() => interrupt, [interrupt]);

  return {
    state,
    change,
    select,
    acceptGhost,
    dismissGhost,
    declineQuestion,
    applyOption,
    retry,
    restore,
    setComposing,
  };
}

export type EnhanceController = ReturnType<typeof useEnhance>;
