import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBrief, PrIntentDetail } from "@devdigest/shared";
// Eight `..` from a test under pulls/[number]/_components/* to the package root.
import briefMessages from "../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import { OverviewTab } from "./OverviewTab";

/**
 * SPEC-03 (PR Brief) — AC-25 only: the placement criterion.
 *
 * Spec-first, and expected to be RED until `PrBriefCard` exists and
 * `OverviewTab` renders it. Nothing here was read off an implementation; the
 * prop names follow `.devdigest/cache/plans/pr-brief.md` W10, which is the
 * closest thing to a settled interface — if the implementation names them
 * differently, this file's props change and its assertion does not.
 *
 * The `card` block below carries test wording for the keys AC-40 introduces,
 * for the reason set out at length in `PrBriefCard.test.tsx`: the exact copy is
 * spec open question 3.
 */
const messages = {
  brief: {
    ...briefMessages,
    card: {
      riskLevel: { high: "High merge risk", medium: "Medium merge risk", low: "Low merge risk" },
      what: "What this changes",
      why: "Why it is risky",
      reviewFocus: "Where to look first",
      noFocus: "No review focus flagged.",
      degraded: "Sources the brief could not fully read",
      dropped: "{count} ungrounded entries dropped",
      generating: "Generating the brief…",
      regenerate: "Regenerate brief",
      tokens: "{tokensIn} in · {tokensOut} out",
      unpriced: "Unpriced",
      empty: { title: "No brief for this pull request yet", body: "b", cta: "Generate brief" },
      error: { title: "The brief could not be loaded", body: "Reason: {reason}", retry: "Retry" },
    },
  },
  prReview: prReviewMessages,
};

const INTENT: PrIntentDetail = {
  pr_id: "pr1",
  intent: "Adds a per-route rate limit to the review endpoints.",
  in_scope: ["rate limiting"],
  out_of_scope: [],
  head_sha: "aaaa1111",
  model: "gpt-4.1",
  confidence: 0.72,
  sources: null,
  missing_context: null,
  created_at: "2026-08-07T00:00:00Z",
  stale: false,
  status: "ready",
};

const BRIEF = {
  risk_level: "high",
  what: "Adds a per-route rate limit to the review endpoints.",
  why: "It fronts every paid route.",
  risks: [],
  review_focus: [],
  head_sha: "aaaa1111",
  provider: "openai",
  model: "gpt-4.1",
  degraded_sources: [],
  dropped_entries: 0,
  usage: { tokens_in: 10, tokens_out: 5, cost_usd: 0.001 },
} as PrBrief;

afterEach(cleanup);

describe("OverviewTab", () => {
  it("AC-25 — renders the brief card on the Overview tab, above the intent card", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <OverviewTab
          prBody="A pull request description."
          intent={INTENT}
          deferredFindings={[]}
          onRederiveIntent={() => {}}
          brief={BRIEF}
          onGenerateBrief={() => {}}
          onOpenFocus={() => {}}
        />
      </NextIntlClientProvider>,
    );

    // Both cards are present...
    const briefBlock = screen.getByText("What this changes");
    const intentBlock = screen.getByText("In scope");
    expect(briefBlock).toBeInTheDocument();
    expect(intentBlock).toBeInTheDocument();

    // ...and the brief comes first in document order, which is what "above"
    // means for a stacked column.
    expect(briefBlock.compareDocumentPosition(intentBlock)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
