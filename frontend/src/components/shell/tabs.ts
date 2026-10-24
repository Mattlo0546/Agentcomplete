import { Activity, Library, PenLine, Settings2, type LucideIcon } from "lucide-react";

export type TabDef = { href: string; label: string; icon: LucideIcon };

export const TABS: TabDef[] = [
  { href: "/refine", label: "Refine", icon: PenLine },
  { href: "/knowledge", label: "Knowledge", icon: Library },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings2 },
];
