import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useIntegration } from "./integration";
export function useSendToCodex(_target?: "Codex" | "Claude") {
  const integration = useIntegration();
  return useMutation({
    mutationFn: async (prompt: string) => {
      if (!integration) throw new Error("Reopen Prompt Enhance from ChatGPT.");
      await integration.onApply(prompt);
    },
    onError: (error) => toast.error(error.message),
  });
}
