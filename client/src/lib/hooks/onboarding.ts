/* hooks/onboarding.ts — React Query hooks for the per-repo Onboarding Tour.

   HTTP surface (onboarding module):
     GET  /repos/:id/onboarding           → the stored tour + how honest it is
     POST /repos/:id/onboarding/generate  → generate (ONE model call) and persist

   Both hang off the one ["onboarding", repoId] key; the mutation invalidates it
   explicitly rather than relying on a prefix sweep, so the banners and the
   staleness comparison refresh from the server rather than from the mutation's
   own return value.

   The two envelopes below are per-REQUEST shapes and are restated here on
   purpose: only the persisted tour is a shared contract, and `@devdigest/shared`
   is type-only on the client — a runtime import of it breaks the Next build. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Onboarding, Provider } from "@devdigest/shared";

/** Why generation is unavailable, or `null` when it is offered. */
export type OnboardingUnavailableReason = "missing_key" | "index_missing" | "flag_off";

/** GET /repos/:id/onboarding. `tour` is null until one has been generated. */
export interface OnboardingPayload {
  tour: Onboarding | null;
  generated_at: string | null;
  /** The repository's head right now — compare with `tour.sha` for staleness. */
  current_sha: string | null;
  availability: {
    can_generate: boolean;
    reason: OnboardingUnavailableReason | null;
    provider: Provider;
  };
}

/** POST /repos/:id/onboarding/generate — the usage block proves the one call. */
export interface OnboardingGenerateResult {
  tour: Onboarding;
  dropped_links: number;
  usage: {
    calls: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number | null;
  };
}

export function useOnboarding(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding", repoId],
    queryFn: () => api.get<OnboardingPayload>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
  });
}

/**
 * Generate or regenerate the tour. Blocking: the request is held open for the
 * whole model call, so the view's in-flight state is what stops a second one
 * being started.
 *
 * Rejects with ApiError 409 `repo_not_indexed` when the repository has no
 * usable import graph, and `repo_intel_disabled` when the layer is switched
 * off — the page states each as its own reason rather than as a generic
 * failure.
 */
export function useGenerateOnboarding(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<OnboardingGenerateResult>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["onboarding", repoId] });
    },
  });
}
