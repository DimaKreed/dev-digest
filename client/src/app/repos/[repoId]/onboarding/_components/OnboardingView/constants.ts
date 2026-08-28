/**
 * The five section kinds the tour is made of, in render order.
 *
 * Restated on the client rather than imported: `@devdigest/shared` is type-only
 * here, so a runtime value cannot cross that boundary. Keep equal to
 * `SECTION_KINDS` in the server's onboarding module — a kind added there and
 * not here simply stops rendering.
 */
export const SECTION_KINDS = [
  "overview",
  "architecture",
  "key_modules",
  "getting_started",
  "conventions",
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** The one kind a diagram is rendered for. Every other diagram is ignored. */
export const DIAGRAM_KIND: SectionKind = "architecture";
