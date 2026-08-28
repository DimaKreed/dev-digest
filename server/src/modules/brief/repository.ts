import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { BriefRepositoryPort, BriefUpsert, StoredBrief } from './ports.js';

/**
 * Brief data-access. The ONLY place in this codebase that touches `pr_brief`.
 *
 * It writes no other table. It READS one it does not own — `pull_requests`,
 * to resolve tenancy — and that is table access, not a cross-module import:
 * the same shape `OnboardingRepository` uses when it joins `repos`. Everything
 * else the brief needs from the review domain arrives through a structural port
 * over `ReviewRepository`, because that repository already owns those tables
 * and a second one over them would break onion rule C2.
 *
 * TENANCY: `pr_brief` carries no `workspace_id` — its only key is `pr_id`. So
 * both the read and the write resolve the workspace through `pull_requests`
 * FIRST, and there is no path here that reaches a brief row without that check.
 * A repository that scopes its read but not its write is one refactor away from
 * being wrong.
 *
 * A brief is ONE document in ONE row, so a generation is a single write: no
 * transaction is owed (H9 read in reverse) and no partial-brief state exists to
 * observe (AC-18).
 */
export class BriefRepository implements BriefRepositoryPort {
  constructor(private db: Db) {}

  /**
   * The stored brief, or `undefined` when there is none — or when the pull
   * request it belongs to is not this workspace's. The join is the tenancy
   * check (AC-22).
   */
  async get(workspaceId: string, prId: string): Promise<StoredBrief | undefined> {
    const [row] = await this.db
      .select({
        json: t.prBrief.json,
        headSha: t.prBrief.headSha,
        model: t.prBrief.model,
        generatedAt: t.prBrief.generatedAt,
      })
      .from(t.prBrief)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.prBrief.prId))
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.prBrief.prId, prId)));
    return row;
  }

  /**
   * Replace this pull request's brief. `pr_id` is the primary key, so the
   * conflict clause gives AC-17's replace-on-regeneration for free — one row
   * per PR, no versions, no second write to make atomic.
   *
   * Tenancy is re-resolved here rather than trusted from the caller, for the
   * same reason the read joins: the row has no workspace of its own.
   */
  async upsert(workspaceId: string, prId: string, doc: BriefUpsert): Promise<StoredBrief> {
    const [owner] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!owner) {
      throw new Error(`brief upsert refused: pull request ${prId} is not this workspace's`);
    }

    const generatedAt = new Date();
    const values = {
      prId,
      json: doc.json,
      headSha: doc.headSha,
      model: doc.model,
      generatedAt,
    };
    const [row] = await this.db
      .insert(t.prBrief)
      .values(values)
      .onConflictDoUpdate({
        target: t.prBrief.prId,
        set: {
          json: doc.json,
          headSha: doc.headSha,
          model: doc.model,
          generatedAt,
        },
      })
      .returning({
        json: t.prBrief.json,
        headSha: t.prBrief.headSha,
        model: t.prBrief.model,
        generatedAt: t.prBrief.generatedAt,
      });
    if (!row) throw new Error(`brief upsert wrote no row for pull request ${prId}`);
    return row;
  }
}
