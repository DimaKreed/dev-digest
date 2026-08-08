import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiff } from "@devdigest/shared";
import type { DiffCommentApi } from "@/components/diff-viewer";
// Eight `..` from a test under pulls/[number]/_components/*/ to the package root
// (client/insights.md:219-230 — counted, not copied).
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

/**
 * Spec-first tests for W7 / W9 of `.devdigest/cache/plans/smart-diff.md`.
 * `fireEvent` only — `@testing-library/user-event` is not installed here.
 * SmartDiffViewer is prop-driven (W7's six props), so no hook seam is mocked:
 * `useSmartDiff` belongs to the parent `DiffTab` (W8), not to this component.
 */

// jsdom has no layout, so scrollIntoView doesn't exist on elements. Same stub
// as src/components/diff-viewer/DiffViewer/DiffViewer.test.tsx:8-10 — FileCard's
// deep-link fallback calls it whenever the target line is outside the patch
// hunks (client/insights.md:42-55).
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

// ---- local typed factories (there is no shared fixture directory in this repo)

function sdFile(path: string, additions: number, deletions: number, finding_lines: number[] = []) {
  return { path, pseudocode_summary: null, additions, deletions, finding_lines };
}

function prFile(path: string, additions: number, deletions: number): PrFile {
  return {
    path,
    additions,
    deletions,
    patch: `@@ -10,3 +10,4 @@\n   port: 3000,\n+  const x = 1;\n   redisUrl: x,`,
  };
}

function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/service.ts",
    start_line: 11,
    end_line: 11,
    rationale: "a live key is committed",
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

const REVIEWS: ReviewRecord[] = [
  {
    id: "r1",
    pr_id: "pr1",
    agent_id: "a1",
    run_id: "run1",
    agent_name: "Security reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: "one blocker",
    score: 50,
    model: "openrouter/deepseek/deepseek-v4-flash",
    grounding: null,
    created_at: "2026-08-02T00:00:00Z",
    findings: [finding(), finding({ id: "f2", severity: "WARNING", start_line: 14, end_line: 14 })],
  },
];

const FILES: PrFile[] = [
  prFile("src/service.ts", 10, 2),
  prFile("src/modules/index.ts", 2, 0),
  prFile("pnpm-lock.yaml", 900, 30),
];

/** Inline commenting off — this suite is about ordering, not comments (W8.5). */
const COMMENTING: DiffCommentApi = {
  comments: [],
  canComment: false,
  showComments: false,
  posting: false,
  onSubmit: async () => ({}),
};

/** All three roles populated; `too_big` off. */
const SMART_DIFF: SmartDiff = {
  groups: [
    { role: "core", files: [sdFile("src/service.ts", 10, 2, [11, 14])] },
    { role: "wiring", files: [sdFile("src/modules/index.ts", 2, 0)] },
    { role: "boilerplate", files: [sdFile("pnpm-lock.yaml", 900, 30)] },
  ],
  split_suggestion: { too_big: false, total_lines: 944, proposed_splits: [] },
};

function renderViewer(props: Partial<React.ComponentProps<typeof SmartDiffViewer>> = {}) {
  const onOpenFile = props.onOpenFile ?? vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <SmartDiffViewer
        smartDiff={SMART_DIFF}
        files={FILES}
        reviews={REVIEWS}
        commenting={COMMENTING}
        target={null}
        onOpenFile={onOpenFile}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { ...view, onOpenFile };
}

describe("SmartDiffViewer", () => {
  it("renders the groups in core → wiring → boilerplate order and skips an empty group (W7.1, W7.2)", () => {
    renderViewer();
    // getAllBy* returns matches in document order, so this is the DOM order.
    const labels = screen.getAllByText(/^(Core|Wiring|Boilerplate)$/).map((el) => el.textContent);
    expect(labels).toEqual(["Core", "Wiring", "Boilerplate"]);

    cleanup();

    renderViewer({
      smartDiff: {
        ...SMART_DIFF,
        groups: [
          { role: "core", files: [sdFile("src/service.ts", 10, 2, [11, 14])] },
          { role: "wiring", files: [] },
          { role: "boilerplate", files: [] },
        ],
      },
    });
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.queryByText("Wiring")).not.toBeInTheDocument();
    expect(screen.queryByText("Boilerplate")).not.toBeInTheDocument();
  });

  it("starts the boilerplate group collapsed and expands it on a header click (W7.3)", () => {
    renderViewer();
    // A path renders twice by design in an open group — once in the finding-chip
    // index row, once in FileCard's own header (W7's "index row, then
    // <DiffViewer>") — so count matches rather than demanding exactly one.
    expect(screen.getAllByText("src/service.ts").length).toBeGreaterThan(0);
    // The boilerplate group's chips and DiffViewer are not in the DOM at all.
    expect(screen.queryAllByText("pnpm-lock.yaml")).toHaveLength(0);

    fireEvent.click(screen.getByText("Boilerplate"));
    expect(screen.getAllByText("pnpm-lock.yaml").length).toBeGreaterThan(0);
  });

  it("badges a file's finding lines and opens the file exactly once per chip click (W7.4, W7.5)", () => {
    const onOpenFile = vi.fn();
    renderViewer({ onOpenFile });

    // Badge text comes from prReview.smartDiff.findingLines ("{count} finding-lines").
    expect(screen.getByText("2 finding-lines")).toBeInTheDocument();

    // Each chip is a button whose accessible name names the line it targets —
    // otherwise W7.5's "clicking a chip" is not addressable at all.
    const chip = screen.getByRole("button", { name: /11/ });
    fireEvent.click(chip);

    // Count FIRST: toHaveBeenCalledWith alone passes if *any* call matched, so a
    // bubbled second call would go unseen (client/insights.md:122-127).
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith("src/service.ts", 11, 11);
  });

  it("opens a collapsed group when the deep-link target lands inside it, and re-opens on a new nonce (W7.6)", () => {
    const { rerender, onOpenFile } = renderViewer({
      target: { path: "pnpm-lock.yaml", start: 1, end: 1, nonce: 1 },
    });
    // The collapsed boilerplate group must open, or the FileCard → CodeLine
    // scroll can never run (client/insights.md:42-55).
    expect(screen.getAllByText("pnpm-lock.yaml").length).toBeGreaterThan(0);

    // Collapse it by hand, then re-select the same path with a bumped nonce.
    fireEvent.click(screen.getByText("Boilerplate"));
    expect(screen.queryAllByText("pnpm-lock.yaml")).toHaveLength(0);

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
        <SmartDiffViewer
          smartDiff={SMART_DIFF}
          files={FILES}
          reviews={REVIEWS}
          commenting={COMMENTING}
          target={{ path: "pnpm-lock.yaml", start: 1, end: 1, nonce: 2 }}
          onOpenFile={onOpenFile}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByText("pnpm-lock.yaml").length).toBeGreaterThan(0);
  });

  it("shows the split hint only when too_big, and never a placeholder for a null summary (W7.7, W7.8)", () => {
    renderViewer();
    expect(screen.queryByText(/This PR is large/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Consider splitting it/)).not.toBeInTheDocument();
    // pseudocode_summary is null on every file — nothing at all is rendered for it.
    expect(screen.queryByText("—")).not.toBeInTheDocument();

    cleanup();

    renderViewer({
      smartDiff: {
        ...SMART_DIFF,
        split_suggestion: { too_big: true, total_lines: 944, proposed_splits: [] },
      },
    });
    expect(screen.getByText(/This PR is large \(944 changed lines\)/)).toBeInTheDocument();
    expect(screen.getByText(/Consider splitting it/)).toBeInTheDocument();
  });
});
