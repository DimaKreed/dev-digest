import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBrief } from "@devdigest/shared";
// Eight `..` from a test under pulls/[number]/_components/* to the package root.
import briefMessages from "../../../../../../../../messages/en/brief.json";
import { PrBriefCard } from "./PrBriefCard";

/**
 * SPEC-03 (PR Brief) — the card's display criteria.
 *
 * Spec-first: every assertion cites the `AC-NN` in `specs/03-pr-brief-card.md`
 * it comes from. The component does not exist yet, so this file is expected to
 * be RED; that is the correct result, not a defect.
 *
 * Two deliberate choices about the messages:
 *
 * 1. The existing keys — `noRisks`, `intentCard.stale`, `intentCard.staleHint`
 *    — come from the REAL `messages/en/brief.json`, because AC-35 and AC-36
 *    name them and the namespace is protected scaffolding.
 * 2. The keys AC-40 adds are supplied here with test wording, because the exact
 *    copy is spec open question 3 and is not settled. That still enforces
 *    AC-40 for those keys: a component that hardcodes an English literal
 *    instead of reading the namespace fails every assertion below. The key
 *    PATHS are the contract this test states — an implementation that names
 *    them differently must change this file's `card` block, not its wording.
 */
const messages = {
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
    missingKey: "A model key is required to generate a brief.",
    regenerate: "Regenerate brief",
    tokens: "{tokensIn} in · {tokensOut} out",
    unpriced: "Unpriced",
    empty: {
      title: "No brief for this pull request yet",
      body: "Generating one assembles the PR's intent, blast radius and diff stats into a single model call.",
      cta: "Generate brief",
    },
    error: {
      title: "The brief could not be loaded",
      body: "Reason: {reason}",
      retry: "Retry",
    },
  },
};

