/**
 * Ring 2 — the house rules DevDigest mined from a repository's own code.
 *
 * Reads an existing scan; it never starts one. Starting a scan costs a model call
 * and takes minutes, so a read-only tool that silently triggered one would be a
 * trap rather than a convenience.
 */
import type { ConventionBrief } from '../contracts.js';
import type { DevDigestApi } from '../ports.js';
import { resolveRepoId, type ResolveDeps } from './resolve-target.js';
import { fail, fromApiFailure, ok, type UseCaseResult } from './result.js';

export interface GetConventionsDeps extends ResolveDeps {
  api: DevDigestApi;
}

export interface GetConventionsInput {
  repo: string;
  status?: string;
  category?: string;
  limit: number;
}

export interface GetConventionsOutput {
  conventions: ConventionBrief[];
  lastScanAt: string | null;
  returned: number;
  total: number;
  truncated: boolean;
  /** True when the repository has never been scanned at all — not the same as a scan that found nothing. */
  neverScanned: boolean;
}

export async function getConventions(
  deps: GetConventionsDeps,
  input: GetConventionsInput,
): Promise<UseCaseResult<GetConventionsOutput>> {
  const repoId = await resolveRepoId(deps, input.repo);
  if (!repoId.ok) return fail(repoId.failure);

  const result = await deps.api.listConventions(repoId.value);
  if (!result.ok) return fail(fromApiFailure(result.failure));

  const { candidates, last_scan_at } = result.value;
  const lastScanAt = last_scan_at ?? null;

  const matching = candidates.filter(
    (candidate) =>
      (input.status === undefined || candidate.status === input.status) &&
      (input.category === undefined || candidate.category === input.category),
  );

  // Highest confidence first: a caller that reads only the head of the list
  // should be reading the rules the extractor was most sure about.
  const ranked = [...matching].sort((a, b) => b.confidence - a.confidence || a.rule.localeCompare(b.rule));
  const shown = ranked.slice(0, input.limit);

  return ok({
    conventions: shown,
    lastScanAt,
    returned: shown.length,
    total: ranked.length,
    truncated: shown.length < ranked.length,
    neverScanned: lastScanAt === null && candidates.length === 0,
  });
}
