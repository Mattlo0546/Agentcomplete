// design.md §6 number and date formats.

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function formatScore(n: number): string {
  return n.toFixed(2);
}

export function formatPct(n: number): string {
  return `${Math.round(n)}%`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-GB");
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const DAY_MONTH_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** `24 Oct` */
export function formatDay(iso: string): string {
  return DAY_MONTH.format(new Date(iso));
}

/** `24 Oct 14:02` */
export function formatDayTime(iso: string): string {
  return DAY_MONTH_TIME.format(new Date(iso)).replace(",", "");
}

/** `14:02:31.418` */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  const pad = (v: number, len = 2) => String(v).padStart(len, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
