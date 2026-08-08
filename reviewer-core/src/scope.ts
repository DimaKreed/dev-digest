import type { Finding } from '@devdigest/shared';

/**
 * Scope partitioning — the Intent Layer's counterpart to the grounding gate.
 *
 * A finding is DEFERRED (kept, persisted and shown, but excluded from the score,
 * the verdict and the blocker count) only when the reviewer model itself marked
 * it `out_of_scope` against the derived intent. There is deliberately NO prose
 * matching and NO path globbing here: the reviewer is the only model that sees
 * both the intent and the code, so this file reads one boolean and never
 * inspects text. That keeps reviewer-core's "no heuristic filtering" rule intact.
 *
 * Three guards make the filter unable to hide a real defect:
 *  1. CRITICAL is never deferred, whatever the flag says.
 *  2. `category === 'security'` is never deferred, at any severity.
 *  3. `allowDefer: false` defers nothing at all — the caller passes this when
 *     the agent's `ciFailOn === 'warning'`, so intent can never open a red gate.
 */

export interface ScopePartition {
  /** Findings that count: score, verdict, blockers, the main list. */
  active: Finding[];
  /** Findings excluded from every derived number, shown in their own section. */
  deferred: Finding[];
}

export function partitionByScope(
  findings: Finding[],
  opts: { allowDefer: boolean },
): ScopePartition {
  const active: Finding[] = [];
  const deferred: Finding[] = [];

  for (const finding of findings) {
    // `kind` is checked as well as `category`: a secret leak or a lethal-trifecta
    // finding is normally CRITICAL and already caught by the severity guard, but
    // nothing FORCES the model to pair them, and the whole out_of_scope flag is
    // ultimately derived from attacker-authored PR prose. Cheap belt-and-braces.
    const deferrable =
      opts.allowDefer &&
      finding.out_of_scope === true &&
      finding.severity !== 'CRITICAL' &&
      finding.category !== 'security' &&
      finding.kind !== 'secret_leak' &&
      finding.kind !== 'lethal_trifecta';
    if (deferrable) deferred.push(finding);
    else active.push(finding);
  }

  return { active, deferred };
}

/** Human-readable summary for the run trace, e.g. "1 deferred / 4". */
export function scopeSummary(partition: ScopePartition): string {
  const total = partition.active.length + partition.deferred.length;
  return `${partition.deferred.length} deferred / ${total}`;
}
