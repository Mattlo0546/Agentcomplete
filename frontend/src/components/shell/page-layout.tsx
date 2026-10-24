"use client";

import { PanelRight } from "lucide-react";
import type { ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { useLayoutMode } from "./use-layout-mode";

export type InspectorProps = {
  /** Header content of the inspector (left side). */
  title: ReactNode;
  /** Optional header content on the right (ids, actions). */
  actions?: ReactNode;
  content: ReactNode;
  /** Accessible name of the inspector region / sheet. */
  label: string;
  /** Medium/narrow only: whether the sheet/drawer is open. Wide always shows the panel. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type PageLayoutProps = {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  inspector?: InspectorProps;
  /** Extra classes for the scrolling main body. */
  bodyClassName?: string;
};

/** design.md §3: header + main body, with the inspector as a resizable panel (wide), sheet (medium) or drawer (narrow). */
export function PageLayout({ title, actions, children, inspector, bodyClassName }: PageLayoutProps) {
  const mode = useLayoutMode();
  const narrow = mode === "narrow";

  const main = (
    <main className="flex h-full min-w-0 flex-col">
      <header
        className={cn("flex shrink-0 items-center gap-3 border-b border-border", narrow ? "h-12 px-4" : "h-14 px-6")}
      >
        <h1 className="text-title">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          {actions}
          {inspector && mode !== "wide" && (
            <button
              type="button"
              aria-label={`Show ${inspector.label.toLowerCase()}`}
              onClick={() => inspector.onOpenChange(true)}
              className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <PanelRight className="size-4" />
            </button>
          )}
        </div>
      </header>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto",
          narrow ? "gap-3 p-4" : "gap-4 p-6",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </main>
  );

  if (!inspector) return <div className="min-w-0 flex-1">{main}</div>;

  const header = (
    <div className={cn("flex shrink-0 items-center gap-2 border-b border-border", narrow ? "h-12 px-4" : "h-14 px-5")}>
      <div className="flex min-w-0 items-center gap-2 text-section">{inspector.title}</div>
      <div className="ml-auto flex items-center gap-1">{inspector.actions}</div>
    </div>
  );
  const body = (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", narrow ? "gap-5 p-4" : "gap-6 p-5")}>
      {inspector.content}
    </div>
  );

  if (mode === "wide") {
    return (
      <Group orientation="horizontal" className="min-w-0 flex-1">
        <Panel id="main" minSize={520}>
          {main}
        </Panel>
        <Separator
          aria-label="Resize inspector"
          className="relative w-px bg-border transition-colors after:absolute after:inset-y-0 after:-right-[3px] after:-left-[3px] hover:bg-marker data-[separator=active]:bg-marker"
        />
        <Panel id="inspector" defaultSize={340} minSize={280} maxSize={480} collapsible collapsedSize={0}>
          <aside aria-label={inspector.label} className="flex h-full flex-col">
            {header}
            {body}
          </aside>
        </Panel>
      </Group>
    );
  }

  if (mode === "medium") {
    return (
      <div className="min-w-0 flex-1">
        {main}
        <Sheet open={inspector.open} onOpenChange={inspector.onOpenChange}>
          <SheetContent side="right" className="flex w-[360px] flex-col gap-0 p-0 sm:max-w-[360px]">
            <SheetTitle className="sr-only">{inspector.label}</SheetTitle>
            {header}
            {body}
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1">
      {main}
      <Drawer open={inspector.open} onOpenChange={inspector.onOpenChange}>
        <DrawerContent className="max-h-[78vh]">
          <DrawerTitle className="sr-only">{inspector.label}</DrawerTitle>
          {header}
          {body}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
