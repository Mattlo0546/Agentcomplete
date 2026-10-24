"use client";

import { useLayoutMode } from "@/components/shell/use-layout-mode";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useAddKnowledge } from "@/lib/knowledge/use-add-knowledge";

import { AddKnowledgeForm } from "./add-knowledge-form";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new item's id once the user presses Done. */
  onAdded: (id: string) => void;
};

/** design.md §4.9: dialog (wide/medium), full-height bottom sheet (narrow). */
export function AddKnowledgeDialog({ open, onOpenChange, onAdded }: Props) {
  const narrow = useLayoutMode() === "narrow";
  const form = useAddKnowledge(onAdded, () => onOpenChange(false));
  const handleOpenChange = (next: boolean) => {
    if (next) onOpenChange(true);
    else form.requestClose();
  };

  if (narrow) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} dismissible={form.state.status !== "running"}>
        <DrawerContent
          aria-describedby={undefined}
          className="data-[vaul-drawer-direction=bottom]:h-[calc(100dvh-16px)] data-[vaul-drawer-direction=bottom]:max-h-none"
        >
          <DrawerHeader className="text-left">
            <DrawerTitle>Add knowledge</DrawerTitle>
          </DrawerHeader>
          <AddKnowledgeForm form={form} />
          <div className="h-4 shrink-0" />
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[90vh] flex-col gap-5 px-0 py-6 sm:max-w-xl">
        <DialogHeader className="px-6">
          <DialogTitle>Add knowledge</DialogTitle>
        </DialogHeader>
        <AddKnowledgeForm form={form} />
      </DialogContent>
    </Dialog>
  );
}
