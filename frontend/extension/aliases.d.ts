declare module "pe-react-dom" {
  export * from "react-dom";
}
declare module "pe-mantine-hooks" {
  export * from "@mantine/hooks";
}
declare module "*.css?inline" {
  const css: string;
  export default css;
}

declare module "pe-aria-hidden" {
  export function hideOthers(target: Element | Element[], parent?: HTMLElement, marker?: string): () => void;
  export function inertOthers(target: Element | Element[], parent?: HTMLElement, marker?: string): () => void;
  export function suppressOthers(target: Element | Element[], parent?: HTMLElement, marker?: string): () => void;
  export function supportsInert(): boolean;
}
