import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { FindingSummaryRow } from "./FindingSummaryRow";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  rationale: "Line 12 contains a literal sk_live_ key.",
  suggestion: null,
  confidence: 0.98,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "rv1",
  accepted_at: null,
  dismissed_at: null,
};

function renderRow(f: FindingRecord = FINDING, props = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingSummaryRow f={f} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("FindingSummaryRow", () => {
  it("renders title, category, file:line and confidence", () => {
    renderRow();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(screen.getByText("98% conf")).toBeInTheDocument();
  });

  it("renders a line range when the finding spans lines", () => {
    renderRow({ ...FINDING, file: "src/api/users.ts", start_line: 45, end_line: 52 });
    expect(screen.getByText("src/api/users.ts:45-52")).toBeInTheDocument();
  });

  it("hides the rationale unless a clamp is asked for", () => {
    renderRow();
    expect(screen.queryByText(FINDING.rationale)).not.toBeInTheDocument();

    cleanup();
    renderRow(FINDING, { rationaleClamp: 2 });
    expect(screen.getByText(FINDING.rationale)).toBeInTheDocument();
  });

  it("marks an accepted or dismissed finding", () => {
    renderRow({ ...FINDING, dismissed_at: "2026-06-13T21:00:00.000Z" });
    expect(screen.getByText("dismissed")).toBeInTheDocument();
  });

  it("does not bubble a file-link click to a clickable ancestor", () => {
    const onRowClick = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <div onClick={onRowClick}>
          <FindingSummaryRow f={FINDING} repoFullName="acme/payments-api" headSha="abc123" />
        </div>
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByText("src/config.ts:12"));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
