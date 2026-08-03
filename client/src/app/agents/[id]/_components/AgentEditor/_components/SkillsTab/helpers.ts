import type { AgentSkillLink, Skill } from "@devdigest/shared";

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

/** Move `id` one slot up (-1) or down (+1) within the linked-id list. */
export function moveId(ids: string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * Move `fromId` to the slot currently occupied by `toId` — the drag-and-drop
 * counterpart of `moveId`. Returns the input unchanged when either id is not
 * in the list or they are the same, so a drop on itself is a no-op rather than
 * a pointless write.
 */
export function reorder(ids: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return ids;
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from === -1 || to === -1) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** True when the two id lists differ in content or order. */
export function orderChanged(a: string[], b: string[]): boolean {
  return a.length !== b.length || a.some((id, i) => id !== b[i]);
}
