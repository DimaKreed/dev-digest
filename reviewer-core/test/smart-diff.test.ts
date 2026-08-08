import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { classifyPath, groupFiles, SMART_DIFF_TOO_BIG_LINES } from '../src/index.js';

/**
 * Spec-first tests for W1 of `.devdigest/cache/plans/smart-diff.md` — the pure
 * ring-0 classifier + grouping. Every assertion cites a W1 done-when number;
 * nothing here was read off an implementation.
 *
 * Local typed factories (no shared fixture directory exists in this repo).
 */
function file(path: string, additions = 0, deletions = 0) {
  return { path, additions, deletions };
}
function ref(fileName: string, start_line: number) {
  return { file: fileName, start_line };
}

/** The ordering fixture, all four paths deliberately in the `core` role (W1.2). */
const CORE_FILES = [
  file('src/alpha.ts', 30, 0), // 0 findings, 30 lines
  file('src/bravo.ts', 1, 0), // 2 findings
  file('src/charlie.ts', 60, 40), // 1 finding, 100 lines
  file('src/delta.ts', 5, 5), // 0 findings, 10 lines
  file('src/echo.ts', 20, 10), // 0 findings, 30 lines — ties alpha, loses on path
];
const CORE_FINDINGS = [
  ref('src/bravo.ts', 7),
  ref('src/bravo.ts', 5),
  ref('src/bravo.ts', 7), // duplicate line — deduped (W1.5)
  ref('src/charlie.ts', 3),
  ref('does/not/exist.ts', 1), // unknown path — dropped, not an error (W1.5)
];

describe('classifyPath (W1.1, W1.2)', () => {
  // W1.1 — boilerplate patterns are matched FIRST, so a lock file can never
  // fall through to `wiring` (it is a .yaml/.json config-looking path) or `core`.
  it.each([
    'pnpm-lock.yaml',
    'package-lock.json',
    'client/pnpm-lock.yaml',
    'dist/bundle.js',
    'src/__snapshots__/x.snap',
  ])('classifies %s as boilerplate', (path) => {
    expect(classifyPath(path)).toBe('boilerplate');
  });

  // W1.2 — config / index / registry paths are `wiring`.
  it.each(['tsconfig.json', 'vitest.config.ts', 'src/modules/index.ts', '.github/workflows/x.yml'])(
    'classifies %s as wiring',
    (path) => {
      expect(classifyPath(path)).toBe('wiring');
    },
  );

  // W1.2 — anything unmatched is `core`.
  it.each(['server/src/modules/reviews/service.ts', 'src/alpha.ts'])(
    'classifies %s as core',
    (path) => {
      expect(classifyPath(path)).toBe('core');
    },
  );
});

describe('groupFiles (W1.3 – W1.8)', () => {
  it('always emits all three groups in the fixed order, empty ones included (W1.3)', () => {
    const out = groupFiles([file('src/alpha.ts', 1, 0)], []);
    expect(out.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(out.groups[0]!.role).toBe('core');
    expect(out.groups[1]!.files).toEqual([]);
    expect(out.groups[2]!.files).toEqual([]);
  });

  it('orders a group by finding count desc, then changed lines desc, then path asc (W1.4)', () => {
    const out = groupFiles(CORE_FILES, CORE_FINDINGS);
    const core = out.groups.find((g) => g.role === 'core')!;
    expect(core.files.map((f) => f.path)).toEqual([
      'src/bravo.ts', // 2 findings
      'src/charlie.ts', // 1 finding
      'src/alpha.ts', // 0 findings, 30 lines, path < echo
      'src/echo.ts', // 0 findings, 30 lines
      'src/delta.ts', // 0 findings, 10 lines
    ]);
  });

  it('is a total order — reversed input yields byte-identical output (W1.4)', () => {
    const forward = groupFiles(CORE_FILES, CORE_FINDINGS);
    const reversed = groupFiles([...CORE_FILES].reverse(), [...CORE_FINDINGS].reverse());
    expect(reversed).toEqual(forward);
  });

  it('collects finding_lines per file, deduped and ascending, dropping unknown paths (W1.5)', () => {
    const out = groupFiles(CORE_FILES, CORE_FINDINGS);
    const core = out.groups.find((g) => g.role === 'core')!;
    const byPath = new Map(core.files.map((f) => [f.path, f.finding_lines]));
    expect(byPath.get('src/bravo.ts')).toEqual([5, 7]);
    expect(byPath.get('src/charlie.ts')).toEqual([3]);
    expect(byPath.get('src/alpha.ts')).toEqual([]);
    // The finding for `does/not/exist.ts` invented no file.
    expect(core.files.map((f) => f.path)).not.toContain('does/not/exist.ts');
  });

  it('ships pseudocode_summary null on every emitted file (W1.6)', () => {
    const out = groupFiles([...CORE_FILES, file('pnpm-lock.yaml', 900, 30)], CORE_FINDINGS);
    const emitted = out.groups.flatMap((g) => g.files);
    expect(emitted.length).toBeGreaterThan(0);
    for (const f of emitted) expect(f.pseudocode_summary).toBeNull();
  });

  it('sums split_suggestion.total_lines over ALL input files and keeps proposed_splits empty (W1.7)', () => {
    const files = [...CORE_FILES, file('pnpm-lock.yaml', 4, 1), file('tsconfig.json', 2, 0)];
    const expectedTotal = files.reduce((n, f) => n + f.additions + f.deletions, 0);
    const out = groupFiles(files, []);
    expect(out.split_suggestion.total_lines).toBe(expectedTotal);
    expect(out.split_suggestion.proposed_splits).toEqual([]);
  });

  it('sets too_big strictly above SMART_DIFF_TOO_BIG_LINES (W1.7)', () => {
    const atThreshold = groupFiles([file('src/alpha.ts', SMART_DIFF_TOO_BIG_LINES, 0)], []);
    expect(atThreshold.split_suggestion.total_lines).toBe(SMART_DIFF_TOO_BIG_LINES);
    expect(atThreshold.split_suggestion.too_big).toBe(false);

    const overThreshold = groupFiles([file('src/alpha.ts', SMART_DIFF_TOO_BIG_LINES, 1)], []);
    expect(overThreshold.split_suggestion.too_big).toBe(true);
  });

  it('produces output the SmartDiff contract accepts (W1.8)', () => {
    const out = groupFiles(
      [...CORE_FILES, file('pnpm-lock.yaml', 900, 30), file('tsconfig.json', 2, 0)],
      CORE_FINDINGS,
    );
    // Parse in the test, never in src — W1.8 / zod `parse-validate-early`.
    expect(() => SmartDiff.parse(out)).not.toThrow();
  });

  it('handles an empty PR without throwing (W1.3, W1.7)', () => {
    const out = groupFiles([], []);
    expect(out.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(out.groups.every((g) => g.files.length === 0)).toBe(true);
    expect(out.split_suggestion.total_lines).toBe(0);
    expect(out.split_suggestion.too_big).toBe(false);
  });
});
