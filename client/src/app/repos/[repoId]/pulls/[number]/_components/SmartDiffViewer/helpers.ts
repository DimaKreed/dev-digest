/**
 * Pure helpers for the SmartDiffViewer.
 *
 * The server ships `finding_lines: number[]` per file and no severity, on
 * purpose — the contract was not edited for this feature. The severity of a
 * flagged line is therefore RE-DERIVED here from the `reviews` the page already
 * fetched, using the same two rules as every other findings surface:
 * `latestRunPerAgent` (newest run per agent) + `isLiveFinding` (dismissed
 * excluded). Importing them from `@/lib/severity` rather than restating them is
 * what keeps a chip's colour equal to the header chip that counted it.
 */
import type {
  PrFile,
  ReviewRecord,
  Severity,
  SmartDiffGroup,
  SmartDiffRole,
} from "@devdigest/shared";
import { SEVERITY_LEVELS, isLiveFinding, latestRunPerAgent } from "@/lib/severity";

/** Index the PR's files by path so a group can be mapped back onto them. */
export function filesByPath(files: PrFile[]): Map<string, PrFile> {
  return new Map(files.map((f) => [f.path, f]));
}

/**
 * A group's files as the real `PrFile` records `DiffViewer` needs, in the
 * server's order. A path with no matching `PrFile` is skipped: the two lists
 * come from the same request, but a stale cache entry must not crash the tab.
 */
export function groupPrFiles(group: SmartDiffGroup, byPath: Map<string, PrFile>): PrFile[] {
  const out: PrFile[] = [];
  for (const file of group.files) {
    const match = byPath.get(file.path);
    if (match) out.push(match);
  }
  return out;
}

/**
 * The most severe live finding covering `file`:`line`, or null.
 *
 * Matches on the NEW side range `[start_line, end_line]` — the same side
 * `lineInRange` and `commentTargetFor` use in the diff viewer.
 */
export function severityForLine(
  reviews: ReviewRecord[],
  file: string,
  line: number,
): Severity | null {
  const hits = new Set<Severity>();
  for (const review of latestRunPerAgent(reviews)) {
    for (const finding of review.findings) {
      if (finding.file !== file) continue;
      if (!isLiveFinding(finding)) continue;
      if (line < finding.start_line || line > finding.end_line) continue;
      hits.add(finding.severity);
    }
  }
  // SEVERITY_LEVELS is ordered most-severe-first, so the first hit wins.
  return SEVERITY_LEVELS.find((level) => hits.has(level)) ?? null;
}

/** Which group holds `path`, or null when no group does. */
export function roleForPath(groups: SmartDiffGroup[], path: string): SmartDiffRole | null {
  for (const group of groups) {
    if (group.files.some((f) => f.path === path)) return group.role;
  }
  return null;
}
