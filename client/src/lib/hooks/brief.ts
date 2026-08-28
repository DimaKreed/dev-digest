/* hooks/brief.ts — React Query hooks for the per-PR merge-risk brief.

   HTTP surface (brief module):
     GET  /pulls/:id/brief           → the stored brief, its staleness, availability
     POST /pulls/:id/brief/generate  → generate (ONE model call) and persist

   Both hang off the one ["brief", prId] key; the mutation invalidates that
   exact key rather than relying on a prefix sweep, so the stale badge and the
   usage line refresh from the server rather than from the mutation's own
   return value.

   The two envelopes below are per-REQUEST shapes and are restated here on
   purpose: only the persisted brief is a shared contract, and `@devdigest/shared`
   is type-only on the client — a runtime import of it breaks the Next build. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BriefSource, PrBrief, Provider } from "@devdigest/shared";

/** Why generation is unavailable, or `null` when it is offered. */
export type BriefUnavailableReason = "missing_key";

/**
 * Whether this workspace can pay for a generation at all, decided server-side.
 *
 * Named as its own type because the CARD consumes it, not just the page: AC-24
 * requires the reader to be told a model key is required instead of being shown
 * a live control that can only answer 503.
 */
export interface BriefAvailability {
  can_generate: boolean;
  reason: BriefUnavailableReason | null;
  provider: Provider;
  model: string;
}

/** GET /pulls/:id/brief. `brief` is null until one has been generated. */
export interface BriefPayload {
  brief: PrBrief | null;
  generated_at: string | null;
  /** The pull request's head right now. Informational — see `stale`. */
  current_sha: string;
  /** Computed server-side (AC-16). The client compares no sha and no model. */
  stale: boolean;
  availability: BriefAvailability;
}

/** POST /pulls/:id/brief/generate — the usage block proves the one call. */
export interface BriefGenerateResult {
  brief: PrBrief;
  dropped_entries: number;
  degraded_sources: BriefSource[];
  usage: {
    calls: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number | null;
  };
}

export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["brief", prId],
    queryFn: () => api.get<BriefPayload>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/**
 * Generate or regenerate the brief. A MUTATION, never a query: this one costs
 * money, and a query would refire it on window refocus and on remount. The
 * caller decides when — here, only an explicit click on the generate or
 * regenerate control.
 *
 * Blocking: the request is held open for the whole model call, so the view's
 * in-flight state is what stops a second one being started. The server refuses
 * a concurrent second generation with a 409 `brief_in_flight` regardless.
 *
 * Rejects with ApiError 503 `missing_model_key` when no provider key is
 * configured — the card states that as its own reason rather than as a generic
 * failure.
 */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<BriefGenerateResult>(`/pulls/${prId}/brief/generate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brief", prId] });
    },
  });
}
