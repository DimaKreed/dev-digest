/* RunCostBadge — what one review run cost. Two views of the same number:
   `compact` for tabular slots (the PR list's COST column, the review-run header),
   `detailed` for the Agent Runs timeline, where the tokens behind the price fit. */

import { formatCost, formatTokens } from "@/lib/format-usage";

export function RunCostBadge({
  usd,
  variant = "compact",
  tokensIn,
  tokensOut,
}: {
  /** Null/undefined renders the no-data dash, never "$0.00". */
  usd: number | null | undefined;
  variant?: "compact" | "detailed";
  tokensIn?: number | null;
  tokensOut?: number | null;
}) {
  const tokens =
    variant === "detailed" && tokensIn != null && tokensOut != null && tokensIn + tokensOut > 0
      ? formatTokens(tokensIn, tokensOut)
      : null;
  return (
    <span className="mono tnum">
      {formatCost(usd)}
      {tokens ? ` · ${tokens}` : ""}
    </span>
  );
}

export default RunCostBadge;
