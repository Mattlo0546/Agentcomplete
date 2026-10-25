import { createPortal as originalCreatePortal } from "pe-react-dom";
import type { ReactNode } from "react";
export * from "pe-react-dom";
let portalContainer: HTMLElement | null = null;
export function setPortalContainer(container: HTMLElement | null) {
  portalContainer = container;
}
export function getPortalScope() {
  return portalContainer?.parentElement || undefined;
}
export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null) {
  return originalCreatePortal(
    children,
    container === document.body && portalContainer ? portalContainer : container,
    key,
  );
}
