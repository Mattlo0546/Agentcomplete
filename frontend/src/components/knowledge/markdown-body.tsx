import type { ReactNode } from "react";

import { parseMarkdown, type Inline } from "@/lib/knowledge/markdown";
import { cn } from "@/lib/utils";

function renderInline(inline: Inline[]): ReactNode[] {
  return inline.map((part, i) =>
    part.type === "code" ? (
      <code key={i} className="rounded-sm bg-muted px-1">
        {part.text}
      </code>
    ) : part.type === "strong" ? (
      <strong key={i} className="font-semibold">
        {part.text}
      </strong>
    ) : (
      part.text
    ),
  );
}

/** Renders the safe markdown subset as React elements; input is never injected as HTML. */
export function MarkdownBody({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-2 font-mono text-[13px] leading-5 break-words">
      {parseMarkdown(source).map((block, i) => {
        switch (block.type) {
          case "heading":
            return (
              <p key={i} role="heading" aria-level={block.level} className={cn("font-semibold", i > 0 && "mt-2")}>
                {renderInline(block.inline)}
              </p>
            );
          case "code":
            return (
              <pre key={i} className="overflow-x-auto rounded-sm bg-muted p-2 whitespace-pre">
                {block.text}
              </pre>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List key={i} className="flex flex-col gap-0.5">
                {block.items.map((item, j) => (
                  <li key={j} style={{ paddingLeft: `${item.depth * 16}px` }} className="flex gap-2">
                    <span aria-hidden className="text-muted-foreground">
                      {block.ordered ? `${j + 1}.` : "-"}
                    </span>
                    <span className="min-w-0">{renderInline(item.inline)}</span>
                  </li>
                ))}
              </List>
            );
          }
          default:
            return (
              <p key={i} className="whitespace-pre-wrap">
                {renderInline(block.inline)}
              </p>
            );
        }
      })}
    </div>
  );
}
