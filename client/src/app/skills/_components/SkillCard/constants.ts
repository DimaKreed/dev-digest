import type { IconName } from "@devdigest/ui";
import type { SkillSource, SkillType } from "@devdigest/shared";

/** Accent per skill type, mirroring the severity/model chip idiom elsewhere. */
export const TYPE_COLOR: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "var(--ok)",
  security: "var(--critical)",
  custom: "var(--text-secondary)",
};

/** Provenance icon. `imported_*` reads as "came from outside this workspace". */
export const SOURCE_ICON: Record<SkillSource, IconName> = {
  manual: "Edit",
  extracted: "Wrench",
  community: "Globe",
  imported_url: "Upload",
  imported_file: "Upload",
};

/** Sources whose body was authored elsewhere — surfaced as "vet before enabling". */
export const UNTRUSTED_SOURCES: SkillSource[] = ["community", "imported_url", "imported_file"];
