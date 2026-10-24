"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { StatusDot } from "@/components/common/status-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiJson } from "@/lib/api/client";
import type { Health } from "@/lib/api/types";
import { currentApiBase, normalizeApiBase, saveApiBase } from "@/lib/settings/backend-url";
import { describeHealth, describeHealthError, type HealthView } from "@/lib/settings/health";

import { SettingGroup, SettingRow } from "./setting-group";

export function BackendGroup() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(() => currentApiBase());
  const [view, setView] = useState<HealthView | null>(null);
  const normalized = normalizeApiBase(url);
  const invalid = url.trim() !== "" && normalized === null;

  const test = useMutation({
    mutationFn: (base: string) => apiJson<Health>("/v1/health?deep=1", { base }),
  });

  const run = (base: string) => {
    test.mutate(base, {
      onSuccess: (health) => {
        setView(describeHealth(health));
        if (base !== currentApiBase()) {
          saveApiBase(base);
          void queryClient.invalidateQueries();
        }
      },
      onError: (error) => setView(describeHealthError(error)),
    });
  };

  const initial = useRef(true);
  useEffect(() => {
    if (!initial.current) return;
    initial.current = false;
    run(currentApiBase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => normalized && run(normalized);

  return (
    <SettingGroup title="Backend">
      <SettingRow label="URL" htmlFor="backend-url">
        <div className="flex w-full min-w-0 gap-2">
          <Input
            id="backend-url"
            value={url}
            inputMode="url"
            aria-invalid={invalid}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submit()}
            className="font-mono text-sm md:text-sm"
          />
          <Button variant="outline" disabled={normalized === null || test.isPending} onClick={submit}>
            {test.isPending ? "Testing…" : "Test"}
          </Button>
        </div>
        {invalid && <p className="text-xs text-destructive">Enter an http(s) URL</p>}
      </SettingRow>
      <SettingRow label="Status">
        <span role="status" className="flex items-center gap-2 text-data">
          {view && (
            <>
              <StatusDot tone={view.tone} />
              {view.text}
            </>
          )}
        </span>
      </SettingRow>
    </SettingGroup>
  );
}
