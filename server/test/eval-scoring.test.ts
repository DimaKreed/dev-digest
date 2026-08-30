import { describe, it, expect } from 'vitest';
import type { EvalCaseCounts, EvalExpectation, Finding } from '@devdigest/shared';
import {
  aggregateMetrics,
  locationsMatch,
  scoreCase,
} from '../src/modules/eval/scoring.js';
import {
  alertFor,
  groupBatches,
  parseExpectations,
  toSummary,
} from '../src/modules/eval/helpers.js';
import type { EvalCaseRow, EvalRunRow } from '../src/modules/eval/ports.js';

/**
 * The eval scorer (SPEC-04). Hermetic by construction: the module under test
 * imports no provider, no container and no database, which is the AC-06 claim
 * this file exists to keep true.
 */

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded Stripe secret key',
    file: 'src/config.ts',
    start_line: 12,
    end_line: 12,
    rationale: 'sk_live_ literal',
    confidence: 0.9,
    ...over,
  };
}

function expectation(over: Partial<EvalExpectation> = {}): EvalExpectation {
  return { file: 'src/config.ts', start_line: 12, end_line: 12, ...over };
}

describe('locationsMatch', () => {
  it('matches the same file with overlapping ranges', () => {
    expect(
      locationsMatch(
        { file: 'a.ts', start_line: 10, end_line: 20 },
        { file: 'a.ts', start_line: 18, end_line: 30 },
      ),
    ).toBe(true);
  });

  it('does not match across files, however close the lines', () => {
    expect(
      locationsMatch(
        { file: 'a.ts', start_line: 12, end_line: 12 },
        { file: 'b.ts', start_line: 12, end_line: 12 },
      ),
    ).toBe(false);
  });

  it('does not match disjoint ranges in the same file', () => {
    expect(
      locationsMatch(
        { file: 'a.ts', start_line: 10, end_line: 12 },
        { file: 'a.ts', start_line: 40, end_line: 44 },
      ),
    ).toBe(false);
  });

  it('normalises a reversed range instead of dropping it', () => {
    // A model that emits end_line < start_line has still cited those lines;
    // scoring that as a miss would measure field ordering, not detection.
    expect(
      locationsMatch(
        { file: 'a.ts', start_line: 40, end_line: 12 },
        { file: 'a.ts', start_line: 20, end_line: 20 },
      ),
    ).toBe(true);
  });
});

describe('scoreCase — must_find', () => {
  it('counts a hit as tp and passes', () => {
    const r = scoreCase({
      expectationKind: 'must_find',
      expectations: [expectation()],
      findings: [finding()],
      groundedKept: 1,
      groundedTotal: 1,
    });
    expect(r.counts).toMatchObject({ tp: 1, fn: 0, fp: 0, findings: 1 });
    expect(r.pass).toBe(true);
    expect(r.recall).toBe(1);
  });

  it('counts a miss as fn and fails, naming what was missed', () => {
    const r = scoreCase({
      expectationKind: 'must_find',
      expectations: [expectation()],
      findings: [finding({ file: 'src/other.ts' })],
      groundedKept: 1,
      groundedTotal: 1,
    });
    expect(r.counts).toMatchObject({ tp: 0, fn: 1 });
    expect(r.pass).toBe(false);
    expect(r.recall).toBe(0);
    expect(r.missed).toHaveLength(1);
  });

  it('does NOT penalise extra findings a must_find case did not label', () => {
    // A real diff holds more than the one thing somebody accepted a finding
    // for; counting the extras as noise would punish an agent for being right.
    const r = scoreCase({
      expectationKind: 'must_find',
      expectations: [expectation()],
      findings: [finding(), finding({ id: 'f2', file: 'src/api/users.ts', start_line: 45, end_line: 52 })],
      groundedKept: 2,
      groundedTotal: 2,
    });
    expect(r.counts.fp).toBe(0);
    expect(r.precision).toBe(1);
    expect(r.pass).toBe(true);
  });
});

