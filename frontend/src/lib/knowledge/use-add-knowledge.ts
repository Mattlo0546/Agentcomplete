"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { KnowledgeKind } from "@/lib/api/types";

import { knowledgeKeys, patchKnowledge } from "./api";
import { sameTags } from "./tags";
import { useIngest } from "./use-ingest";

export const MAX_TITLE = 200;
export const MAX_BODY = 100_000;

export type FieldErrors = { title?: string; body?: string };

export function validateAdd(title: string, body: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!title.trim()) errors.title = "Title is required";
  else if (title.trim().length > MAX_TITLE) errors.title = `Title is over ${MAX_TITLE} characters`;
  if (!body.trim()) errors.body = "Body is required";
  else if (body.length > MAX_BODY) errors.body = "Body is over 100,000 characters";
  return errors;
}

/** State machine behind AddKnowledgeDialog: form -> streamed progress -> review tags -> done. */
export function useAddKnowledge(onAdded: (id: string) => void, onClose: () => void) {
  const queryClient = useQueryClient();
  const ingest = useIngest();
  const [kind, setKind] = useState<KnowledgeKind>("skill");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [editedTags, setEditedTags] = useState<string[] | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const { state } = ingest;
  const generatedTags = state.result?.tags.map((t) => t.name) ?? [];
  const tags = editedTags ?? generatedTags;
  const errors = submitted ? validateAdd(title, body) : {};

  const reset = () => {
    ingest.reset();
    setKind("skill");
    setTitle("");
    setBody("");
    setSubmitted(false);
    setEditedTags(null);
    setFinishing(false);
    setFinishError(null);
  };

  const submit = () => {
    setSubmitted(true);
    if (Object.keys(validateAdd(title, body)).length) return;
    void ingest.start({ kind, title: title.trim(), body });
  };

  const finish = async () => {
    const result = state.result;
    if (!result) return;
    setFinishError(null);
    if (!sameTags(tags, generatedTags)) {
      setFinishing(true);
      try {
        await patchKnowledge(result.knowledge.id, { tags });
        void queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
        void queryClient.invalidateQueries({ queryKey: ["tags"] });
      } catch (error) {
        setFinishing(false);
        setFinishError(error instanceof Error ? error.message : "Couldn't save tags");
        return;
      }
    }
    toast.success("Knowledge added", { description: result.knowledge.title });
    onAdded(result.knowledge.id);
    reset();
    onClose();
  };

  /** Dialog dismissal: blocked while streaming; after `done`, closing keeps the item (and tag edits). */
  const requestClose = () => {
    if (state.status === "running" || finishing) return;
    if (state.status === "done") void finish();
    else {
      reset();
      onClose();
    }
  };

  return {
    state,
    kind,
    setKind,
    title,
    setTitle,
    body,
    setBody,
    errors,
    tags,
    setTags: setEditedTags,
    finishing,
    finishError,
    submit,
    finish,
    requestClose,
  };
}
