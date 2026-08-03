import type { SkillRow, SkillVersionRow } from '../../db/rows.js';

/**
 * Domain types for the skills module.
 *
 * Row types live HERE, not in `repository.ts`, for two reasons:
 *  - `helpers.ts` is ring 0 and may not import `src/db/` at all (arch rule
 *    `c5-pure-helpers`), so it cannot pull the row type from the schema;
 *  - importing it from `repository.ts` instead would close the cycle
 *    helpers → repository → helpers (`no-circular`), which is the recorded
 *    trap in server/insights.md.
 *
 * Both `helpers.ts` and `repository.ts` depend inward on this file.
 */
export type { SkillRow, SkillVersionRow };

/** Why an archive entry did not become the skill body. */
export type SkipReason = 'executable' | 'not_markdown' | 'unused_markdown';
