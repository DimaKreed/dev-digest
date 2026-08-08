import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type {
  FindingRecord,
  PrFile,
  PrReviewComment,
  ReviewRecord,
  SmartDiff,
} from "@devdigest/shared";
// Eight `..` from a test under pulls/[number]/_components/*/ to the package root
// (client/insights.md:219-230 — counted, not copied).
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";

/**
 * Spec-first tests for W8 of `.devdigest/cache/plans/smart-diff.md` — the
 * "Smart order | Original order" toggle and, above all, W8.4: Smart Diff must
 * never be able to hide the diff.
 *
 * The data seam here is real (unlike SmartDiffViewer, which is prop-driven), so
 * `@/lib/hooks/reviews` is mocked — never `fetch`, and never MSW (not installed).
 */

// jsdom has no layout — same stub as diff-viewer/DiffViewer/DiffViewer.test.tsx:8-10.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// ---- local typed factories (no shared fixture directory exists in this repo)

/** New-side lines 10, 11, 12; the added line is 11 and names its file so every
 *  rendered diff row is unique across the three files. */
function prFile(path: string, additions: number, deletions: number): PrFile {
  return {
    path,
    additions,
    deletions,
    patch: `@@ -10,3 +10,4 @@\n   port: 3000,\n+  const changed = "${path}";\n   redisUrl: x,`,
  };
}

/** The added row of `src/service.ts` — new-side line 11, where the fixture
 *  comment is anchored and where a new comment gets composed. */
const ADDED_LINE_TEXT = 'const changed = "src/service.ts";';

function sdFile(path: string, additions: number, deletions: number, finding_lines: number[] = []) {
  return { path, pseudocode_summary: null, additions, deletions, finding_lines };
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

/** Props order — what "Original order" must reproduce. */
const FILES: PrFile[] = [
  prFile("src/service.ts", 10, 2),
  prFile("src/modules/index.ts", 2, 0),
  prFile("pnpm-lock.yaml", 900, 30),
];

const SMART_DIFF: SmartDiff = {
  groups: [
    { role: "core", files: [sdFile("src/service.ts", 10, 2, [11])] },
    { role: "wiring", files: [sdFile("src/modules/index.ts", 2, 0)] },
    { role: "boilerplate", files: [sdFile("pnpm-lock.yaml", 900, 30)] },
  ],
  split_suggestion: { too_big: false, total_lines: 944, proposed_splits: [] },
};

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
    findings: [finding()],
  },
];

const COMMENT_BODY = "Please rename this constant.";
const COMMENTS: PrReviewComment[] = [
  {
    id: 1,
    path: "src/service.ts",
    line: 11,
    original_line: 11,
    side: "RIGHT",
    body: COMMENT_BODY,
    user: "octocat",
    created_at: "2026-08-05T00:00:00Z",
    html_url: "https://github.com/acme/api/pull/482#discussion_r1",
    in_reply_to_id: null,
    is_outdated: false,
  },
];

// ---- the data seam: mock the hooks module, not the network

let smartDiffState: { data: SmartDiff | undefined; isLoading: boolean; isError: boolean } = {
  data: SMART_DIFF,
  isLoading: false,
  isError: false,
};
let reviewsState: { data: ReviewRecord[] | undefined; isLoading: boolean } = {
  data: REVIEWS,
  isLoading: false,
};
let commentsState: { data: PrReviewComment[] | undefined } = { data: COMMENTS };
const createMutateAsync = vi.fn(async () => ({}));

vi.mock("@/lib/hooks/reviews", () => ({
  useSmartDiff: () => smartDiffState,
  usePrReviews: () => reviewsState,
  usePrComments: () => commentsState,
  useCreatePrComment: () => ({ mutateAsync: createMutateAsync, isPending: false }),
}));

// Imported below the fixtures and the mock — the factory closes over them
// (react-testing-library § Mocking Strategies, the PRRow.test.tsx idiom).
import { DiffTab } from "./DiffTab";

const GROUP_LABELS = /^(Core|Wiring|Boilerplate)$/;
const FILE_PATHS = /^(src\/service\.ts|src\/modules\/index\.ts|pnpm-lock\.yaml)$/;

function renderTab(props: Partial<React.ComponentProps<typeof DiffTab>> = {}) {
  const onSetOrder = props.onSetOrder ?? vi.fn();
  const onOpenFile = props.onOpenFile ?? vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <DiffTab
        prId="pr1"
        filesCount={FILES.length}
        files={FILES}
        canComment
        target={null}
        order="smart"
        {...props}
        onSetOrder={onSetOrder}
        onOpenFile={onOpenFile}
      />
    </NextIntlClientProvider>,
  );
  return { ...view, onSetOrder, onOpenFile };
}

/** Every changed file is on screen — the "no empty screen" half of W8.4. */
function expectEveryFileVisible() {
  for (const f of FILES) {
    expect(screen.getAllByText(f.path).length).toBeGreaterThan(0);
  }
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  smartDiffState = { data: SMART_DIFF, isLoading: false, isError: false };
  reviewsState = { data: REVIEWS, isLoading: false };
  commentsState = { data: COMMENTS };
});

