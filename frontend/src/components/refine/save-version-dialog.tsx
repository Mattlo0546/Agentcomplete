"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveVersion, type PromptVersion, type VersionSnapshot } from "@/lib/history/api";

export function SaveVersionDialog({
  snapshot,
  onClose,
  onSaved,
}: {
  snapshot: VersionSnapshot;
  onClose: () => void;
  onSaved: (version: PromptVersion) => void;
}) {
  const client = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const candidate = snapshot.prompt + (snapshot.suggestion_text ?? "");
  const save = useMutation({
    mutationFn: () =>
      saveVersion({ ...snapshot, title: title.trim() || null, description: description.trim() || null }),
    onSuccess: (version) => {
      void client.invalidateQueries({ queryKey: ["prompt-history"] });
      onSaved(version);
    },
  });
  const tooLong = candidate.length > 20_000 || (snapshot.suggestion_text?.length ?? 0) > 4000;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent aria-describedby="save-version-description" className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>Save prompt version</DialogTitle>
        <DialogDescription id="save-version-description" className="sr-only">
          Save this snapshot to prompt history without changing your draft.
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!tooLong && !save.isPending) save.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="version-title">Name</Label>
            <Input
              id="version-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="version-description">Description</Label>
            <Textarea
              id="version-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={1000}
              rows={2}
            />
          </div>
          <div
            aria-label="Version preview"
            className="max-h-48 overflow-auto rounded-md border bg-card p-3 font-mono text-[13px] leading-5 [overflow-wrap:anywhere] whitespace-pre-wrap"
          >
            {snapshot.prompt}
            <ins className="bg-insert-soft text-insert underline underline-offset-3">{snapshot.suggestion_text}</ins>
          </div>
          {tooLong && (
            <p role="alert" className="text-sm text-destructive">
              Version exceeds the 20,000 character prompt or 4,000 character suggestion limit.
            </p>
          )}
          {save.error && (
            <p role="alert" className="text-sm text-destructive">
              {save.error.message}. Try saving again.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending} className="min-h-11">
              Cancel
            </Button>
            <Button type="submit" disabled={tooLong || !candidate.trim() || save.isPending} className="min-h-11">
              {save.isPending ? "Saving…" : "Save version"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
