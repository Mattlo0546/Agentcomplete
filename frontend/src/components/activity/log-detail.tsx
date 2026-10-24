"use client";

import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

import { StatusDot, httpTone } from "@/components/common/status-dot";
import { Button } from "@/components/ui/button";
import { buildTimeline, sumTokens } from "@/lib/activity/timeline";
import { useLogDetail } from "@/lib/activity/queries";
import { formatClock, formatDay, formatLatency, formatTokens } from "@/lib/format";
import type { LogDetail as LogDetailData } from "@/lib/api/types";

export function LogDetailTitle({ requestId }: { requestId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(requestId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <span className="truncate font-mono text-[13px]">{requestId}</span>
      <Button variant="ghost" size="icon-xs" aria-label="Copy request id" onClick={copy}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </>
  );
}

export function LogDetailStatus({ requestId }: { requestId: string }) {
  const { data } = useLogDetail(requestId);
  if (!data) return null;
  return (
    <span className="flex items-center gap-1.5 text-data text-foreground">
      <StatusDot tone={httpTone(data.api.status)} />
      {data.api.status}
    </span>
  );
}

function Kv({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-mono text-[13px]">{children}</dd>
    </>
  );
}

function outcomeText(outcome: NonNullable<LogDetailData["outcome"]>): string {
  const event = outcome.event.charAt(0).toUpperCase() + outcome.event.slice(1);
  return outcome.time_to_action_ms === null ? event : `${event} after ${formatLatency(outcome.time_to_action_ms)}`;
}

function Details({ data }: { data: LogDetailData }) {
  const { api, ai, trace, outcome } = data;
  const tokens = sumTokens(ai);
  const bars = buildTimeline(api, ai);
  const error = api.error ?? ai.find((call) => call.error)?.error ?? null;
  return (
    <>
      <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5">
        <Kv label="Endpoint">
          {api.method} {api.path}
        </Kv>
        <Kv label="Started">
          {formatDay(api.time)} {formatClock(api.time)}
        </Kv>
        <Kv label="Total">{formatLatency(api.latency_ms)}</Kv>
        {trace && (
          <Kv label="Result">
            {trace.result_type} · rev {trace.prompt_revision}
          </Kv>
        )}
        {outcome && (
          <Kv label="Outcome">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone={outcome.event === "accepted" ? "ok" : "mute"} />
              {outcomeText(outcome)}
            </span>
          </Kv>
        )}
        {tokens && (
          <Kv label="Tokens">
            {formatTokens(tokens.input)} in / {formatTokens(tokens.output)} out
          </Kv>
        )}
      </dl>
      {bars.length > 0 && (
        <section aria-label="Timeline" className="flex flex-col gap-2.5">
          <h3 className="text-label">Timeline</h3>
          <ul className="flex flex-col gap-2.5">
            {bars.map((bar) => (
              <li key={bar.key} className="grid grid-cols-[88px_minmax(0,1fr)_56px] items-center gap-2">
                <span className="truncate font-mono text-xs">{bar.label}</span>
                <span className="relative h-1.5 rounded-full bg-muted">
                  <span
                    data-testid="timeline-bar"
                    className={`absolute inset-y-0 rounded-full ${bar.status === "error" ? "bg-destructive" : "bg-foreground"}`}
                    style={{ left: `${bar.offsetPct}%`, width: `${bar.widthPct}%` }}
                  />
                </span>
                <span className="text-right text-data text-foreground">{formatLatency(bar.latencyMs)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && (
        <section aria-label="Error" className="flex flex-col gap-2">
          <h3 className="text-label">Error</h3>
          <pre className="rounded-md bg-destructive-soft p-3 font-mono text-xs break-words whitespace-pre-wrap text-destructive">
            {error}
          </pre>
        </section>
      )}
    </>
  );
}

export function LogDetailBody({ requestId }: { requestId: string | null }) {
  const { data, isError, error } = useLogDetail(requestId);
  if (requestId === null) return <p className="text-sm text-muted-foreground">No request selected</p>;
  if (isError) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!data) return null;
  return <Details data={data} />;
}
