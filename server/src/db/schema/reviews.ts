import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import type { IntentSource } from '../../vendor/shared/contracts/intent';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id'),
    /** The agent_run that produced this review (links the timeline run ↔ review). */
    runId: uuid('run_id'),
    kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    score: integer('score'),
    model: text('model'),
    createdAt: now(),
  },
  // `run_id` is a bare uuid with no FK (run deletion clears reviews by hand in
  // run.repo.ts). Every per-skill stat joins run_skills → agent_runs → reviews
  // on it, so without this index each rollup is a seq-scan over all reviews.
  (t) => ({ runIdx: index('reviews_run_id_idx').on(t.runId) }),
);

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull(),
  suggestion: text('suggestion'),
  confidence: doublePrecision('confidence').notNull(),
  kind: text('kind').notNull().default('finding'),
  trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  // Intent layer. Nullable: every row that predates the intent migration has
  // neither, and an unlabelled finding is treated as in scope.
  outOfScope: boolean('out_of_scope'),
  scopeRationale: text('scope_rationale'),
});

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // Classifier provenance. All nullable — rows written before the intent layer
  // shipped have none of it. `headSha` + `model` together are the reuse key:
  // a stored classification is reused only on an exact match of both.
  headSha: text('head_sha'),
  model: text('model'),
  confidence: doublePrecision('confidence'),
  sources: jsonb('sources').$type<IntentSource[]>(),
  missingContext: jsonb('missing_context').$type<string[]>(),
  createdAt: now(),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
  // Reuse key. `headSha` + `model` together decide reusability exactly the way
  // `pr_intent` states it above: a stored brief is reused only on an exact
  // match of BOTH, and anything else is stale. Nullable because a row written
  // before this migration has neither — there are none today, but the column
  // pair outlives that fact.
  //
  // These two duplicate values that are ALSO written inside `json`. That is
  // deliberate, not redundancy to clean up: the document has to be
  // self-describing once it leaves the database (AC-09), while the staleness
  // comparison is a column read that must not deserialise a document to answer.
  headSha: text('head_sha'),
  model: text('model'),
  // Event time, so `timestamptz`. `defaultNow()` is safe to add to this table
  // without a rewrite concern because `pr_brief` has never been written to.
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});
