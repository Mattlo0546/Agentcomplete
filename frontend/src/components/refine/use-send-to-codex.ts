"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { postHandoff } from "@/lib/enhance/api";

class ClipboardError extends Error {}

/** Store the shared agent handoff and copy text; never execute the prompt. */
export function useSendToCodex(target: "Codex" | "Claude" = "Codex") {
  const mutation = useMutation({
    mutationFn: async (prompt: string) => {
      await postHandoff(prompt);
      try {
        await navigator.clipboard.writeText(prompt);
      } catch {
        throw new ClipboardError(`Saved for ${target}, but copying to the clipboard failed`);
      }
      return target;
    },
    onSuccess: (destination) => toast.success(`Copied for ${destination}`),
    onError: (error, prompt) =>
      toast.error(error instanceof ClipboardError ? error.message : `Send to ${target} failed · ${error.message}`, {
        action: { label: "Retry", onClick: () => mutation.mutate(prompt) },
      }),
  });
  return mutation;
}
