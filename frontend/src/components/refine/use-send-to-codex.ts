"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { postHandoff } from "@/lib/enhance/api";

class ClipboardError extends Error {}

/** Send to Codex (brief §3): store the hand-off, then copy the prompt. User text only ever goes to the clipboard. */
export function useSendToCodex() {
  const mutation = useMutation({
    mutationFn: async (prompt: string) => {
      await postHandoff(prompt);
      try {
        await navigator.clipboard.writeText(prompt);
      } catch {
        throw new ClipboardError("Saved for Codex, but copying to the clipboard failed");
      }
    },
    onSuccess: () => toast.success("Copied for Codex"),
    onError: (error, prompt) =>
      toast.error(error instanceof ClipboardError ? error.message : `Send to Codex failed · ${error.message}`, {
        action: { label: "Retry", onClick: () => mutation.mutate(prompt) },
      }),
  });
  return mutation;
}
