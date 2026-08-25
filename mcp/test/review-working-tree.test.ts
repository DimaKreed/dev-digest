import { describe, expect, it } from 'vitest';
import { createFakeApi, createFakeGit } from '../src/adapters/mocks.js';
import type { DiffReviewBrief, FindingBrief } from '../src/contracts.js';
import { formatReview, sortFindings } from '../src/domain/cli-format.js';
import { failureMessage, parseArgs } from '../src/cli.js';
import {
  EXIT_BLOCKED,
  EXIT_CLEAN,
  EXIT_ERROR,
  reviewWorkingTree,
} from '../src/usecases/review-working-tree.js';

/**
 * Hermetic: both the API and git are substituted at their port seams, never with
 * `vi.mock` and never against a real repository.
 *
 * The property under test is the exit-code contract. A hook wires a push to
 * these numbers, so "could not review" must never be reportable as "clean".
 */

function deps(over: { api?: unknown; git?: unknown } = {}) {
  return {
    api: (over.api ?? createFakeApi()) as ReturnType<typeof createFakeApi>,
    git: (over.git ?? createFakeGit()) as ReturnType<typeof createFakeGit>,
  };
}

const input = { cwd: '/repo', mode: 'working' };

const BLOCKING: DiffReviewBrief = {
  agent_name: 'General Reviewer',
  model: 'gpt-test',
  verdict: 'request_changes',
  score: 40,
  summary: 'A secret was committed.',
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      title: 'Hardcoded secret',
      file: 'src/a.ts',
      start_line: 2,
      end_line: 2,
      rationale: 'A live key is committed in plaintext.',
      suggestion: 'Read it from the environment.',
    },
  ],
  blockers: 1,
  fail_on: 'critical',
  files_reviewed: 1,
};