function renderCard(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** A small typed factory, local to this file — the house convention. */
function brief(over: Partial<PrBrief> = {}): PrBrief {
  return {
    risk_level: "high",
    what: "Adds a per-route rate limit to the review endpoints.",
    why: "It fronts every paid route, so a wrong window blocks reviews outright.",
    risks: [
      {
        title: "The limiter is applied before authentication",
        explanation: "An unauthenticated caller can exhaust the window for everyone.",
        severity: "high",
        refs: [{ path: "src/pay.ts", line: 12 }],
      },
    ],
    review_focus: [
      {
        label: "The limiter registration",
        ref: { path: "src/pay.ts", line: 12 },
        reason: "This is where the window is chosen.",
      },
      {
        label: "The shared config module",
        ref: { path: "src/config.ts" },
        reason: "It has no line to anchor on.",
      },
    ],
    head_sha: "aaaa1111",
    provider: "openai",
    model: "gpt-4.1",
    degraded_sources: [
      { name: "project_context", reason: "dropped to fit the input budget" },
      { name: "blast", reason: "repository intelligence is disabled by flag" },
    ],
    dropped_entries: 2,
    usage: { tokens_in: 1200, tokens_out: 340, cost_usd: 0.0012 },
    ...over,
  } as PrBrief;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PrBriefCard", () => {
  it("AC-26 / AC-27 / AC-28 / AC-37 / AC-39 / AC-42 — shows the risk level, what, why, risks, focus list, degraded sources and usage, and no review verdict", () => {
    renderCard(
      <PrBriefCard brief={brief()} onGenerate={() => {}} onOpenFocus={() => {}} />,
    );

    // AC-26 — the brief's OWN risk level, with its what and why.
    expect(screen.getByText("High merge risk")).toBeInTheDocument();
    expect(screen.getByText("What this changes")).toBeInTheDocument();
    expect(screen.getByText(/per-route rate limit/)).toBeInTheDocument();
    expect(screen.getByText("Why it is risky")).toBeInTheDocument();
    expect(screen.getByText(/wrong window blocks reviews/)).toBeInTheDocument();

    // AC-26 — and none of the agent-run surface, which belongs to VerdictBanner.
    expect(screen.queryByText(/request changes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/finding/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/blocker/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();

    // AC-27 — the risks are rendered here, in the brief card.
    expect(screen.getByText("Risks")).toBeInTheDocument();
    expect(screen.getByText(/applied before authentication/)).toBeInTheDocument();

    // AC-28 — review-focus entries are activatable, one per entry.
    expect(screen.getByText("Where to look first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /The limiter registration/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /The shared config module/ })).toBeInTheDocument();

    // AC-37 — every degraded source is named to the reader, with the count of
    // entries the grounding gate dropped. None of them is swallowed.
    expect(screen.getByText("Sources the brief could not fully read")).toBeInTheDocument();
    expect(screen.getByText(/project_context/)).toBeInTheDocument();
    expect(screen.getByText(/repository intelligence is disabled by flag/)).toBeInTheDocument();
    expect(screen.getByText("2 ungrounded entries dropped")).toBeInTheDocument();

    // AC-39 — both token figures, and a priced call is not shown as unpriced.
    expect(screen.getByText("1200 in · 340 out")).toBeInTheDocument();
    expect(screen.queryByText("Unpriced")).not.toBeInTheDocument();

    // AC-42 — the outcome of a completed generation sits in a polite live
    // region. `role="status"` IS `aria-live="polite"`.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("AC-29 / AC-30 — activating a focus entry reports it exactly once, with and without a line", () => {
    const onOpenFocus = vi.fn();
    renderCard(<PrBriefCard brief={brief()} onGenerate={() => {}} onOpenFocus={onOpenFocus} />);

    fireEvent.click(screen.getByRole("button", { name: /The limiter registration/ }));
    // Count FIRST: `toHaveBeenCalledWith` alone passes when *any* call matched,
    // so a bubbled second activation would go unseen (client/insights.md).
    expect(onOpenFocus).toHaveBeenCalledTimes(1);
    expect(onOpenFocus).toHaveBeenCalledWith({ path: "src/pay.ts", line: 12 });

    onOpenFocus.mockClear();

    // AC-30 — an entry with no line is still activatable, not inert; it simply
    // carries no line target.
    fireEvent.click(screen.getByRole("button", { name: /The shared config module/ }));
    expect(onOpenFocus).toHaveBeenCalledTimes(1);
    const [arg] = onOpenFocus.mock.calls[0] as [{ path: string; line?: number | null }];
    expect(arg.path).toBe("src/config.ts");
    expect(arg.line ?? null).toBeNull();
  });

  it("AC-33 / AC-32 — the empty state offers generation, and an in-flight generation cannot be fired twice", () => {
    const onGenerate = vi.fn();
    const { rerender } = renderCard(
      <PrBriefCard brief={null} onGenerate={onGenerate} onOpenFocus={() => {}} />,
    );

    // AC-33 — a title, a body explaining what generation does, and the CTA.
    expect(screen.getByText("No brief for this pull request yet")).toBeInTheDocument();
    expect(screen.getByText(/assembles the PR's intent/)).toBeInTheDocument();
    const cta = screen.getByRole("button", { name: "Generate brief" });

    fireEvent.click(cta);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    onGenerate.mockClear();

    // AC-32 — a distinct in-progress state, and no second generation from here.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <PrBriefCard brief={null} generating onGenerate={onGenerate} onOpenFocus={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Generating the brief…")).toBeInTheDocument();
    expect(screen.queryByText("No brief for this pull request yet")).not.toBeInTheDocument();

    for (const button of screen.queryAllByRole("button")) fireEvent.click(button);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("AC-34 — the error state names its reason, offers a retry, and is distinguishable from the empty state", () => {
    const onGenerate = vi.fn();
    renderCard(
      <PrBriefCard
        brief={null}
        error="the API returned 503"
        onGenerate={onGenerate}
        onOpenFocus={() => {}}
      />,
    );

    expect(screen.getByText("The brief could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("Reason: the API returned 503")).toBeInTheDocument();
    // Distinguishable: the empty state's own title and CTA are NOT what is shown.
    expect(screen.queryByText("No brief for this pull request yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate brief" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("AC-35 / AC-39 — zero risks and zero focus entries read as 'none flagged', and an unpriced call is not $0.00", () => {
    renderCard(
      <PrBriefCard
        brief={brief({
          risks: [],
          review_focus: [],
          usage: { tokens_in: 900, tokens_out: 120, cost_usd: null },
        })}
        onGenerate={() => {}}
        onOpenFocus={() => {}}
      />,
    );

    // AC-35 — both are valid results, and both get a statement rather than a
    // blank block. `noRisks` is the key that already exists in the namespace.
    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
    expect(screen.getByText("No review focus flagged.")).toBeInTheDocument();

    // AC-39 — an unpriced call says so; it must not read as costing nothing.
    expect(screen.getByText("Unpriced")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("AC-36 / AC-41 — a stale brief is still displayed, badged and explained, with a named regenerate control", () => {
    const onGenerate = vi.fn();
    renderCard(
      <PrBriefCard brief={brief()} stale onGenerate={onGenerate} onOpenFocus={() => {}} />,
    );

    // AC-36 — still displayed...
    expect(screen.getByText(/per-route rate limit/)).toBeInTheDocument();
    // ...with the badge and hint the intent card already uses.
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText(/Derived for an earlier commit/)).toBeInTheDocument();

    // AC-41 — the icon-only regenerate control has an accessible name, which is
    // also the only way this assertion can find it.
    const regenerate = screen.getByRole("button", { name: "Regenerate brief" });
    fireEvent.click(regenerate);
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("AC-24 — with no provider key the card states that a key is required and offers no live generation", () => {
    const onGenerate = vi.fn();
    // What the read returns on a key-less install: the server has already
    // decided this, so the card compares nothing and resolves no provider.
    const unavailable = {
      can_generate: false,
      reason: "missing_key" as const,
      provider: "openai" as const,
      model: "gpt-4.1",
    };

    const { rerender } = renderCard(
      <PrBriefCard
        brief={null}
        availability={unavailable}
        onGenerate={onGenerate}
        onOpenFocus={() => {}}
      />,
    );

    // The CTA is REPLACED by the requirement, not merely greyed out — the
    // "looks broken" outcome AC-24 exists to prevent is a live button whose
    // only possible answer is the server's own 503 sentence.
    expect(screen.getByText("A model key is required to generate a brief.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate brief" })).not.toBeInTheDocument();
    for (const button of screen.queryAllByRole("button")) fireEvent.click(button);
    expect(onGenerate).not.toHaveBeenCalled();

    // A stored brief still displays in full — a missing key stops a
    // REgeneration, not a read — but the regenerate control is unavailable
    // while keeping the accessible name AC-41 requires.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <PrBriefCard
          brief={brief()}
          availability={unavailable}
          onGenerate={onGenerate}
          onOpenFocus={() => {}}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/per-route rate limit/)).toBeInTheDocument();
    const regenerate = screen.getByRole("button", { name: "Regenerate brief" });
    expect(regenerate).toBeDisabled();
    fireEvent.click(regenerate);
    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.getByText("A model key is required to generate a brief.")).toBeInTheDocument();
  });

  it("AC-24 — a load failure on a key-less install offers no retry either", () => {
    const onGenerate = vi.fn();
    // Reachable state, and the one the first closure pass missed: a failed
    // REFETCH keeps the previous response's availability, so error and a known
    // can_generate:false co-occur. A retry here could only produce the 503.
    renderCard(
      <PrBriefCard
        brief={null}
        error="Service Unavailable"
        availability={{
          can_generate: false,
          reason: "missing_key" as const,
          provider: "openai" as const,
          model: "gpt-4.1",
        }}
        onGenerate={onGenerate}
        onOpenFocus={() => {}}
      />,
    );

    // Still an error state — the reason is not swallowed by the key message.
    expect(screen.getByText(/Service Unavailable/)).toBeInTheDocument();
    expect(screen.getByText("A model key is required to generate a brief.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
    for (const button of screen.queryAllByRole("button")) fireEvent.click(button);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("AC-34 — a load failure with a key configured still offers a live retry", () => {
    const onGenerate = vi.fn();
    // The converse, so the guard above cannot pass by killing every retry.
    renderCard(
      <PrBriefCard
        brief={null}
        error="Network error"
        onGenerate={onGenerate}
        onOpenFocus={() => {}}
      />,
    );

    const retry = screen.getByRole("button", { name: /Retry/ });
    fireEvent.click(retry);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("A model key is required to generate a brief.")).not.toBeInTheDocument();
  });

  it("spec § Untrusted inputs — a risk_level outside the contract's enum renders no label at all", () => {
    renderCard(
      <PrBriefCard
        brief={brief({ risk_level: "catastrophic" as PrBrief["risk_level"] })}
        onGenerate={() => {}}
        onOpenFocus={() => {}}
      />,
    );

    // Model output is untrusted: an unknown level is dropped, never echoed.
    expect(screen.queryByText(/catastrophic/i)).not.toBeInTheDocument();
    for (const label of ["High merge risk", "Medium merge risk", "Low merge risk"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    // The rest of the brief still renders.
    const card = screen.getByText(/per-route rate limit/);
    expect(within(card.ownerDocument.body).getByText("What this changes")).toBeInTheDocument();
  });
});
