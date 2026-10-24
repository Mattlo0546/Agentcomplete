"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { uniqBy } from "es-toolkit";
import { useMemo } from "react";
import { toast } from "sonner";

import {
  deleteKnowledge,
  fetchKnowledge,
  fetchKnowledgePage,
  fetchTags,
  knowledgeKeys,
  patchKnowledge,
  type KnowledgeFilters,
  type KnowledgePatch,
} from "./api";

export function useKnowledgeList(filters: KnowledgeFilters) {
  const query = useInfiniteQuery({
    queryKey: knowledgeKeys.list(filters),
    queryFn: ({ pageParam }) => fetchKnowledgePage(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, page) => n + page.items.length, 0);
      return last.items.length > 0 && loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => uniqBy(query.data?.pages.flatMap((p) => p.items) ?? [], (k) => k.id), [query.data]);
  return { ...query, items, total: query.data?.pages[0]?.total ?? 0 };
}

/** Unfiltered total for the `n of total` readout. */
export function useKnowledgeTotal() {
  return useQuery({
    queryKey: knowledgeKeys.total,
    queryFn: () => fetchKnowledgePage({ q: "", kind: "all", tags: [] }, 0).then((p) => p.total),
  });
}

export function useKnowledgeDetail(id: string | null) {
  return useQuery({
    queryKey: knowledgeKeys.detail(id ?? ""),
    queryFn: () => fetchKnowledge(id!),
    enabled: id !== null,
  });
}

export function useTags(q: string, enabled = true) {
  return useQuery({
    queryKey: knowledgeKeys.tags(q),
    queryFn: () => fetchTags(q),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useUpdateKnowledge(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: KnowledgePatch) => patchKnowledge(id, patch),
    onSuccess: (detail) => {
      queryClient.setQueryData(knowledgeKeys.detail(id), detail);
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["tags"] });
      toast.success("Changes saved");
    },
    onError: (error: Error) => toast.error("Couldn't save changes", { description: error.message }),
  });
}

export function useDeleteKnowledge(onDeleted: (id: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteKnowledge(id),
    onSuccess: (_void, id) => {
      queryClient.removeQueries({ queryKey: knowledgeKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
      toast.success("Knowledge deleted");
      onDeleted(id);
    },
    onError: (error: Error) => toast.error("Couldn't delete", { description: error.message }),
  });
}
