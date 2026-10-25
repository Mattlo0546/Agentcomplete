"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocalStorage } from "@mantine/hooks";
import { AnimatePresence, MotionConfig } from "motion/react";
import { BookmarkPlus, History } from "lucide-react";
import { useRef, useState } from "react";

import { PageLayout } from "@/components/shell/page-layout";
import { Button } from "@/components/ui/button";
import { useLayoutMode } from "@/components/shell/use-layout-mode";
import { getSettings } from "@/lib/enhance/api";
import { activeQuestion, ghostText } from "@/lib/enhance/state";
import { DEFAULT_TRIGGER_DELAY_MS, useEnhance } from "@/lib/enhance/use-enhance";
import type { VersionSnapshot } from "@/lib/history/api";

import { ContextInspector } from "./context-inspector";
import { EditorFooter } from "./editor-footer";
import { InputContext } from "./input-context";
import { PromptEditor } from "./prompt-editor";
import { PromptHistory } from "./prompt-history";
import { SaveVersionDialog } from "./save-version-dialog";
import { QuestionCard } from "./question-card";
import { useSendToCodex } from "./use-send-to-codex";

export function RefineView() {
  const narrow = useLayoutMode() === "narrow";
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const enhance = useEnhance(settings.data?.trigger_delay_ms ?? DEFAULT_TRIGGER_DELAY_MS, {
    autocompleteEnabled: settings.data?.autocomplete_enabled,
    questionsEnabled: settings.data?.questions_enabled,
    configurationKey: JSON.stringify(settings.data ?? null),
    settingsReady: !settings.isPending,
  });
  const [target, setTarget] = useLocalStorage<"Codex" | "Claude">({ key: "pe.agentTarget", defaultValue: "Codex" });
  const send = useSendToCodex(target);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [saveSnapshot, setSaveSnapshot] = useState<VersionSnapshot | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { state } = enhance;
  const ghost = ghostText(state);
  const question = activeQuestion(state);
  const focusEditor = () => textareaRef.current?.focus();
  const saveCurrent = () => {
    setHistoryOpen(false);
    setSaveSnapshot({ prompt: state.prompt, suggestion_text: ghost || null });
  };

  return (
    <MotionConfig reducedMotion="user">
      <PageLayout
        title="Refine"
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={ghost ? "Save suggestion as version" : "Save prompt as version"}
              title="Save version"
              disabled={!state.prompt.trim()}
              onClick={saveCurrent}
            >
              <BookmarkPlus />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label="Prompt history"
              title="Prompt history"
              onClick={() => setHistoryOpen(true)}
            >
              <History />
            </Button>
          </>
        }
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
          ghostSource={state.suggestion?.type === "autocomplete" ? state.suggestion : undefined}
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
          onEscape={() => (question ? enhance.declineQuestion() : enhance.dismissGhost())}
          onSaveSuggestion={(prompt, suggestion) => setSaveSnapshot({ prompt, suggestion_text: suggestion })}
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
              target={target}
              onTargetChange={setTarget}
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
        {state.prompt.trim() !== "" && <InputContext requestId={state.traceId} />}
      </PageLayout>
      {historyOpen && (
        <PromptHistory
          prompt={state.prompt}
          initialId={historyId}
          onClose={() => setHistoryOpen(false)}
          onSave={saveCurrent}
          onRestore={(prompt) => {
            enhance.restore(prompt);
            setHistoryOpen(false);
            requestAnimationFrame(focusEditor);
          }}
        />
      )}
      {saveSnapshot && (
        <SaveVersionDialog
          snapshot={saveSnapshot}
          onClose={() => {
            setSaveSnapshot(null);
            requestAnimationFrame(focusEditor);
          }}
          onSaved={(version) => {
            setSaveSnapshot(null);
            setHistoryId(version.id);
            setHistoryOpen(true);
          }}
        />
      )}
    </MotionConfig>
  );
}
