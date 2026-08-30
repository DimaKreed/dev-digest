import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCaseRecord, EvalCaseRun, Finding } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/eval.json";
import { ToastProvider } from "../../../../../../../lib/toast";

const runSet = vi.fn();
const runCase = vi.fn();
const runFinished = vi.fn();

let cases: EvalCaseRecord[] = [];
let dashboard: unknown = null;
/** The batch `useEvalBatch` reports — what a run in flight looks like here. */
let batch: unknown = undefined;

vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useEvalCases: () => ({ data: cases, isLoading: false }),
  useEvalCaseRuns: () => ({ data: [] }),
  useEvalAgentDashboard: () => ({ data: dashboard }),
  useEvalBatch: () => ({ data: batch }),
  useEvalRunFinished: () => runFinished,
  useRunEvalSet: () => ({ mutate: runSet, isPending: false }),
  useRunEvalCase: () => ({ mutate: runCase, isPending: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  cases = [];
  dashboard = null;
  batch = undefined;
  vi.clearAllMocks();
});

const AGENT = { id: "a1", name: "Security Reviewer" } as Agent;

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "a literal sk_live_ key",
    confidence: 0.97,
    ...over,
  };
}

function run(over: Partial<EvalCaseRun> = {}): EvalCaseRun {
  return {
    id: "r1",
    case_id: "c1",
    case_name: "stripe-key-leak",
    expectation_kind: "must_find",
    ran_at: "2026-01-02T09:14:00.000Z",
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    duration_ms: 1800,
    cost_usd: 0.002,
    counts: { tp: 1, fn: 0, fp: 0, findings: 1, grounded_kept: 1, grounded_total: 1 },
    findings: [finding()],
    missed: [],
    violations: [],
    error: null,
    ...over,
  };
}

