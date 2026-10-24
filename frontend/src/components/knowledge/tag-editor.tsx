"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { TagChip } from "@/components/common/tag-chip";
import { normalizeTag } from "@/lib/knowledge/tags";

type TagEditorProps = {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** Trailing data per tag, e.g. `new` / `existing`. */
  meta?: Record<string, string>;
  disabled?: boolean;
};

/** Removable tag chips plus an inline `+ Tag` input. */
export function TagEditor({ tags, onChange, meta, disabled }: TagEditorProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const name = normalizeTag(draft);
    if (name && !tags.includes(name)) onChange([...tags, name]);
    setDraft("");
    setAdding(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((name) => (
        <TagChip
          key={name}
          name={name}
          meta={meta?.[name]}
          onRemove={disabled ? undefined : () => onChange(tags.filter((t) => t !== name))}
          className="h-7 px-2.5"
        />
      ))}
      {!disabled &&
        (adding ? (
          <input
            autoFocus
            aria-label="New tag"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDraft("");
                setAdding(false);
              }
            }}
            className="h-7 w-28 rounded-full border border-input bg-background px-2.5 font-mono text-[11.5px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-input px-2.5 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Plus className="size-3.5" />
            Tag
          </button>
        ))}
    </div>
  );
}
