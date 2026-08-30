import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseRun } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/eval.json";
import { ToastProvider } from "../../../../../../../lib/toast";
import { draftFromSeed } from "./helpers";

const createCase = vi.fn();
const previewCase = vi.fn();
const runSavedCase = vi.fn();

vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useCreateEvalCase: () => ({ mutate: createCase, isPending: false }),
  useUpdateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useRunEvalCase: () => ({ mutate: runSavedCase, isPending: false }),
  useEvalPreview: () => ({ mutate: previewCase, isPending: false }),
  useEvalCaseRuns: () => ({ data: undefined }),
}));

import { EvalCaseModal } from "./EvalCaseModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SEED = draftFromSeed({
  agent_id: "a1",
  agent_name: "Security Reviewer",
  name: "From finding: Missing authentication in API calls",
  expectation_kind: "must_find",
  input_diff: [
    "diff --git a/client/src/lib/api.ts b/client/src/lib/api.ts",
    "--- a/client/src/lib/api.ts",
    "+++ b/client/src/lib/api.ts",
    "@@ -9,3 +9,4 @@",
    "+  headers: {},",
  ].join("\n"),
  input_meta: { title: "Feat/subagents", body: "" },
  expected_output: [
    {
      file: "client/src/lib/api.ts",
      start_line: 9,
      end_line: 12,
      severity: "CRITICAL",
      category: "security",
      title: "Missing authentication in API calls",
    },
  ],
  source_finding_id: "f1",
  input_files: ["client/src/lib/api.ts"],
});

function renderSeeded() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <ToastProvider>
        <EvalCaseModal
          agentId="a1"
          seed={{ draft: SEED, sourceFindingId: "f1" }}
          onClose={() => {}}
        />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

function previewResult(over: Partial<EvalCaseRun> = {}): EvalCaseRun {
  return {
    id: "",
    case_id: "",
    case_name: "preview",
    expectation_kind: "must_find",
    ran_at: "2026-01-02T09:14:00.000Z",
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    duration_ms: 1800,
    cost_usd: 0.002,
    counts: { tp: 1, fn: 0, fp: 0, findings: 1, grounded_kept: 1, grounded_total: 1 },
    findings: [
      {
        id: "f1",
        severity: "CRITICAL",
        category: "security",
        title: "Missing authentication in API calls",
        file: "client/src/lib/api.ts",
        start_line: 9,
        end_line: 12,
        rationale: "no auth header",
        confidence: 0.9,
      },
    ],
    missed: [],
    violations: [],
    error: null,
    ...over,
  };
}

describe("EvalCaseModal — seeded from a finding", () => {
  it("opens pre-filled and writes NOTHING until Save", () => {
    renderSeeded();
    expect(
      screen.getByDisplayValue("From finding: Missing authentication in API calls"),
    ).toBeInTheDocument();
    expect(screen.getByText("POSITIVE CASE")).toBeInTheDocument();
    expect(screen.getByText(/MUST find/)).toBeInTheDocument();
    // The whole point of the dialog: the click that opened it created no case.
    expect(createCase).not.toHaveBeenCalled();
  });

  it("dry-runs the draft before it exists, and shows the actual output", () => {
    renderSeeded();
    fireEvent.click(screen.getByText("Run case"));

    expect(previewCase).toHaveBeenCalledTimes(1);
    const [vars, opts] = previewCase.mock.calls[0]!;
    expect(vars.agentId).toBe("a1");
    expect(vars.input.expected_output[0]).toMatchObject({ file: "client/src/lib/api.ts" });
    // Still nothing saved — a preview is a measurement, not a decision.
    expect(createCase).not.toHaveBeenCalled();

    // The mutation is mocked, so its success callback is invoked by hand —
    // inside `act`, or React 19 never flushes the state it sets.
    act(() => opts.onSuccess(previewResult()));
    expect(screen.getByText("dry run · not saved")).toBeInTheDocument();
    expect(screen.getByText(/Last run passed/)).toBeInTheDocument();
    expect(screen.getByText("client/src/lib/api.ts:9-12")).toBeInTheDocument();
  });

  it("shows a dry run that failed its assertion as failed, not as an error", () => {
    renderSeeded();
    fireEvent.click(screen.getByText("Run case"));
    act(() =>
      previewCase.mock.calls[0]![1].onSuccess(
        previewResult({
          pass: false,
          findings: [],
          missed: [{ file: "client/src/lib/api.ts", start_line: 9, end_line: 12 }],
          counts: { tp: 0, fn: 1, fp: 0, findings: 0, grounded_kept: 0, grounded_total: 0 },
        }),
      ),
    );
    expect(screen.getByText(/Last run failed/)).toBeInTheDocument();
    expect(screen.getByText(/found 0 of 1 expected/)).toBeInTheDocument();
  });

  it("carries the source finding through to the saved case", () => {
    renderSeeded();
    fireEvent.click(screen.getByText("Create case"));
    expect(createCase).toHaveBeenCalledTimes(1);
    const [vars] = createCase.mock.calls[0]!;
    expect(vars.input.source_finding_id).toBe("f1");
    expect(vars.input.expectation_kind).toBe("must_find");
  });

  it("blocks Run and Save while the expected output is not valid JSON", () => {
    renderSeeded();
    const json = screen.getByDisplayValue(/"file": "client\/src\/lib\/api.ts"/);
    fireEvent.change(json, { target: { value: "[{" } });

    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Run case"));
    fireEvent.click(screen.getByText("Create case"));
    expect(previewCase).not.toHaveBeenCalled();
    expect(createCase).not.toHaveBeenCalled();
  });

  it("blocks Save on a case that asserts nothing", () => {
    // "[]" is valid JSON and a useless case: it passes every run and inflates
    // the pass count, which is worse than having no case at all.
    renderSeeded();
    const json = screen.getByDisplayValue(/"file": "client\/src\/lib\/api.ts"/);
    fireEvent.change(json, { target: { value: "[]" } });
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Create case"));
    expect(createCase).not.toHaveBeenCalled();
  });

  it("flips the assertion sentence when the polarity is changed", () => {
    renderSeeded();
    fireEvent.click(screen.getByText("must not flag"));
    expect(screen.getByText("NEGATIVE CASE")).toBeInTheDocument();
    expect(screen.getByText(/MUST NOT comment on/)).toBeInTheDocument();
  });

  it("lists the files the frozen diff touches", () => {
    renderSeeded();
    fireEvent.click(screen.getByText("Files"));
    expect(screen.getByText("client/src/lib/api.ts")).toBeInTheDocument();
  });

  it("runs the saved case after Save when 'Run on save' is on", () => {
    renderSeeded();
    fireEvent.click(screen.getByText("Run on save"));
    fireEvent.click(screen.getByText("Create case"));
    act(() => createCase.mock.calls[0]![1].onSuccess({ id: "c9", owner_id: "a1" }));
    expect(runSavedCase).toHaveBeenCalledWith(
      { caseId: "c9", agentId: "a1" },
      expect.anything(),
    );
  });
});
