import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Providers } from "../src/app/providers";
import { AppShell } from "../src/components/shell/app-shell";
import { RefineView } from "../src/components/refine/refine-view";
import { KnowledgeView } from "../src/components/knowledge/knowledge-view";
import { ActivityView } from "../src/components/activity/activity-view";
import { SettingsView } from "../src/components/settings/settings-view";
import { Button } from "../src/components/ui/button";
import { Navigation } from "./navigation";
import { useIntegration } from "./integration";
export function Workspace() {
  const integration = useIntegration();
  const close = () => integration?.onClose();
  const [pathname, navigate] = useState("/refine");
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      const target = (event.composedPath()[0] || event.target) as HTMLElement;
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        target.tagName !== "TEXTAREA" &&
        !target.closest('[role="radio"]') &&
        !(integration?.themeTarget || document).querySelector('[role="dialog"], [aria-label="Question"]')
      )
        close();
    };
    const events = integration?.container || window;
    events.addEventListener("keydown", escape as EventListener);
    return () => events.removeEventListener("keydown", escape as EventListener);
  }, [integration]);
  return (
    <Navigation.Provider value={{ pathname, navigate }}>
      <Providers>
        <div className="extension-workspace flex h-dvh flex-col bg-background text-foreground">
          <header className="extension-titlebar flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-4">
            <span className="text-base font-semibold">Prompt Enhance</span>
            <span className="ml-auto text-xs text-muted-foreground">For ChatGPT</span>
            <Button variant="ghost" size="icon-sm" aria-label="Close Prompt Enhance" onClick={close}>
              <X />
            </Button>
          </header>
          <div className="extension-shell min-h-0 flex-1">
            <AppShell>
              {pathname === "/knowledge" ? (
                <KnowledgeView />
              ) : pathname === "/activity" ? (
                <ActivityView />
              ) : pathname === "/settings" ? (
                <SettingsView />
              ) : (
                <RefineView />
              )}
            </AppShell>
          </div>
        </div>
      </Providers>
    </Navigation.Provider>
  );
}
