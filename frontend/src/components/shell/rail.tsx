"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { TABS } from "./tabs";
import { ThemeToggle } from "./theme-toggle";

export function Rail() {
  const pathname = usePathname();
  return (
    <nav aria-label="Tabs" className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border py-3">
      <div
        aria-label="Prompt Enhance"
        className="relative mb-4 grid size-8 place-items-center rounded-md bg-primary text-[17px] leading-none font-semibold text-primary-foreground"
      >
        ¶
        <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full border-2 border-background bg-marker" />
      </div>
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Tooltip key={href}>
            <TooltipTrigger asChild>
              <Link
                href={href}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "grid size-10 place-items-center rounded-md transition-colors",
                  active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-[18px]" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        );
      })}
      <div className="flex-1" />
      <ThemeToggle />
    </nav>
  );
}
