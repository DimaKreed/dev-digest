import type { SkillType } from "@devdigest/shared";

export const DRAWER_WIDTH = 640;

/** Only these reach the server; the archive filter then admits .md only. */
export const ACCEPTED_EXTENSIONS = ".md,.markdown,.zip";

/**
 * Mirrors the `SkillType` enum in @devdigest/shared. Declared here rather than
 * imported from a sibling component's constants — one feature component is not
 * an import target for another.
 */
export const SKILL_TYPES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

export const IMPORT_TABS = ["file", "url"] as const;
export type ImportTab = (typeof IMPORT_TABS)[number];
