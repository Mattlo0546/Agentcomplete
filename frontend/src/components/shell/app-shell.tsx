"use client";

import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";

import { Rail } from "./rail";
import { TabBar } from "./tab-bar";
import { useLayoutMode } from "./use-layout-mode";

/** Rail on ≥ 768 px, bottom tab bar below (CSS-driven so server and client markup match). */
export function AppShell({ children }: { children: ReactNode }) {
  const narrow = useLayoutMode() === "narrow";
  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <div className="hidden md:flex">
        <Rail />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
      <div className="md:hidden">
        <TabBar />
      </div>
      <Toaster position={narrow ? "top-center" : "bottom-right"} />
    </div>
  );
}
