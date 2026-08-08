import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';

/**
 * Raw reads of the workspace `settings` bag.
 *
 * This module reads the settings TABLE rather than importing
 * `modules/settings/feature-models.ts`: the `no-cross-module` arch rule forbids
 * `modules/reviews` reaching into a sibling module's folder, and reading the row
 * through this module's own repository is the legal equivalent. The same
 * duplication exists in `modules/conventions/service.ts:resolveModel`.
 *
 * Values are returned UNPARSED — the service validates them with the shared
 * Zod schema and falls back to the registry default.
 */
export async function settingValue(db: Db, workspaceId: string, key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: t.settings.value })
    .from(t.settings)
    .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, key)));
  return row?.value;
}
