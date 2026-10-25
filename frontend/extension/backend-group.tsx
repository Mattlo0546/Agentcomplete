import { useQuery } from "@tanstack/react-query";
import { apiJson } from "@/lib/api/client";
import { SettingGroup, SettingRow } from "@/components/settings/setting-group";
export function BackendGroup() {
  const status = useQuery({
    queryKey: ["extension-bridge-status"],
    queryFn: () => apiJson<{ status: string; model?: string; knowledge_items?: number }>("/v1/health"),
  });
  return (
    <SettingGroup title="Connection">
      <SettingRow label="OpenAI bridge">
        <span role="status" className="text-sm">
          {status.isPending
            ? "Connecting…"
            : status.error
              ? status.error.message
              : status.data?.status === "ok"
                ? "Connected"
                : "Unavailable"}
        </span>
      </SettingRow>
      <SettingRow label="Privacy">
        <span className="text-sm text-muted-foreground">
          Your current draft and matching knowledge are sent to OpenAI. Your API key stays in the local bridge.
        </span>
      </SettingRow>
    </SettingGroup>
  );
}
