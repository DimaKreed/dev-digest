/**
 * Ring 2 — review the local working tree before it is pushed.
 *
 * This use case owns the SEQUENCE (read git → send the patch → classify the
 * outcome) and nothing else. The review itself belongs to the server, which runs
 * the same engine a pull-request review runs; that is deliberate, and the reason
 * this file contains no prompt, no severity rule and no scoring. A second review
 * implementation living in a CLI would drift from the first one the day either
 * changed.
 *
 * The exit-code contract is decided here and only here — see `ReviewExit`.
 */
import type { DiffReviewBrief } from '../contracts.js';
import type { DevDigestApi } from '../ports.js';
import type { GitClient, GitFailure } from '../ports-git.js';

/**
 * What `--mode` selects. Only `working` is implemented; the others are named so
 * that an unknown mode fails with a list of real options rather than silently
 * reviewing something the caller did not ask for.
 */
export const REVIEW_MODES = ['working', 'staged', 'branch'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

/**
 * Process exit codes. A caller wiring this into a git hook needs these to be
 * stable, so they are enumerated rather than derived at the call site.
 *
 *   0 — reviewed, nothing meets the agent's gate. Safe to push.
 *   1 — reviewed, and blocking findings were reported.
 *   2 — could not review. NOT a verdict about the code: no conclusion about the
 *       change may be drawn from it. Kept apart from 1 for exactly that reason.
 */
export const EXIT_CLEAN = 0;
export const EXIT_BLOCKED = 1;
export const EXIT_ERROR = 2;

export type ReviewExit = typeof EXIT_CLEAN | typeof EXIT_BLOCKED | typeof EXIT_ERROR;

export type ReviewWorkingTreeResult =
  | {
      ok: true;
      review: DiffReviewBrief;
      branch: string | null;
      /** Reported, never reviewed — `git diff HEAD` cannot see these. */
      untracked: string[];
      exit: typeof EXIT_CLEAN | typeof EXIT_BLOCKED;
    }
  | { ok: false; failure: ReviewFailure; exit: typeof EXIT_ERROR };

export type ReviewFailure =
  | { kind: 'git'; failure: GitFailure }
  | { kind: 'unsupported_mode'; mode: string }
  /** Nothing to review. Distinct from a clean review: nothing was examined. */
  | { kind: 'no_changes'; untracked: string[] }
  | { kind: 'api'; message: string };

export interface ReviewWorkingTreeDeps {
  api: DevDigestApi;
  git: GitClient;
}

export interface ReviewWorkingTreeInput {
  cwd: string;
  mode: string;
  agentId?: string | undefined;
}

export async function reviewWorkingTree(
  deps: ReviewWorkingTreeDeps,
  input: ReviewWorkingTreeInput,
): Promise<ReviewWorkingTreeResult> {
  if (input.mode !== 'working') {
    return {
      ok: false,
      failure: { kind: 'unsupported_mode', mode: input.mode },
      exit: EXIT_ERROR,
    };
  }

  const changes = await deps.git.workingTree(input.cwd);
  if (!changes.ok) {
    return { ok: false, failure: { kind: 'git', failure: changes.failure }, exit: EXIT_ERROR };
  }

  // An empty patch is NOT a clean review — nothing was examined. Exiting 0 here
  // would let a hook report "reviewed, all good" over a tree holding only
  // untracked files, which is the case most likely to hide a brand-new secret.
  if (changes.value.patch.trim().length === 0) {
    return {
      ok: false,
      failure: { kind: 'no_changes', untracked: changes.value.untracked },
      exit: EXIT_ERROR,
    };
  }

  const result = await deps.api.reviewDiff({
    patch: changes.value.patch,
    agentId: input.agentId,
    task: changes.value.branch
      ? `Local working tree on branch ${changes.value.branch}, not yet pushed.`
      : 'Local working tree, not yet pushed.',
  });

  if (!result.ok) {
    return {
      ok: false,
      failure: { kind: 'api', message: describeApiFailure(result.failure) },
      exit: EXIT_ERROR,
    };
  }

  // The gate is the server's, applied under the agent's own `ci_fail_on`. This
  // reads the count rather than recomputing it from severities: a second copy of
  // the rule here could disagree with the verdict shown in the web UI.
  return {
    ok: true,
    review: result.value,
    branch: changes.value.branch,
    untracked: changes.value.untracked,
    exit: result.value.blockers > 0 ? EXIT_BLOCKED : EXIT_CLEAN,
  };
}

function describeApiFailure(failure: {
  kind: string;
  baseUrl?: string;
  message?: string;
  timeoutMs?: number;
}): string {
  switch (failure.kind) {
    case 'unreachable':
      return `Cannot reach the DevDigest API at ${failure.baseUrl}. Start it with ./scripts/dev.sh from the repository root.`;
    case 'slow':
      return `The review did not finish within ${Math.round((failure.timeoutMs ?? 0) / 1000)} seconds. The API is running; try a smaller change, or review the pull request in the web app instead.`;
    case 'not_found':
      return failure.message ?? 'No enabled reviewer agent is configured in DevDigest.';
    case 'rate_limited':
      return 'Rate limited by the DevDigest API — reviews are capped at 10 per minute. Wait a moment and try again.';
    case 'bad_response':
      return `The API answered in a shape this CLI does not recognise (${failure.message ?? 'unexpected shape'}). Check that the server and this package are the same version.`;
    default:
      return failure.message ?? 'The review could not be completed.';
  }
}
