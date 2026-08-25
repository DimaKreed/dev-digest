import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { DiffReviewService } from '../src/modules/diff-review/service.js';
import type { DiffReviewAgent } from '../src/modules/diff-review/ports.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';

/**
 * Unit tests for `POST /reviews/diff` — the route the pre-push CLI calls.
 *
 * No `test/helpers/pg.ts` import (hermetic unit lane) and no `vi.mock`: the
 * service takes a narrow deps object, so the agent reads and the provider are
 * substituted at the port seam.
 */

const AGENT: DiffReviewAgent = {
  id: 'agent-1',
  name: 'General Reviewer',
  systemPrompt: 'Review the diff.',
  provider: 'openai',
  model: 'gpt-test',
  strategy: 'single-pass',
  ciFailOn: 'critical',
  enabled: true,
};

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 111..222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '+const token = "sk-live-abc";',
  ' const b = 2;',
].join('\n');

/**
 * Two findings on line 2 — the added line, so both survive the grounding gate.
 * One CRITICAL and one WARNING, which is what makes the gate tests meaningful:
 * at `critical` only the first blocks, at `warning` both do.
 */
const REVIEW_FIXTURE = {
  summary: 'A secret was committed.',
  verdict: 'request_changes',
  score: 40,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret',
      file: 'src/a.ts',
      start_line: 2,
      end_line: 2,
      confidence: 0.9,
      rationale: 'A live key is committed in plaintext.',
      suggestion: 'Read it from the environment.',
    },
    {
      id: 'f2',
      severity: 'WARNING',
      category: 'style',
      title: 'Prefer a named constant',
      file: 'src/a.ts',
      start_line: 2,
      end_line: 2,
      confidence: 0.6,
      rationale: 'The literal is unexplained.',
      suggestion: 'Extract it.',
    },
  ],
};

function service(over: Partial<DiffReviewAgent> = {}, agents: DiffReviewAgent[] = []) {
  const agent = { ...AGENT, ...over };
  const list = agents.length > 0 ? agents : [agent];
  return new DiffReviewService({
    agents: {
      listEnabled: async () => list.filter((a) => a.enabled),
      getById: async (_ws, id) => list.find((a) => a.id === id),
      linkedSkills: async () => [],
    },
    llm: async () => new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
    parseDiff: parseUnifiedDiff,
  });
}

describe('DiffReviewService', () => {
  it('reviews a patch that belongs to no pull request', async () => {
    const res = await service().review('ws-1', { patch: PATCH });

    expect(res.agent_name).toBe('General Reviewer');
    expect(res.files_reviewed).toBe(1);
    expect(res.fail_on).toBe('critical');
    // Score, verdict and blockers all come from the engine's own gate, so they
    // cannot disagree with each other.
    expect(res.score).toBeGreaterThanOrEqual(0);
    expect(res.score).toBeLessThanOrEqual(100);
    expect(['approve', 'comment', 'request_changes']).toContain(res.verdict);
    expect(res.blockers).toBe(
      res.findings.filter((f) => f.severity === 'CRITICAL').length,
    );
  });

  it('rejects a patch the parser reads as no files, rather than approving it', async () => {
    // An "approve, score 100" answer to an unreadable patch is a clean bill of
    // health nobody earned — the one result this route must never return.
    await expect(service().review('ws-1', { patch: 'not a diff at all' })).rejects.toThrow(
      /no file changes/i,
    );
  });

  it('falls back to the first enabled agent when none is named', async () => {
    const res = await service({}, [
      { ...AGENT, id: 'off', name: 'Disabled', enabled: false },
      { ...AGENT, id: 'on', name: 'Enabled One' },
    ]).review('ws-1', { patch: PATCH });

    expect(res.agent_name).toBe('Enabled One');
  });

  it('refuses to run a disabled agent that was named explicitly', async () => {
    await expect(
      service({ enabled: false }).review('ws-1', { patch: PATCH, agentId: 'agent-1' }),
    ).rejects.toThrow(/disabled/i);
  });

  it('reports when no enabled agent exists at all', async () => {
    await expect(
      service({}, [{ ...AGENT, enabled: false }]).review('ws-1', { patch: PATCH }),
    ).rejects.toThrow(/no enabled reviewer/i);
  });

  it('honours the agent gate — a warning gate counts warnings as blockers', async () => {
    const strict = await service({ ciFailOn: 'warning' }).review('ws-1', { patch: PATCH });
    expect(strict.fail_on).toBe('warning');
    expect(strict.blockers).toBe(
      strict.findings.filter((f) => f.severity !== 'SUGGESTION').length,
    );
  });
});

describe('POST /reviews/diff (schema + registration)', () => {
  const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' });

  it('rejects a body with no patch before the handler runs', async () => {
    const app = await buildApp({ config: config() });
    const res = await app.inject({ method: 'POST', url: '/reviews/diff', payload: {} });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('rejects an empty patch string', async () => {
    const app = await buildApp({ config: config() });
    const res = await app.inject({
      method: 'POST',
      url: '/reviews/diff',
      payload: { patch: '' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('is registered — an unknown route would 404 instead of 422', async () => {
    const app = await buildApp({ config: config() });
    const res = await app.inject({ method: 'POST', url: '/reviews/diff', payload: {} });
    expect(res.statusCode).not.toBe(404);
    await app.close();
  });
});
