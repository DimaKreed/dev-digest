import type { SkillType } from "@devdigest/shared";

/**
 * The `SkillType` enum, hand-mirrored as a runtime value.
 *
 * `@devdigest/shared` can only be imported here as a TYPE — pulling a runtime
 * value out of that barrel drags `./contracts/*.js` into the bundle and Next's
 * webpack cannot resolve them (same reason `FEATURE_MODELS` is mirrored in
 * `lib/feature-models.ts`). So the list is duplicated on purpose; if a value is
 * added to the Zod enum it has to be added here too.
 *
 * It lives in `lib/` rather than beside any one component because three
 * unrelated features render it — the create modal, the import drawer and the
 * skill editor's config tab — and a component folder is not an import target
 * for a sibling feature.
 */
export const SKILL_TYPES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

export const DEFAULT_SKILL_TYPE: SkillType = "custom";
