import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrIntentDetail } from "@devdigest/shared";
// Eight `..` from a test under pulls/[number]/_components/* to the package root.
import messages from "../../../../../../../../messages/en/brief.json";
import { IntentCard } from "./IntentCard";

afterEach(cleanup);

const READY: PrIntentDetail = {
  pr_id: "pr1",
  intent: "Adds a per-route rate limit to the review endpoints.",
  in_scope: ["rate limiting", "route config"],
  out_of_scope: ["logging for the limiter"],
  head_sha: "a1b2c3d4",
  model: "openrouter/deepseek/deepseek-v4-flash",
  confidence: 0.72,
  sources: [{ kind: "pr_title", ref: "#482" }],
  missing_context: ["empty PR description"],
  created_at: "2026-08-07T00:00:00Z",
  stale: false,
  status: "ready",
};

const ABSENT: PrIntentDetail = {
  ...READY,
  intent: "",
  in_scope: [],
  out_of_scope: [],
  head_sha: null,
  model: null,
  confidence: null,
  sources: null,
  missing_context: null,
  created_at: null,
  stale: false,
  status: "absent",
};

const DEFERRED: FindingRecord[] = [
  {
    id: "f-deferred",
    severity: "WARNING",
    category: "style",
    title: "No logging around the limiter",
    file: "src/limiter.ts",
    start_line: 22,
    end_line: 22,
    rationale: "no logs",
    suggestion: null,
    confidence: 0.6,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    out_of_scope: true,
    scope_rationale: "logging is listed as out of scope",
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderCard(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("IntentCard", () => {
  it("renders the summary, both scope lists, confidence and missing context", () => {
    renderCard(<IntentCard intent={READY} onRederive={() => {}} />);

    expect(screen.getByText(/per-route rate limit/)).toBeInTheDocument();
    expect(screen.getByText("In scope")).toBeInTheDocument();
    expect(screen.getByText("rate limiting")).toBeInTheDocument();
    expect(screen.getByText("Out of scope")).toBeInTheDocument();
    expect(screen.getByText("logging for the limiter")).toBeInTheDocument();
    expect(screen.getByText("Confidence")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByText("empty PR description")).toBeInTheDocument();
  });

  it("shows the empty state and a re-derive button when no intent exists", () => {
    const onRederive = vi.fn();
    renderCard(<IntentCard intent={ABSENT} onRederive={onRederive} />);

    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.getByText("Run a review or open the PR to compute it.")).toBeInTheDocument();
    expect(screen.queryByText("In scope")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Re-derive/ }));
    expect(onRederive).toHaveBeenCalledTimes(1);
  });

  it("badges a stale classification and explains why", () => {
    renderCard(<IntentCard intent={{ ...READY, stale: true }} onRederive={() => {}} />);
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText(/Derived for an earlier commit/)).toBeInTheDocument();
  });

  it("shows a skeleton while a background derivation is in flight", () => {
    renderCard(
      <IntentCard intent={{ ...ABSENT, status: "deriving" }} onRederive={() => {}} />,
    );
    expect(screen.getByText("Deriving the PR intent…")).toBeInTheDocument();
    expect(screen.queryByText("Brief not available yet.")).not.toBeInTheDocument();
  });

  it("collapses the deferred findings and reveals them on click", () => {
    renderCard(<IntentCard intent={READY} deferred={DEFERRED} onRederive={() => {}} />);

    const toggle = screen.getByRole("button", { name: /1 finding deferred as out of scope/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/No logging around the limiter/)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/No logging around the limiter/)).toBeInTheDocument();
    expect(screen.getByText("logging is listed as out of scope")).toBeInTheDocument();
    // The guard is stated where the user sees the consequence.
    expect(screen.getByText(/never deferred/)).toBeInTheDocument();
  });

  it("renders no deferred section when nothing was deferred", () => {
    renderCard(<IntentCard intent={READY} deferred={[]} onRederive={() => {}} />);
    expect(screen.queryByText(/deferred as out of scope/)).not.toBeInTheDocument();
  });
});
