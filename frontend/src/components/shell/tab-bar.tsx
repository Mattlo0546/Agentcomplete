"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { TABS } from "./tabs";

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Tabs" className="grid h-14 shrink-0 grid-cols-4 border-t border-border bg-background">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center justify-center gap-[3px] text-[11px] font-medium",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
