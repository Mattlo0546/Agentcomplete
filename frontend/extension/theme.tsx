import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useIntegration } from "./integration";
type ThemeContext = {
  theme: string;
  resolvedTheme: string;
  setTheme: (theme: string) => void;
  themes: string[];
  systemTheme: string;
};
const Theme = createContext<ThemeContext>({
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => {},
  themes: ["light", "dark", "system"],
  systemTheme: "light",
});
export function ThemeProvider({ children }: { children: ReactNode; [key: string]: unknown }) {
  const integration = useIntegration();
  const [theme, setTheme] = useState("system");
  const inheritedTheme = integration?.theme || "light";
  const resolvedTheme = theme === "system" ? inheritedTheme : theme;
  useEffect(() => {
    const target = integration?.themeTarget;
    if (!target) return;
    target.classList.toggle("dark", resolvedTheme === "dark");
    target.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, integration?.themeTarget]);
  return (
    <Theme.Provider
      value={{ theme, resolvedTheme, setTheme, themes: ["light", "dark", "system"], systemTheme: inheritedTheme }}
    >
      {children}
    </Theme.Provider>
  );
}
export function useTheme() {
  return useContext(Theme);
}
