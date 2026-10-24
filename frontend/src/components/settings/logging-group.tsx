"use client";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useStats } from "@/lib/activity/queries";
import { formatBytes, formatCount } from "@/lib/format";
import { useClearLogs, useSettings } from "@/lib/settings/queries";

import { SettingGroup, SettingRow } from "./setting-group";

export function LoggingGroup() {
  const { data: settings } = useSettings();
  const { data: stats } = useStats();
  const clear = useClearLogs();
  return (
    <SettingGroup title="Logging">
      <SettingRow label="Payloads">
        <span className="text-data text-foreground">
          {settings ? (settings.store_payloads ? "Stored" : "Not stored") : "—"}
        </span>
      </SettingRow>
      <SettingRow label="Retention">
        <span className="text-data text-foreground">{settings ? `${settings.retention_days} days` : "—"}</span>
      </SettingRow>
      <SettingRow label="Stored">
        <span className="text-data">
          {stats ? `${formatCount(stats.log_entries)} entries · ${formatBytes(stats.log_bytes)}` : "—"}
        </span>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={clear.isPending}
              className="border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive"
            >
              Clear logs
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all logs?</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => clear.mutate()}
              >
                Clear logs
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SettingRow>
    </SettingGroup>
  );
}
