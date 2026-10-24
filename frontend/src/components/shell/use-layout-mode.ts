import { useMediaQuery } from "@mantine/hooks";

/** design.md §3: narrow < 768, medium 768–1023, wide ≥ 1024. */
export function useLayoutMode(): "narrow" | "medium" | "wide" {
  const wide = useMediaQuery("(min-width: 1024px)", true, { getInitialValueInEffect: false });
  const medium = useMediaQuery("(min-width: 768px)", true, { getInitialValueInEffect: false });
  return wide ? "wide" : medium ? "medium" : "narrow";
}