describe('scoreCase — must_not_flag', () => {
  it('counts a finding at the forbidden location as fp and fails', () => {
    const r = scoreCase({
      expectationKind: 'must_not_flag',
      expectations: [expectation({ start_line: 45, end_line: 52, file: 'src/api/users.ts' })],
      findings: [finding({ file: 'src/api/users.ts', start_line: 46, end_line: 46 })],
      groundedKept: 1,
      groundedTotal: 1,
    });
    expect(r.counts).toMatchObject({ fp: 1, tp: 0, fn: 0 });
    expect(r.pass).toBe(false);
    expect(r.precision).toBe(0);
    expect(r.violations).toHaveLength(1);
  });

  it('passes when the agent stayed away from the forbidden location', () => {
    const r = scoreCase({
      expectationKind: 'must_not_flag',
      expectations: [expectation({ file: 'src/api/users.ts', start_line: 45, end_line: 52 })],
      findings: [finding()],
      groundedKept: 1,
      groundedTotal: 1,
    });
    expect(r.pass).toBe(true);
    expect(r.precision).toBe(1);
    // A negative case expects nothing, so recall is vacuously satisfied rather
    // than zero — printing 0% there would read as a total failure.
    expect(r.recall).toBe(1);
  });
});

describe('scoreCase — citation accuracy', () => {
  it('is the share of candidates that survived the grounding gate', () => {
    const r = scoreCase({
      expectationKind: 'must_find',
      expectations: [expectation()],
      findings: [finding()],
      groundedKept: 3,
      groundedTotal: 4,
    });
    expect(r.citationAccuracy).toBe(0.75);
  });

  it('is 1 when the agent produced no candidate at all', () => {
    const r = scoreCase({
      expectationKind: 'must_not_flag',
      expectations: [expectation()],
      findings: [],
      groundedKept: 0,
      groundedTotal: 0,
    });
    expect(r.citationAccuracy).toBe(1);
  });
});

describe('aggregateMetrics', () => {
  const counts = (over: Partial<EvalCaseCounts> = {}): EvalCaseCounts => ({
    tp: 0,
    fn: 0,
    fp: 0,
    findings: 0,
    grounded_kept: 0,
    grounded_total: 0,
    ...over,
  });

  it('micro-averages recall over every expectation, not over cases', () => {
    // 3 of 4 expectations found. A macro average of the two cases would say
    // 0.75 too here only by coincidence — this asserts the weighting.
    const m = aggregateMetrics(
      [counts({ tp: 3, fn: 0 }), counts({ tp: 0, fn: 1 })],
      1,
      2,
    );
    expect(m.recall).toBe(0.75);
  });

  it('derives precision from false positives over all findings', () => {
    const m = aggregateMetrics(
      [counts({ findings: 4, fp: 0 }), counts({ findings: 1, fp: 1 })],
      1,
      2,
    );
    expect(m.precision).toBe(0.8);
  });

  it('answers 1 for an empty set rather than 0 or NaN', () => {
    const m = aggregateMetrics([], 0, 0);
    expect(m).toMatchObject({ recall: 1, precision: 1, citation_accuracy: 1 });
  });
});

// --- batch aggregation -------------------------------------------------------

