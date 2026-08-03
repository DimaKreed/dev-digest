import type { Skill } from "@devdigest/shared";

/** Free-text filter over the skill list: name, description and type. */
export function matchesQuery(skill: Skill, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    skill.name.toLowerCase().includes(q) ||
    skill.description.toLowerCase().includes(q) ||
    skill.type.includes(q)
  );
}
