import type { LLMProvider, Provider } from '@devdigest/shared';
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

/**
 * The single dependency the injection scan has (H7). Declared as a port so
 * `safety.ts` never names `Container`: a use case that takes the composition
 * root hides what it actually touches, and here that is one function.
 *
 * Resolution stays a FUNCTION rather than a resolved `LLMProvider` because the
 * scan tries providers in order and each may throw `ConfigError` for a missing
 * key — the "no key ⇒ null, never a throw" contract lives in that loop.
 */
export interface SkillSafetyDeps {
  llm(provider: Provider): Promise<LLMProvider>;
}
