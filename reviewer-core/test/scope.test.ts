import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../server/src/adapters/mocks.js';
import { partitionByScope, reviewPullRequest } from '../src/index.js';
import { scoreFromFindings } from '../src/review/reduce.js';
import { assemblePrompt } from '../src/prompt.js';
import { countBlockers, verdictFromFindings } from '../src/output/to-review.js';

/**
 * Intent Layer — the scope filter and the three derived numbers that must agree
 * with the post-filter set (score, verdict, blockers).
 */

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f',
    severity: 'WARNING',
    category: 'bug',
    title: 'a finding',
    file: 'src/config.ts',
    start_line: 11,
    end_line: 11,
    rationale: 'because',
    confidence: 0.8,
    kind: 'finding',
    ...over,
  } as Finding;
}

describe('partitionByScope', () => {
  it('defers a plain out-of-scope WARNING', () => {
    const f = finding({ out_of_scope: true, scope_rationale: 'author excluded logging' });
    const p = partitionByScope([f], { allowDefer: true });
    expect(p.active).toHaveLength(0);
    expect(p.deferred).toHaveLength(1);
  });

  it('keeps an out-of-scope SUGGESTION deferred but an out-of-scope CRITICAL active', () => {
    const suggestion = finding({ id: 's', severity: 'SUGGESTION', out_of_scope: true });
    const critical = finding({ id: 'c', severity: 'CRITICAL', out_of_scope: true });
    const p = partitionByScope([suggestion, critical], { allowDefer: true });
    expect(p.deferred.map((f) => f.id)).toEqual(['s']);
    expect(p.active.map((f) => f.id)).toEqual(['c']);
  });

  it('never defers a security finding, at any severity', () => {
    const f = finding({ severity: 'SUGGESTION', category: 'security', out_of_scope: true });
    const p = partitionByScope([f], { allowDefer: true });
    expect(p.deferred).toHaveLength(0);
    expect(p.active).toHaveLength(1);
  });

  it('defers nothing at all when allowDefer is false', () => {
    const findings = [
      finding({ id: 'a', out_of_scope: true }),
      finding({ id: 'b', severity: 'SUGGESTION', out_of_scope: true }),
    ];
    const p = partitionByScope(findings, { allowDefer: false });
    expect(p.deferred).toHaveLength(0);
    expect(p.active).toHaveLength(2);
  });

  it('treats a missing or false flag as in scope', () => {
    const p = partitionByScope(
      [finding({ id: 'none' }), finding({ id: 'false', out_of_scope: false })],
      { allowDefer: true },
    );
    expect(p.deferred).toHaveLength(0);
    expect(p.active).toHaveLength(2);
  });
});

describe('the prompt is byte-identical when no intent is present', () => {
  const parts = {
    system: 'security reviewer',
    diff: 'diff --git a/x b/x',
    task: 'Review PR #482',
    prDescription: 'adds a limiter',
  };

  it('omits the section for undefined and for an empty/whitespace intent', () => {
    const baseline = assemblePrompt(parts);
    expect(assemblePrompt({ ...parts, intent: undefined })).toEqual(baseline);
    expect(assemblePrompt({ ...parts, intent: '' })).toEqual(baseline);
    expect(assemblePrompt({ ...parts, intent: '   \n ' })).toEqual(baseline);
    expect(baseline.assembly.user).not.toContain('## Derived intent & scope');
    expect(baseline.assembly.intent).toBeNull();
  });

  it('adds the section, wrapped as untrusted, when an intent is present', () => {
    const withIntent = assemblePrompt({ ...parts, intent: 'Intent: adds a limiter' });
    expect(withIntent.assembly.user).toContain('## Derived intent & scope');
    expect(withIntent.assembly.user).toContain('<untrusted source="intent">');
    expect(withIntent.assembly.intent).toBe('Intent: adds a limiter');
    // Right after the PR description, before the diff.
    const user = withIntent.assembly.user;
    expect(user.indexOf('## PR description')).toBeLessThan(
      user.indexOf('## Derived intent & scope'),
    );
    expect(user.indexOf('## Derived intent & scope')).toBeLessThan(user.indexOf('## Diff to review'));
  });
});

describe('score, verdict and blockers all describe the POST-filter set', () => {
  /** Grounded (line 11 is in the MockGitClient diff): one CRITICAL + one deferrable WARNING. */
  const fixture = {
    verdict: 'approve',
    summary: 'x',
    score: 99,
    findings: [
      {
        id: 'in-scope-critical',
        severity: 'CRITICAL',
        category: 'bug',
        title: 'null deref',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'boom',
        confidence: 0.9,
        kind: 'finding',
        out_of_scope: false,
      },
      {
        id: 'out-of-scope-warning',
        severity: 'WARNING',
        category: 'style',
        title: 'no logging on the limiter',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'author said logging is a follow-up',
        confidence: 0.6,
        kind: 'finding',
        out_of_scope: true,
        scope_rationale: 'logging is listed as out of scope',
      },
    ],
  };

  it('defers the out-of-scope WARNING and keeps all three numbers consistent', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();
    const outcome = await reviewPullRequest({
      systemPrompt: 's',
      model: 'gpt-4.1',
      diff,
      llm,
      intent: 'Intent: adds a limiter\nOut of scope:\n- logging for the limiter',
    });

    expect(outcome.review.findings.map((f) => f.id)).toEqual(['in-scope-critical']);
    expect(outcome.deferred.map((f) => f.id)).toEqual(['out-of-scope-warning']);
    expect(outcome.scope).toBe('1 deferred / 2');

    // The invariant: every derived number is computed over review.findings.
    expect(outcome.review.score).toBe(scoreFromFindings(outcome.review.findings));
    expect(outcome.review.verdict).toBe(verdictFromFindings(outcome.review.findings, 'critical'));
    expect(countBlockers(outcome.review.findings, 'critical')).toBe(1);
    // 100 − 35 only. Had the WARNING stayed active it would read 53.
    expect(outcome.review.score).toBe(65);

    // Grounding stays a GROUNDING statistic — it must not absorb the scope drop.
    expect(outcome.grounding).toBe('2/2 passed');
  });

  it('defers nothing at a warning gate, so the intent layer cannot turn a red gate green', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();
    const outcome = await reviewPullRequest({
      systemPrompt: 's',
      model: 'gpt-4.1',
      diff,
      llm,
      failOn: 'warning',
      allowDefer: false,
    });

    expect(outcome.deferred).toHaveLength(0);
    expect(outcome.review.findings).toHaveLength(2);
    expect(outcome.review.score).toBe(scoreFromFindings(outcome.review.findings));
    expect(outcome.review.verdict).toBe('request_changes');
    expect(countBlockers(outcome.review.findings, 'warning')).toBe(2);
  });
});
