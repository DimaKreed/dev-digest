import { pgTable, uuid, text, integer, boolean, jsonb, primaryKey } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  type: text('type', { enum: ['rubric', 'convention', 'security', 'custom'] }).notNull(),
  // TS-level union only — Drizzle's `enum` option emits no CHECK constraint on
  // a `text` column, so adding a value here needs no migration. Mirrors
  // `SkillSource` in vendor/shared/contracts/knowledge.ts.
  source: text('source', {
    enum: ['manual', 'imported_url', 'imported_file', 'extracted', 'community'],
  }).notNull(),
  body: text('body').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  version: integer('version').notNull().default(1),
  evidenceFiles: jsonb('evidence_files').$type<string[]>(),
  createdAt: now(),
});

/**
 * Immutable body snapshot per version. A saved edit never rewrites history —
 * "restore" writes a NEW version carrying an older body — so an eval run stays
 * reproducible against the exact text it scored.
 */
export const skillVersions = pgTable(
  'skill_versions',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    /** Optional "what changed" label the author types when saving. */
    note: text('note'),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.version] }) }),
);
