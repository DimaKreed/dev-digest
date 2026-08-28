import type { PrBrief } from "@devdigest/shared";

/**
 * The risk levels this card is willing to render.
 *
 * Model output is untrusted (spec § Untrusted inputs). A stored document that
 * carries a level outside the contract's enum — an older document, or one
 * written by a future version — renders NO level rather than echoing the raw
 * string onto the page.
 */
export const RISK_LEVELS = ["high", "medium", "low"] as const;
export type KnownRiskLevel = (typeof RISK_LEVELS)[number];

export function isKnownRiskLevel(level: PrBrief["risk_level"]): level is KnownRiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(level);
}

/** The colour token each level paints its badge with. */
export const RISK_LEVEL_COLOR: Record<KnownRiskLevel, { color: string; bg: string }> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg, var(--bg-hover))" },
  medium: { color: "var(--warn-text)", bg: "var(--warn-bg, var(--bg-hover))" },
  low: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};

/**
 * The stored cost, formatted for display — or `null` when the call was never
 * priced, which the card must show as unpriced rather than as $0.00 (AC-39).
 *
 * `Intl.NumberFormat` rather than a hand-written `"$" + n.toFixed(2)`: a brief
 * costs fractions of a cent, and two decimal places would round every real
 * figure to exactly the zero this criterion exists to forbid.
 */
export function formatCost(costUsd: number | null | undefined): string | null {
  if (typeof costUsd !== "number") return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(costUsd);
}
