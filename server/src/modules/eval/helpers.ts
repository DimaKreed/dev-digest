import type {
  EvalBatch,
  EvalBatchSummary,
  EvalCaseCounts,
  EvalCaseRecord,
  EvalCaseRun,
  EvalExpectation,
  EvalTrendPoint,
  Finding,
} from '@devdigest/shared';
import {
  EvalCaseCounts as EvalCaseCountsSchema,
  EvalExpectation as EvalExpectationSchema,
  Finding as FindingSchema,
} from '@devdigest/shared';

import type { ActiveBatch, EvalCaseRow, EvalRunRow } from './ports.js';
import { aggregateMetrics } from './scoring.js';
import { EVAL_ALERT_EPSILON } from './constants.js';

/**
 * Pure mapping and aggregation for the eval module (ring 0).
 *
 * Every jsonb column this module reads is UNVALIDATED at the database edge, so
 * each one is parsed through its contract here rather than cast. A row written
 * by an older shape must degrade to "empty" instead of crashing a list request
 * — the eval tables shipped in `0000_init` and could hold anything.
 */

/** `expected_output` jsonb → expectations, dropping anything that does not parse. */
export function parseExpectations(raw: unknown): EvalExpectation[] {
  if (!Array.isArray(raw)) return [];
  const out: EvalExpectation[] = [];
  for (const item of raw) {
    const parsed = EvalExpectationSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** `actual_output.<key>` jsonb → findings, dropping anything that does not parse. */
export function parseFindings(raw: unknown, key: 'findings' | 'violations' = 'findings'): Finding[] {
  const list = (raw as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(list)) return [];
  const out: Finding[] = [];
  for (const item of list) {
    const parsed = FindingSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** `actual_output.missed` jsonb → the expectations no finding matched. */
export function parseMissed(raw: unknown): EvalExpectation[] {
  return parseExpectations((raw as { missed?: unknown } | null)?.missed);
}

/** `counts` jsonb → the scoring counts, or null when the row carries none. */
export function parseCounts(raw: unknown): EvalCaseCounts | null {
  const parsed = EvalCaseCountsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A case row plus its newest run → the API record. */
export function toCaseDto(row: EvalCaseRow, latest?: EvalRunRow): EvalCaseRecord {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    expectation_kind: row.expectationKind,
    input_diff: row.inputDiff ?? '',
    input_meta: row.inputMeta ?? null,
    expected_output: parseExpectations(row.expectedOutput),
    notes: row.notes,
    source_finding_id: row.sourceFindingId,
    created_at: row.createdAt.toISOString(),
    // The WHOLE newest run, not a summary of it: the case editor shows expected
    // and actual side by side, and a count alone cannot answer "what did it say
    // instead?" — which is the only question a failing case raises.
    last_run: latest ? toCaseRunDto(latest, row) : null,
  };
}

/** One `eval_runs` row, joined to its case, as the batch detail lists it. */
export function toCaseRunDto(run: EvalRunRow, row: EvalCaseRow): EvalCaseRun {
  return {
    id: run.id,
    case_id: run.caseId,
    case_name: row.name,
    expectation_kind: row.expectationKind,
    ran_at: run.ranAt.toISOString(),
    pass: run.pass,
    recall: run.recall,
    precision: run.precision,
    citation_accuracy: run.citationAccuracy,
    duration_ms: run.durationMs,
    cost_usd: run.costUsd,
    counts: parseCounts(run.counts),
    findings: parseFindings(run.actualOutput),
    missed: parseMissed(run.actualOutput),
    violations: parseFindings(run.actualOutput, 'violations'),
    error: run.error,
  };
}

/**
 * The batch a run is answered with before any case has finished.
 *
 * Its metrics come from `aggregateMetrics` over nothing rather than from a
 * literal of zeroes, so "not measured yet" is produced by the same function
 * that produces every real measurement and cannot drift from it. `status` and
 * `cases_done: 0` are what tell a reader those zeroes are not a score.
 */
export function pendingBatch(batchId: string, active: ActiveBatch): EvalBatch {
  return {
    batch_id: batchId,
    status: 'running',
    cases_total: active.total,
    cases_done: 0,
    agent_id: active.agentId,
    agent_name: active.agentName,
    agent_version: active.agentVersion,
    system_prompt: active.systemPrompt,
    model: active.model,
    ran_at: active.startedAt,
    metrics: aggregateMetrics([], 0, 0),
    cost_usd: null,
    duration_ms: null,
    errors: 0,
    cases: [],
  };
}

/**
 * Group per-case rows into batches and aggregate each one.
 *
 * The batch numbers are recomputed from the stored `counts` on every read
 * rather than persisted alongside them. There is exactly one definition of
 * `recall` in this codebase (`aggregateMetrics`), so a batch summary cannot
 * drift from the rows it summarises — the failure mode a materialised
 * `eval_batches` table would have introduced.
 *
 * Rows with no `batch_id` are single-case runs; each becomes its own batch
 * keyed by the row id, so the history is complete rather than quietly missing
 * the runs someone triggered from a single case.
 */
export function groupBatches(
  rows: { run: EvalRunRow; case: EvalCaseRow }[],
  agentId: string,
  agentName?: string,
): EvalBatch[] {
  const byBatch = new Map<string, { run: EvalRunRow; case: EvalCaseRow }[]>();
  for (const r of rows) {
    const key = r.run.batchId ?? r.run.id;
    const bucket = byBatch.get(key);
    if (bucket) bucket.push(r);
    else byBatch.set(key, [r]);
  }

  const batches: EvalBatch[] = [];
  for (const [batchId, members] of byBatch) {
    const first = members[0]!;
    // A case that errored contributes no counts anywhere (AC-07) — not a zero,
    // which would drag every metric down as if the agent had answered wrongly.
    const scored = members.filter((m) => m.run.error == null);
    const counts = scored.map((m) => parseCounts(m.run.counts)).filter(isCounts);
    const passed = scored.filter((m) => m.run.pass === true).length;
    const errors = members.length - scored.length;

    // A batch's cost is null when ANY case failed to report one: summing the
    // rest would print a number smaller than what was actually spent, which is
    // worse than printing nothing.
    const costs = members.map((m) => m.run.costUsd);
    const costUsd = costs.some((c) => c == null)
      ? null
      : costs.reduce<number>((n, c) => n + (c ?? 0), 0);

    batches.push({
      batch_id: batchId,
      // Anything read back out of the DB is finished by definition: a batch
      // only exists as `running` in the memory of the process executing it, and
      // `getBatch` is the one reader that overlays that. Rows are all there is
      // here, so done/total/done is the only honest triple.
      status: 'done',
      cases_total: members.length,
      cases_done: members.length,
      agent_id: agentId,
      ...(agentName !== undefined ? { agent_name: agentName } : {}),
      agent_version: first.run.agentVersion,
      system_prompt: first.run.systemPrompt,
      model: first.run.model,
      // The batch's time is its NEWEST row. Cases run several at a time and
      // land out of order, so no single row is "the batch" — but the last one
      // to land is when the batch finished, which is what a history reads as.
      ran_at: new Date(
        Math.max(...members.map((m) => m.run.ranAt.getTime())),
      ).toISOString(),
      metrics: aggregateMetrics(counts, passed, scored.length),
      cost_usd: costUsd,
      duration_ms: members.reduce((n, m) => n + (m.run.durationMs ?? 0), 0),
      errors,
      cases: members.map((m) => toCaseRunDto(m.run, m.case)),
    });
  }

  // Newest first — the order every history table and "latest" read assumes.
  batches.sort((a, b) => b.ran_at.localeCompare(a.ran_at));
  return batches;
}

function isCounts(c: EvalCaseCounts | null): c is EvalCaseCounts {
  return c !== null;
}

/** Drop the per-case rows — what the history table and dashboards carry. */
export function toSummary(batch: EvalBatch): EvalBatchSummary {
  const { cases: _cases, ...summary } = batch;
  return summary;
}

/** A batch summary → one point on the trend chart. */
export function toTrendPoint(batch: EvalBatchSummary): EvalTrendPoint {
  const { metrics } = batch;
  return {
    ran_at: batch.ran_at,
    recall: metrics.recall,
    precision: metrics.precision,
    citation_accuracy: metrics.citation_accuracy,
    pass_rate:
      metrics.traces_total > 0 ? metrics.traces_passed / metrics.traces_total : 0,
    cost_usd: batch.cost_usd,
  };
}

/** Signed change from `previous` to `latest`. Zeroes when there is no previous. */
export function deltaBetween(
  latest: EvalBatchSummary | null,
  previous: EvalBatchSummary | null,
): { recall: number; precision: number; citation_accuracy: number } {
  if (!latest || !previous) return { recall: 0, precision: 0, citation_accuracy: 0 };
  return {
    recall: latest.metrics.recall - previous.metrics.recall,
    precision: latest.metrics.precision - previous.metrics.precision,
    citation_accuracy: latest.metrics.citation_accuracy - previous.metrics.citation_accuracy,
  };
}

/**
 * The dashboard's one-line note about the newest batch.
 *
 * Written in code from the deltas that are shown right beside it, so it can
 * never claim something the numbers contradict. It reports the metric that
 * REGRESSED first, because that is the one a person is about to miss; a batch
 * where nothing moved says so rather than inventing an observation.
 */
export function alertFor(
  latest: EvalBatchSummary | null,
  previous: EvalBatchSummary | null,
): string | null {
  if (!latest) return null;
  if (latest.errors > 0) {
    return `${latest.errors} of ${latest.errors + latest.metrics.traces_total} case(s) failed to run and are excluded from every metric.`;
  }
  if (!previous) return null;

  const d = deltaBetween(latest, previous);
  const drops: string[] = [];
  const gains: string[] = [];
  const note = (label: string, value: number) => {
    if (value <= -EVAL_ALERT_EPSILON) drops.push(`${label} ${points(value)}`);
    else if (value >= EVAL_ALERT_EPSILON) gains.push(`${label} ${points(value)}`);
  };
  note('recall', d.recall);
  note('precision', d.precision);
  note('citation', d.citation_accuracy);

  if (drops.length === 0 && gains.length === 0) {
    return 'No metric moved against the previous run on this set.';
  }
  if (drops.length === 0) return `Improved: ${gains.join(', ')}.`;
  const tail = gains.length > 0 ? ` ${gains.join(', ')} improved.` : '';
  return `Regression: ${drops.join(', ')}.${tail}`;
}

/** `-0.02` → `down 2pts`. Points, not percent, because these are deltas of a rate. */
function points(v: number): string {
  const pts = Math.round(Math.abs(v) * 100);
  return `${v < 0 ? 'down' : 'up'} ${pts}pt${pts === 1 ? '' : 's'}`;
}
