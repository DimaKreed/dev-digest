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
import { formatCost } from "@/lib/format-usage";

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
