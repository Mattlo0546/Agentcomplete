"use client";

import { Send } from "lucide-react";

import { StatusDot } from "@/components/common/status-dot";
import { Button } from "@/components/ui/button";
import type { EnhanceError } from "@/lib/enhance/state";
import { cn } from "@/lib/utils";

import { RequestIndicator } from "./request-indicator";

type EditorFooterProps = {
  revision: number;
  selectionStart: number;
  selectionEnd: number;
  length: number;
  requesting: boolean;
  error: EnhanceError | null;
  onRetry: () => void;
  onSend: () => void;
  sending: boolean;
  narrow: boolean;
  target: "Codex" | "Claude";
  onTargetChange: (target: "Codex" | "Claude") => void;
};

/** design.md §4.1 footer: status left (rev · cursor | indicator | error), count + Send to Codex right. */
export function EditorFooter(props: EditorFooterProps) {
  const { revision, selectionStart, selectionEnd, length, requesting, error, onRetry, onSend, sending, narrow } = props;
  return (
    <div
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-3 border-t border-border py-1",
        narrow ? "pr-2 pl-4" : "pr-3 pl-5",
      )}
    >
      {requesting ? (
        <RequestIndicator />
      ) : error ? (
        <span role="alert" className="flex min-w-0 items-center gap-2">
          <StatusDot tone="err" />
          <span className="truncate text-data text-destructive">
            {error.status > 0 ? `${error.status} · ${error.message}` : error.message}
          </span>
        </span>
      ) : (
        <span className="truncate text-data">
          rev {revision} · {selectionStart}:{selectionEnd}
        </span>
      )}
      <div className="flex-1" />
      {error && !requesting && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="text-muted-foreground">
          Retry
        </Button>
      )}
      <span className="text-data" aria-label={`${length} characters`}>
        {length}
      </span>
      <select
        aria-label="Send target"
        value={props.target}
        disabled={sending}
        onChange={(event) => props.onTargetChange(event.target.value === "Claude" ? "Claude" : "Codex")}
        className="min-h-11 min-w-0 rounded-md border bg-card px-1 text-xs focus-visible:outline-2 focus-visible:outline-ring"
      >
        <option>Codex</option>
        <option>Claude</option>
      </select>
      <Button
        size="sm"
        className="min-h-11"
        onClick={onSend}
        disabled={length === 0 || sending}
        aria-label={`Send to ${props.target}`}
      >
        <Send />
        <span className={narrow ? "sr-only" : undefined}>Send to {props.target}</span>
      </Button>
    </div>
  );
}
