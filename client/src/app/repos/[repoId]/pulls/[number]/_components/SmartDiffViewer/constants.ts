/** Constants for the SmartDiffViewer. */
import type { SmartDiffRole } from "@devdigest/shared";

/** Roles whose group starts collapsed — generated files are not worth a scroll. */
export const COLLAPSED_ROLES: readonly SmartDiffRole[] = ["boilerplate"];

/**
 * Past this many finding-lines on one file, the chips are dropped and only the
 * count badge renders — 30 chips is a wall, not an index.
 *
 * NOTE: no skill or invariant governs this number; it is a judgement call, put
 * here rather than inline so it is at least reviewable in one place.
 */
export const MAX_FINDING_CHIPS_PER_FILE = 8;

/** Role → its `prReview.smartDiff.*` label key. No role label is ever inlined. */
export const ROLE_LABEL_KEY: Record<SmartDiffRole, string> = {
  core: "smartDiff.coreLabel",
  wiring: "smartDiff.wiringLabel",
  boilerplate: "smartDiff.boilerplateLabel",
};
