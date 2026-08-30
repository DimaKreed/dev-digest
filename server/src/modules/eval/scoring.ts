import type {
  EvalCaseCounts,
  EvalExpectation,
  EvalExpectationKind,
  EvalMetrics,
  Finding,
} from '@devdigest/shared';

/**
 * The eval scorer (ring 0) — pure, synchronous, and deliberately model-free.
 *
 * SPEC-04 AC-06: no LLM call happens anywhere in scoring. That is not a
 * performance choice, it is what makes two runs comparable at all — a judge
 * model is itself a variable, so a metric that moved could mean the reviewer
 * changed OR the judge did. Here an expectation is a `file:line` and a match is
 * arithmetic, so the only thing that can move a number is the agent under test.
 *
 * This module imports NO provider, NO database and NO container. The single
 * import is the contract types. Keep it that way: the whole point is that the
 * file can be read in one sitting and believed.
 */

/**
 * Do a produced finding and an expectation describe the same place?
 *
 * Same file, and overlapping line ranges. `start`/`end` are normalised because
 * neither side is guaranteed ordered — a model that emits `start_line: 40,
 * end_line: 12` has still cited lines 12–40, and dropping it as a miss would
 * score the model's field ordering rather than its judgement.
 */
export function locationsMatch(
  a: { file: string; start_line: number; end_line: number },
  b: { file: string; start_line: number; end_line: number },
): boolean {
  if (a.file !== b.file) return false;
  const aLo = Math.min(a.start_line, a.end_line);
  const aHi = Math.max(a.start_line, a.end_line);
  const bLo = Math.min(b.start_line, b.end_line);
  const bHi = Math.max(b.start_line, b.end_line);
  return aLo <= bHi && bLo <= aHi;
}

/** What one case's scoring needs. Data in, never a port. */
export interface ScoreCaseInput {
  expectationKind: EvalExpectationKind;
  expectations: EvalExpectation[];
  /** The grounded, in-scope findings the agent produced for this case. */
  findings: Finding[];
  /** From the engine's citation gate: how many candidates survived, of how many. */
  groundedKept: number;
  groundedTotal: number;
}

export interface ScoreCaseResult {
  counts: EvalCaseCounts;
  pass: boolean;
  /** Per-case recall — 1 for a `must_not_flag` case, which expects nothing. */
  recall: number;
  /** Per-case precision — the share of this case's findings that are not noise. */
  precision: number;
  citationAccuracy: number;
  /** The expectations a `must_find` case did NOT match, for the reader. */
  missed: EvalExpectation[];
  /** The findings a `must_not_flag` case should not have produced. */
  violations: Finding[];
}

/**
 * Score ONE case.
 *
 * The two polarities are not symmetric and are not collapsed:
 *
 *  - `must_find` asks whether each expectation was hit. Findings the agent
 *    produced beyond the expectations are NOT counted as false positives here.
 *    A real diff contains more than the one thing that was labelled, and
 *    penalising the extras would make the metric punish an agent for reporting
 *    a second real bug nobody happened to accept a finding for.
 *  - `must_not_flag` asks the opposite question about ONE location, and a
 *    finding landing there is the definition of noise. This is the only thing
 *    in the whole harness that can produce a false positive, which is why
 *    dismissed findings are what move precision.
 */
export function scoreCase(input: ScoreCaseInput): ScoreCaseResult {
  const { expectations, findings } = input;
  const findingsTotal = findings.length;

  let tp = 0;
  let fn = 0;
  let fp = 0;
  const missed: EvalExpectation[] = [];
  const violations: Finding[] = [];

  if (input.expectationKind === 'must_find') {
    for (const e of expectations) {
      if (findings.some((f) => locationsMatch(f, e))) tp += 1;
      else {
        fn += 1;
        missed.push(e);
      }
    }
  } else {
    for (const f of findings) {
      if (expectations.some((e) => locationsMatch(f, e))) {
        fp += 1;
        violations.push(f);
      }
    }
  }

  const counts: EvalCaseCounts = {
    tp,
    fn,
    fp,
    findings: findingsTotal,
    grounded_kept: input.groundedKept,
    grounded_total: input.groundedTotal,
  };

  return {
    counts,
    pass: fn === 0 && fp === 0,
    recall: ratio(tp, tp + fn),
    precision: ratio(findingsTotal - fp, findingsTotal),
    citationAccuracy: ratio(input.groundedKept, input.groundedTotal),
    missed,
    violations,
  };
}

/**
 * Aggregate a batch from its case counts — MICRO-averaged, not a mean of means.
 *
 * A macro average would weight a case with one expectation the same as a case
 * with six, so adding a small case could move recall without the agent changing
 * at all. Summing the counts first makes the batch number mean "of every
 * expectation in the set, this fraction was found", which is the sentence the
 * dashboard claims it is showing.
 *
 * `passed` is passed in separately rather than derived: a case that ERRORED is
 * not a pass and contributes no counts, so it must not silently look like a
 * clean zero (SPEC-04 AC-07).
 */
export function aggregateMetrics(
  counts: EvalCaseCounts[],
  passed: number,
  total: number,
): EvalMetrics {
  const sum = (pick: (c: EvalCaseCounts) => number) =>
    counts.reduce((n, c) => n + pick(c), 0);

  const tp = sum((c) => c.tp);
  const fn = sum((c) => c.fn);
  const fp = sum((c) => c.fp);
  const findings = sum((c) => c.findings);
  const kept = sum((c) => c.grounded_kept);
  const seen = sum((c) => c.grounded_total);

  return {
    recall: ratio(tp, tp + fn),
    precision: ratio(findings - fp, findings),
    citation_accuracy: ratio(kept, seen),
    traces_passed: passed,
    traces_total: total,
  };
}

/**
 * `n / d`, with an empty denominator answering 1 rather than 0 or NaN.
 *
 * "No expectation went unfound" is true of a set with no expectations, and
 * printing 0% there would read as a total failure of an agent that was never
 * asked anything. The three call sites all mean it that way.
 */
function ratio(n: number, d: number): number {
  if (d <= 0) return 1;
  return Math.min(1, Math.max(0, n / d));
}
