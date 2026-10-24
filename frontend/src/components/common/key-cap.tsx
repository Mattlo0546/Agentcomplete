import { cn } from "@/lib/utils";

/** design.md §4.1: key cap; `marker` = amber, used only for the pending decision. */
export function KeyCap({ children, marker, className }: { children: string; marker?: boolean; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-grid h-5 min-w-5 place-items-center rounded-sm border px-[5px] font-mono text-[11px] leading-none font-medium",
        marker ? "border-marker bg-marker-soft text-marker-foreground" : "border-input bg-card text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
