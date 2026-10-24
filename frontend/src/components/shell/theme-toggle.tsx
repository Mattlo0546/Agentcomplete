"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={() => setTheme(dark ? "light" : "dark")}
          className="grid size-10 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
