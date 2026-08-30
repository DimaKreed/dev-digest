import { z } from 'zod';
import { Verdict, Finding, Severity, FindingCategory } from './findings.js';
import { EvalRun, EvalOwnerKind, Conformance } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/**
 * The polarity of a case's assertion.
 *
 * `must_find` is seeded from an ACCEPTED finding — "at this file:line there IS
 * something to report". `must_not_flag` from a DISMISSED one — "there is NOT".
 * The two drive different metrics: only a `must_not_flag` expectation can make
 * a produced finding count as noise, which is what moves precision.
 */
export const EvalExpectationKind = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationKind = z.infer<typeof EvalExpectationKind>;

/**
 * One expected (or forbidden) finding location.
 *
 * `severity`, `category` and `title` are carried for the reader and are NOT
 * matched on: an agent that finds the right bug and calls it a WARNING instead
 * of a CRITICAL has still found it, and scoring that as a miss would make the
 * metric measure vocabulary rather than detection.
 */
export const EvalExpectation = z.object({
  file: z.string().min(1),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: Severity.nullish(),
  category: FindingCategory.nullish(),
  title: z.string().nullish(),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
  /** SPEC-04. Defaulted so a payload written before the column existed parses. */
  expectation_kind: EvalExpectationKind.default('must_find'),
  source_finding_id: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type EvalCaseInputBody = z.input<typeof EvalCaseInput>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  /** SPEC-04 columns. Nullish: rows written before the migration have none. */
  batch_id: z.string().nullish(),
  agent_version: z.number().int().nullish(),
  system_prompt: z.string().nullish(),
  model: z.string().nullish(),
  error: z.string().nullish(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunRecord),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ===========================================================================
// Eval Pipeline (SPEC-04) — per-case rows, batches, dashboard
// ===========================================================================

/** The scoring counts one case contributes to its batch. Micro-averaged, not meaned. */
export const EvalCaseCounts = z.object({
  /** Expectations matched by a produced finding (must_find only). */
  tp: z.number().int(),
  /** Expectations left unmatched (must_find only). */
  fn: z.number().int(),
  /** Produced findings that hit a forbidden location (must_not_flag only). */
  fp: z.number().int(),
  /** Grounded, in-scope findings the agent produced for this case. */
  findings: z.number().int(),
  /** Candidate findings that survived the citation-grounding gate. */
  grounded_kept: z.number().int(),
  /** Candidate findings the gate saw at all (kept + dropped). */
  grounded_total: z.number().int(),
});
export type EvalCaseCounts = z.infer<typeof EvalCaseCounts>;

/** One case's row inside a batch — the persisted `eval_runs` row, expanded. */
export const EvalCaseRun = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string(),
  expectation_kind: EvalExpectationKind,
  ran_at: z.string(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  counts: EvalCaseCounts.nullable(),
  /** The grounded findings this case produced, for the per-case detail view. */
  findings: z.array(Finding),
  /**
   * The verdict, per expectation, as the SCORER saw it — not re-derived by the
   * reader. `missed` are the `must_find` expectations no finding matched;
   * `violations` are the findings that landed on a `must_not_flag` location.
   *
   * Persisted rather than recomputed in the client on purpose: the match rule
   * (same file, overlapping lines) has exactly one implementation, and a second
   * copy in the UI is a copy that will disagree with the metric beside it.
   */
  missed: z.array(EvalExpectation).default([]),
  violations: z.array(Finding).default([]),
  error: z.string().nullable(),
});
export type EvalCaseRun = z.infer<typeof EvalCaseRun>;

/** A persisted eval case as the API returns it. */
export const EvalCaseRecord = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  expectation_kind: EvalExpectationKind,
  input_diff: z.string(),
  input_meta: z.unknown().nullish(),
  expected_output: z.array(EvalExpectation),
  notes: z.string().nullable(),
  source_finding_id: z.string().nullable(),
  created_at: z.string(),
  /** The most recent run of THIS case, or null when it has never run. */
  last_run: EvalCaseRun.nullable(),
});
export type EvalCaseRecord = z.infer<typeof EvalCaseRecord>;


/**
 * A case that does NOT exist yet — what the editor is filled with before the
 * user has decided to keep it.
 *
 * SPEC-04 originally created the case on the click. That skipped the step the
 * harness is actually for: a case whose expectation is one line off is dropped
 * by the grounding gate on every run, and the only way to notice is to run it.
 * So the click now produces a draft, the editor can run the draft, and only
 * `Save` writes a row.
 */
