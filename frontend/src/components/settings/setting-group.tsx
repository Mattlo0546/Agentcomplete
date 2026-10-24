import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";

/** design.md §4.13: hairline-separated group with a `section` heading only. */
export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 border-b border-border py-6 first:pt-0 last:border-b-0">
      <h2 className="text-section">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** 180px label column on wide, stacked on narrow. */
export function SettingRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 md:grid md:min-h-9 md:grid-cols-[180px_minmax(0,1fr)] md:items-center md:gap-3">
      <Label htmlFor={htmlFor} className="text-sm font-normal">
        {label}
      </Label>
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
