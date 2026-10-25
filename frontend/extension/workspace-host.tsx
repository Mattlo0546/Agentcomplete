import { createRoot } from "react-dom/client";
import { IntegrationContext, type ExtensionIntegration } from "./integration";
import { Workspace } from "./workspace";
import { setPortalContainer } from "./react-dom";
import { initializeStorage } from "./storage";
import css from "./generated.css?inline";
import { enhanceReducer, initialEnhanceState, ghostText, type EnhanceAction } from "../src/lib/enhance/state";
export { enhanceReducer, initialEnhanceState, ghostText } from "../src/lib/enhance/state";
export { MAX_SALVAGE_AGE_MS } from "../src/lib/enhance/use-enhance";

/** Native composer adapter over the exact state machine used by the Refine view. */
export function createNativeStateController(prompt = "") {
  let state = enhanceReducer(initialEnhanceState, { type: "hydrate", prompt });
  return {
    get state() {
      return state;
    },
    dispatch(action: EnhanceAction) {
      state = enhanceReducer(state, action);
      return state;
    },
    ghostText() {
      return ghostText(state);
    },
  };
}
export type MountOptions = {
  prompt: string;
  theme: "light" | "dark";
  onApply: (prompt: string) => Promise<void>;
  onClose: () => void;
};
export function mountWorkspace(container: HTMLElement, options: MountOptions) {
  const shadow = container.shadowRoot || container.attachShadow({ mode: "open" });
  shadow.replaceChildren();
  const style = document.createElement("style");
  style.textContent =
    css
      .replaceAll(":root", ":host")
      .replace(/@media\s*\(((?:min-|max-)?width)[^)]*\)/g, (match) =>
        match.replace("@media", "@container pe-workspace"),
      ) +
    "\n:host{display:block;width:100%;height:100%;container-type:inline-size;container-name:pe-workspace}.extension-root{position:relative;contain:layout paint;isolation:isolate;width:100%;height:100%;overflow:clip;font-family:var(--font-geist-sans);font-size:14px;line-height:1.5;background:var(--background);color:var(--foreground)}.extension-workspace{height:100%}.extension-root .toaster{position:fixed}";
  const wrapper = document.createElement("div");
  wrapper.className = "extension-root";
  wrapper.classList.toggle("dark", options.theme === "dark");
  const app = document.createElement("div");
  app.className = "extension-app";
  app.style.cssText = "height:100%;min-height:0";
  const portals = document.createElement("div");
  portals.className = "extension-portals";
  wrapper.append(app, portals);
  shadow.append(style, wrapper);
  setPortalContainer(portals);
  const root = createRoot(app);
  let disposed = false;
  let integration: ExtensionIntegration = { ...options, container, themeTarget: wrapper };
  const render = () => {
    if (!disposed)
      root.render(
        <IntegrationContext.Provider value={integration}>
          <Workspace />
        </IntegrationContext.Provider>,
      );
  };
  app.textContent = "Opening Prompt Enhance…";
  initializeStorage(options.prompt).then(render);
  return {
    unmount() {
      disposed = true;
      root.unmount();
      setPortalContainer(null);
      shadow.replaceChildren();
    },
    setTheme(theme: "light" | "dark") {
      integration = { ...integration, theme };
      render();
    },
  };
}
