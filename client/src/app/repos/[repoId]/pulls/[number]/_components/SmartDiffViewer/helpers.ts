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
  FindingRecord,
  PrFile,
  ReviewRecord,
  SmartDiffGroup,
  SmartDiffRole,
} from "@devdigest/shared";
import { SEVERITY_LEVELS, liveFindings } from "@/lib/severity";

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
 * Every live finding covering `file`:`line`, most severe first.
 *
 * Matches on the NEW side range `[start_line, end_line]` — the same side
 * `lineInRange` and `commentTargetFor` use in the diff viewer.
 *
 * Returns the whole records rather than just their severity: the index row
 * renders each finding's `title`, because a bare line number tells a reviewer
 * WHERE to look and nothing about WHAT is wrong there, and the diff rows
 * themselves carry no finding text (see `client/insights.md` — the Agent runs
 * tab is otherwise the only surface with the text on it).
 */
export function findingsForLine(
  reviews: ReviewRecord[],
  file: string,
  line: number,
): FindingRecord[] {
  const hits = liveFindings(reviews).filter(
    (f) => f.file === file && line >= f.start_line && line <= f.end_line,
  );
  // SEVERITY_LEVELS is ordered most-severe-first. Sorting by its index keeps a
  // CRITICAL above a SUGGESTION on the same line; ties keep discovery order,
  // which is `latestRunPerAgent`'s newest-first order.
  return hits.sort(
    (a, b) => SEVERITY_LEVELS.indexOf(a.severity) - SEVERITY_LEVELS.indexOf(b.severity),
  );
}

/** Which group holds `path`, or null when no group does. */
export function roleForPath(groups: SmartDiffGroup[], path: string): SmartDiffRole | null {
  for (const group of groups) {
    if (group.files.some((f) => f.path === path)) return group.role;
  }
  return null;
}
