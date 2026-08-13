import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import {
  SMART_DIFF_BOILERPLATE_PATTERNS,
  SMART_DIFF_ROLE_ORDER,
  SMART_DIFF_TOO_BIG_LINES,
  SMART_DIFF_WIRING_PATTERNS,
} from './constants.js';

/**
 * Smart Diff — risk-ordered PR file groups.
 *
 * Reorders a PR's changed files so a reviewer meets the service before the lock
 * file: `core` (the decisions) → `wiring` (config, barrels, CI) → `boilerplate`
 * (generated, vendored, minified). Each file carries the line numbers the last
 * review flagged, so the client can index straight into them.
 *
 * Deliberately NOT a model call. This is a pure classifier over path patterns
 * plus a join against findings the caller already has, which makes it
 * deterministic, free, and testable without a network — see rule C5 in
 * `.claude/skills/onion-architecture/SKILL.md`. Every tunable lives in
 * `./constants.ts`; this file holds only the ordering logic.
 *
 * Inputs are declared structurally so no Drizzle or DB type reaches ring 0 —
 * the server's rows satisfy them by shape, with no mapping layer.
 */

/** One changed file, as the caller already has it. */
export interface SmartDiffInputFile {
  path: string;
  additions: number;
  deletions: number;
}

/** One finding, reduced to the two fields the grouping needs. */
export interface SmartDiffFindingRef {
  file: string;
  start_line: number;
}

/**
 * Which bucket a path belongs to. Boilerplate is tested first so that a
 * `pnpm-lock.yaml` can never be claimed by the `.yaml` wiring pattern; anything
 * matching neither list is `core`, which makes `core` the safe default rather
 * than a pattern list that has to be kept exhaustive.
 */
export function classifyPath(path: string): SmartDiffRole {
  for (const pattern of SMART_DIFF_BOILERPLATE_PATTERNS) {
    if (pattern.test(path)) return 'boilerplate';
  }
  for (const pattern of SMART_DIFF_WIRING_PATTERNS) {
    if (pattern.test(path)) return 'wiring';
  }
  return 'core';
}

/**
 * Group and order a PR's files.
 *
 * Always emits all three groups in `SMART_DIFF_ROLE_ORDER`, with `files: []` for
 * a role nothing matched — the client renders group headers from this array, so
 * a missing role would be indistinguishable from a server bug.
 *
 * Within a group the order is: most findings first, then most changed lines,
 * then path ascending. That last key makes the order TOTAL, so the same input
 * always yields byte-identical output (no clock, no insertion-order reliance).
 */
export function groupFiles(
  files: readonly SmartDiffInputFile[],
  findings: readonly SmartDiffFindingRef[],
): SmartDiff {
  const linesByPath = new Map<string, Set<number>>();
  for (const file of files) linesByPath.set(file.path, new Set());
  for (const finding of findings) {
    // A finding for a path outside this PR's file list is dropped, not an error:
    // findings outlive a force-push that removed the file they cite.
    linesByPath.get(finding.file)?.add(finding.start_line);
  }

  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  for (const role of SMART_DIFF_ROLE_ORDER) byRole.set(role, []);

  let totalLines = 0;
  for (const file of files) {
    totalLines += file.additions + file.deletions;
    const lines = [...(linesByPath.get(file.path) ?? new Set<number>())].sort((a, b) => a - b);
    byRole.get(classifyPath(file.path))?.push({
      path: file.path,
      // No pseudocode summary is produced: writing one needs a paid model call,
      // and Smart Diff is specified as a zero-call feature.
      pseudocode_summary: null,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: lines,
    });
  }

  const groups: SmartDiffGroup[] = SMART_DIFF_ROLE_ORDER.map((role) => ({
    role,
    files: (byRole.get(role) ?? []).sort(compareFiles),
  }));

  return {
    groups,
    split_suggestion: {
      too_big: totalLines > SMART_DIFF_TOO_BIG_LINES,
      total_lines: totalLines,
      // Proposing actual splits needs repo intel (import graph, symbol owners),
      // which this feature does not read. Contract-shaped and empty on purpose.
      proposed_splits: [],
    },
  };
}

function compareFiles(a: SmartDiffFile, b: SmartDiffFile): number {
  const byFindings = b.finding_lines.length - a.finding_lines.length;
  if (byFindings !== 0) return byFindings;
  const bySize = b.additions + b.deletions - (a.additions + a.deletions);
  if (bySize !== 0) return bySize;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}
