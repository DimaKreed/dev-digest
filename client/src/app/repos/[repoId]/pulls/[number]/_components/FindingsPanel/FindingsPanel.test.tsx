import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ToastProvider } from "../../../../../../../lib/toast";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The panel opens the eval-case editor over a DRAFT it fetches (SPEC-04);
// mocked here for the same reason the action hook is — this file is a render
// smoke test with no query client and no API.
vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useEvalCaseDraft: () => ({ data: undefined, isLoading: true, isError: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
  {
    id: "f2",
    severity: "WARNING",
    category: "perf",
    title: "N+1 query",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "One query per user.",
    suggestion: null,
    confidence: 0.86,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, eval: evalMessages }}>
      {/* The eval-case editor the panel can open raises toasts, so the provider
          is part of this panel's render contract now. */}
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("renders only the selected severity when the page filter is active", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" severity="CRITICAL" />);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
  });

  it("shows the empty state when no finding is at the selected severity", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" severity="SUGGESTION" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});