describe("DiffTab — Smart Diff can never hide the diff (W8.4)", () => {
  it("falls back to the plain DiffViewer while useSmartDiff is loading", () => {
    smartDiffState = { data: undefined, isLoading: true, isError: false };
    renderTab({ order: "smart" });

    expect(screen.queryAllByText(GROUP_LABELS)).toHaveLength(0);
    expectEveryFileVisible();
  });

  it("falls back to the plain DiffViewer when useSmartDiff errors", () => {
    smartDiffState = { data: undefined, isLoading: false, isError: true };
    renderTab({ order: "smart" });

    expect(screen.queryAllByText(GROUP_LABELS)).toHaveLength(0);
    expectEveryFileVisible();
  });

  it("falls back to the plain DiffViewer when the server returns no groups", () => {
    smartDiffState = {
      data: { groups: [], split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] } },
      isLoading: false,
      isError: false,
    };
    renderTab({ order: "smart" });

    expect(screen.queryAllByText(GROUP_LABELS)).toHaveLength(0);
    expectEveryFileVisible();
  });
});

describe("DiffTab — order (W8.1, W8.2, W8.3)", () => {
  it("renders the grouped Smart order when order is smart (W8.1)", () => {
    renderTab({ order: "smart" });

    // getAllBy* returns matches in document order.
    expect(screen.getAllByText(GROUP_LABELS).map((el) => el.textContent)).toEqual([
      "Core",
      "Wiring",
      "Boilerplate",
    ]);
    // The core group is first, so the service file precedes the lock file.
    expect(screen.getAllByText("src/service.ts").length).toBeGreaterThan(0);
  });

  it("renders the original order for ?order=original with no interaction (W8.3)", () => {
    renderTab({ order: "original" });

    // Asserted synchronously after render: no click, no await, no waitFor.
    expect(screen.queryAllByText(GROUP_LABELS)).toHaveLength(0);
    expect(screen.getAllByText(FILE_PATHS).map((el) => el.textContent)).toEqual(
      FILES.map((f) => f.path),
    );
  });

  it("asks the page to switch order, once per click, in both directions (W8.2)", () => {
    const { onSetOrder } = renderTab({ order: "smart" });

    fireEvent.click(screen.getByRole("button", { name: /original/i }));
    // Count FIRST — toHaveBeenCalledWith alone passes if *any* call matched
    // (client/insights.md:122-127).
    expect(onSetOrder).toHaveBeenCalledTimes(1);
    expect(onSetOrder).toHaveBeenCalledWith("original");

    cleanup();

    const back = renderTab({ order: "original" });
    fireEvent.click(screen.getByRole("button", { name: /smart/i }));
    expect(back.onSetOrder).toHaveBeenCalledTimes(1);
    expect(back.onSetOrder).toHaveBeenCalledWith("smart");
  });
});

/**
 * W8.5 — "existing inline-comment behaviour is unchanged in both orders".
 * `plan-verifier` called this unverifiable because Smart order renders one
 * `DiffViewer` per group instead of one for the whole PR, so passing an
 * identical `commenting` object proves nothing. These two tests therefore run
 * the same *rendered* flow — reveal an anchored thread, then compose and post a
 * new comment on a diff row — once per `order` value.
 *
 * The two `parentElement` hops are the one structural coupling in this file:
 * the hover affordance has no accessible name until its row is hovered, and the
 * handler sits on diff-viewer's unlabelled row wrapper.
 */
async function commentFlow() {
  // 1. An existing GitHub thread is hidden until the toggle reveals it.
  expect(screen.queryByText(COMMENT_BODY)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /comments/i }));
  expect(screen.getByText(COMMENT_BODY)).toBeInTheDocument();

  // 2. Hovering the added row offers "+", which opens the composer.
  const row = screen.getByText(ADDED_LINE_TEXT).parentElement!.parentElement!;
  fireEvent.mouseEnter(row);
  fireEvent.click(screen.getByRole("button", { name: /add a comment on this line/i }));

  // 3. Posting reaches the mutation with the new-side line the row shows.
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Nit: name it." } });
  fireEvent.click(screen.getByRole("button", { name: /^Comment$/ }));

  // The composer closes only on a successful post — awaiting that is both the
  // user-visible settle and what keeps the async state update inside act().
  await waitForElementToBeRemoved(() => screen.queryByRole("textbox"));

  expect(createMutateAsync).toHaveBeenCalledTimes(1);
  expect(createMutateAsync).toHaveBeenCalledWith({
    path: "src/service.ts",
    line: 11,
    side: "RIGHT",
    body: "Nit: name it.",
  });
}

describe("DiffTab — inline comments in both orders (W8.5)", () => {
  it("reveals an anchored thread and posts a new comment — in the original order", async () => {
    renderTab({ order: "original" });
    await commentFlow();
  });

  it("reveals an anchored thread and posts a new comment — in the smart order", async () => {
    renderTab({ order: "smart" });
    await commentFlow();
  });
});
