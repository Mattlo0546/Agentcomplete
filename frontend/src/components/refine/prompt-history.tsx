"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { getApiBase } from "@/lib/api/client";
import { formatDayTime } from "@/lib/format";
import { deleteVersion, listVersions, updateVersion, type PromptVersion } from "@/lib/history/api";
import { versionDiff } from "@/lib/history/diff";
import { cn } from "@/lib/utils";

const versionName = (version: PromptVersion) => version.title || formatDayTime(version.created_at);

export function PromptHistory({
  prompt,
  initialId,
  onClose,
  onRestore,
  onSave,
}: {
  prompt: string;
  initialId: string | null;
  onClose: () => void;
  onRestore: (text: string) => void;
  onSave: () => void;
}) {
  const query = useInfiniteQuery({
    queryKey: ["prompt-history", getApiBase()],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => listVersions(pageParam, signal),
    getNextPageParam: (last, pages) => {
      const offset = pages.reduce((sum, page) => sum + page.items.length, 0);
      return last.items.length > 0 && offset < last.total ? offset : undefined;
    },
  });
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [showDetail, setShowDetail] = useState(Boolean(initialId));
  const versions = query.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = versions.find((version) => version.id === selectedId) ?? versions[0];

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        aria-describedby="prompt-history-description"
        className="w-full gap-0 data-[state=closed]:duration-150 data-[state=open]:duration-150 sm:w-[min(90vw,900px)] sm:max-w-none"
      >
        <div className="flex min-h-14 shrink-0 items-center gap-3 border-b px-4 pr-12 sm:px-6">
          <SheetTitle className="text-title">Prompt history</SheetTitle>
          <span className="text-data">{query.data?.pages[0]?.total ?? ""}</span>
        </div>
        <SheetDescription id="prompt-history-description" className="sr-only">
          Saved prompt versions with names, descriptions, and comparisons.
        </SheetDescription>
        <div className="flex min-h-0 flex-1">
          <div
            aria-label="Saved versions"
            className={cn(
              "w-full shrink-0 flex-col overflow-y-auto sm:flex sm:w-64 sm:border-r",
              showDetail ? "hidden" : "flex",
            )}
          >
            <div className="border-b p-3">
              <Button
                variant="outline"
                className="min-h-11 w-full shadow-none"
                disabled={!prompt.trim()}
                onClick={onSave}
              >
                Save current version
              </Button>
            </div>
            {query.isPending && (
              <p role="status" className="p-4 text-sm text-muted-foreground">
                Loading versions…
              </p>
            )}
            {query.isError && (
              <div role="alert" className="p-4 text-sm">
                <p className="text-destructive">{query.error.message}</p>
                <Button variant="ghost" onClick={() => void query.refetch()}>
                  Retry history
                </Button>
              </div>
            )}
            {!query.isPending && !query.isError && versions.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No saved versions</p>
            )}
            {versions.map((version) => (
              <button
                type="button"
                key={version.id}
                aria-pressed={selected?.id === version.id}
                className={cn(
                  "flex min-h-16 w-full flex-col gap-1 border-b p-4 text-left focus-visible:outline-2 focus-visible:outline-ring",
                  selected?.id === version.id ? "bg-accent" : "hover:bg-muted",
                )}
                onClick={() => {
                  setSelectedId(version.id);
                  setShowDetail(true);
                }}
              >
                <span className="w-full truncate text-sm font-medium">{versionName(version)}</span>
                {version.description && (
                  <span className="line-clamp-2 text-xs [overflow-wrap:anywhere] text-muted-foreground">
                    {version.description}
                  </span>
                )}
                <time dateTime={version.created_at} className="text-data">
                  {formatDayTime(version.created_at)}
                </time>
              </button>
            ))}
            {query.hasNextPage && (
              <Button
                variant="ghost"
                className="m-3 min-h-11"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? "Loading…" : "Load more versions"}
              </Button>
            )}
          </div>
          <div className={cn("min-w-0 flex-1 overflow-y-auto p-4 sm:block sm:p-6", showDetail ? "block" : "hidden")}>
            <Button variant="ghost" className="mb-4 min-h-11 sm:hidden" onClick={() => setShowDetail(false)}>
              <ArrowLeft />
              All versions
            </Button>
            {selected && (
              <VersionDetail
                key={selected.id}
                version={selected}
                versions={versions}
                prompt={prompt}
                onRestore={onRestore}
              />
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function VersionDetail({
  version,
  versions,
  prompt,
  onRestore,
}: {
  version: PromptVersion;
  versions: PromptVersion[];
  prompt: string;
  onRestore: (text: string) => void;
}) {
  const client = useQueryClient();
  const [title, setTitle] = useState(version.title ?? "");
  const [description, setDescription] = useState(version.description ?? "");
  const [compareId, setCompareId] = useState("draft");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const baseline = versions.find((item) => item.id === compareId)?.saved_text ?? prompt;
  const segments = useMemo(() => versionDiff(baseline, version.saved_text), [baseline, version.saved_text]);
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["prompt-history"] });
  };
  const update = useMutation({
    mutationFn: () =>
      updateVersion(version.id, { title: title.trim() || null, description: description.trim() || null }),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: () => deleteVersion(version.id), onSuccess: invalidate });
  const error = update.error ?? remove.error;
  const busy = update.isPending || remove.isPending;
  const changed = (title.trim() || null) !== version.title || (description.trim() || null) !== version.description;
  const added = segments.filter((part) => part.kind === "insert").reduce((sum, part) => sum + part.text.length, 0);
  const removed = segments.filter((part) => part.kind === "delete").reduce((sum, part) => sum + part.text.length, 0);

  return (
    <section aria-label="Version details" className="flex min-w-0 flex-col gap-5">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) update.mutate();
        }}
      >
        <Label htmlFor="history-title">Name</Label>
        <Input id="history-title" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
        <Label htmlFor="history-description">Description</Label>
        <Textarea
          id="history-description"
          rows={2}
          maxLength={1000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="flex items-center gap-3">
          <time className="text-data" dateTime={version.created_at}>
            {formatDayTime(version.created_at)}
          </time>
          <Button type="submit" variant="ghost" className="ml-auto min-h-11" disabled={!changed || busy}>
            {update.isPending ? "Saving…" : "Save details"}
          </Button>
        </div>
      </form>
      <div className="flex flex-col gap-2 border-t pt-4">
        <Label htmlFor="history-compare">Compare with</Label>
        <select
          id="history-compare"
          className="min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          value={compareId}
          onChange={(event) => setCompareId(event.target.value)}
        >
          <option value="draft">Current draft</option>
          {versions
            .filter((item) => item.id !== version.id)
            .map((item) => (
              <option value={item.id} key={item.id}>
                {versionName(item)}
              </option>
            ))}
        </select>
        <div
          aria-label="Version comparison"
          className="rounded-md border bg-card p-3 font-mono text-[13px] leading-5 [overflow-wrap:anywhere] whitespace-pre-wrap"
        >
          {segments.map((part, index) =>
            part.kind === "insert" ? (
              <ins key={index} className="bg-insert-soft text-insert underline underline-offset-3">
                <span className="sr-only">Inserted: </span>
                {part.text}
              </ins>
            ) : part.kind === "delete" ? (
              <del key={index} className="bg-destructive-soft text-destructive">
                <span className="sr-only">Deleted: </span>
                {part.text}
              </del>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </div>
        <span className="text-data">
          +{added} −{removed}
          {!added && !removed ? " · No changes" : ""}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}. Try again.
        </p>
      )}
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button
          className="min-h-11"
          disabled={busy}
          onClick={() => {
            if (prompt.trim() && prompt !== version.saved_text) setConfirmRestore(true);
            else onRestore(version.saved_text);
          }}
        >
          <RotateCcw />
          Restore version
        </Button>
        <Button
          variant="ghost"
          className="min-h-11 text-destructive"
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 />
          Delete
        </Button>
      </div>
      {confirmRestore && (
        <div
          role="group"
          aria-label="Confirm version restore"
          className="flex flex-wrap items-center gap-2 border-t pt-4"
        >
          <span className="text-sm">Replace the current draft?</span>
          <Button className="min-h-11" disabled={busy} onClick={() => onRestore(version.saved_text)}>
            Restore selected version
          </Button>
          <Button variant="ghost" className="min-h-11" onClick={() => setConfirmRestore(false)}>
            Keep draft
          </Button>
        </div>
      )}
      {confirmDelete && (
        <div
          role="group"
          aria-label="Confirm version deletion"
          className="flex flex-wrap items-center gap-2 border-t pt-4"
        >
          <span className="text-sm">Delete this saved version?</span>
          <Button variant="destructive" className="min-h-11" disabled={busy} onClick={() => remove.mutate()}>
            {remove.isPending ? "Deleting…" : "Delete version"}
          </Button>
          <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setConfirmDelete(false)}>
            Keep version
          </Button>
        </div>
      )}
    </section>
  );
}
