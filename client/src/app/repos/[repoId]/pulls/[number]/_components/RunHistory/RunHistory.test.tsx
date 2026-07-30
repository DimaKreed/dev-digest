/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[], findingsByRunId?: Map<string, FindingRecord[]>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} findingsByRunId={findingsByRunId} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — run cost badge", () => {
  it("a settled run shows its cost and the tokens behind it", () => {
    renderRuns([run({ status: "done", cost_usd: 0.0134, tokens_in: 8200, tokens_out: 1300 })]);
    expect(screen.getByText("$0.0134 · 8k→1.3k")).toBeInTheDocument();
  });

  it("a settled run with no cost recorded shows a dash, never $0.00", () => {
    renderRuns([run({ status: "done", cost_usd: null, tokens_in: 8200, tokens_out: 1300 })]);
    expect(screen.getByText("— · 8k→1.3k")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("an unsettled run shows no price at all", () => {
    renderRuns([run({ status: "running", cost_usd: null, score: null, blockers: null })]);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  it("a failed run shows no price at all", () => {
    renderRuns([run({ status: "failed", error: "boom", cost_usd: null, score: null, blockers: null })]);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});

describe("RunHistory — findings peek", () => {
  const FINDING: FindingRecord = {
    id: "f1",
    severity: "WARNING",
    category: "perf",
    title: "N+1 query in user list endpoint",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "One query per user.",
    suggestion: null,
    confidence: 0.86,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rv1",
    accepted_at: null,
    dismissed_at: null,
  };

  function hoverRow(label: string) {
    fireEvent.mouseEnter(screen.getByText(label));
    act(() => {
      vi.advanceTimersByTime(200);
    });
  }

  it("hovering a run card lists that run's findings", () => {
    vi.useFakeTimers();
    renderRuns(
      [run({ status: "done", findings_count: 1, blockers: 0, score: 64 })],
      new Map([["run-1", [FINDING]]]),
    );
    hoverRow("Security Reviewer");
    expect(screen.getByText("N+1 query in user list endpoint")).toBeInTheDocument();
    expect(screen.getByText("1 findings in this run")).toBeInTheDocument();
  });

  it("a run with no findings gets no panel", () => {
    vi.useFakeTimers();
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })], new Map());
    hoverRow("Security Reviewer");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
