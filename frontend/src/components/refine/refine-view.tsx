"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, MotionConfig } from "motion/react";
import { useRef, useState } from "react";

import { PageLayout } from "@/components/shell/page-layout";
import { useLayoutMode } from "@/components/shell/use-layout-mode";
import { getSettings } from "@/lib/enhance/api";
import { activeQuestion, ghostText } from "@/lib/enhance/state";
import { DEFAULT_TRIGGER_DELAY_MS, useEnhance } from "@/lib/enhance/use-enhance";

import { ContextInspector } from "./context-inspector";
import { EditorFooter } from "./editor-footer";
import { PromptEditor } from "./prompt-editor";
import { QuestionCard } from "./question-card";
import { useSendToCodex } from "./use-send-to-codex";

export function RefineView() {
  const narrow = useLayoutMode() === "narrow";
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const enhance = useEnhance(settings.data?.trigger_delay_ms ?? DEFAULT_TRIGGER_DELAY_MS, {
    autocompleteEnabled: settings.data?.autocomplete_enabled,
    questionsEnabled: settings.data?.questions_enabled,
  });
  const send = useSendToCodex();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { state } = enhance;
  const ghost = ghostText(state);
  const question = activeQuestion(state);
  const focusEditor = () => textareaRef.current?.focus();

  return (
    <MotionConfig reducedMotion="user">
      <PageLayout
        title="Refine"
        bodyClassName={question && narrow ? "pb-[60dvh]" : undefined}
        inspector={{
          title: "Context",
          actions: state.traceId && <span className="text-data">{state.traceId}</span>,
          content: <ContextInspector key={state.traceId} requestId={state.traceId} />,
          label: "Context",
          open: inspectorOpen,
          onOpenChange: setInspectorOpen,
        }}
      >
        <PromptEditor
          prompt={state.prompt}
          selectionStart={state.selectionStart}
          selectionEnd={state.selectionEnd}
          ghost={ghost}
          quiet={question !== null}
          narrow={narrow}
          textareaRef={textareaRef}
          onChange={enhance.change}
          onSelect={enhance.select}
          onComposingChange={enhance.setComposing}
          onAcceptGhost={() => {
            enhance.acceptGhost();
            focusEditor();
          }}
          onEscape={() => (ghost ? enhance.dismissGhost() : question && enhance.declineQuestion())}
          footer={
            <EditorFooter
              revision={state.revision}
              selectionStart={state.selectionStart}
              selectionEnd={state.selectionEnd}
              length={state.prompt.length}
              requesting={state.pending !== null}
              error={state.error}
              onRetry={enhance.retry}
              onSend={() => send.mutate(state.prompt)}
              sending={send.isPending}
              narrow={narrow}
            />
          }
        />
        <AnimatePresence>
          {question && (
            <QuestionCard
              key={question.requestId}
              question={question.question}
              options={question.options}
              prompt={state.prompt}
              narrow={narrow}
              onApply={(optionId) => {
                enhance.applyOption(optionId);
                focusEditor();
              }}
              onDecline={() => {
                enhance.declineQuestion();
                focusEditor();
              }}
            />
          )}
        </AnimatePresence>
      </PageLayout>
    </MotionConfig>
  );
}
