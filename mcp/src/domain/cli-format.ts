/**
 * Ring 0 — the terminal output of `devdigest review`.
 *
 * Pure: no I/O, no ambient state, no clock. Returns strings; the entry point
 * decides which stream they go to.
 *
 * The finding line is `SEVERITY  path:line  title`, the same order
 * `domain/format.ts` uses for the MCP tools. A developer reading both should not
 * have to learn two layouts for the same fact.
 */
import type { DiffReviewBrief, FindingBrief } from '../contracts.js';
import { SEVERITY_ORDER, severityRank } from './limits.js';

export const HELP = `devdigest review — review local changes before you push them.

USAGE
  devdigest review [--mode working] [--agent <id>] [--json]

WHAT IT REVIEWS
  --mode working   (default) Tracked files with staged or unstaged changes,
                   exactly what \`git diff HEAD\` reports.

  Untracked files are NOT reviewed. \`git diff HEAD\` cannot see them, so a file
  git has never been told about is invisible to this command. Any that exist are
  listed in the output so their absence from the review is stated rather than
  assumed. \`git add\` them first to have them reviewed.

  --mode staged and --mode branch are not implemented yet and exit 2.

OPTIONS
  --mode <mode>    working (default) | staged | branch
  --agent <id>     Reviewer agent to use. Defaults to the first enabled one.
                   List them with the devdigest_list_agents MCP tool.
  --json           Emit the full review as JSON on stdout instead of text.
  -h, --help       Show this help.

EXIT CODES
  0  Reviewed. Nothing meets the agent's gate — safe to push.
  1  Reviewed. Blocking findings were reported.
  2  Could NOT review: git failed, there was nothing to review, or the API was
     unreachable. This is not a verdict about the code, and no conclusion about
     the change may be drawn from it.

  Which findings block is the agent's own \`ci_fail_on\` setting (never, critical,
  warning, any) — the same gate the web app and CI apply, decided server-side.

REQUIREMENTS
  The DevDigest API must be running (./scripts/dev.sh). Set DEVDIGEST_API_URL to
  point elsewhere than http://localhost:3001.`;

function lineFor(finding: FindingBrief): string {
  const start = finding.start_line;
  const end = finding.end_line;
  const range =
    start == null ? '' : end == null || end === start ? `:${start}` : `:${start}-${end}`;
  return `${finding.severity.padEnd(10)} ${finding.file}${range}  ${finding.title}`;
}

/** Most severe first, then by file and line, so the output is stable. */
export function sortFindings(findings: FindingBrief[]): FindingBrief[] {
  return [...findings].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      a.file.localeCompare(b.file) ||
      (a.start_line ?? 0) - (b.start_line ?? 0),
  );
}

export function formatReview(
  review: DiffReviewBrief,
  context: { branch: string | null; untracked: string[] },
): string {
  const findings = sortFindings(review.findings ?? []);
  const lines: string[] = [];

  const where = context.branch ? `working tree on ${context.branch}` : 'working tree';
  lines.push(
    `Reviewed ${where}: ${review.files_reviewed ?? 0} file(s) by ${review.agent_name}` +
      (review.model ? ` (${review.model})` : ''),
  );

  if (findings.length === 0) {
    lines.push('No findings.');
  } else {
    const tally = SEVERITY_ORDER.map(
      (s) => `${s} ${findings.filter((f) => f.severity === s).length}`,
    ).join(' · ');
    lines.push(tally);
    lines.push('');
    for (const finding of findings) {
      lines.push(lineFor(finding));
      if (finding.rationale) lines.push(`           ${finding.rationale}`);
      if (finding.suggestion) lines.push(`           fix: ${finding.suggestion}`);
    }
    lines.push('');
  }

  if (review.summary) lines.push(review.summary);

  // The gate is named alongside the count. "0 blocking" under `never` and under
  // `critical` are different facts, and a reader cannot tell them apart from the
  // number alone.
  lines.push(
    `Verdict: ${review.verdict} · score ${review.score ?? 'n/a'} · ` +
      `${review.blockers} blocking at gate "${review.fail_on}"`,
  );

  // Stated, not implied. A brand-new file that was never reviewed is exactly the
  // case where silence would be read as approval.
  if (context.untracked.length > 0) {
    lines.push('');
    lines.push(
      `NOT reviewed — ${context.untracked.length} untracked file(s). ` +
        `\`git diff HEAD\` cannot see these; \`git add\` them to include them:`,
    );
    for (const path of context.untracked.slice(0, 10)) lines.push(`  ${path}`);
    if (context.untracked.length > 10) {
      lines.push(`  … and ${context.untracked.length - 10} more`);
    }
  }

  return lines.join('\n');
}
