import { hideOthers as hide, inertOthers as inert, suppressOthers as suppress } from "pe-aria-hidden";
import { getPortalScope } from "./react-dom";
export * from "pe-aria-hidden";
export function hideOthers(target: Element | Element[], parent?: HTMLElement, marker?: string) {
  return hide(target, getPortalScope() || parent, marker);
}
export function inertOthers(target: Element | Element[], parent?: HTMLElement, marker?: string) {
  return inert(target, getPortalScope() || parent, marker);
}
export function suppressOthers(target: Element | Element[], parent?: HTMLElement, marker?: string) {
  return suppress(target, getPortalScope() || parent, marker);
}
