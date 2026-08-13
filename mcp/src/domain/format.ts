/**
 * Ring 0 — projections from materialized data to the text a caller reads.
 *
 * This layer is pure: it performs no I/O, reads no ambient state, and observes
 * no clock. It takes already-fetched arrays and returns plain strings.
 *
 * It deliberately returns strings rather than MCP content blocks. That envelope
 * is another system's wire format, and putting it here would bake a transport
 * detail into the core — the transport layer wraps these strings instead.
 */
import type { AgentBrief, ConventionBrief, FindingBrief, ReviewBrief } from '../contracts.js';
import { blastTruncated, findingsTruncated, listTruncated } from './errors.js';

export type ResponseFormat = 'concise' | 'detailed';

function lineFor(finding: FindingBrief, format: ResponseFormat): string {
  const start = finding.start_line;
  const end = finding.end_line;
  const range = start == null ? '' : end == null || end === start ? `:${start}` : `:${start}-${end}`;
  const head = `${finding.severity}  ${finding.file}${range}  ${finding.title}`;
  if (format === 'concise') return head;

  const extra: string[] = [];
  if (finding.rationale) extra.push(`    why: ${finding.rationale}`);
  if (finding.suggestion) extra.push(`    fix: ${finding.suggestion}`);
  return extra.length === 0 ? head : `${head}\n${extra.join('\n')}`;
}

export function formatAgents(
  agents: AgentBrief[],
  total: number,
  format: ResponseFormat,
): string {
  if (agents.length === 0) {
    return 'No reviewer agents are configured in DevDigest.';
  }

  const lines: string[] = [];
  for (const agent of agents) {
    const state = agent.enabled ? '' : '  (disabled)';
    lines.push(`${agent.id}  ${agent.name}${state}`);
    if (format === 'detailed') {
      if (agent.description) lines.push(`    ${agent.description}`);
      const spec = [agent.provider, agent.model].filter(Boolean).join('/');
      const gate = [
        spec ? `model: ${spec}` : '',
        agent.strategy ? `strategy: ${agent.strategy}` : '',
        agent.ci_fail_on ? `ci_fail_on: ${agent.ci_fail_on}` : '',
      ]
        .filter(Boolean)
        .join('  ');
      if (gate) lines.push(`    ${gate}`);
    }
  }

  if (agents.length < total) lines.push(listTruncated(agents.length, total, 'agents'));
  return lines.join('\n');
}

/** The completed-run projection `devdigest_run_agent_on_pr` returns on success. */
export function formatRunResult(
  agentName: string,
  verdict: string,
  score: number | null,
  findings: FindingBrief[],
  format: ResponseFormat,
): string {
  const scoreText = score == null ? 'n/a' : String(score);
  const header = `${agentName}: verdict ${verdict}, score ${scoreText}, ${findings.length} finding(s).`;
  if (findings.length === 0) return header;

  const lines = [header];
  for (const finding of findings) lines.push(lineFor(finding, format));
  return lines.join('\n');
}

/** The multi-review projection `devdigest_get_findings` returns on success. */
export function formatReviews(
  reviews: ReviewBrief[],
  shown: FindingBrief[],
  total: number,
  counts: Record<string, number>,
  format: ResponseFormat,
): string {
  const heads: string[] = [];
  for (const review of reviews) {
    const name = review.agent_name ?? review.agent_id ?? 'unknown agent';
    const scoreText = review.score == null ? 'n/a' : String(review.score);
    heads.push(`${name}: verdict ${review.verdict ?? 'n/a'}, score ${scoreText} (${review.created_at})`);
  }

  // Labelled as covering the whole review on purpose: this tally is computed over
  // every live finding, so it does not shrink when a limit or a severity filter
  // narrows the rows printed below it. Without the label the two numbers look
  // like they disagree.
  const tally = `Whole review — CRITICAL ${counts.CRITICAL ?? 0} · WARNING ${counts.WARNING ?? 0} · SUGGESTION ${counts.SUGGESTION ?? 0}`;
  const lines = [...heads, tally];
  for (const finding of shown) lines.push(lineFor(finding, format));
  if (shown.length < total) lines.push(findingsTruncated(shown.length, total));
  return lines.join('\n');
}

