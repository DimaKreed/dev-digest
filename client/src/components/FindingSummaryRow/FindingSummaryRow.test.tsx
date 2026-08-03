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

describe("FindingSummaryRow navigation", () => {
  it("is not a control unless onOpen is given", () => {
    renderRow();
    expect(screen.queryByRole("button", { name: /Hardcoded/ })).not.toBeInTheDocument();
  });

  it("opens the finding on row click and on Enter", () => {
    const onOpen = vi.fn();
    renderRow(FINDING, { onOpen });

    const row = screen.getByRole("button", { name: /Hardcoded/ });
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("does not leak the row's click or Enter to a clickable ancestor", () => {
    const onOpen = vi.fn();
    const ancestor = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <div onClick={ancestor} onKeyDown={ancestor}>
          <FindingSummaryRow f={FINDING} onOpen={onOpen} />
        </div>
      </NextIntlClientProvider>,
    );

    const row = screen.getByRole("button", { name: /Hardcoded/ });
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(ancestor).not.toHaveBeenCalled();
  });

  it("opens the file:line in-app without also opening the finding", () => {
    const onOpen = vi.fn();
    const onOpenFile = vi.fn();
    renderRow(FINDING, { onOpen, onOpenFile });

    fireEvent.click(screen.getByText("src/config.ts:12"));
    expect(onOpenFile).toHaveBeenCalledWith("src/config.ts", 12, 12);
    // The row is a control too — the link must not bubble into it.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps GitHub reachable via a separate link once file:line goes in-app", () => {
    renderRow(FINDING, {
      onOpenFile: vi.fn(),
      repoFullName: "acme/payments-api",
      headSha: "abc123",
    });

    const gh = screen.getByRole("link", { name: "Open this file on GitHub" });
    expect(gh).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123/src/config.ts#L12",
    );
    expect(gh).toHaveAttribute("target", "_blank");
  });
});
