import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { latestLiveFindings } from '../src/modules/smart-diff/helpers.js';
import { rollupSeverities } from '../src/modules/pulls/status.js';

/**
 * Spec-first unit tests for W3 (the restated "last review" formula) and the
 * schema-first 422 path of W2, from `.devdigest/cache/plans/smart-diff.md`.
 *
 * No `test/helpers/pg.ts` import here on purpose — this file must pass in the
 * hermetic unit lane (`vitest run --exclude '**\/*.it.test.ts'`, W5.2).
 * No `vi.mock` anywhere (W5.5 / onion § Test seams): the route is driven through
 * `buildApp()` + `app.inject()` and the helper is pure, so nothing needs faking.
 */

/**
 * The structural row shape `SmartDiffReads.reviewsForPull` returns (plan W2).
 * `severity` and `acceptedAt` are extra fields the port does not name; they are
 * here because W3.3 and W3.5 need them, and structural typing tolerates them.
 */
interface Row {
  review: { id: string; agentId: string | null; createdAt: Date };
  findings: {
    file: string;
    startLine: number;
    dismissedAt: Date | null;
    acceptedAt?: Date | null;
    severity?: string;
  }[];
}

const AGENT_A = '11111111-1111-4111-8111-111111111111';
const at = (iso: string) => new Date(iso);

function row(
  id: string,
  agentId: string | null,
  createdAt: string,
  findings: Row['findings'],
): Row {
  return { review: { id, agentId, createdAt: at(createdAt) }, findings };
}

/**
 * An INDEPENDENT restatement of the house formula, from root
 * `insights.md:47-62` — newest review per `agent_id`, a null agent in its own
 * bucket, dismissed findings excluded. Written from the insight, not from the
 * implementation under test, so W3.5 compares two derivations rather than one.
 */
function referenceLiveFindings(rows: Row[]) {
  const newestFirst = [...rows].sort(
    (a, b) => b.review.createdAt.getTime() - a.review.createdAt.getTime(),
  );
  const seen = new Set<string>();
  const kept: Row[] = [];
  for (const r of newestFirst) {
    const key = r.review.agentId ?? `review:${r.review.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(r);
  }
  return kept.flatMap((r) => r.findings.filter((f) => f.dismissedAt == null));
}

const sorted = (refs: { file: string; start_line: number }[]) =>
  [...refs].sort((a, b) => a.file.localeCompare(b.file) || a.start_line - b.start_line);

describe('latestLiveFindings (W3)', () => {
  it('keeps only the newer review when two runs share an agent_id (W3.1)', () => {
    const rows = [
      row('r-old', AGENT_A, '2026-08-01T00:00:00Z', [
        { file: 'src/service.ts', startLine: 42, dismissedAt: null },
      ]),
      row('r-new', AGENT_A, '2026-08-02T00:00:00Z', [
        { file: 'src/service.ts', startLine: 11, dismissedAt: null },
      ]),
    ];
    expect(sorted(latestLiveFindings(rows))).toEqual([{ file: 'src/service.ts', start_line: 11 }]);
  });

  it('gives each null-agent review its own bucket, so both contribute (W3.2)', () => {
    const rows = [
      row('r-adhoc-1', null, '2026-08-01T00:00:00Z', [
        { file: 'src/a.ts', startLine: 1, dismissedAt: null },
      ]),
      row('r-adhoc-2', null, '2026-08-02T00:00:00Z', [
        { file: 'src/b.ts', startLine: 2, dismissedAt: null },
      ]),
    ];
    expect(sorted(latestLiveFindings(rows))).toEqual([
      { file: 'src/a.ts', start_line: 1 },
      { file: 'src/b.ts', start_line: 2 },
    ]);
  });

  it('drops a dismissed finding and keeps an accepted one (W3.3)', () => {
    const rows = [
      row('r1', AGENT_A, '2026-08-02T00:00:00Z', [
        { file: 'src/service.ts', startLine: 11, dismissedAt: null, acceptedAt: at('2026-08-03T00:00:00Z') },
        { file: 'src/service.ts', startLine: 99, dismissedAt: at('2026-08-03T00:00:00Z') },
      ]),
    ];
    const out = latestLiveFindings(rows);
    expect(out).toContainEqual({ file: 'src/service.ts', start_line: 11 });
    expect(out).not.toContainEqual({ file: 'src/service.ts', start_line: 99 });
  });

  it('is order-independent — the same rows shuffled yield identical output (W3.4)', () => {
    const rows = [
      row('r-old', AGENT_A, '2026-08-01T00:00:00Z', [
        { file: 'src/service.ts', startLine: 42, dismissedAt: null },
      ]),
      row('r-new', AGENT_A, '2026-08-02T00:00:00Z', [
        { file: 'src/service.ts', startLine: 11, dismissedAt: null },
      ]),
      row('r-adhoc', null, '2026-07-30T00:00:00Z', [
        { file: 'src/a.ts', startLine: 3, dismissedAt: null },
        { file: 'src/a.ts', startLine: 4, dismissedAt: at('2026-08-04T00:00:00Z') },
      ]),
    ];
    expect(latestLiveFindings([...rows].reverse())).toEqual(latestLiveFindings(rows));
  });

  it('agrees with the header-chip tally on the same data (W3.5)', () => {
    const rows = [
      row('r-old', AGENT_A, '2026-08-01T00:00:00Z', [
        { file: 'src/service.ts', startLine: 42, dismissedAt: null, severity: 'CRITICAL' },
      ]),
      row('r-new', AGENT_A, '2026-08-02T00:00:00Z', [
        { file: 'src/service.ts', startLine: 11, dismissedAt: null, severity: 'CRITICAL' },
        { file: 'src/service.ts', startLine: 12, dismissedAt: null, severity: 'WARNING' },
        { file: 'src/service.ts', startLine: 99, dismissedAt: at('2026-08-03T00:00:00Z'), severity: 'WARNING' },
      ]),
      row('r-adhoc', null, '2026-07-30T00:00:00Z', [
        { file: 'src/a.ts', startLine: 3, dismissedAt: null, severity: 'SUGGESTION' },
      ]),
    ];
    // The server-side house formula (`rollupSeverities`) applied to the same
    // latest-live set the reference derivation selects.
    const live = referenceLiveFindings(rows).map((f) => ({ severity: f.severity ?? '' }));
    const chips = rollupSeverities(live);
    const total = chips.critical + chips.warning + chips.suggestion;

    expect(total).toBe(3);
    expect(latestLiveFindings(rows)).toHaveLength(total);
  });
});

describe('GET /pulls/:id/smart-diff — schema-first edge (W2.3, W4)', () => {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

  it('rejects a non-uuid :id with 422 before the handler runs (W2.3)', async () => {
    // No `db` is passed: postgres-js connects lazily, so if the handler were
    // reached this would fail loudly rather than returning a clean 422.
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/smart-diff' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });

  it('has the route registered in the static module registry (W4)', async () => {
    // A route that is not registered never reaches param validation — Fastify
    // answers 404 route-not-found. So a 422 here is the registration proof.
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/pulls/still-not-a-uuid/smart-diff' });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
