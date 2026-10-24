import { useMediaQuery } from "@mantine/hooks";

/** design.md §3: narrow < 768, medium 768–1023, wide ≥ 1024. */
export function useLayoutMode(): "narrow" | "medium" | "wide" {
  // Initial value matches the server render (wide); the real value is applied after hydration.
  const wide = useMediaQuery("(min-width: 1024px)", true);
  const medium = useMediaQuery("(min-width: 768px)", true);
  return wide ? "wide" : medium ? "medium" : "narrow";
}