export const EvalCaseDraft = z.object({
  /** The agent that produced the finding, and therefore will own the case. */
  agent_id: z.string(),
  agent_name: z.string(),
  name: z.string(),
  expectation_kind: EvalExpectationKind,
  input_diff: z.string(),
  input_meta: z.unknown().nullish(),
  expected_output: z.array(EvalExpectation),
  source_finding_id: z.string(),
  /** Files the frozen diff touches — the editor's `Files` tab. */
  input_files: z.array(z.string()),
});
export type EvalCaseDraft = z.infer<typeof EvalCaseDraft>;

/** Body of the dry run: a case's content, with no case behind it. */
export const EvalPreviewInput = z.object({
  expectation_kind: EvalExpectationKind.default('must_find'),
  input_diff: z.string().min(1),
  input_meta: z.unknown().optional(),
  expected_output: z.array(EvalExpectation).default([]),
});
export type EvalPreviewInput = z.infer<typeof EvalPreviewInput>;

/** The metrics of one run of the set. All of them are computed in code, no model. */
export const EvalMetrics = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
});
export type EvalMetrics = z.infer<typeof EvalMetrics>;

/**
 * Where a batch is in its life.
 *
 * `running` means THIS process is still executing the batch: the set runs in
 * the background and the client polls, because a set of ten cases is ten model
 * calls in sequence and no HTTP request should be holding that open. The state
 * is deliberately not a column — a batch cannot outlive the process running it,
 * so a persisted `running` would be a lie every time the server restarts.
 */
export const EvalBatchStatus = z.enum(['running', 'done']);
export type EvalBatchStatus = z.infer<typeof EvalBatchStatus>;

/**
 * One run of the whole set — the rows sharing a `batch_id`, aggregated.
 *
 * `system_prompt` and `model` are the snapshot taken when the batch ran, not a
 * join onto the agent: comparing two batches has to keep working after the
 * agent has been edited a third time.
 */
export const EvalBatch = z.object({
  batch_id: z.string(),
  status: EvalBatchStatus,
  /** Cases the batch set out to run. Equals `cases_done` once it is `done`. */
  cases_total: z.number().int(),
  /** Cases that have a persisted row yet — the progress a running batch shows. */
  cases_done: z.number().int(),
  agent_id: z.string(),
  agent_name: z.string().nullish(),
  agent_version: z.number().int().nullable(),
  system_prompt: z.string().nullable(),
  model: z.string().nullable(),
  ran_at: z.string(),
  metrics: EvalMetrics,
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  /** Cases whose model call failed. Counted in no metric (SPEC-04 AC-07). */
  errors: z.number().int(),
  cases: z.array(EvalCaseRun),
});
export type EvalBatch = z.infer<typeof EvalBatch>;

/** A batch as the history table lists it — everything but the per-case rows. */
export const EvalBatchSummary = EvalBatch.omit({ cases: true });
export type EvalBatchSummary = z.infer<typeof EvalBatchSummary>;

/** One agent's row on the Eval Dashboard. `latest` is null when never run. */
export const EvalAgentSummary = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  model: z.string(),
  cases_total: z.number().int(),
  latest: EvalBatchSummary.nullable(),
  /** Recall of each batch, oldest first — the row's sparkline. */
  trend: z.array(z.number()),
});
export type EvalAgentSummary = z.infer<typeof EvalAgentSummary>;

/** `GET /eval/dashboard` — every agent plus the newest batches across all of them. */
export const EvalDashboardAll = z.object({
  agents: z.array(EvalAgentSummary),
  recent_runs: z.array(EvalBatchSummary),
});
export type EvalDashboardAll = z.infer<typeof EvalDashboardAll>;

/** `GET /agents/:id/eval-dashboard` — one agent's metrics, trend and history. */
export const EvalAgentDashboard = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  model: z.string(),
  cases_total: z.number().int(),
  latest: EvalBatchSummary.nullable(),
  /** Signed change from the previous batch. Zeroes when there is no previous. */
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  /** Chronological (oldest first) so a chart can render it directly. */
  trend: z.array(EvalTrendPoint),
  /** Newest first, for the history table. */
  batches: z.array(EvalBatchSummary),
  /**
   * A one-line honest note about the newest batch, or null. Written in code
   * from the deltas — never generated, so it can never disagree with them.
   */
  alert: z.string().nullable(),
});
export type EvalAgentDashboard = z.infer<typeof EvalAgentDashboard>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
