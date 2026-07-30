import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta, FindingRecord, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function finding(id: string, severity: FindingRecord["severity"], over: Partial<FindingRecord> = {}) {
  return {
    id,
    severity,
    category: "security",
    title: `title ${id}`,
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "Because reasons.",
    suggestion: null,
    confidence: 0.98,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rv1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } satisfies FindingRecord;
}

const REVIEWS: ReviewRecord[] = [
  {
    id: "rv1",
    pr_id: "pr-1",
    agent_id: "agent-a",
    run_id: "run-1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: null,
    score: 61,
    model: "gpt-4.1",
    created_at: "2026-06-13T20:00:00.000Z",
    findings: [
      finding("f1", "CRITICAL"),
      finding("f2", "CRITICAL", { title: "dismissed one", dismissed_at: "2026-06-13T21:00:00.000Z" }),
      finding("f3", "WARNING", { title: "a warning" }),
    ],
  },
];

// PRRow fetches findings lazily for the peek panel; mock the hook rather than
// standing up a QueryClientProvider (same idiom as RunTraceDrawer.test.tsx).
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: REVIEWS, isLoading: false }),
}));

import { PRRow } from "./PRRow";

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.useRealTimers();
});

const PR: PrMeta = {
  id: "pr-1",
  number: 482,
  title: "Add rate limiting to public API endpoints",
  author: "marisa.koch",
  branch: "feat/rate-limit-public",
  base: "main",
  head_sha: "abc1234",
  additions: 247,
  deletions: 38,
  files_count: 9,
  status: "needs_review",
  opened_at: "2026-06-13T17:00:00.000Z",
  updated_at: "2026-06-13T20:00:00.000Z",
  score: 61,
  findings_critical: 2,
  findings_warning: 2,
  findings_suggestion: 0,
  cost_usd: 0.014,
};

function renderRow(pr: PrMeta = PR) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={pr} repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

/** Chips are labelled "{count} {SEVERITY} findings". */
function chip(level: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(level) });
}

/** Hover the chip and let HoverCard's open delay elapse. */
function hover(el: HTMLElement) {
  fireEvent.mouseEnter(el);
  act(() => {
    vi.advanceTimersByTime(200);
  });
}

describe("PRRow findings column", () => {
  it("renders one chip per severity with its count", () => {
    renderRow();
    expect(chip("CRITICAL")).toHaveTextContent("2");
    expect(chip("WARNING")).toHaveTextContent("2");
    expect(chip("SUGGESTION")).toHaveTextContent("0");
  });

  it("disables a level with no findings and leaves the others clickable", () => {
    renderRow();
    expect(chip("SUGGESTION")).toBeDisabled();
    expect(chip("CRITICAL")).toBeEnabled();
  });

  it("renders a dash and no chips for a PR that was never reviewed", () => {
    renderRow({
      ...PR,
      score: null,
      findings_critical: null,
      findings_warning: null,
      findings_suggestion: null,
    });
    expect(screen.queryByRole("button", { name: /CRITICAL/ })).not.toBeInTheDocument();
    // Two dashes: the score ring already dashes on an unreviewed PR, and the
    // findings cell now joins it — null means "no review", not "zero findings".
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("opens the PR pre-filtered to the clicked severity, without the row's own navigation", () => {
    renderRow();
    fireEvent.click(chip("CRITICAL"));
    // Exactly one push: the chip stops the row's click from also firing, which
    // would otherwise overwrite this with the unfiltered PR URL.
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482?tab=findings&severity=critical");
  });

  it("still navigates to the unfiltered PR when the row itself is clicked", () => {
    renderRow();
    fireEvent.click(screen.getByText(PR.title));
    expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482");
  });
});

describe("PRRow findings peek", () => {
  it("hovering a chip lists only that severity's live findings", () => {
    vi.useFakeTimers();
    renderRow();
    hover(chip("CRITICAL"));

    expect(screen.getByText("title f1")).toBeInTheDocument();
    // A dismissed finding is excluded, matching the count above the chip.
    expect(screen.queryByText("dismissed one")).not.toBeInTheDocument();
    // …and so is another severity's.
    expect(screen.queryByText("a warning")).not.toBeInTheDocument();
  });

  it("shows nothing until hovered, and closes again on mouse leave", () => {
    vi.useFakeTimers();
    renderRow();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    hover(chip("CRITICAL"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseLeave(chip("CRITICAL"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not peek on a level with no findings", () => {
    vi.useFakeTimers();
    renderRow();
    hover(chip("SUGGESTION"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
