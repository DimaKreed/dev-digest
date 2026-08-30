import { describe, it, expect } from 'vitest';
import { groundFindings } from '@devdigest/reviewer-core';
import type { Finding } from '@devdigest/shared';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { BUILT_EVAL_CASES } from '../src/db/seed-evals.js';

/**
 * The starter eval set has to be RUNNABLE, not merely present.
 *
 * A case whose expectation lines fall outside its own diff hunk is dropped by
 * the citation-grounding gate on every run, so no agent could ever pass it
 * however good it is — the case would measure the seed file's arithmetic
 * instead of the reviewer. That is invisible in review and only shows up as a
 * metric that will not move, which is the one failure this harness cannot
 * afford. So the seed data is asserted against the same parser and the same
 * gate a real run uses.
 */
describe('seeded eval cases', () => {
  it('ships at least 8 cases, in both polarities (SPEC-04 AC-14)', () => {
    expect(BUILT_EVAL_CASES.length).toBeGreaterThanOrEqual(8);
    const kinds = new Set(BUILT_EVAL_CASES.map((c) => c.expectationKind));
    expect(kinds).toEqual(new Set(['must_find', 'must_not_flag']));
  });

  it('gives every case a diff the parser reads as exactly one file', () => {
    for (const c of BUILT_EVAL_CASES) {
      const diff = parseUnifiedDiff(c.inputDiff);
      expect(diff.files.map((f) => f.path), c.name).toEqual([c.expectation.file]);
    }
  });

  it('places every expectation inside a real hunk of its own diff', () => {
    for (const c of BUILT_EVAL_CASES) {
      const diff = parseUnifiedDiff(c.inputDiff);
      const probe: Finding = {
        id: 'probe',
        severity: 'CRITICAL',
        category: 'security',
        title: c.expectation.title,
        file: c.expectation.file,
        start_line: c.expectation.start_line,
        end_line: c.expectation.end_line,
        rationale: '',
        confidence: 1,
      };
      const result = groundFindings([probe], diff);
      expect(result.dropped.map((d) => d.reason), c.name).toEqual([]);
      expect(result.kept, c.name).toHaveLength(1);
    }
  });

  it('names each case uniquely, since the seed is idempotent by name', () => {
    const names = BUILT_EVAL_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
