import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiJson } from "@/lib/api/client";
import type { AnalyticsStatus, AppSettings } from "@/lib/api/types";

export type EditableSettings = Pick<
  AppSettings,
  "trigger_delay_ms" | "autocomplete_enabled" | "questions_enabled" | "max_options"
>;

const SETTINGS_KEY = ["settings"] as const;

export function useSettings() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: () => apiJson<AppSettings>("/v1/settings") });
}

/** Optimistic PUT with rollback and an error toast. */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<EditableSettings>) => {
      const current = queryClient.getQueryData<AppSettings>(SETTINGS_KEY);
      const body: EditableSettings = {
        trigger_delay_ms: current?.trigger_delay_ms ?? 400,
        autocomplete_enabled: current?.autocomplete_enabled ?? true,
        questions_enabled: current?.questions_enabled ?? true,
        max_options: current?.max_options ?? 4,
        ...patch,
      };
      return apiJson<AppSettings>("/v1/settings", { method: "PUT", body });
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_KEY });
      const previous = queryClient.getQueryData<AppSettings>(SETTINGS_KEY);
      if (previous) queryClient.setQueryData<AppSettings>(SETTINGS_KEY, { ...previous, ...patch });
      return { previous };
    },
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(SETTINGS_KEY, context.previous);
      toast.error(`Couldn't save settings: ${error.message}`);
    },
    onSuccess: (saved) => queryClient.setQueryData(SETTINGS_KEY, saved),
  });
}

export function useAnalyticsStatus() {
  return useQuery({
    queryKey: ["analytics-status"],
    queryFn: () => apiJson<AnalyticsStatus>("/v1/analytics/status"),
  });
}

export function useExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiJson<{ exported: number }>("/v1/analytics/export", { method: "POST" }),
    onSuccess: ({ exported }) => {
      toast.success(`Exported ${exported} events`);
      void queryClient.invalidateQueries({ queryKey: ["analytics-status"] });
    },
    onError: (error) => toast.error(error.message),
  });
}

export function useTrain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiJson<{ auc: number; rows: number; trained_at: string }>("/v1/analytics/train", { method: "POST" }),
    onSuccess: ({ auc, rows }) => {
      toast.success(`Classifier trained · AUC ${auc.toFixed(2)} · ${rows} rows`);
      void queryClient.invalidateQueries({ queryKey: ["analytics-status"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (error) => toast.error(error.message),
  });
}

export function useClearLogs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiJson<void>("/v1/logs", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Logs cleared");
      for (const key of ["stats", "logs", "log"]) void queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: (error) => toast.error(error.message),
  });
}
