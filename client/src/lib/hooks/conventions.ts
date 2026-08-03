/* hooks/conventions.ts — React Query hooks for the repo Conventions page.

   HTTP surface (conventions module):
     POST /repos/:id/conventions/extract      → run the extractor over the clone
     GET  /repos/:id/conventions              → the stored candidates + scorecard
     PATCH /conventions/:id                   → triage / edit one candidate
     POST /repos/:id/conventions/skill-draft  → merged markdown, written NOWHERE
     POST /repos/:id/conventions/link-skill   → attach a saved skill to candidates
     GET  /repos/:id/conventions/plugin       → a .devdigest-plugin bundle

   Everything hangs off the one ["conventions", repoId] key; mutations invalidate
   it explicitly rather than relying on a prefix sweep. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionStatus,
  ExtractionStats,
  PluginBundle,
  SkillDraft,
} from "@devdigest/shared";
import type { CreateSkillInput } from "./skills";

/** GET /repos/:id/conventions. `stats`/`last_scan_at` are null before any scan. */
export interface ConventionsPayload {
  candidates: ConventionCandidate[];
  last_scan_at: string | null;
  stats: ExtractionStats | null;
}

/** POST /repos/:id/conventions/extract — the scorecard is always present here. */
export interface ExtractionResult {
  candidates: ConventionCandidate[];
  stats: ExtractionStats;
}

/**
 * POST /skills body for a convention-derived skill. `evidence_files` is not on
 * `CreateSkillInput` yet, so widen locally rather than editing hooks/skills.ts.
 */
export type ConventionSkillInput = CreateSkillInput & { evidence_files: string[] };

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionsPayload>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/**
 * Run the extractor. Rejects with ApiError 409 `repo_not_indexed` when the repo
 * has never been indexed — the page shows that as its own message, not as a
 * generic failure.
 */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ExtractionResult>(`/repos/${repoId}/conventions/extract`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export interface UpdateConventionInput {
  id: string;
  patch: {
    status?: ConventionStatus;
    rule?: string;
    category?: ConventionCategory;
  };
}

export function useUpdateConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

/**
 * Render the markdown the accepted candidates would become. The server writes
 * nothing — saving is a separate POST /skills once the user has edited it, so
 * there is deliberately no cache invalidation here.
 */
export function useConventionSkillDraft(repoId: string | null | undefined) {
  return useMutation({
    mutationFn: (conventionIds: string[]) =>
      api.post<SkillDraft>(`/repos/${repoId}/conventions/skill-draft`, {
        convention_ids: conventionIds,
      }),
  });
}

/** Attach a saved skill to the candidates it was merged from (sets skill_id). */
export function useLinkConventionSkill(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, conventionIds }: { skillId: string; conventionIds: string[] }) =>
      api.post<{ linked: number }>(`/repos/${repoId}/conventions/link-skill`, {
        skill_id: skillId,
        convention_ids: conventionIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

/** Package the accepted conventions as a Claude Code plugin bundle (read-only). */
export function useConventionsPlugin(repoId: string | null | undefined) {
  return useMutation({
    mutationFn: () => api.get<PluginBundle>(`/repos/${repoId}/conventions/plugin`),
  });
}
