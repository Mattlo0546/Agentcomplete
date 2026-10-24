"use client";

import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";

import { Rail } from "./rail";
import { TabBar } from "./tab-bar";
import { useLayoutMode } from "./use-layout-mode";

export function AppShell({ children }: { children: ReactNode }) {
  const mode = useLayoutMode();
  const narrow = mode === "narrow";
  return (
    <div className={narrow ? "flex h-dvh flex-col" : "flex h-dvh"}>
      {!narrow && <Rail />}
      <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
      {narrow && <TabBar />}
      <Toaster position={narrow ? "top-center" : "bottom-right"} />
    </div>
  );
}
