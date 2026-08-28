import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff — each with its own consumers, none of them composed into
 * `PrBrief` any more. `PrBrief` itself, at the end of this file, is the
 * persisted brief DOCUMENT (SPEC-03); see the docblock there for why it was
 * redefined in place rather than given a sibling.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- PR Brief document (pr_brief.json) ----

/**
 * The persisted brief document (SPEC-03).
 *
 * REDEFINED IN PLACE. `PrBrief` used to be the composition
 * `{ intent, blast, risks, history }` — forward scaffolding that was never
 * written: `pr_brief` had zero writes anywhere, so no stored document has the
 * old shape and nothing had to be migrated. The building blocks above
 * (`Intent`, `BlastRadius`, `Risk`, `Risks`, `PrHistory`, `SmartDiff`) are
 * unchanged and keep their own consumers; only the composed type moved.
 *
 * Every field that a document written before this feature — or before a later
 * field is added — could lack is `.nullish()` or carries `.default([])`, never
 * `.nullable()`. The whole document round-trips through a jsonb column, so an
 * older row has no such KEY at all and `.nullable()` still requires the key to
 * be present. AC-12; root `insights.md` § *A Zod field parsed back out of a
 * jsonb column must be `.nullish()`*.
 */

export const BriefRiskLevel = z.enum(['high', 'medium', 'low']);
export type BriefRiskLevel = z.infer<typeof BriefRiskLevel>;

/**
 * A reference into the change, as a path plus an OPTIONAL line.
 *
 * Deliberately not `Risk.file_refs`' preformatted `path:line` string (AC-11):
 * a reference with no line has to be representable, and each part has to be
 * verifiable on its own before it becomes a deep link. `Risk` keeps its own
 * shape — this sits beside it rather than replacing it.
 */
export const BriefFileRef = z.object({
  path: z.string(),
  line: z.number().int().nullish(),
});
export type BriefFileRef = z.infer<typeof BriefFileRef>;

export const BriefRisk = z.object({
  title: z.string(),
  explanation: z.string(),
  severity: BriefRiskLevel,
  refs: z.array(BriefFileRef).default([]),
});
export type BriefRisk = z.infer<typeof BriefRisk>;

/** One "read this first" entry. Activating it deep-links into the diff tab. */
export const BriefReviewFocus = z.object({
  label: z.string(),
  ref: BriefFileRef,
  reason: z.string(),
});
export type BriefReviewFocus = z.infer<typeof BriefReviewFocus>;

/**
 * An input that did not fully reach the model, named to the reader.
 *
 * One shape covers all three honesty cases — dropped to fit the token cap
 * (AC-06), absent or unreachable (AC-07), and switched off by flag (AC-08) —
 * because the card renders them identically and the distinction lives in
 * `reason`.
 */
export const BriefSource = z.object({
  name: z.string(),
  reason: z.string(),
});
export type BriefSource = z.infer<typeof BriefSource>;

/**
 * What the one generation call cost. Stored INSIDE the document rather than in
 * `agent_runs.cost_usd`: a brief has no run at all, and the established
 * precedent keeps ancillary call costs out of that column anyway
 * (`modules/reviews/run-executor.ts`). `cost_usd` is `.nullable()` and not
 * `.nullish()` on purpose — it is always written when `usage` is, and an
 * unpriced call is a real `null`, displayed as unpriced rather than as $0.00
 * (AC-39).
 */
export const BriefUsage = z.object({
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number().nullable(),
});
export type BriefUsage = z.infer<typeof BriefUsage>;

export const PrBrief = z.object({
  risk_level: BriefRiskLevel,
  /** What the change does. */
  what: z.string(),
  /** Why it is risky to merge. */
  why: z.string(),
  risks: z.array(BriefRisk).default([]),
  review_focus: z.array(BriefReviewFocus).default([]),
  /** The head the input was assembled from — not the head at write time (AC-20). */
  head_sha: z.string().nullish(),
  provider: z.string().nullish(),
  model: z.string().nullish(),
  /** AC-06 / AC-07 / AC-08 — every input that did not fully reach the model. */
  degraded_sources: z.array(BriefSource).default([]),
  /** AC-13 — model entries dropped because their reference was not in the input. */
  dropped_entries: z.number().int().nullish(),
  usage: BriefUsage.nullish(),
});
export type PrBrief = z.infer<typeof PrBrief>;
