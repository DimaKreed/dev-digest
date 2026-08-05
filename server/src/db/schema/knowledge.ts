import { pgTable, uuid, text, jsonb, timestamp, doublePrecision, integer, vector, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { skills } from './skills';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

/**
 * One extracted house-rule candidate, always backed by evidence that was
 * verified against the cloned working copy IN CODE — never on the model's word.
 *
 * `evidencePath`/`evidenceSnippet`/`evidence{Start,End}Line` are the PRIMARY
 * (first verified) occurrence, the one the card renders and links to GitHub.
 * `evidenceFiles` holds every verified path and `occurrences` its length: a rule
 * seen exactly once is a coincidence, not a convention, so the extractor drops
 * anything below two distinct files before it ever reaches this table.
 *
 * `status` supersedes the original `accepted: boolean` — a boolean cannot tell
 * "not triaged yet" apart from "explicitly rejected", and only accepted rows are
 * merged into the generated skill.
 */
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    rule: text('rule').notNull(),
    // TS-level union only (Drizzle's `enum` emits no CHECK on text) — mirrors
    // `ConventionCategory` in vendor/shared/contracts/knowledge.ts.
    category: text('category', {
      enum: [
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
      ],
    })
      .notNull()
      .default('structure'),
    evidencePath: text('evidence_path'),
    evidenceSnippet: text('evidence_snippet'),
    evidenceStartLine: integer('evidence_start_line'),
    evidenceEndLine: integer('evidence_end_line'),
    /** Every verified path, primary first. Length === `occurrences`. */
    evidenceFiles: jsonb('evidence_files').$type<string[]>(),
    occurrences: integer('occurrences').notNull().default(1),
    confidence: doublePrecision('confidence'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    /** Set once this candidate has been merged into a generated skill. */
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' }),
    /** When the scan that produced this candidate ran. */
    createdAt: now(),
  },
  (t) => ({ repoIdx: index('conventions_repo_idx').on(t.repoId) }),
);
