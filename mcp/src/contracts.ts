/**
 * Ring 1 — narrow, tolerant mirrors of the DevDigest API response shapes.
 *
 * These are NOT a third copy of `@devdigest/shared`. Each schema covers only the
 * fields the five tools actually read, and every one names the canonical contract
 * it mirrors in its own comment. Two properties are deliberate and load-bearing:
 *
 *   - unknown keys are stripped (Zod's default), so a field added on the server
 *     side is a no-op here rather than a parse failure;
 *   - anything the server may omit or null out is `.nullish()`, never
 *     `.nullable()` — `.nullable()` still requires the KEY to be present, which
 *     breaks the moment this package talks to a server version it did not ship
 *     with.
 *
 * The API declares no response schemas, so these are also the only validation
 * standing between a wire payload and the tool output.
 */
import { z } from 'zod';

/** Mirrors `contracts/knowledge.ts` → `Agent` (only what list_agents renders). */
export const AgentBrief = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  provider: z.string().nullish(),
  model: z.string().nullish(),
  strategy: z.string().nullish(),
  ci_fail_on: z.string().nullish(),
  enabled: z.boolean(),
});
export type AgentBrief = z.infer<typeof AgentBrief>;

/** Mirrors `contracts/platform.ts` → `Repo` (only what target resolution needs). */
export const RepoBrief = z.object({
  id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
});
export type RepoBrief = z.infer<typeof RepoBrief>;

/**
 * Mirrors `contracts/platform.ts` → `PrMeta`. Note `id` is nullish upstream too:
 * a PR listed straight from GitHub has no local row yet, and such a PR cannot be
 * reviewed — resolution treats a missing id as "not importable".
 */
export const PrBrief = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
  title: z.string(),
});
export type PrBrief = z.infer<typeof PrBrief>;

/** Mirrors `contracts/review-api.ts` → `ReviewRunTarget`. */
export const RunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type RunTarget = z.infer<typeof RunTarget>;

/**
 * Mirrors `contracts/review-api.ts` → `ReviewRunResponse`.
 *
 * `reviews` is intentionally absent from this mirror. The endpoint is
 * fire-and-forget and that array is ALWAYS empty, whatever the upstream contract
 * comment suggests — leaving it out makes it impossible to read by accident.
 */
export const StartReviewResponse = z.object({
  pr_id: z.string(),
  runs: z.array(RunTarget),
});
export type StartReviewResponse = z.infer<typeof StartReviewResponse>;

/**
 * Mirrors `contracts/trace.ts` → `RunSummary`.
 *
 * `status` is a bare nullable string upstream, not an enum, so it stays a string
 * here. The wait loop must therefore treat "anything that is not `running`" as
 * terminal rather than matching a closed set it does not control.
 */
export const RunBrief = z.object({
  run_id: z.string(),
  agent_id: z.string().nullish(),
  agent_name: z.string().nullish(),
  status: z.string().nullish(),
  error: z.string().nullish(),
  duration_ms: z.number().int().nullish(),
  findings_count: z.number().int().nullish(),
  score: z.number().int().nullish(),
  blockers: z.number().int().nullish(),
});
export type RunBrief = z.infer<typeof RunBrief>;

/** Mirrors `contracts/findings.ts` → `Severity`. Fixed by contract. */
export const Severity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type Severity = z.infer<typeof Severity>;

/** Mirrors `contracts/findings.ts` → `Verdict`. Fixed by contract. */
export const Verdict = z.enum(['request_changes', 'approve', 'comment']);
export type Verdict = z.infer<typeof Verdict>;

/**
 * Mirrors `contracts/review-api.ts` → `FindingRecord`.
 *
 * `dismissed_at` is carried because a dismissed finding is excluded from what the
 * tools report — the product's own severity tally excludes them, and a tool that
 * disagreed with the UI would read as a bug.
 */
export const FindingBrief = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string().nullish(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int().nullish(),
  end_line: z.number().int().nullish(),
  rationale: z.string().nullish(),
  suggestion: z.string().nullish(),
  dismissed_at: z.string().nullish(),
});
export type FindingBrief = z.infer<typeof FindingBrief>;

/** Mirrors `contracts/review-api.ts` → `ReviewRecord`. */
export const ReviewBrief = z.object({
  id: z.string(),
  run_id: z.string().nullish(),
  agent_id: z.string().nullish(),
  agent_name: z.string().nullish(),
  verdict: Verdict.nullish(),
  summary: z.string().nullish(),
  score: z.number().int().nullish(),
  created_at: z.string(),
  findings: z.array(FindingBrief),
});
export type ReviewBrief = z.infer<typeof ReviewBrief>;

/** Mirrors `contracts/knowledge.ts` → `ConventionStatus` (verified at source). */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

/** Mirrors `contracts/knowledge.ts` → `ConventionCategory` (verified at source). */
export const ConventionCategory = z.enum([
  'naming',
  'error-handling',
  'async',
  'imports',
  'structure',
  'api-design',
  'testing',
  'typing',
  'logging',
  'data-access',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

/**
 * Mirrors `contracts/knowledge.ts` → `ConventionCandidate`.
 *
 * `occurrences` is a counted fact upstream (a candidate only survives if its
 * evidence was matched in at least two distinct files), which is why the tool
 * description is allowed to promise it.
 */
export const ConventionBrief = z.object({
  id: z.string(),
  rule: z.string(),
  category: z.string(),
  occurrences: z.number().int(),
  confidence: z.number(),
  status: z.string(),
  evidence_path: z.string().nullish(),
  evidence_snippet: z.string().nullish(),
  evidence_start_line: z.number().int().nullish(),
  evidence_end_line: z.number().int().nullish(),
});
export type ConventionBrief = z.infer<typeof ConventionBrief>;

/** Mirrors the service-level wrapper returned by `GET /repos/:id/conventions`. */
export const ConventionListResponse = z.object({
  candidates: z.array(ConventionBrief),
  last_scan_at: z.string().nullish(),
});
export type ConventionListResponse = z.infer<typeof ConventionListResponse>;

/** Mirrors `contracts/platform.ts` → `ApiErrorBody`. Every route uses it. */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
