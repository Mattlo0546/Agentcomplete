"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { KindIcon, KIND_LABELS } from "@/components/common/kind-icon";
import { PageLayout, type InspectorProps } from "@/components/shell/page-layout";
import { useLayoutMode } from "@/components/shell/use-layout-mode";
import { Button } from "@/components/ui/button";
import type { KnowledgeFilters } from "@/lib/knowledge/api";
import {
  useDeleteKnowledge,
  useKnowledgeDetail,
  useKnowledgeList,
  useKnowledgeTotal,
} from "@/lib/knowledge/use-knowledge";

import { AddKnowledgeDialog } from "./add-knowledge-dialog";
import { DeleteKnowledgeDialog } from "./delete-knowledge-dialog";
import { KnowledgeDetail } from "./knowledge-detail";
import { KnowledgeList } from "./knowledge-list";
import { KnowledgeToolbar } from "./knowledge-toolbar";

const NO_FILTERS: KnowledgeFilters = { q: "", kind: "all", tags: [] };

export function KnowledgeView() {
  const narrow = useLayoutMode() === "narrow";
  const [filters, setFilters] = useState<KnowledgeFilters>(NO_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const list = useKnowledgeList(filters);
  const total = useKnowledgeTotal();
  const detail = useKnowledgeDetail(selectedId);
  const remove = useDeleteKnowledge(() => {
    setDeleteOpen(false);
    setSelectedId(null);
    setInspectorOpen(false);
    setEditing(false);
  });

  const select = (id: string) => {
    if (id !== selectedId) setEditing(false);
    setSelectedId(id);
    setInspectorOpen(true);
  };
  const item = detail.data;
  const summary = list.items.find((k) => k.id === selectedId);
  const kind = item?.kind ?? summary?.kind;

  const inspector: InspectorProps = {
    label: "Knowledge detail",
    open: inspectorOpen && selectedId !== null,
    onOpenChange: setInspectorOpen,
    title: kind ? (
      <>
        <KindIcon kind={kind} className="size-4 text-muted-foreground" />
        {KIND_LABELS[kind]}
      </>
    ) : (
      "Details"
    ),
    actions: selectedId && (
      <>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit"
          aria-pressed={editing}
          disabled={!item}
          onClick={() => setEditing((e) => !e)}
        >
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Delete" disabled={!item} onClick={() => setDeleteOpen(true)}>
          <Trash2 />
        </Button>
      </>
    ),
    content: selectedId ? (
      <KnowledgeDetail
        item={item}
        loading={detail.isPending}
        error={detail.isError}
        onRetry={() => void detail.refetch()}
        editing={editing}
        onEditDone={() => setEditing(false)}
      />
    ) : (
      <p className="text-label">Select an item</p>
    ),
  };

  const filtered = filters.q !== "" || filters.kind !== "all" || filters.tags.length > 0;

  return (
    <>
      <PageLayout title="Knowledge" inspector={inspector} bodyClassName="overflow-hidden">
        <KnowledgeToolbar
          filters={filters}
          onFiltersChange={setFilters}
          narrow={narrow}
          shown={list.total}
          total={total.data}
          onAdd={() => setAddOpen(true)}
        />
        <KnowledgeList
          items={list.items}
          narrow={narrow}
          selectedId={selectedId}
          onSelect={select}
          loading={list.isPending}
          error={list.isError}
          hasNextPage={list.hasNextPage}
          fetchNextPage={() => void (!list.isFetchingNextPage && list.fetchNextPage())}
          onRetry={() => void list.refetch()}
          filtered={filtered}
          onAdd={() => setAddOpen(true)}
          onClearFilters={() => setFilters(NO_FILTERS)}
        />
      </PageLayout>
      <AddKnowledgeDialog open={addOpen} onOpenChange={setAddOpen} onAdded={select} />
      <DeleteKnowledgeDialog
        open={deleteOpen}
        title={item?.title ?? null}
        pending={remove.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() => selectedId && remove.mutate(selectedId)}
      />
    </>
  );
}
