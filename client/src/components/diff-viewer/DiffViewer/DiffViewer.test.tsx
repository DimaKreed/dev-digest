import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import messages from "../../../../messages/en/shell.json";
import { DiffViewer } from "./DiffViewer";

// jsdom has no layout, so scrollIntoView doesn't exist on elements.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

/** A patch whose new-side numbering runs 40…49. */
const PATCH = [
  "@@ -40,4 +40,10 @@",
  " ctx40",
  " ctx41",
  " ctx42",
  " ctx43",
  "+add44",
  "+add45",
  "-removed",
  "+add46",
  " ctx47",
  " ctx48",
  " ctx49",
].join("\n");

const SMALL: PrFile = { path: "src/small.ts", additions: 3, deletions: 1, patch: PATCH };
/** Over AUTO_EXPAND_MAX_LINES (200), so it starts collapsed. */
const BIG: PrFile = { path: "src/big.ts", additions: 400, deletions: 20, patch: PATCH };

function renderViewer(
  files: PrFile[],
  target?: React.ComponentProps<typeof DiffViewer>["target"],
  findings?: FindingRecord[],
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      <DiffViewer files={files} target={target} findings={findings} />
    </NextIntlClientProvider>,
  );
}

function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Token forwarded to a caller-supplied URL",
    file: "src/small.ts",
    start_line: 44,
    end_line: 44,
    rationale: "req.body.callback_url reaches fetch() with the account token attached.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    out_of_scope: null,
    scope_rationale: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

/** The severity stamped on each marked row, in document order. */
function severityMarkedTexts(): string[] {
  return Array.from(document.querySelectorAll("[data-severity]")).map(
    (el) => `${el.getAttribute("data-severity")}:${el.textContent ?? ""}`,
  );
}

/** The row elements the highlight marks. */
function highlightedTexts(): string[] {
  return Array.from(document.querySelectorAll("[data-highlighted]")).map(
    (el) => el.textContent ?? "",
  );
}

