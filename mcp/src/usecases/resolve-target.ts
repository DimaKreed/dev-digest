/**
 * Ring 2 — turning what a caller can say into what the API can take.
 *
 * Every tool addresses a pull request the way a person does: "owner/name" plus
 * the number on GitHub. The API addresses everything by UUID. This is the one
 * place that bridges the two, so no other use case ever handles a raw identifier
 * it did not receive from the API.
 */
import type { DevDigestApi } from '../ports.js';
import { fail, fromApiFailure, ok, type UseCaseResult } from './result.js';

export interface ResolveDeps {
  api: DevDigestApi;
}

export interface ResolvedPull {
  repoId: string;
  prId: string;
}

/**
 * `repo` is matched against `full_name`, case-insensitively — a caller writing
 * "Acme/Payments-API" means the same repository as the one GitHub spells
 * differently, and failing that lookup would be a confusing dead end.
 */
export async function resolveRepoId(
  deps: ResolveDeps,
  repo: string,
): Promise<UseCaseResult<string>> {
  const repos = await deps.api.listRepos();
  if (!repos.ok) return fail(fromApiFailure(repos.failure));

  const wanted = repo.trim().toLowerCase();
  const match = repos.value.find(
    (candidate) =>
      candidate.full_name.toLowerCase() === wanted ||
      `${candidate.owner}/${candidate.name}`.toLowerCase() === wanted,
  );

  return match ? ok(match.id) : fail({ kind: 'unknown_repo', repo });
}

export async function resolvePull(
  deps: ResolveDeps,
  repo: string,
  prNumber: number,
): Promise<UseCaseResult<ResolvedPull>> {
  const repoId = await resolveRepoId(deps, repo);
  if (!repoId.ok) return fail(repoId.failure);

  const pulls = await deps.api.listPulls(repoId.value);
  if (!pulls.ok) return fail(fromApiFailure(pulls.failure));

  const match = pulls.value.find((pull) => pull.number === prNumber);
  // A pull request listed straight from GitHub before import has no local id, and
  // nothing can be run against it — the caller needs the same advice either way.
  if (!match || !match.id) return fail({ kind: 'unknown_pull', repo, prNumber });

  return ok({ repoId: repoId.value, prId: match.id });
}
