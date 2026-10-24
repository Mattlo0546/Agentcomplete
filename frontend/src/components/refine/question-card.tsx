"use client";

import { useMediaQuery } from "@mantine/hooks";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { KeyCap } from "@/components/common/key-cap";
import { Button } from "@/components/ui/button";
import type { Option } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { DiffPreview } from "./diff-preview";

type QuestionCardProps = {
  question: string;
  options: Option[];
  prompt: string;
  narrow: boolean;
  onApply: (optionId: string) => void;
  onDecline: () => void;
};

/** design.md §4.3. Radio-group options; 1–9 select, ↑/↓ move, Enter previews/confirms, Esc declines all. */
export function QuestionCard({ question, options, prompt, narrow, onApply, onDecline }: QuestionCardProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const touch = useMediaQuery("(pointer: coarse)");
  const reduced = useReducedMotion();
  const duration = (seconds: number) => (reduced ? 0 : seconds);

  const select = (index: number, focus = true) => {
    setSelected(index);
    if (focus) optionRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const onButton = target.tagName === "BUTTON";
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= Math.min(9, options.length)) {
      event.preventDefault();
      select(digit - 1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const from = selected ?? (step === 1 ? -1 : 0);
      select((from + step + options.length) % options.length);
    } else if (event.key === "Enter" && !onButton) {
      event.preventDefault();
      const focused = Number(target.dataset.index ?? selected ?? 0);
      if (selected === focused) onApply(options[focused].id);
      else select(focused);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onDecline();
    }
  };

  return (
    <motion.section
      aria-label="Question"
      onKeyDown={handleKeyDown}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration(0.18), ease: [0.2, 0, 0, 1] }}
      className={cn(
        "flex flex-col bg-card",
        narrow
          ? "fixed inset-x-0 bottom-14 z-20 max-h-[72dvh] rounded-t-xl border-t border-border shadow-pop"
          : "shrink-0 rounded-lg border border-border",
      )}
    >
      <div className={cn("flex shrink-0 items-start gap-3 pb-3", narrow ? "px-4 pt-4" : "px-5 pt-4")}>
        <div className="min-w-0 flex-1">
          <div className="text-label">Question</div>
          <h2 id="question-text" className="mt-1 text-[15px] leading-[22px] font-semibold">
            {question}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Decline all options"
          onClick={onDecline}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>

      <div
        role="radiogroup"
        aria-labelledby="question-text"
        className={cn("flex min-h-0 flex-col gap-2 overflow-y-auto", narrow ? "flex-1 px-4 pb-2" : "px-5")}
      >
        {options.map((option, index) => {
          const on = index === selected;
          return (
            <div
              key={option.id}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              role="radio"
              aria-checked={on}
              data-index={index}
              tabIndex={on || (selected === null && index === 0) ? 0 : -1}
              onClick={() => select(index)}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                on ? "border-marker bg-marker-soft" : "border-border hover:bg-accent",
              )}
            >
              <KeyCap className={cn("mt-px", on && "border-marker bg-card text-marker-foreground")}>
                {String(index + 1)}
              </KeyCap>
              <div className="min-w-0 flex-1">
                <div className="leading-5 font-medium">{option.label}</div>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div
                      key="diff"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: duration(0.16) }}
                      className="overflow-hidden"
                    >
                      <DiffPreview prompt={prompt} edits={option.edits} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className={cn(
          "flex shrink-0 items-center gap-2",
          narrow ? "border-t border-border px-4 py-3" : "px-5 pt-4 pb-4",
        )}
      >
        <Button variant="ghost" onClick={onDecline} className="text-muted-foreground">
          Decline all
        </Button>
        {!touch && <KeyCap>Esc</KeyCap>}
        <div className="flex-1" />
        {!touch && <KeyCap>↵</KeyCap>}
        <Button disabled={selected === null} onClick={() => selected !== null && onApply(options[selected].id)}>
          Apply
        </Button>
      </div>
    </motion.section>
  );
}
