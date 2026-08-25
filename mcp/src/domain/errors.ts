/**
 * Ring 0 — the exact text every failure and every empty result returns.
 *
 * This layer is pure: it performs no I/O, reads no ambient state, and observes
 * no clock. Each function below is a template over its arguments.
 *
 * These strings are the contract, not decoration. They were written to be the
 * caller's only recovery path, so a change here is a behavioural change: the
 * timeout text is what stops a caller from starting a second paid review, and
 * the blast-radius text is what stops an empty answer from being read as
 * "this pull request is harmless". Copy them; do not reword them.
 */

export function unreachable(baseUrl: string): string {
  return `Cannot reach the DevDigest API at ${baseUrl}. Start it by running ./scripts/dev.sh from the repository root, then try again.`;
}

/**
 * Deliberately NOT the `unreachable` text. Telling someone to restart a server
 * that is answering — just slowly — sends them to fix the one thing that is not
 * broken. The pull-request listing route syncs from GitHub inside its handler,
 * so exceeding the per-request budget is an ordinary event on a large repository.
 */
export function apiTooSlow(baseUrl: string, timeoutMs: number): string {
  const seconds = Math.round(timeoutMs / 1000);
  return `The DevDigest API at ${baseUrl} did not answer within ${seconds} seconds. It IS running, so do not restart it — importing or syncing a large repository can take longer than that. Wait a moment and try the same call again.`;
}

export function runTimedOut(runId: string, repo: string, prNumber: number): string {
  return `Timed out after 120 seconds. The review is STILL RUNNING on the server (run_id: ${runId}). Do not run it again — that would start a second review. Wait about a minute, then call devdigest_get_findings with repo "${repo}" and pr_number ${prNumber} to read the result.`;
}

export function runDidNotComplete(runId: string, status: string, error: string): string {
  return `The review run did not complete (run_id: ${runId}, status: ${status}): ${error}. Try a different agent_id from devdigest_list_agents, or check the DevDigest server logs.`;
}

export function unknownAgent(agentId: string): string {
  return `No agent with id "${agentId}" exists in DevDigest. Call devdigest_list_agents to get the valid agent ids.`;
}

export function rateLimited(): string {
  return `DevDigest allows 10 review runs per minute and that limit is currently exhausted. Wait a minute before starting another review. Any review already running is unaffected.`;
}

/**
 * Not in the plan's verbatim set, which only covered "unknown repo or PR" as one
 * message. Saying which of the two was wrong is strictly more actionable, so the
 * repository case gets its own text and the pull-request text stays as written.
 */
export function unknownRepo(repo: string): string {
  return `No repository "${repo}" is imported in DevDigest. Check the spelling of the repository ("owner/name"), or import it in the DevDigest web app first.`;
}

export function unknownPull(repo: string, prNumber: number): string {
  return `No pull request #${prNumber} was found in repository "${repo}". Check the spelling of the repository ("owner/name") and the pull request number, or import the repository in DevDigest first.`;
}

export function noReviewYet(repo: string, prNumber: number): string {
  return `No review has been run for ${repo} #${prNumber} yet, so there are no findings to report. This is not the same as a clean review. Call devdigest_run_agent_on_pr to produce one.`;
}

/**
 * The verdict and score are interpolated rather than hard-coded.
 *
 * The plan's wording ended in a literal "(verdict: approve, score: 100)", which
 * is true only of the case that needs no explaining. A review whose every finding
 * was dismissed also reports nothing, while its stored verdict stays
 * `request_changes` — printing the literal there would state two false facts.
 */
export function reviewFoundNothing(
  agentName: string,
  repo: string,
  prNumber: number,
  verdict: string,
  score: number | null,
): string {
  const scoreText = score == null ? 'n/a' : String(score);
  return `${agentName} reviewed ${repo} #${prNumber} and reported no findings (verdict: ${verdict}, score: ${scoreText}).`;
}

/** Several agents reviewed it and none reported anything — naming one would misattribute. */
export function reviewsFoundNothing(count: number, repo: string, prNumber: number): string {
  return `${count} agents reviewed ${repo} #${prNumber} and none of them reported any findings.`;
}

/**
 * The third empty case, and the one originally missing: findings exist, the
 * caller's own filter hid them. Saying "no findings" here would be read as a
 * clean review, which is the single most damaging thing this tool can say.
 */
