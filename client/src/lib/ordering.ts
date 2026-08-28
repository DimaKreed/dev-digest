/**
 * ordering.ts — the pure reorder primitives shared by every "ordered set
 * attached to a parent" surface.
 *
 * Promoted out of `AgentEditor/_components/SkillsTab/helpers.ts` when the
 * `Context` tab became a second consumer: one route's `_components/` is never
 * an import target for another route, and the Context tab lives in two.
 * `orderSkills` stayed behind — it is skill-specific.
 *
 * The ids are opaque strings: skill ids in the Skills tab, document paths in
 * the Context tab.
 */

/** Move `id` one slot up (-1) or down (+1) within the list. */
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