function caseRow(over: Partial<EvalCaseRow> = {}): EvalCaseRow {
  return {
    id: 'c1',
    workspaceId: 'w1',
    ownerKind: 'agent',
    ownerId: 'a1',
    name: 'stripe-key-leak',
    inputDiff: 'diff',
    inputMeta: null,
    expectedOutput: [expectation()],
    notes: null,
    expectationKind: 'must_find',
    sourceFindingId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function runRow(over: Partial<EvalRunRow> = {}): EvalRunRow {
  return {
    id: 'r1',
    caseId: 'c1',
    ranAt: new Date('2026-01-02T00:00:00Z'),
    actualOutput: { findings: [finding()] },
    pass: true,
    recall: 1,
    precision: 1,
    citationAccuracy: 1,
    durationMs: 1200,
    costUsd: 0.01,
    batchId: 'b1',
    agentVersion: 7,
    systemPrompt: 'You are a security reviewer.',
    model: 'gpt-4.1',
    counts: { tp: 1, fn: 0, fp: 0, findings: 1, grounded_kept: 1, grounded_total: 1 },
    error: null,
    ...over,
  };
}

describe('groupBatches', () => {
  it('aggregates the rows of one batch into one summary', () => {
    const batches = groupBatches(
      [
        { run: runRow(), case: caseRow() },
        {
          run: runRow({
            id: 'r2',
            caseId: 'c2',
            pass: false,
            counts: { tp: 0, fn: 1, fp: 0, findings: 0, grounded_kept: 0, grounded_total: 0 },
          }),
          case: caseRow({ id: 'c2', name: 'ssrf-webhook' }),
        },
      ],
      'a1',
      'Security Reviewer',
    );
    expect(batches).toHaveLength(1);
    const b = batches[0]!;
    expect(b.metrics.recall).toBe(0.5);
    expect(b.metrics.traces_passed).toBe(1);
    expect(b.metrics.traces_total).toBe(2);
    expect(b.agent_version).toBe(7);
    expect(b.cost_usd).toBeCloseTo(0.02);
    expect(b.cases).toHaveLength(2);
  });

  it('excludes an errored case from every metric, and counts it as an error', () => {
    // AC-07: a provider failure is not evidence that the agent got it wrong.
    const batches = groupBatches(
      [
        { run: runRow(), case: caseRow() },
        {
          run: runRow({
            id: 'r2',
            caseId: 'c2',
            pass: null,
            recall: null,
            counts: null,
            costUsd: null,
            error: 'provider timed out',
          }),
          case: caseRow({ id: 'c2' }),
        },
      ],
      'a1',
    );
    const b = batches[0]!;
    expect(b.errors).toBe(1);
    expect(b.metrics.traces_total).toBe(1);
    expect(b.metrics.recall).toBe(1);
    // Cost is withheld entirely rather than under-reported.
    expect(b.cost_usd).toBeNull();
  });

  it('gives a row with no batch_id a batch of its own', () => {
    const batches = groupBatches(
      [{ run: runRow({ batchId: null }), case: caseRow() }],
      'a1',
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]!.batch_id).toBe('r1');
  });

  it('orders batches newest first', () => {
    const batches = groupBatches(
      [
        { run: runRow({ id: 'old', batchId: 'b0', ranAt: new Date('2026-01-01T00:00:00Z') }), case: caseRow() },
        { run: runRow(), case: caseRow() },
      ],
      'a1',
    );
    expect(batches.map((b) => b.batch_id)).toEqual(['b1', 'b0']);
  });
});

describe('alertFor', () => {
  const summaryWith = (recall: number, precision: number, errors = 0) =>
    toSummary(
      groupBatches(
        [
          {
            run: runRow({
              counts: {
                tp: Math.round(recall * 10),
                fn: 10 - Math.round(recall * 10),
                fp: 10 - Math.round(precision * 10),
                findings: 10,
                grounded_kept: 1,
                grounded_total: 1,
              },
            }),
            case: caseRow(),
          },
        ],
        'a1',
      )[0]!,
    );

  it('leads with the metric that regressed', () => {
    const alert = alertFor(summaryWith(0.9, 0.8), summaryWith(0.8, 1.0));
    expect(alert).toContain('Regression');
    expect(alert).toContain('precision down 20pts');
    expect(alert).toContain('recall');
  });

  it('says plainly when nothing moved rather than inventing an observation', () => {
    expect(alertFor(summaryWith(0.8, 0.9), summaryWith(0.8, 0.9))).toBe(
      'No metric moved against the previous run on this set.',
    );
  });

  it('is null when there is nothing to compare against', () => {
    expect(alertFor(summaryWith(0.8, 0.9), null)).toBeNull();
    expect(alertFor(null, null)).toBeNull();
  });
});

describe('parseExpectations', () => {
  it('drops entries that do not parse instead of failing the whole read', () => {
    expect(parseExpectations([expectation(), { file: 'a.ts' }, 'nonsense'])).toHaveLength(1);
  });

  it('treats a non-array jsonb as no expectations', () => {
    expect(parseExpectations(null)).toEqual([]);
    expect(parseExpectations({ file: 'a.ts' })).toEqual([]);
  });
});
