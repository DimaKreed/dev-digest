import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import {
  BlastCaller,
  BlastRadius,
  DownstreamImpact,
  Intent,
  PrHistoryItem,
  SmartDiff,
} from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/** Intent persisted for a PR (the Intent plus the pr_id it scopes). */
export const PrIntentRecord = Intent.extend({ pr_id: z.string() });
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;

/**
 * How much of the code index backed a blast result. Three states, never
 * collapsed into a boolean:
 *   ok       — the index covered every changed file; the lists below are complete.
 *   partial  — the index exists but is incomplete. What IS listed is true; what
 *              is missing is NOT knowable from an empty array.
 *   degraded — no usable index. An empty `downstream` here is the absence of a
 *              measurement, not a measurement of absence.
 */
export const BlastState = z.enum(['ok', 'partial', 'degraded']);
export type BlastState = z.infer<typeof BlastState>;

/**
 * One caller, carrying the endpoints and jobs attributed to ITS OWN file.
 *
 * `DownstreamImpact.endpoints_affected` is a flat per-symbol union, which loses
 * which caller reaches which endpoint. A graph view reading only that union has
 * to assume every caller reaches every endpoint and draws the complete bipartite
 * product (4 callers x 3 endpoints = 12 edges) in place of the real 5.
 */
export const BlastCallerNode = BlastCaller.extend({
  endpoints_affected: z.array(z.string()).default([]),
  crons_affected: z.array(z.string()).default([]),
});
export type BlastCallerNode = z.infer<typeof BlastCallerNode>;

export const DownstreamNode = DownstreamImpact.extend({
  callers: z.array(BlastCallerNode),
});
export type DownstreamNode = z.infer<typeof DownstreamNode>;

/**
 * A merged PR that touched the same files. `notes` is `''` on the main read —
 * that path costs nothing and reaches no model. A note is prose about how the
 * two pull requests relate, which only a model can write, so it arrives later
 * from `POST /pulls/:id/blast/history-notes`. `notes_state` is what separates
 * "not asked for" from "asked, and there was nothing to say".
 *
 * `merged_at` carries `pull_requests.updated_at`: there is no merge timestamp
 * column, and `status = 'merged'` is the only merge signal stored.
 */
export const PriorPr = PrHistoryItem;
export type PriorPr = z.infer<typeof PriorPr>;

/**
 * Response of `GET /pulls/:id/blast`.
 *
 * Extends `BlastRadius` rather than editing it: that contract is a member of
 * `PrBrief` and is parsed from stored documents, so a new required field there
 * would break every one of them.
 */
export const BlastRadiusResponse = BlastRadius.extend({
  downstream: z.array(DownstreamNode),
  state: BlastState,
  /** Machine-readable cause. Null if and only if `state` is 'ok'. */
  reason: z.string().nullable(),
  /** Files whose reverse-import walk was cut short by the fan-out cap. */
  truncated_files: z.array(z.string()).default([]),
  prior_prs: z.array(PriorPr).default([]),
  notes_state: z.enum(['absent', 'ready']).default('absent'),
});
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;

/**
 * Request of `POST /reviews/diff` — review a patch that belongs to no pull
 * request, so a change can be reviewed before it is pushed.
 *
 * `patch` is a unified diff exactly as `git diff` writes one. The route parses
 * it server-side and runs the same engine a PR review runs; nothing is
 * persisted, because there is no pull request to hang it on.
 */
export const DiffReviewRequest = z.object({
  patch: z.string().min(1),
  /** Omit to use the workspace's first enabled agent. */
  agentId: z.string().uuid().optional(),
  /** Free text shown to the reviewer as the task, e.g. the branch name. */
  task: z.string().max(500).optional(),
});
export type DiffReviewRequest = z.infer<typeof DiffReviewRequest>;

/** Response of `POST /reviews/diff`. */
export const DiffReviewResponse = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  model: z.string(),
  verdict: Verdict,
  score: z.number().int(),
  summary: z.string(),
  /** Grounded, in-scope findings — the set score and verdict derive from. */
  findings: z.array(Finding),
  /** Findings at or above the agent's `ci_fail_on` gate. */
  blockers: z.number().int(),
  /** The gate this review was judged under. */
  fail_on: z.string(),
  files_reviewed: z.number().int(),
  grounding: z.string(),
  cost_usd: z.number().nullable(),
});
export type DiffReviewResponse = z.infer<typeof DiffReviewResponse>;

/** Response of `POST /pulls/:id/blast/history-notes`. */
export const BlastHistoryNotes = z.object({
  notes: z.array(z.object({ pr_number: z.number().int(), note: z.string() })),
});
export type BlastHistoryNotes = z.infer<typeof BlastHistoryNotes>;
