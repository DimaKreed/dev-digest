import type { SkillType } from "@devdigest/shared";

export const MODAL_WIDTH = 640;

/** Mirrors the `SkillType` enum in @devdigest/shared. */
export const SKILL_TYPES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

export const DEFAULT_TYPE: SkillType = "custom";
