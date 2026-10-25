import { ArrowUpRight, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RequestIndicator } from "@/components/refine/request-indicator";
import type { EnhanceError } from "@/lib/enhance/state";
type Props = {
  revision: number;
  selectionStart: number;
  selectionEnd: number;
  length: number;
  requesting: boolean;
  error: EnhanceError | null;
  onRetry: () => void;
  onSend: () => void;
  sending: boolean;
  narrow: boolean;
};
export function EditorFooter(p: Props) {
  return (
    <div className="extension-editor-footer flex min-h-12 flex-wrap items-center gap-2 border-t border-border px-4 py-2">
      <div className="mr-auto min-w-0 text-sm text-muted-foreground" role={p.error ? "alert" : "status"}>
        {p.requesting ? (
          <RequestIndicator />
        ) : p.error ? (
          <span className="text-destructive">{p.error.message}</span>
        ) : (
          `${p.length.toLocaleString()} characters`
        )}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={p.onRetry} disabled={p.requesting || !p.length}>
        <RotateCw className="size-4" />
        {p.error ? "Retry" : "Suggest"}
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={p.onSend}
        disabled={!p.length || p.sending}
        aria-label="Apply to ChatGPT"
      >
        <ArrowUpRight className="size-4" />
        Apply to ChatGPT
      </Button>
    </div>
  );
}
