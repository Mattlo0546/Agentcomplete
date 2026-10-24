"use client";

import { useDebouncedCallback } from "@mantine/hooks";
import { useState } from "react";

import { Segmented } from "@/components/common/segmented";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useSettings, useUpdateSettings } from "@/lib/settings/queries";

import { SettingGroup, SettingRow } from "./setting-group";

const MAX_OPTIONS = [2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }));
export const SLIDER_DEBOUNCE_MS = 400;

export function SuggestionsGroup() {
  const { data } = useSettings();
  const update = useUpdateSettings();
  // Local value while dragging; cleared once the debounced PUT settles.
  const [pending, setPending] = useState<number | null>(null);
  const saveDelay = useDebouncedCallback(
    (value: number) =>
      update.mutate(
        { trigger_delay_ms: value },
        { onSettled: () => setPending((current) => (current === value ? null : current)) },
      ),
    SLIDER_DEBOUNCE_MS,
  );

  if (!data) return <SettingGroup title="Suggestions">{null}</SettingGroup>;
  const shownDelay = pending ?? data.trigger_delay_ms;

  return (
    <SettingGroup title="Suggestions">
      <SettingRow label="Trigger delay" htmlFor="trigger-delay">
        <div className="flex w-full max-w-md items-center gap-4">
          <Slider
            id="trigger-delay"
            thumbLabel="Trigger delay"
            min={150}
            max={1500}
            step={50}
            value={[shownDelay]}
            onValueChange={([value]) => {
              setPending(value);
              saveDelay(value);
            }}
          />
          <span className="w-16 shrink-0 text-right text-data">{shownDelay} ms</span>
        </div>
      </SettingRow>
      <SettingRow label="Autocomplete" htmlFor="autocomplete">
        <Switch
          id="autocomplete"
          checked={data.autocomplete_enabled}
          onCheckedChange={(checked) => update.mutate({ autocomplete_enabled: checked })}
        />
      </SettingRow>
      <SettingRow label="Questions" htmlFor="questions">
        <Switch
          id="questions"
          checked={data.questions_enabled}
          onCheckedChange={(checked) => update.mutate({ questions_enabled: checked })}
        />
      </SettingRow>
      <SettingRow label="Max options">
        <Segmented
          label="Max options"
          value={String(data.max_options)}
          options={MAX_OPTIONS}
          onChange={(value) => update.mutate({ max_options: Number(value) })}
        />
      </SettingRow>
    </SettingGroup>
  );
}
