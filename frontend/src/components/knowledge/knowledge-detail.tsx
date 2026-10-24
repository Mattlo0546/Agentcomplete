"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { TagChip } from "@/components/common/tag-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { KnowledgeDetail as Detail } from "@/lib/api/types";
import { formatDayTime } from "@/lib/format";
import type { KnowledgePatch } from "@/lib/knowledge/api";
import { sameTags } from "@/lib/knowledge/tags";
import { useUpdateKnowledge } from "@/lib/knowledge/use-knowledge";

import { MarkdownBody } from "./markdown-body";
import { TagEditor } from "./tag-editor";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-label">{label}</h3>
      {children}
    </section>
  );
}

function ReadView({ item }: { item: Detail }) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="font-mono text-base font-medium break-words">{item.title}</h2>
        <p className="text-data">
          added {formatDayTime(item.created_at)} · used {item.use_count}×
        </p>
      </div>
      <Section label="Tags">
        {item.tags.length ? (
          <div className="flex flex-wrap gap-2">
            {item.tags.map((name) => (
              <TagChip key={name} name={name} className="h-7 px-2.5" />
            ))}
          </div>
        ) : (
          <span className="text-data">—</span>
        )}
      </Section>
      <Section label="Summary">
        <p className="text-sm leading-6">{item.summary}</p>
      </Section>
      <Section label="Body">
        <div className="max-h-[60vh] overflow-auto rounded-md border border-border bg-card p-3">
          {item.kind === "skill" ? (
            <MarkdownBody source={item.body} />
          ) : (
            <pre className="font-mono text-[13px] leading-5 break-words whitespace-pre-wrap">{item.body}</pre>
          )}
        </div>
      </Section>
    </>
  );
}

function EditView({ item, onDone }: { item: Detail; onDone: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [tags, setTags] = useState(item.tags);
  const update = useUpdateKnowledge(item.id);

  const patch: KnowledgePatch = {};
  if (title.trim() !== item.title) patch.title = title.trim();
  if (body !== item.body) patch.body = body;
  if (!sameTags(tags, item.tags)) patch.tags = tags;
  const bodyChanged = patch.body !== undefined;
  const valid = title.trim().length >= 1 && title.trim().length <= 200 && body.trim().length >= 1;
  const dirty = Object.keys(patch).length > 0;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && valid) update.mutate(patch, { onSuccess: onDone });
        else if (!dirty) onDone();
      }}
    >
      <label className="flex flex-col gap-2 text-sm font-medium">
        Title
        <Input
          value={title}
          maxLength={200}
          disabled={update.isPending}
          aria-invalid={title.trim() === ""}
          onChange={(e) => setTitle(e.target.value)}
          className="font-mono"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Body
        <Textarea
          value={body}
          rows={12}
          disabled={update.isPending}
          aria-invalid={body.trim() === ""}
          onChange={(e) => setBody(e.target.value)}
          className="font-mono text-[13px] leading-5"
        />
      </label>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Tags</span>
        <TagEditor tags={tags} onChange={setTags} disabled={update.isPending} />
      </div>
      {update.isError && (
        <p role="alert" className="text-sm text-destructive">
          {update.error.message}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" disabled={update.isPending} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid || update.isPending}>
          {update.isPending && <Loader2 className="animate-spin" />}
          {update.isPending ? (bodyChanged ? "Regenerating" : "Saving") : "Save"}
        </Button>
      </div>
    </form>
  );
}

type DetailProps = {
  item: Detail | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  editing: boolean;
  onEditDone: () => void;
};

/** design.md §4.8 body of the inspector. */
export function KnowledgeDetail({ item, loading, error, onRetry, editing, onEditDone }: DetailProps) {
  if (error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-label">Couldn&apos;t load item</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (loading || !item) {
    return (
      <div aria-busy="true" aria-label="Loading item" className="flex flex-col gap-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return editing ? <EditView key={item.id} item={item} onDone={onEditDone} /> : <ReadView item={item} />;
}
