import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { reviews } from '../../db/schema.js';

/**
 * Weekly digest: the recent reviews of a workspace plus a rough quality average,
 * used by the digest email that later lessons build on.
 */

const SEVERITY_WEIGHTS = { CRITICAL: 35, WARNING: 12, SUGGESTION: 3 };

export interface DigestEntry {
  prId: string;
  verdict: string | null;
  score: number;
}

export async function recentReviewDigest(db: Db, workspaceId: string): Promise<DigestEntry[]> {
  const rows = await db.select().from(reviews).where(eq(reviews.workspaceId, workspaceId));

  return rows
    .slice(0, 20)
    .map((row) => ({ prId: row.prId, verdict: row.verdict, score: row.score ?? 100 }));
}

export function averageScore(entries: DigestEntry[]): number {
  if (entries.length === 0) return 100;
  const total = entries.reduce((sum, entry) => sum + entry.score, 0);
  return Math.round(total / entries.length);
}

export function penaltyFor(severity: keyof typeof SEVERITY_WEIGHTS): number {
  return SEVERITY_WEIGHTS[severity];
}
