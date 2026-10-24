"use client";

import { PageLayout } from "@/components/shell/page-layout";

import { AppearanceGroup } from "./appearance-group";
import { BackendGroup } from "./backend-group";
import { LoggingGroup } from "./logging-group";
import { SnowflakeGroup } from "./snowflake-group";
import { SuggestionsGroup } from "./suggestions-group";

export function SettingsView() {
  return (
    <PageLayout title="Settings">
      <div className="flex w-full max-w-[720px] flex-col">
        <BackendGroup />
        <SuggestionsGroup />
        <AppearanceGroup />
        <LoggingGroup />
        <SnowflakeGroup />
      </div>
    </PageLayout>
  );
}