export function noFindingAtSeverity(
  repo: string,
  prNumber: number,
  severity: string,
  total: number,
  counts: Record<string, number>,
): string {
  const tally = `CRITICAL ${counts.CRITICAL ?? 0} · WARNING ${counts.WARNING ?? 0} · SUGGESTION ${counts.SUGGESTION ?? 0}`;
  return `No finding at severity ${severity} for ${repo} #${prNumber} — but this review is NOT clean: it has ${total} finding(s) at other severities (${tally}). Drop the severity filter, or ask for one of the levels above, to see them.`;
}

export function findingsTruncated(returned: number, total: number): string {
  return `Showing ${returned} of ${total} findings. To narrow the request, set severity to "CRITICAL", pass a single agent_id, or lower the limit.`;
}

export function listTruncated(returned: number, total: number, noun: string): string {
  return `Showing ${returned} of ${total} ${noun}; ${total - returned} omitted. Raise limit to see more.`;
}

export function neverScanned(repo: string): string {
  return `No conventions have been extracted for "${repo}" yet. Open the repository in the DevDigest web app and run the conventions extractor first.`;
}

/**
 * The three empty blast-radius results, and they are not the same fact.
 *
 * A short or empty answer from a tool with this name reads as a measured verdict
 * of "small impact". That is only true when the code index was complete, so each
 * of these names its own cause and only ONE of them permits the conclusion.
 */
export function blastNotIndexed(
  repo: string,
  prNumber: number,
  status: string,
  reason: string | null,
): string {
  const because = reason ? ` Reason: ${reason}.` : '';
  return `The code index for "${repo}" is ${status} (stale, unavailable, or incomplete), so no blast radius could be computed for #${prNumber}.${because} This is NOT a result meaning "this pull request has no downstream impact" — you must not draw any conclusion about impact, risk, or scope from it. Re-index the repository in the DevDigest web app, then call this tool again.`;
}

export function blastNoSymbols(repo: string, prNumber: number): string {
  return `No analysable code symbols changed in ${repo} #${prNumber}, so there is nothing to trace callers from. This usually means the diff touches only configuration, documentation or data files. It does NOT mean the change is safe — call devdigest_get_findings for the review's own verdict.`;
}

/** The one empty answer that IS a measured result — and it says so. */
export function blastNoCallers(
  repo: string,
  prNumber: number,
  symbolCount: number,
  tally: { notCallable: number; unreferenced: number; unresolved: number },
): string {
  // Only `unreferenced` earns the word "measured". A type was never callable, so
  // its silence measures nothing; an unresolved name IS used somewhere and the
  // import graph merely could not prove where. Collapsing all three into
  // "nothing calls the changed code" is the one sentence that makes a reader
  // stop looking, and it was wrong for 42 of 130 symbols on a real pull request.
  const parts: string[] = [];
  if (tally.unreferenced > 0) {
    parts.push(
      `${tally.unreferenced} have no reference anywhere in the index — for those this is a measured result`,
    );
  }
  if (tally.unresolved > 0) {
    parts.push(
      `${tally.unresolved} ARE referenced but no reference could be tied to the changed declaration, typically a call through an injected port that the calling file does not import — those callers exist and are simply not provable from the import graph`,
    );
  }
  if (tally.notCallable > 0) {
    parts.push(
      `${tally.notCallable} are types or interfaces, which are annotated rather than invoked, so no caller was ever possible`,
    );
  }
  const breakdown = parts.length > 0 ? ` Of them, ${parts.join('; ')}.` : '';
  return `${symbolCount} changed symbol(s) in ${repo} #${prNumber}, and the code index resolved no callers of any of them.${breakdown} Do not read this as "the change is contained" unless every symbol falls in the first group. Callers outside this repository are never visible to the index.`;
}

/**
 * Prefixed to EVERY result, empty or not, when the index was incomplete. A
 * caller list computed from a partial index understates impact by an unknown
 * amount, and a number without that qualifier is read as exact.
 */
export function blastIndexIncomplete(status: string, reason: string | null): string {
  const because = reason ? ` Reason: ${reason}.` : '';
  return `WARNING — the code index was ${status} when this was computed, so the list below is INCOMPLETE by an unknown amount.${because} Treat every count here as a lower bound, never as the full impact.`;
}

export function blastTruncated(
  returned: number,
  total: number,
  callersPerSymbol: number,
): string {
  return `Showing ${returned} of ${total} affected symbols, and at most ${callersPerSymbol} callers each. Raise limit to see more symbols; the counts above are over all of them.`;
}
