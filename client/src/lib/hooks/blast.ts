/* Blast radius for a PR: which symbols changed, who calls them, and the HTTP
   endpoints and scheduled jobs those callers sit behind.

   GET /pulls/:id/blast is a pure read over the already-built code index — no
   model call — so it has no `refetchInterval`: nothing about it settles
   asynchronously, the same reasoning `useSmartDiff` records.

   The prose notes on the prior-PR list DO cost a generation call, so they are a
   separate mutation fired on demand rather than part of the query. */
"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { BlastHistoryNotes, BlastRadiusResponse } from "@devdigest/shared";
import { api } from "../api";

export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}

/**
 * Annotate the prior-PR list, one generation call for the whole list.
 *
 * A mutation rather than a query on purpose: this one costs money, and a query
 * would refire it on window refocus and on remount. The caller decides when —
 * here, the first time the history section is expanded.
 */
export function useBlastHistoryNotes(prId: string | null | undefined) {
  return useMutation({
    mutationFn: () =>
      api.post<BlastHistoryNotes>(`/pulls/${prId}/blast/history-notes`, {}),
  });
}
