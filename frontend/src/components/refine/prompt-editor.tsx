"use client";

import { ContextMenu } from "radix-ui";
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import { KeyCap } from "@/components/common/key-cap";
import { cn } from "@/lib/utils";

type PromptEditorProps = {
  prompt: string;
  selectionStart: number;
  selectionEnd: number;
  /** Ghost suffix (already checked to be current and at the end), or "". */
  ghost: string;
  /** Amber focus treatment is dropped while a question card holds the pending decision. */
  quiet: boolean;
  narrow: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (prompt: string, selectionStart: number, selectionEnd: number) => void;
  onSelect: (selectionStart: number, selectionEnd: number) => void;
  onComposingChange: (composing: boolean) => void;
  onAcceptGhost: () => void;
  onEscape: () => void;
  onSaveSuggestion: (prompt: string, suggestion: string) => void;
  footer: ReactNode;
};

/**
 * design.md §4.1. The textarea and an aligned mirror share one grid cell, so both always have the same box,
 * font metrics and wrapping; the mirror renders committed text transparently, then the ghost suffix and the
 * amber Tab cap. The cell grows with the content and the sheet body scrolls both layers together.
 */
export function PromptEditor(props: PromptEditorProps) {
  const { prompt, selectionStart, selectionEnd, ghost, quiet, narrow, textareaRef, footer } = props;
  const caretRef = useRef<HTMLSpanElement>(null);
  const menuSnapshot = useRef({ prompt, ghost });

  // Keep the DOM selection in step with state (accepting/applying moves the cursor) and keep the caret visible.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (textarea.selectionStart !== selectionStart || textarea.selectionEnd !== selectionEnd) {
      textarea.setSelectionRange(selectionStart, selectionEnd);
    }
    if (document.activeElement === textarea) caretRef.current?.scrollIntoView({ block: "nearest" });
  }, [textareaRef, prompt, selectionStart, selectionEnd]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Tab" && ghost && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      props.onAcceptGhost();
    } else if (event.key === "Escape") {
      props.onEscape();
    }
  };

  const syncSelection = (target: HTMLTextAreaElement) => props.onSelect(target.selectionStart, target.selectionEnd);

  return (
    <section
      aria-label="Prompt"
      className={cn(
        "flex shrink-0 flex-col rounded-lg border bg-card transition-[border-color,box-shadow] duration-150",
        quiet
          ? "border-border"
          : "border-border focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25",
      )}
    >
      <div className={cn("overflow-y-auto", narrow ? "max-h-[50dvh]" : "max-h-[min(62dvh,720px)]")}>
        <div
          className={cn(
            "grid text-prompt [overflow-wrap:break-word] whitespace-pre-wrap",
            narrow ? "min-h-40 p-4" : "min-h-70 p-5",
          )}
        >
          <textarea
            ref={textareaRef}
            aria-label="Prompt"
            aria-describedby="prompt-ghost-status"
            value={prompt}
            rows={1}
            spellCheck={false}
            onChange={(event) =>
              props.onChange(event.target.value, event.target.selectionStart, event.target.selectionEnd)
            }
            onSelect={(event) => syncSelection(event.currentTarget)}
            onCompositionStart={() => props.onComposingChange(true)}
            onCompositionEnd={(event) => {
              const target = event.currentTarget;
              props.onChange(target.value, target.selectionStart, target.selectionEnd);
              props.onComposingChange(false);
            }}
            onKeyDown={handleKeyDown}
            className="col-start-1 row-start-1 m-0 resize-none overflow-hidden border-0 bg-transparent p-0 [overflow-wrap:break-word] whitespace-pre-wrap text-foreground outline-none"
          />
          <div aria-hidden className="pointer-events-none col-start-1 row-start-1 text-transparent">
            {prompt.slice(0, selectionEnd)}
            <span ref={caretRef} />
            {prompt.slice(selectionEnd)}
            {ghost && (
              <span data-testid="ghost-text">
                <ContextMenu.Root
                  onOpenChange={(open) => {
                    if (open) menuSnapshot.current = { prompt, ghost };
                  }}
                >
                  <ContextMenu.Trigger asChild>
                    <span className="pointer-events-auto text-ghost" onMouseDown={(event) => event.preventDefault()}>
                      {ghost}
                    </span>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content className="z-50 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                      <ContextMenu.Item
                        onSelect={() => props.onSaveSuggestion(menuSnapshot.current.prompt, menuSnapshot.current.ghost)}
                        className="flex min-h-11 cursor-default items-center rounded-sm px-3 text-sm outline-none data-highlighted:bg-accent"
                      >
                        Save as prompt version
                      </ContextMenu.Item>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Accept suggestion"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={props.onAcceptGhost}
                  className="pointer-events-auto relative ml-2 inline-block align-[1px] before:absolute before:-inset-3"
                >
                  <KeyCap marker>Tab</KeyCap>
                </button>
              </span>
            )}
            {"​"}
          </div>
        </div>
      </div>
      <span id="prompt-ghost-status" aria-live="polite" className="sr-only">
        {ghost ? "Suggestion available, press Tab to accept" : ""}
      </span>
      {footer}
    </section>
  );
}
