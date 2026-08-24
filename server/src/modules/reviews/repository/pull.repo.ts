import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { PullRow } from '../../../db/rows.js';
import type { IntentUpsert, PriorPrRow, StoredIntent } from '../ports.js';

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
 * Merged PRs of the same repo that touched any of `paths`, newest first.
 *
 * One query: join the file rows of other PRs against the given paths, then
 * collapse to one row per PR carrying the overlapping subset. `array_agg` runs
 * over the join, so `files_overlap` is exactly the intersection — the same list
 * the UI shows as chips.
 *
 * Reads no code index, so this works even when the blast radius itself is
 * degraded: which PRs touched a file is plain PR history.
 */
export async function getPriorPrs(
  db: Db,
  repoId: string,
  prId: string,
  paths: string[],
  limit: number,
): Promise<PriorPrRow[]> {
  if (paths.length === 0) return [];
  const rows = await db
    .select({
      number: t.pullRequests.number,
      title: t.pullRequests.title,
      author: t.pullRequests.author,
      mergedAt: t.pullRequests.updatedAt,
      filesOverlap: sql<string[]>`array_agg(distinct ${t.prFiles.path})`,
    })
    .from(t.pullRequests)
    .innerJoin(t.prFiles, eq(t.prFiles.prId, t.pullRequests.id))
    .where(
      and(
        eq(t.pullRequests.repoId, repoId),
        ne(t.pullRequests.id, prId),
        eq(t.pullRequests.status, 'merged'),
        inArray(t.prFiles.path, paths),
      ),
    )
    .groupBy(
      t.pullRequests.id,
      t.pullRequests.number,
      t.pullRequests.title,
      t.pullRequests.author,
      t.pullRequests.updatedAt,
    )
    // NULLS LAST explicitly: `updated_at` is nullable, and Postgres DESC
    // defaults to NULLS FIRST — five undated rows would otherwise fill the
    // whole limit and push out the genuinely recent overlaps.
    .orderBy(sql`${t.pullRequests.updatedAt} desc nulls last`)
    .limit(limit);
  return rows.map((r) => ({ ...r, filesOverlap: r.filesOverlap ?? [] }));
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