function makeCase(over: Partial<EvalCaseRecord> = {}): EvalCaseRecord {
  return {
    id: "c1",
    owner_kind: "agent",
    owner_id: "a1",
    name: "stripe-key-leak",
    expectation_kind: "must_find",
    input_diff: "@@ -10,4 +10,5 @@",
    input_meta: null,
    expected_output: [{ file: "src/config.ts", start_line: 12, end_line: 12 }],
    notes: null,
    source_finding_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    last_run: null,
    ...over,
  };
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <ToastProvider>
        <EvalsTab agent={AGENT} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab", () => {
  it("says the set was never run instead of showing zeroed metrics", () => {
    // AC-12 in miniature: "never measured" and "scored zero" are different
    // facts, and a 0% here reads as a broken agent.
    cases = [makeCase()];
    renderTab();
    expect(screen.getByText(/Never run/)).toBeInTheDocument();
  });

  it("renders the metrics of the newest run when there is one", () => {
    cases = [makeCase()];
    dashboard = {
      latest: {
        metrics: {
          recall: 0.82,
          precision: 0.91,
          citation_accuracy: 0.95,
          traces_passed: 17,
          traces_total: 20,
        },
      },
      delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
      alert: null,
    };
    renderTab();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("91")).toBeInTheDocument();
    expect(screen.getByText("17/20")).toBeInTheDocument();
  });

  it("labels each case with its polarity", () => {
    cases = [makeCase(), makeCase({ id: "c2", name: "clean-refactor", expectation_kind: "must_not_flag" })];
    renderTab();
    expect(screen.getByText("must find")).toBeInTheDocument();
    expect(screen.getByText("must not flag")).toBeInTheDocument();
  });

  it("shows a case's error rather than reporting it as a failed assertion", () => {
    // AC-07: a provider failure is not evidence the agent got it wrong.
    cases = [
      makeCase({
        last_run: run({ pass: null, recall: null, findings: [], error: "provider timed out" }),
      }),
    ];
    renderTab();
    expect(screen.getByText(/provider timed out/)).toBeInTheDocument();
  });

  it("shows expected next to actual when a case row is expanded", () => {
    cases = [makeCase({ last_run: run() })];
    renderTab();
    // Collapsed by default — a run of the set would otherwise dump every
    // finding of every case onto the page at once.
    expect(screen.queryByText("Actual output")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("stripe-key-leak"));
    expect(screen.getByText("Actual output")).toBeInTheDocument();
    // The expected location and the produced one, both rendered.
    expect(screen.getAllByText("src/config.ts:12")).toHaveLength(2);
    expect(screen.getByText(/Last run passed/)).toBeInTheDocument();
    expect(screen.getByText(/found 1 of 1 expected/)).toBeInTheDocument();
  });

  it("names what a failing must_find case missed", () => {
    cases = [
      makeCase({
        last_run: run({
          pass: false,
          recall: 0,
          findings: [],
          missed: [{ file: "src/config.ts", start_line: 12, end_line: 12 }],
          counts: { tp: 0, fn: 1, fp: 0, findings: 0, grounded_kept: 0, grounded_total: 0 },
        }),
      }),
    ];
    renderTab();
    fireEvent.click(screen.getByText("stripe-key-leak"));
    expect(screen.getByText(/Last run failed/)).toBeInTheDocument();
    expect(screen.getByText(/found 0 of 1 expected/)).toBeInTheDocument();
    expect(screen.getByText(/reported nothing on this diff/)).toBeInTheDocument();
  });

  it("says a case has never run instead of showing an empty actual panel", () => {
    cases = [makeCase()];
    renderTab();
    fireEvent.click(screen.getByText("stripe-key-leak"));
    expect(screen.getByText(/Never run yet/)).toBeInTheDocument();
  });

  it("runs the whole set from the header button", () => {
    cases = [makeCase()];
    renderTab();
    fireEvent.click(screen.getByText("Run all evals"));
    expect(runSet).toHaveBeenCalledWith("a1", expect.anything());
  });

  it("reports how far a running set has got, not just that it is running", () => {
    // The whole point of backgrounding the batch: ten cases is ~2 minutes, and
    // a spinner over that cannot be told apart from a run that has died.
    cases = [makeCase(), makeCase({ id: "c2", name: "ssrf-webhook" })];
    renderTab();
    runSet.mockImplementation((_id: string, opts: { onSuccess: (b: unknown) => void }) =>
      opts.onSuccess({ batch_id: "b1", status: "running", cases_total: 2, cases_done: 0 }),
    );
    batch = { batch_id: "b1", status: "running", cases_total: 2, cases_done: 1, cases: [] };
    fireEvent.click(screen.getByText("Run all evals"));
    expect(screen.getByText("Running 1 / 2…")).toBeInTheDocument();
  });

  it("shows a case's result as soon as its own row lands, mid-batch", () => {
    // `useEvalCases` is not refetched until the batch finishes, so without the
    // batch's own rows every case would sit unchanged and then all change at
    // once at the end.
    cases = [makeCase(), makeCase({ id: "c2", name: "ssrf-webhook" })];
    runSet.mockImplementation((_id: string, opts: { onSuccess: (b: unknown) => void }) =>
      opts.onSuccess({ batch_id: "b1", status: "running", cases_total: 2, cases_done: 0 }),
    );
    batch = {
      batch_id: "b1",
      status: "running",
      cases_total: 2,
      cases_done: 1,
      cases: [run({ case_id: "c1", pass: false })],
    };
    renderTab();
    fireEvent.click(screen.getByText("Run all evals"));
    // c1 landed and reads as failed; c2 has not produced a row at all.
    expect(screen.getByText(/failed/)).toBeInTheDocument();
    expect(screen.getByText(/never run/)).toBeInTheDocument();
  });

  it("refetches the case list and the dashboards only once the batch is done", () => {
    cases = [makeCase()];
    runSet.mockImplementation((_id: string, opts: { onSuccess: (b: unknown) => void }) =>
      opts.onSuccess({ batch_id: "b1", status: "running", cases_total: 1, cases_done: 0 }),
    );
    batch = { batch_id: "b1", status: "done", cases_total: 1, cases_done: 1, cases: [] };
    renderTab();
    fireEvent.click(screen.getByText("Run all evals"));
    expect(runFinished).toHaveBeenCalledWith("a1");
  });

  it("disables the run button when the set is empty", () => {
    renderTab();
    fireEvent.click(screen.getByText("Run all evals"));
    expect(runSet).not.toHaveBeenCalled();
  });
});
