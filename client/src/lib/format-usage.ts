/* Formatting for LLM usage figures (dollar cost, token counts) shared by the PR
   list, the Agent Runs timeline and the run trace drawer. */

/** Shown wherever a usage figure is unknown — never a fabricated "$0.00". */
export const NO_USAGE = "—";

/**
 * USD cost at THREE significant digits, e.g. `$0.012` — not `$0.01`. Review runs
 * cost fractions of a cent, so a fixed 2-decimal format rounds most of them to
 * `$0.01` or `$0.00` and destroys the signal.
 *
 * Trailing zeros from the significant-digit padding are trimmed, but at least two
 * decimals are kept so round amounts still read as money (`$0.50`, not `$0.5`).
 * Returns {@link NO_USAGE} for null/undefined — an unpriced run has no cost, which
 * is not the same as costing nothing.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return NO_USAGE;
  if (usd === 0) return "$0";
  // 3 significant digits ⇒ 2 decimals past the first significant one. Capped at 8
  // so sub-microdollar amounts stay in plain notation instead of going exponential.
  const decimals = Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(Math.abs(usd)))));
  let out = usd.toFixed(decimals);
  if (out.includes(".")) {
    const [whole = "", frac = ""] = out.replace(/0+$/, "").split(".");
    out = `${whole}.${frac.padEnd(2, "0")}`;
  }
  return `$${out}`;
}

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}
