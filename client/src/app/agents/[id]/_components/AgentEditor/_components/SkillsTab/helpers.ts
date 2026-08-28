import type { AgentSkillLink, Skill } from "@devdigest/shared";

/**
 * `moveId` / `reorder` / `orderChanged` moved to `src/lib/ordering.ts` when the
 * `Context` tab became a second consumer, and are re-exported here so this
 * tab's own imports (and its test) keep working. `orderSkills` stays: it is
 * about skills specifically, and nothing else needs it.
 */
export { moveId, orderChanged, reorder } from "../../../../../../../lib/ordering";

/**
 * Order the skill list for display: linked skills first in their prompt order,
 * then everything else alphabetically. The linked prefix IS the order the
 * bodies appear in the assembled prompt.
 */
export function orderSkills(skills: Skill[], links: AgentSkillLink[]): Skill[] {
  const rank = new Map(links.map((l) => [l.skill_id, l.order]));
  const linked = skills
    .filter((s) => rank.has(s.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const rest = skills
    .filter((s) => !rank.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...linked, ...rest];
}
