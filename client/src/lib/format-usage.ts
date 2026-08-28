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

/**
 * Counts under 1000 are shown verbatim rather than in thousands. Dividing by
 * 1000 first rendered every small run as a fabricated zero — 400 tokens became
 * `0k` and 20 became `0.0k`, which reads as "nothing was sent" — and rounding
 * pushed 999 up to `1k`. Both are the same failure as a fabricated `$0.00`:
 * a real measurement displayed as its own absence.
 *
 * At or above 1000 the format is unchanged (`8k`, `1.3k`), so existing
 * expectations still hold.
 */
function compactTokens(n: number, decimals: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(decimals)}k`;
}

/** Token in→out summary (e.g. "12k→1.5k", or "400→20" for a small run). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${compactTokens(tokensIn, 0)}→${compactTokens(tokensOut, 1)}`;
}
