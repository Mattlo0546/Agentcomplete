"use client";

import { readLocalStorageValue, useDebouncedCallback, useLocalStorage } from "@mantine/hooks";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ApiError, getApiBase, newRequestId } from "@/lib/api/client";
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
export const MAX_SALVAGE_AGE_MS = 3000;

type EnhanceOptions = {
  autocompleteEnabled?: boolean;
  questionsEnabled?: boolean;
  configurationKey?: string;
  /** Wait for fetched settings (or their fallback) before automatically requesting a restored draft. */
  settingsReady?: boolean;
};

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Drives the Refine editor: debounced, abortable /v1/enhance requests plus outcome events. */
export function useEnhance(
  delayMs: number = DEFAULT_TRIGGER_DELAY_MS,
  { autocompleteEnabled = true, questionsEnabled = true, configurationKey, settingsReady = true }: EnhanceOptions = {},
) {
  const [state, setState] = useState<EnhanceState>(initialEnhanceState);
  // The ref is the synchronous source of truth; handlers read it so they never see a stale render.
  const stateRef = useRef(state);
  const controllersRef = useRef(new Map<string, AbortController>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedAtRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const previousModesRef = useRef({ autocompleteEnabled, questionsEnabled, configurationKey });
  const previousRequestIdRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const restoredRequestRef = useRef(false);
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

  const pruneRequests = useCallback(() => {
    const { pending, retained } = stateRef.current;
    for (const [id, controller] of controllersRef.current) {
      if (id !== pending?.requestId && id !== retained?.requestId) {
        controller.abort();
        controllersRef.current.delete(id);
      }
    }
  }, []);

  const clearSchedule = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    queuedAtRef.current = null;
  }, []);

  const send = useCallback(() => {
    const current = stateRef.current;
    if (!canSend(current)) return;
    restoredRequestRef.current = false;
    const controller = new AbortController();
    const startedAt = Date.now();
    const apiBase = getApiBase();
    const snapshot = {
      requestId: newRequestId(),
      revision: current.revision,
      prompt: current.prompt,
      cursor: current.selectionEnd,
    };
    dispatch({ type: "request", snapshot });
    controllersRef.current.set(snapshot.requestId, controller);
    pruneRequests();
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
        if (getApiBase() !== apiBase) {
          dispatch({ type: "cancel" });
          pruneRequests();
          return;
        }
        if (
          (response.type === "autocomplete" && !autocompleteEnabled) ||
          (response.type === "multiple_choice" && !questionsEnabled)
        ) {
          dispatch({ type: "cancel" });
          pruneRequests();
          return;
        }
        const before = stateRef.current;
        if (before.retained?.requestId === snapshot.requestId) {
          dispatch(
            Date.now() - startedAt <= MAX_SALVAGE_AGE_MS
              ? { type: "retainedResponse", requestId: snapshot.requestId, response, now: Date.now() }
              : { type: "discardRetained" },
          );
          // An adopted suffix can avoid a not-yet-started request; an exact request already in flight still wins.
          if (stateRef.current.suggestion?.requestId === snapshot.requestId) clearSchedule();
          pruneRequests();
          return;
        }
        dispatch({ type: "response", response, now: Date.now() });
        const after = stateRef.current;
        if (before.suggestion && after.suggestion?.requestId !== before.suggestion.requestId) {
          emit("superseded", undefined, before.suggestion);
        }
        // A valid `none` response also carries reusable server context. Rejected responses never advance it.
        if (after !== before && after.pending === null && after.error === null) {
          previousRequestIdRef.current = response.request_id;
        }
        pruneRequests();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        const apiError = error instanceof ApiError ? error : null;
        dispatch({
          type: "failure",
          requestId: snapshot.requestId,
          error: { status: apiError?.status ?? 0, message: apiError?.message ?? "Request failed" },
        });
        pruneRequests();
      })
      .finally(() => {
        controllersRef.current.delete(snapshot.requestId);
      });
  }, [autocompleteEnabled, questionsEnabled, canSend, clearSchedule, dispatch, emit, pruneRequests]);

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
    for (const controller of controllersRef.current.values()) controller.abort();
    controllersRef.current.clear();
    clearSchedule();
  }, [clearSchedule]);

  // Settings can arrive after typing begins. Preserve the pending request and elapsed quiet time.
  useLayoutEffect(() => {
    const previous = previousModesRef.current;
    const modesChanged =
      previous.autocompleteEnabled !== autocompleteEnabled ||
      previous.questionsEnabled !== questionsEnabled ||
      previous.configurationKey !== configurationKey;
    previousModesRef.current = { autocompleteEnabled, questionsEnabled, configurationKey };
    const current = stateRef.current;
    const disabledSuggestion =
      current.suggestion?.type === "autocomplete"
        ? !autocompleteEnabled
        : current.suggestion?.type === "multiple_choice" && !questionsEnabled;
    if (modesChanged && (current.pending || current.retained || current.suggestion || disabledSuggestion)) {
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
  }, [
    autocompleteEnabled,
    questionsEnabled,
    configurationKey,
    canSend,
    delayMs,
    dispatch,
    emit,
    interrupt,
    runScheduled,
    schedule,
  ]);

  const change = useCallback(
    (prompt: string, selectionStart: number, selectionEnd: number, inputType?: string) => {
      const before = stateRef.current;
      if (
        prompt === before.prompt &&
        selectionStart === before.selectionStart &&
        selectionEnd === before.selectionEnd
      ) {
        return;
      }
      restoredRequestRef.current = false;
      clearSchedule();
      dispatch({
        type: "change",
        prompt,
        selectionStart,
        selectionEnd,
        retainInFlight: autocompleteEnabled && !composingRef.current && inputType === "insertText",
      });
      pruneRequests();
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
    [autocompleteEnabled, canSend, clearSchedule, dispatch, emit, pruneRequests, schedule],
  );

  const select = useCallback(
    (selectionStart: number, selectionEnd: number) => change(stateRef.current.prompt, selectionStart, selectionEnd),
    [change],
  );

  const acceptGhost = useCallback(() => {
    restoredRequestRef.current = false;
    emit("accepted");
    interrupt();
    dispatch({ type: "acceptGhost" });
  }, [dispatch, emit, interrupt]);

  const dismissGhost = useCallback(() => {
    restoredRequestRef.current = false;
    emit("dismissed");
    interrupt();
    dispatch({ type: "dismiss" });
  }, [dispatch, emit, interrupt]);

  const declineQuestion = useCallback(() => {
    restoredRequestRef.current = false;
    emit("declined");
    interrupt();
    dispatch({ type: "dismiss" });
  }, [dispatch, emit, interrupt]);

  const applyOption = useCallback(
    (optionId: string) => {
      restoredRequestRef.current = false;
      emit("accepted", optionId);
      interrupt();
      dispatch({ type: "apply", optionId });
    },
    [dispatch, emit, interrupt],
  );

  const retry = useCallback(() => {
    interrupt();
    dispatch({ type: "cancel" });
    send();
  }, [dispatch, interrupt, send]);

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
    // Strict Mode may replay this effect with the initial render after hydration updated the ref.
    if (hydratedRef.current && state.prompt === stateRef.current.prompt) saveDraft(state.prompt);
  }, [state.prompt, saveDraft]);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    dispatch({ type: "hydrate", prompt: readLocalStorageValue({ key: DRAFT_STORAGE_KEY, defaultValue: "" }) });
    restoredRequestRef.current = canRequest(stateRef.current);
  }, [dispatch]);

  useEffect(() => {
    if (restoredRequestRef.current && settingsReady && canSend(stateRef.current)) schedule();
    // Keep eligibility until send(): Strict Mode cleanup cancels the timer, then setup schedules it again.
  }, [canSend, schedule, settingsReady]);

  useEffect(() => interrupt, [interrupt]);

  return { state, change, select, acceptGhost, dismissGhost, declineQuestion, applyOption, retry, setComposing };
}

export type EnhanceController = ReturnType<typeof useEnhance>;
