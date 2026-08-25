import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../src/adapters/mocks.js';
import { getFindings, latestPerAgent } from '../src/usecases/get-findings.js';
import {
  CLEAN_REVIEW,
  CRITICAL_FINDING,
  PULL,
  REPO,
  REVIEW_WITH_FINDINGS,
  SUGGESTION_FINDING,
  pullsFor,
} from './fixtures.js';
import { ReviewBrief } from '../src/contracts.js';

const REPO_NAME = 'acme/payments-api';

function findingsDeps(reviews: unknown[]) {
  return { api: createFakeApi({ repos: [REPO], pulls: pullsFor([PULL]), reviews }) };
}

describe('getFindings — the two empty results are different facts', () => {
  it('says "never run" when no review exists at all', async () => {
    const result = await getFindings(findingsDeps([]), {
      repo: REPO_NAME,
      prNumber: 482,
      limit: 25,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.emptyReason).toBe('never_run');
    expect(result.value.reviews).toEqual([]);
  });

  it('says "clean" when a review ran and reported nothing', async () => {
    const result = await getFindings(findingsDeps([CLEAN_REVIEW]), {
      repo: REPO_NAME,
      prNumber: 482,
      limit: 25,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.emptyReason).toBe('clean');
    expect(result.value.reviews).toHaveLength(1);
  });

  it('says "filtered_out", NOT "clean", when the severity filter hid every finding', async () => {
    // The review found two WARNINGs. Asking for CRITICAL must never be answered
    // with "reported no findings" — that reads as a clean review.
    const warnings = {
      ...REVIEW_WITH_FINDINGS,
      findings: [
        { ...CRITICAL_FINDING, id: 'w-1', severity: 'WARNING' },
        { ...CRITICAL_FINDING, id: 'w-2', severity: 'WARNING' },
      ],
    };

    const result = await getFindings(findingsDeps([warnings]), {
      repo: REPO_NAME,
      prNumber: 482,
      severity: 'CRITICAL',
      limit: 25,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.emptyReason).toBe('filtered_out');
    expect(result.value.totalLive).toBe(2);
    expect(result.value.counts).toEqual({ CRITICAL: 0, WARNING: 2, SUGGESTION: 0 });
  });

  it('reports a review whose findings were all dismissed as clean, but keeps its real verdict', async () => {
    const allDismissed = {
      ...REVIEW_WITH_FINDINGS,
      findings: [
        { ...CRITICAL_FINDING, dismissed_at: '2026-08-13T09:00:00.000Z' },
        { ...SUGGESTION_FINDING, dismissed_at: '2026-08-13T09:00:00.000Z' },
      ],
    };

    const result = await getFindings(findingsDeps([allDismissed]), {
      repo: REPO_NAME,
      prNumber: 482,
      limit: 25,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.emptyReason).toBe('clean');
    // The stored verdict is still request_changes — the caller must be able to
    // report that rather than a hard-coded "approve, score 100".
    expect(result.value.reviews[0]?.verdict).toBe('request_changes');
    expect(result.value.reviews[0]?.score).toBe(65);
  });
});

describe('getFindings — filtering and bounds', () => {
  it('orders findings by severity and excludes dismissed ones', async () => {
    const dismissed = { ...SUGGESTION_FINDING, id: 'f-3', dismissed_at: '2026-08-13T12:00:00.000Z' };
    const review = {
      ...REVIEW_WITH_FINDINGS,
      findings: [SUGGESTION_FINDING, dismissed, CRITICAL_FINDING],
    };

    const result = await getFindings(findingsDeps([review]), {
      repo: REPO_NAME,
      prNumber: 482,
      limit: 25,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings.map((f) => f.id)).toEqual(['f-1', 'f-2']);
  });

  it('reports the true total when the limit truncates the list', async () => {
    const result = await getFindings(findingsDeps([REVIEW_WITH_FINDINGS]), {
      repo: REPO_NAME,
      prNumber: 482,
      limit: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.returned).toBe(1);
    expect(result.value.total).toBe(2);
    expect(result.value.truncated).toBe(true);
  });

  it('does not shrink the severity tally when a limit truncates the rows', async () => {
    // The tally describes the review. If it counted only the printed page it
    // would contradict the "Showing 1 of 2" line in the very same message.
    const result = await getFindings(findingsDeps([REVIEW_WITH_FINDINGS]), {
      repo: REPO_NAME,
      prNumber: 482,
      limit: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(1);
    expect(result.value.counts).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 1 });
  });

  it('keeps the whole-review tally even when the severity filter narrows the rows', async () => {
    const result = await getFindings(findingsDeps([REVIEW_WITH_FINDINGS]), {
      repo: REPO_NAME,
      prNumber: 482,
      severity: 'CRITICAL',
      limit: 25,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(1);
    expect(result.value.counts).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 1 });
  });

  it('filters by severity', async () => {
    const result = await getFindings(findingsDeps([REVIEW_WITH_FINDINGS]), {
      repo: REPO_NAME,
      prNumber: 482,
      severity: 'CRITICAL',
      limit: 25,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings.map((f) => f.id)).toEqual(['f-1']);
  });
});

describe('latestPerAgent', () => {
  it('keeps only the newest review of each agent', () => {
    const older = ReviewBrief.parse({ ...REVIEW_WITH_FINDINGS, id: 'rev-old', created_at: '2026-08-01T00:00:00.000Z' });
    const newer = ReviewBrief.parse(CLEAN_REVIEW);

    expect(latestPerAgent([older, newer]).map((r) => r.id)).toEqual(['rev-2']);
  });

  it('breaks a created_at tie on the review id so the order is total', () => {
    const a = ReviewBrief.parse({ ...REVIEW_WITH_FINDINGS, id: 'rev-a', agent_id: 'agent-a' });
    const b = ReviewBrief.parse({ ...REVIEW_WITH_FINDINGS, id: 'rev-b', agent_id: 'agent-b' });

    // Same timestamp, opposite input orders — the result must not depend on
    // which order the caller happened to hand them over in.
    expect(latestPerAgent([a, b]).map((r) => r.id)).toEqual(['rev-b', 'rev-a']);
    expect(latestPerAgent([b, a]).map((r) => r.id)).toEqual(['rev-b', 'rev-a']);
  });

  it('gives an agentless review its own bucket instead of merging them', () => {
    const one = ReviewBrief.parse({ ...REVIEW_WITH_FINDINGS, id: 'rev-x', agent_id: null });
    const two = ReviewBrief.parse({ ...CLEAN_REVIEW, id: 'rev-y', agent_id: null });

    expect(latestPerAgent([one, two])).toHaveLength(2);
  });
});
