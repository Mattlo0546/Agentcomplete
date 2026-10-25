"use client";

import { readLocalStorageValue, useDebouncedCallback, useLocalStorage } from "@mantine/hooks";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, newRequestId } from "@/lib/api/client";
import type { OutcomeEvent } from "@/lib/api/types";

import { postEnhance, postOutcome } from "./api";
import { canRequest, enhanceReducer, initialEnhanceState, type EnhanceAction, type EnhanceState } from "./state";

export const DRAFT_STORAGE_KEY = "pe.refine.draft";
export const DEFAULT_TRIGGER_DELAY_MS = 400;

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Drives the Refine editor: debounced, abortable /v1/enhance requests plus outcome events. */
export function useEnhance(delayMs: number = DEFAULT_TRIGGER_DELAY_MS) {
  const [state, setState] = useState<EnhanceState>(initialEnhanceState);
  // The ref is the synchronous source of truth; handlers read it so they never see a stale render.
  const stateRef = useRef(state);
  const abortRef = useRef<AbortController | null>(null);
  const hydratedRef = useRef(false);
  const queuedRef = useRef(false);
  const [, setDraft] = useLocalStorage({ key: DRAFT_STORAGE_KEY, defaultValue: "" });

  const dispatch = useCallback((action: EnhanceAction) => {
    const next = enhanceReducer(stateRef.current, action);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const emit = useCallback((event: OutcomeEvent, optionId?: string) => {
    const suggestion = stateRef.current.suggestion;
    if (!suggestion) return;
    postOutcome({
      request_id: suggestion.requestId,
      prompt_revision: suggestion.revision,
      event,
      ...(optionId ? { option_id: optionId } : {}),
      time_to_action_ms: Math.max(0, Date.now() - suggestion.shownAt),
    });
  }, []);

  const send = useCallback(() => {
    queuedRef.current = false;
    const current = stateRef.current;
    if (!canRequest(current)) return;
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
        prompt: snapshot.prompt,
        prompt_revision: snapshot.revision,
        cursor: snapshot.cursor,
      },
      controller.signal,
    )
      .then((response) => dispatch({ type: "response", response, now: Date.now() }))
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        const apiError = error instanceof ApiError ? error : null;
        dispatch({
          type: "failure",
          requestId: snapshot.requestId,
          error: { status: apiError?.status ?? 0, message: apiError?.message ?? "Request failed" },
        });
      });
  }, [dispatch]);

  const schedule = useDebouncedCallback(send, delayMs);

  // Changing the delay cancels Mantine's old timer. Preserve any draft request
  // queued before the initial settings response arrived.
  useEffect(() => {
    if (queuedRef.current) schedule();
  }, [schedule]);

  /** Cancels whatever is in flight or queued before the state moves on. */
  const interrupt = useCallback(() => {
    queuedRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    schedule.cancel();
  }, [schedule]);

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
      if (before.suggestion) emit("superseded");
      interrupt();
      dispatch({ type: "change", prompt, selectionStart, selectionEnd });
      if (canRequest(stateRef.current)) {
        queuedRef.current = true;
        schedule();
      }
    },
    [dispatch, emit, interrupt, schedule],
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
      dispatch({ type: "restore", prompt });
      if (canRequest(stateRef.current)) {
        queuedRef.current = true;
        schedule();
      }
    },
    [dispatch, emit, interrupt, schedule],
  );

  // "shown" fires once per displayed suggestion.
  const shownId = state.suggestion?.requestId;
  useEffect(() => {
    if (shownId) {
      const { suggestion } = stateRef.current;
      if (suggestion)
        postOutcome({ request_id: suggestion.requestId, prompt_revision: suggestion.revision, event: "shown" });
    }
  }, [shownId]);

  // Draft persistence. The writer is declared before the loader so the first commit cannot overwrite the draft.
  useEffect(() => {
    if (hydratedRef.current) setDraft(state.prompt);
  }, [state.prompt, setDraft]);
  useEffect(() => {
    hydratedRef.current = true;
    dispatch({ type: "hydrate", prompt: readLocalStorageValue({ key: DRAFT_STORAGE_KEY, defaultValue: "" }) });
  }, [dispatch]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, change, select, acceptGhost, dismissGhost, declineQuestion, applyOption, retry, restore };
}

export type EnhanceController = ReturnType<typeof useEnhance>;
