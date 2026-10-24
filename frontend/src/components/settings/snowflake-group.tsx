"use client";

import { Button } from "@/components/ui/button";
import { formatCount, formatDay, formatDayTime } from "@/lib/format";
import { useAnalyticsStatus, useExport, useTrain } from "@/lib/settings/queries";

import { SettingGroup, SettingRow } from "./setting-group";

export function SnowflakeGroup() {
  const { data } = useAnalyticsStatus();
  const exportNow = useExport();
  const retrain = useTrain();
  const classifier = data?.classifier;
  return (
    <SettingGroup title="Snowflake">
      <SettingRow label="Last export">
        <span className="text-data">
          {data?.last_export_at
            ? `${formatDayTime(data.last_export_at)} · ${formatCount(data.last_export_count ?? 0)} events`
            : "—"}
        </span>
      </SettingRow>
      <SettingRow label="Classifier">
        <span className="text-data">
          {classifier ? `AUC ${classifier.auc.toFixed(2)} · ${formatDay(classifier.trained_at)}` : "—"}
        </span>
        <Button variant="outline" size="sm" disabled={exportNow.isPending} onClick={() => exportNow.mutate()}>
          {exportNow.isPending ? "Exporting…" : "Export now"}
        </Button>
        <Button variant="outline" size="sm" disabled={retrain.isPending} onClick={() => retrain.mutate()}>
          {retrain.isPending ? "Training…" : "Retrain"}
        </Button>
      </SettingRow>
    </SettingGroup>
  );
}
