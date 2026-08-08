import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { PullRow } from '../../../db/rows.js';
import type { IntentUpsert, StoredIntent } from '../ports.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

export async function upsertIntent(db: Db, prId: string, intent: IntentUpsert): Promise<void> {
  const columns = {
    intent: intent.intent,
    inScope: intent.in_scope,
    outOfScope: intent.out_of_scope,
    headSha: intent.head_sha,
    model: intent.model,
    confidence: intent.confidence,
    sources: intent.sources,
    missingContext: intent.missing_context,
  };
  await db
    .insert(t.prIntent)
    .values({ prId, ...columns })
    // A re-derivation replaces the whole classification, provenance included —
    // never merge a new intent onto an older head's sources.
    .onConflictDoUpdate({ target: t.prIntent.prId, set: { ...columns, createdAt: new Date() } });
}

export async function getIntent(db: Db, prId: string): Promise<StoredIntent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    head_sha: row.headSha,
    model: row.model,
    confidence: row.confidence,
    sources: row.sources,
    missing_context: row.missingContext,
    // `created_at` is NOT NULL with a default, so pre-migration rows were
    // backfilled with the migration timestamp, not with their real write time.
    created_at: row.createdAt.toISOString(),
  };
}
