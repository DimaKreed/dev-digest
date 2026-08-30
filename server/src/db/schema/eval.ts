import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable('eval_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  inputDiff: text('input_diff'),
  inputFiles: jsonb('input_files'),
  inputMeta: jsonb('input_meta'),
  expectedOutput: jsonb('expected_output'),
  notes: text('notes'),
  /**
   * The polarity of the assertion (SPEC-04). `must_find` comes from an ACCEPTED
   * finding ("there IS something at this file:line"); `must_not_flag` from a
   * DISMISSED one ("there is NOT"). Defaulted rather than nullable: every row
   * written before this column existed is a positive case.
   */
  expectationKind: text('expectation_kind', { enum: ['must_find', 'must_not_flag'] })
    .notNull()
    .default('must_find'),
  /**
   * Provenance when the case was seeded from a real finding. Deliberately a
   * bare uuid with NO foreign key: the finding may be deleted with its review,
   * and losing the provenance must not delete the case built from it.
   */
  sourceFindingId: uuid('source_finding_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
},
  // The list query is always "this agent's cases": (owner_kind, owner_id) is the
  // access path, and Postgres indexes neither on its own.
  (t) => ({ ownerIdx: index('eval_cases_owner_idx').on(t.ownerKind, t.ownerId) }),
);

export const evalRuns = pgTable('eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => evalCases.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  actualOutput: jsonb('actual_output'),
  pass: boolean('pass'),
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  durationMs: integer('duration_ms'),
  costUsd: doublePrecision('cost_usd'),
  /**
   * One RUN OF THE SET is the rows sharing a `batch_id` (SPEC-04). The per-case
   * row stays the unit of storage — there is no `eval_batches` table — because
   * every batch-level number is micro-averaged from `counts` below, and a
   * second table would let the two disagree.
   */
  batchId: uuid('batch_id'),
  /** The agent config that produced this row. Snapshotted, not joined: a run
   *  must stay readable and comparable after the agent is edited again. */
  agentVersion: integer('agent_version'),
  systemPrompt: text('system_prompt'),
  model: text('model'),
  /** Per-case scoring counts (EvalCaseCounts) the batch aggregate sums. */
  counts: jsonb('counts'),
  /** Set when this case's model call failed. Such a row counts nowhere. */
  error: text('error'),
},
  // Every read of a run of the set groups by batch_id; without this each batch
  // read is a seq-scan over every eval row ever written.
  (t) => ({ batchIdx: index('eval_runs_batch_idx').on(t.batchId) }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