describe('the exit-code contract', () => {
  it('exits 0 when the review is clean', async () => {
    const result = await reviewWorkingTree(deps(), input);
    expect(result.exit).toBe(EXIT_CLEAN);
    expect(result.ok).toBe(true);
  });

  it('exits 1 when the review reported blocking findings', async () => {
    const result = await reviewWorkingTree(
      deps({ api: createFakeApi({ diffReview: BLOCKING }) }),
      input,
    );
    expect(result.exit).toBe(EXIT_BLOCKED);
  });

  it('exits 2 — never 0 — when there was nothing to review', async () => {
    // A clean tree is NOT a clean review: nothing was examined. Exiting 0 here
    // would let a hook report "reviewed, all good" over an unreviewed tree.
    const result = await reviewWorkingTree(
      deps({ git: createFakeGit({ changes: { patch: '' } }) }),
      input,
    );
    expect(result.exit).toBe(EXIT_ERROR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('no_changes');
  });

  it('exits 2 when the API could not be reached', async () => {
    const api = createFakeApi({
      failures: { reviewDiff: { kind: 'unreachable', baseUrl: 'http://localhost:3001' } },
    });
    const result = await reviewWorkingTree(deps({ api }), input);
    expect(result.exit).toBe(EXIT_ERROR);
  });

  it.each([
    ['git_missing', { kind: 'git_missing' as const }],
    ['not_a_repo', { kind: 'not_a_repo' as const, cwd: '/tmp' }],
    ['no_head', { kind: 'no_head' as const }],
  ])('exits 2 when git fails with %s', async (_name, failure) => {
    const result = await reviewWorkingTree(
      deps({ git: createFakeGit({ failure }) }),
      input,
    );
    expect(result.exit).toBe(EXIT_ERROR);
  });

  it('takes the blocker count from the server rather than recomputing it', async () => {
    // The server applied the agent's own gate. A CRITICAL finding reported as
    // 0 blockers means the agent runs at ci_fail_on 'never' — and a CLI that
    // re-derived the gate from severities would disagree with the web UI.
    const lenient = { ...BLOCKING, blockers: 0, fail_on: 'never', verdict: 'comment' };
    const result = await reviewWorkingTree(
      deps({ api: createFakeApi({ diffReview: lenient }) }),
      input,
    );
    expect(result.exit).toBe(EXIT_CLEAN);
  });
});

describe('modes', () => {
  it('reviews the working tree with --mode working', async () => {
    const api = createFakeApi();
    const result = await reviewWorkingTree(deps({ api }), input);
    expect(result.ok).toBe(true);
    expect(api.calls.reviewDiff).toBe(1);
    expect(api.lastPatch()).toContain('diff --git');
  });

  it.each(['staged', 'branch'])('refuses --mode %s rather than reviewing something else', async (mode) => {
    const api = createFakeApi();
    const result = await reviewWorkingTree(deps({ api }), { ...input, mode });
    expect(result.exit).toBe(EXIT_ERROR);
    if (!result.ok) expect(result.failure.kind).toBe('unsupported_mode');
    // Nothing was reviewed and nothing was paid for.
    expect(api.calls.reviewDiff).toBe(0);
  });

  it('refuses an unknown mode', async () => {
    const result = await reviewWorkingTree(deps(), { ...input, mode: 'everything' });
    expect(result.exit).toBe(EXIT_ERROR);
  });
});

describe('untracked files', () => {
  it('reports them as NOT reviewed rather than omitting them silently', async () => {
    const git = createFakeGit({ changes: { untracked: ['src/new-secret.ts'] } });
    const result = await reviewWorkingTree(deps({ git }), input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.untracked).toEqual(['src/new-secret.ts']);

    const text = formatReview(result.review, {
      branch: result.branch,
      untracked: result.untracked,
    });
    expect(text).toContain('NOT reviewed');
    expect(text).toContain('src/new-secret.ts');
  });

  it('says so when the only changes are untracked', async () => {
    const git = createFakeGit({ changes: { patch: '', untracked: ['a.ts'] } });
    const result = await reviewWorkingTree(deps({ git }), input);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(failureMessage(result.failure)).toContain('untracked');
  });
});

describe('output', () => {
  it('names the gate alongside the blocker count', () => {
    // "0 blocking" under `never` and under `critical` are different facts.
    const text = formatReview(BLOCKING, { branch: 'feat/x', untracked: [] });
    expect(text).toContain('1 blocking at gate "critical"');
    expect(text).toContain('feat/x');
    expect(text).toContain('CRITICAL');
    expect(text).toContain('src/a.ts:2');
  });

  it('sorts most severe first, then by file and line', () => {
    const findings = [
      { id: '1', severity: 'SUGGESTION', title: 's', file: 'b.ts', start_line: 1 },
      { id: '2', severity: 'CRITICAL', title: 'c', file: 'z.ts', start_line: 9 },
      { id: '3', severity: 'WARNING', title: 'w', file: 'a.ts', start_line: 3 },
    ] satisfies FindingBrief[];
    expect(sortFindings(findings).map((f) => f.severity)).toEqual([
      'CRITICAL',
      'WARNING',
      'SUGGESTION',
    ]);
  });

  it('reports a clean review without inventing findings', () => {
    const text = formatReview(
      {
        agent_name: 'A',
        verdict: 'approve',
        score: 100,
        findings: [],
        blockers: 0,
        // Required by the contract, because the exit code is read against it.
        fail_on: 'critical',
      } satisfies DiffReviewBrief,
      { branch: null, untracked: [] },
    );
    expect(text).toContain('No findings.');
    expect(text).not.toContain('NOT reviewed');
  });
});

describe('argument parsing', () => {
  it('defaults to --mode working', () => {
    expect(parseArgs(['review'])).toMatchObject({ command: 'review', mode: 'working' });
  });

  it('reads --mode, --agent and --json', () => {
    expect(parseArgs(['review', '--mode', 'staged', '--agent', 'a-1', '--json'])).toMatchObject({
      command: 'review',
      mode: 'staged',
      agentId: 'a-1',
      json: true,
    });
  });

  it('rejects a flag whose value is missing or is another flag', () => {
    // Falling through would run a PAID review against whichever reviewer is
    // first, which is not the one the caller named.
    expect(parseArgs(['review', '--agent']).badFlag).toBe('--agent');
    expect(parseArgs(['review', '--agent', '--json']).badFlag).toBe('--agent');
    expect(parseArgs(['review', '--mode']).badFlag).toBe('--mode');
  });

  it('rejects an unrecognised flag instead of dropping it', () => {
    expect(parseArgs(['review', '--dry-run']).badFlag).toBe('--dry-run');
  });

  it('takes no badFlag on a well-formed invocation', () => {
    expect(parseArgs(['review', '--mode', 'working', '--agent', 'a-1']).badFlag).toBeUndefined();
  });

  it('recognises -h and --help', () => {
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['review', '--help']).help).toBe(true);
  });
});