export function formatConventions(
  conventions: ConventionBrief[],
  total: number,
  lastScanAt: string | null,
  format: ResponseFormat,
): string {
  const lines: string[] = [];
  lines.push(lastScanAt ? `Last scanned: ${lastScanAt}` : 'Last scan time unknown.');

  for (const convention of conventions) {
    lines.push(`[${convention.category}] ${convention.rule}  (found in ${convention.occurrences} files)`);
    if (format === 'detailed' && convention.evidence_path) {
      const start = convention.evidence_start_line;
      const end = convention.evidence_end_line;
      const range = start == null ? '' : end == null || end === start ? `:${start}` : `:${start}-${end}`;
      lines.push(`    evidence: ${convention.evidence_path}${range}`);
      if (convention.evidence_snippet) lines.push(`    ${convention.evidence_snippet}`);
    }
  }

  if (conventions.length < total) {
    lines.push(listTruncated(conventions.length, total, 'conventions'));
  }
  return lines.join('\n');
}

/** One affected symbol, as `get-blast-radius` projects it. */
export interface BlastImpactView {
  symbol: string;
  callers: { name: string; file: string; line: number | null; endpoints: string[] }[];
  callerCount: number;
  endpoints: string[];
  crons: string[];
}

/**
 * The blast radius as a caller reads it.
 *
 * The endpoint and job unions print in BOTH formats, at the end. An affected
 * endpoint is the load-bearing fact of this tool, and hiding it behind
 * `detailed` would make the default answer omit the one thing the question was
 * asked to learn. `detailed` adds the per-caller file:line rows.
 */
export function formatBlastRadius(
  args: {
    symbolCount: number;
    downstream: BlastImpactView[];
    total: number;
    totalCallers: number;
    endpoints: string[];
    crons: string[];
    summary: string | null;
    callersPerSymbol: number;
  },
  format: ResponseFormat,
): string {
  const lines: string[] = [
    `${args.symbolCount} changed symbol(s) · ${args.totalCallers} caller(s) · ` +
      `${args.endpoints.length} endpoint(s) · ${args.crons.length} job(s).`,
  ];
  if (args.summary) lines.push(args.summary);

  for (const impact of args.downstream) {
    const shown =
      impact.callers.length < impact.callerCount
        ? ` (${impact.callerCount} callers, showing ${impact.callers.length})`
        : ` (${impact.callerCount} caller(s))`;
    lines.push(`${impact.symbol}${shown}`);
    if (format !== 'detailed') continue;

    for (const caller of impact.callers) {
      const at = caller.line == null ? '' : `:${caller.line}`;
      lines.push(`    ${caller.file}${at}  ${caller.name}`);
      if (caller.endpoints.length > 0) {
        lines.push(`        reaches: ${caller.endpoints.join(', ')}`);
      }
    }
    if (impact.crons.length > 0) lines.push(`    jobs: ${impact.crons.join(', ')}`);
  }

  if (args.endpoints.length > 0) {
    lines.push(`Endpoints affected: ${args.endpoints.join(', ')}`);
  }
  if (args.crons.length > 0) lines.push(`Jobs affected: ${args.crons.join(', ')}`);

  if (args.downstream.length < args.total) {
    lines.push(blastTruncated(args.downstream.length, args.total, args.callersPerSymbol));
  }
  return lines.join('\n');
}

/** Severity tally over the findings a tool is about to report. */
export function countBySeverity(findings: FindingBrief[]): Record<string, number> {
  const counts: Record<string, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const finding of findings) {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  }
  return counts;
}