describe("DiffViewer deep-link target", () => {
  it("renders nothing highlighted without a target", () => {
    renderViewer([SMALL]);
    expect(highlightedTexts()).toHaveLength(0);
  });

  it("highlights only the rows inside the range, on the new side", () => {
    renderViewer([SMALL], { path: "src/small.ts", start: 44, end: 46, nonce: 1 });

    const texts = highlightedTexts().join(" ");
    expect(texts).toContain("add44");
    expect(texts).toContain("add45");
    expect(texts).toContain("add46");
    // Out of range, and the deleted line has no new-side number at all.
    expect(texts).not.toContain("ctx43");
    expect(texts).not.toContain("ctx47");
    expect(texts).not.toContain("removed");
  });

  it("scrolls the first row of the range into view", () => {
    renderViewer([SMALL], { path: "src/small.ts", start: 45, end: 46, nonce: 1 });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("force-expands a file that would otherwise start collapsed", () => {
    // Without a target the big file is closed, so its lines aren't in the DOM.
    renderViewer([BIG]);
    expect(screen.queryByText("add44")).not.toBeInTheDocument();

    cleanup();
    renderViewer([BIG], { path: "src/big.ts", start: 44, end: 44, nonce: 1 });
    expect(screen.getByText("add44")).toBeInTheDocument();
  });

  it("marks no line when no findings are passed", () => {
    renderViewer([SMALL]);
    expect(severityMarkedTexts()).toHaveLength(0);
  });

  it("leaves other files alone", () => {
    renderViewer([SMALL, { ...BIG, path: "src/other.ts" }], {
      path: "src/small.ts",
      start: 44,
      end: 44,
      nonce: 1,
    });
    // The untargeted big file stays collapsed.
    expect(screen.getAllByText("add44")).toHaveLength(1);
  });
});

describe("DiffViewer severity markers", () => {
  it("marks only the rows a finding's new-side range covers", () => {
    renderViewer([SMALL], undefined, [finding({ start_line: 44, end_line: 45 })]);

    const marked = severityMarkedTexts().join(" ");
    expect(marked).toContain("add44");
    expect(marked).toContain("add45");
    // Outside the range, and the deleted row has no new-side number at all.
    expect(marked).not.toContain("ctx43");
    expect(marked).not.toContain("add46");
    expect(marked).not.toContain("removed");
  });

  it("names the severity in words, not colour alone, and summarises the finding on hover", () => {
    renderViewer([SMALL], undefined, [finding()]);

    // The word comes from shell.diffViewer.severity.CRITICAL.
    const tag = screen.getByText("blocker");
    expect(tag).toBeInTheDocument();
    // Hover is a summary. The markdown rationale needs the panel, below.
    expect(tag).toHaveAttribute("title", "Critical: Token forwarded to a caller-supplied URL");
  });

  it("reveals the full finding text on click, and hides it again", () => {
    renderViewer([SMALL], undefined, [finding()]);
    const tag = screen.getByText("blocker");

    expect(tag).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/reaches fetch\(\) with the account token/)).not.toBeInTheDocument();

    fireEvent.click(tag);
    expect(tag).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Token forwarded to a caller-supplied URL")).toBeInTheDocument();
    expect(screen.getByText(/reaches fetch\(\) with the account token/)).toBeInTheDocument();

    fireEvent.click(tag);
    expect(screen.queryByText(/reaches fetch\(\) with the account token/)).not.toBeInTheDocument();
  });

  it("shows a suggestion only when the finding carries one", () => {
    renderViewer([SMALL], undefined, [finding({ suggestion: "Allow-list the callback host." })]);
    fireEvent.click(screen.getByText("blocker"));

    expect(screen.getByText("Suggested fix")).toBeInTheDocument();
    expect(screen.getByText("Allow-list the callback host.")).toBeInTheDocument();

    cleanup();
    renderViewer([SMALL], undefined, [finding()]);
    fireEvent.click(screen.getByText("blocker"));
    expect(screen.queryByText("Suggested fix")).not.toBeInTheDocument();
  });

  it("tags only the FIRST row of a multi-line finding, while tinting them all", () => {
    // 44…46 on the new side: three rendered rows, one finding.
    renderViewer([SMALL], undefined, [finding({ start_line: 44, end_line: 46 })]);

    // Tinted across the whole range…
    const marked = severityMarkedTexts().join(" ");
    expect(marked).toContain("add44");
    expect(marked).toContain("add45");
    expect(marked).toContain("add46");
    // …but exactly one badge, not one per row.
    expect(screen.getAllByText("blocker")).toHaveLength(1);
  });

  it("puts the badge on the first VISIBLE row when the finding starts above the hunk", () => {
    // The patch's new side starts at 40, so rows 1-39 are not rendered at all.
    renderViewer([SMALL], undefined, [finding({ start_line: 1, end_line: 41 })]);

    // The badge still appears rather than vanishing with its unrendered line.
    expect(screen.getAllByText("blocker")).toHaveLength(1);
    expect(severityMarkedTexts().join(" ")).toContain("ctx40");
  });

  it("collapses several findings on one row into a single badge", () => {
    renderViewer([SMALL], undefined, [
      finding({ id: "f2", severity: "SUGGESTION", title: "Prefer a constant" }),
      finding(),
    ]);

    const tags = screen.getAllByText(/blocker/);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.textContent).toContain("+1");

    // Both texts are in the panel — a SUGGESTION under a CRITICAL is not lost.
    fireEvent.click(tags[0]!);
    expect(screen.getByText("Prefer a constant")).toBeInTheDocument();
    expect(screen.getByText("Token forwarded to a caller-supplied URL")).toBeInTheDocument();
  });

  it("gives a line with several findings the most severe marker", () => {
    renderViewer([SMALL], undefined, [
      finding({ id: "f2", severity: "SUGGESTION", title: "Prefer a constant" }),
      finding(),
    ]);

    // SUGGESTION was passed first; CRITICAL must still win the row.
    expect(severityMarkedTexts().join(" ")).toContain("CRITICAL:");
  });

  it("marks a line in a file the deep link never touched", () => {
    // A finding is a property of the code, so it must not need a ?file= target.
    renderViewer([SMALL], { path: "src/other.ts", start: 1, end: 1, nonce: 1 }, [finding()]);
    expect(severityMarkedTexts().join(" ")).toContain("add44");
  });
});
