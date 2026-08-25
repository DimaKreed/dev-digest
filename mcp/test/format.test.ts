import { describe, expect, it } from 'vitest';
import { AgentBrief, ConventionBrief, FindingBrief } from '../src/contracts.js';
import {
  countBySeverity,
  formatAgents,
  formatConventions,
  formatRunResult,
} from '../src/domain/format.js';
import { CRITICAL_FINDING, SUGGESTION_FINDING } from './fixtures.js';

const findings = [CRITICAL_FINDING, SUGGESTION_FINDING].map((row) => FindingBrief.parse(row));

const AGENT = AgentBrief.parse({
  id: 'agent-1',
  name: 'General Reviewer',
  description: 'Reviews a PR diff for bugs, correctness, and clarity.',
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4',
  strategy: 'single-pass',
  ci_fail_on: 'critical',
  enabled: true,
});

describe('formatRunResult', () => {
  it('keeps a concise finding to one line', () => {
    const output = formatRunResult('General Reviewer', 'request_changes', 65, findings, 'concise');

    expect(output).toContain('CRITICAL  src/webhooks/retry.ts:42-48  Retry loop can never terminate');
    expect(output).not.toContain('why:');
  });

  it('adds the rationale and the fix only in detailed', () => {
    const output = formatRunResult('General Reviewer', 'request_changes', 65, findings, 'detailed');

    expect(output).toContain('why: The backoff counter is reset inside the loop body.');
    expect(output).toContain('fix: Move the reset above the loop.');
  });

  it('collapses a single-line range rather than printing 12-12', () => {
    const output = formatRunResult('General Reviewer', 'comment', 90, [findings[1]!], 'concise');

    expect(output).toContain('src/webhooks/retry.ts:12  Extract the magic number');
    expect(output).not.toContain('12-12');
  });
});

describe('formatAgents', () => {
  it('tells the caller how many agents were omitted when truncated', () => {
    const output = formatAgents([AGENT], 4, 'concise');

    expect(output).toContain('Showing 1 of 4 agents; 3 omitted.');
  });

  it('says nothing about truncation when the whole list fits', () => {
    const output = formatAgents([AGENT], 1, 'concise');

    expect(output).not.toContain('omitted');
  });

  it('marks a disabled agent so its id is not mistaken for a runnable one', () => {
    const disabled = AgentBrief.parse({ ...AGENT, enabled: false });

    expect(formatAgents([disabled], 1, 'concise')).toContain('(disabled)');
  });
});

describe('formatConventions', () => {
  const convention = ConventionBrief.parse({
    id: 'c-1',
    rule: 'Import shared types with `import type`.',
    category: 'imports',
    occurrences: 3,
    confidence: 0.9,
    status: 'accepted',
    evidence_path: 'src/lib/api.ts',
    evidence_start_line: 4,
    evidence_end_line: 6,
    evidence_snippet: "import type { Repo } from '@devdigest/shared';",
  });

  it('reports the counted occurrences the description promises', () => {
    expect(formatConventions([convention], 1, null, 'concise')).toContain('(found in 3 files)');
  });

  it('shows the verified evidence only in detailed', () => {
    expect(formatConventions([convention], 1, null, 'concise')).not.toContain('evidence:');
    expect(formatConventions([convention], 1, null, 'detailed')).toContain(
      'evidence: src/lib/api.ts:4-6',
    );
  });
});

describe('countBySeverity', () => {
  it('always reports all three levels, including the zeroes', () => {
    expect(countBySeverity(findings)).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 1 });
  });
});
