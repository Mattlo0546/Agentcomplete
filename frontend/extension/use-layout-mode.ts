import { useLayoutEffect, useState } from "react";
import { useIntegration } from "./integration";
export function useLayoutMode(): "narrow" | "medium" | "wide" {
  const integration = useIntegration();
  const [width, setWidth] = useState(() => integration?.container.clientWidth || window.innerWidth);
  useLayoutEffect(() => {
    const element = integration?.container;
    if (!element) {
      const resize = () => setWidth(window.innerWidth);
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [integration?.container]);
  return width >= 1024 ? "wide" : width >= 768 ? "medium" : "narrow";
}
