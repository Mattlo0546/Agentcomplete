import { createContext, useContext } from "react";
export type ExtensionIntegration = {
  prompt: string;
  theme: "light" | "dark";
  container: HTMLElement;
  themeTarget: HTMLElement;
  onApply: (prompt: string) => Promise<void>;
  onClose: () => void;
};
export const IntegrationContext = createContext<ExtensionIntegration | null>(null);
export const useIntegration = () => useContext(IntegrationContext);
