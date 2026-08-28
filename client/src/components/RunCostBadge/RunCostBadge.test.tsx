/**
 * RunCostBadge — the two rules that matter for a cost figure:
 * 1. THREE significant digits, so sub-cent review costs stay readable
 *    ($0.012, never $0.01 and never a rounded-to-nothing $0.00).
 * 2. No data ⇒ a dash. An unpriced run has no cost, which is not the same as
 *    costing zero — showing "$0.00" there would be a fabricated number.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RunCostBadge } from "./RunCostBadge";
import { formatCost, formatTokens } from "@/lib/format-usage";

afterEach(cleanup);

describe("formatCost", () => {
  it.each([
    [0.012, "$0.012"],
    [0.014, "$0.014"],
    [0.0013, "$0.0013"],
    [0.06, "$0.06"],
    [0.003, "$0.003"],
    [1.2345, "$1.23"],
    [12.5, "$12.50"],
    [0.5, "$0.50"],
    [0, "$0"],
  ])("formats %s as %s", (usd, expected) => {
    expect(formatCost(usd)).toBe(expected);
  });

  it("never collapses a sub-cent cost to $0.01 or $0.00", () => {
    expect(formatCost(0.012)).not.toBe("$0.01");
    expect(formatCost(0.0004)).not.toBe("$0.00");
  });

  it("stays in plain notation for sub-microdollar amounts", () => {
    expect(formatCost(0.0000004)).toBe("$0.0000004");
  });

  it("returns a dash for null/undefined, not a zero", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
  });
});

describe("formatTokens", () => {
  it.each([
    [8200, 1300, "8k→1.3k"],
    [12000, 1500, "12k→1.5k"],
    [1000, 1000, "1k→1.0k"],
  ])("keeps the thousands format at or above 1000 (%s, %s)", (tin, tout, expected) => {
    expect(formatTokens(tin, tout)).toBe(expected);
  });

  it("shows counts under 1000 verbatim rather than as a fabricated zero", () => {
    // The bug: dividing first rendered a real 400-token input as "0k", which
    // reads as "nothing was sent" — the same failure as a fabricated $0.00.
    expect(formatTokens(400, 20)).toBe("400→20");
    expect(formatTokens(1, 1)).toBe("1→1");
  });

  it("does not round 999 up into a thousand", () => {
    expect(formatTokens(999, 999)).toBe("999→999");
  });
});

describe("RunCostBadge", () => {
  it("compact shows the cost alone", () => {
    render(<RunCostBadge usd={0.0134} />);
    expect(screen.getByText("$0.0134")).toBeInTheDocument();
  });

  it("detailed appends the tokens behind the price", () => {
    render(<RunCostBadge variant="detailed" usd={0.014} tokensIn={8200} tokensOut={1300} />);
    expect(screen.getByText("$0.014 · 8k→1.3k")).toBeInTheDocument();
  });

  it("detailed omits tokens when they are missing or zero", () => {
    const { container } = render(<RunCostBadge variant="detailed" usd={0.014} tokensIn={0} tokensOut={0} />);
    expect(container.textContent).toBe("$0.014");
  });

  it("renders the dash when no cost was recorded", () => {
    render(<RunCostBadge usd={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
