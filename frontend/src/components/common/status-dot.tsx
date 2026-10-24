import { cn } from "@/lib/utils";

export type DotTone = "ok" | "warn" | "err" | "mute";

const TONES: Record<DotTone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  err: "bg-destructive",
  mute: "bg-input",
};

export function StatusDot({ tone, className }: { tone: DotTone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-[7px] shrink-0 rounded-full", TONES[tone], className)} />;
}

export function httpTone(status: number): DotTone {
  return status >= 500 ? "err" : status >= 400 ? "warn" : "ok";
}
