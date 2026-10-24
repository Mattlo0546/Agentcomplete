import { FileText, MessageSquareQuote, Workflow, type LucideProps } from "lucide-react";

import type { KnowledgeKind } from "@/lib/api/types";

const ICONS = { skill: FileText, prompt: MessageSquareQuote, graph: Workflow } as const;
export const KIND_LABELS: Record<KnowledgeKind, string> = { skill: "Skill", prompt: "Prompt", graph: "Graph" };

export function KindIcon({ kind, ...props }: { kind: KnowledgeKind } & LucideProps) {
  const Icon = ICONS[kind];
  return <Icon aria-label={KIND_LABELS[kind]} {...props} />;
}
