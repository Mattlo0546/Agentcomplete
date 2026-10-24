"use client";

import { useTheme } from "next-themes";

import { Segmented } from "@/components/common/segmented";

import { SettingGroup, SettingRow } from "./setting-group";

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function AppearanceGroup() {
  const { theme, setTheme } = useTheme();
  return (
    <SettingGroup title="Appearance">
      <SettingRow label="Theme">
        <Segmented label="Theme" value={theme ?? "system"} options={THEMES} onChange={setTheme} />
      </SettingRow>
    </SettingGroup>
  );
}
