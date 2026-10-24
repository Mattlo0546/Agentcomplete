"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { Segmented } from "@/components/common/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { KnowledgeKind } from "@/lib/api/types";
import { MAX_BODY, MAX_TITLE, type useAddKnowledge } from "@/lib/knowledge/use-add-knowledge";
import { cn } from "@/lib/utils";

import { IngestSteps } from "./add-steps";
import { TagEditor } from "./tag-editor";

type Form = ReturnType<typeof useAddKnowledge>;

const KINDS: { value: KnowledgeKind; label: string }[] = [
  { value: "skill", label: "Skill" },
  { value: "prompt", label: "Prompt" },
  { value: "graph", label: "Graph" },
];

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

/** design.md §4.9 content, shared by the wide dialog and the narrow sheet. */
export function AddKnowledgeForm({ form }: { form: Form }) {
  const { state, errors } = form;
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const locked = state.status === "running" || state.status === "done";

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name) && !file.type.startsWith("text/")) {
      setFileError("Only .md or text files");
      return;
    }
    setFileError(null);
    form.setBody(await file.text());
    if (!form.title.trim()) form.setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, MAX_TITLE));
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!locked) void loadFile(event.dataTransfer.files[0]);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (state.status === "done") void form.finish();
    else if (!locked) form.submit();
  };

  const tagMeta = Object.fromEntries((state.result?.tags ?? []).map((t) => [t.name, t.new ? "new" : "existing"]));

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-1">
        <Segmented label="Kind" value={form.kind} onChange={form.setKind} options={KINDS} className="self-start" />
        <div className="flex flex-col gap-2">
          <label htmlFor="add-title" className="text-sm font-medium">
            Title
          </label>
          <Input
            id="add-title"
            value={form.title}
            maxLength={MAX_TITLE + 50}
            disabled={locked}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "add-title-error" : undefined}
            onChange={(e) => form.setTitle(e.target.value)}
            className="font-mono"
          />
          <FieldError id="add-title-error" message={errors.title} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="add-body" className="text-sm font-medium">
              Body
            </label>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={locked}
              onClick={() => fileInput.current?.click()}
            >
              <FileUp />
              Choose file
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".md,.markdown,.txt,text/*"
              aria-label="Choose markdown file"
              className="hidden"
              onChange={(e) => {
                void loadFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          <Textarea
            id="add-body"
            value={form.body}
            rows={8}
            maxLength={MAX_BODY + 1000}
            disabled={locked}
            aria-invalid={!!errors.body}
            aria-describedby={errors.body ? "add-body-error" : undefined}
            onChange={(e) => form.setBody(e.target.value)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "max-h-72 font-mono text-[13px] leading-5",
              dragging && "border-ring ring-[3px] ring-ring/50",
            )}
          />
          <FieldError id="add-body-error" message={errors.body ?? fileError ?? undefined} />
        </div>

        {state.status !== "idle" && <IngestSteps done={state.steps} running={state.status === "running"} />}

        {state.status === "error" && (
          <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
            <span className="min-w-0 flex-1 break-words">{state.error}</span>
            <Button type="button" variant="outline" size="sm" onClick={form.submit}>
              Retry
            </Button>
          </div>
        )}

        {state.status === "done" && state.result && (
          <>
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Summary</h3>
              <p className="text-sm leading-6">{state.result.knowledge.summary}</p>
            </section>
            <section className="flex flex-col gap-2 pb-2">
              <h3 className="text-sm font-medium">Tags</h3>
              <TagEditor tags={form.tags} onChange={form.setTags} meta={tagMeta} disabled={form.finishing} />
              <FieldError id="add-finish-error" message={form.finishError ?? undefined} />
            </section>
          </>
        )}
      </div>
      <div className="flex shrink-0 justify-end border-t border-border px-6 pt-4">
        {state.status === "done" ? (
          <Button type="submit" disabled={form.finishing}>
            {form.finishing && <Loader2 className="animate-spin" />}
            Done
          </Button>
        ) : (
          <Button type="submit" disabled={state.status === "running"}>
            {state.status === "running" && <Loader2 className="animate-spin" />}
            Add
          </Button>
        )}
      </div>
    </form>
  );
}
