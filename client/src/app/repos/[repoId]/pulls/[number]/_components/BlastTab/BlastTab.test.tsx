import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
// Eight `..` from a test under pulls/[number]/_components/*/ to the package root
// (client/insights.md — counted, not copied).
import blast from "../../../../../../../../messages/en/blast.json";

/**
 * The property under test throughout: an empty caller list must not read the
 * same way when the index was broken as when it was complete.
 *
 * The data seam here is real (BlastTab calls the hook itself), so
 * `@/lib/hooks/blast` is mocked — never `fetch`, and never MSW (not installed).
 * That is the DiffTab precedent, for the same reason.
 */

// ---- local typed factories (no shared fixture directory exists in this repo)

function response(over: Partial<BlastRadiusResponse> = {}): BlastRadiusResponse {
  return {
    changed_symbols: [{ name: "rateLimit", file: "src/api/rateLimit.ts", kind: "function" }],
    downstream: [],
    summary: "s",
    state: "ok",
    reason: null,
    truncated_files: [],
    prior_prs: [],
    notes_state: "absent",
    ...over,
  };
}

/**
 * One downstream row. `resolution` and `mentions` default to the "callers were
 * found" case, so a test that is not about them stays silent about them — but
 * the contract makes them required, so a test that IS about them cannot forget.
 */
function node(
  over: Partial<BlastRadiusResponse["downstream"][number]> & { symbol: string },
): BlastRadiusResponse["downstream"][number] {
  return {
    callers: [],
    endpoints_affected: [],
    crons_affected: [],
    resolution: (over.callers?.length ?? 0) > 0 ? "found" : "unreferenced",
    mentions: 0,
    ...over,
  };
}

const TWO_CALLERS: BlastRadiusResponse["downstream"] = [
  {
    symbol: "rateLimit",
    callers: [
      {
        name: "publicRouter",
        file: "src/api/public/index.ts",
        line: 23,
        endpoints_affected: ["POST /pay"],
        crons_affected: [],
      },
      {
        name: "adminRouter",
        file: "src/api/admin/index.ts",
        line: 41,
        endpoints_affected: ["GET /health"],
        crons_affected: [],
      },
    ],
    endpoints_affected: ["GET /health", "POST /pay"],
    crons_affected: [],
    resolution: "found",
    mentions: 2,
  },
];

let blastState: {
  data: BlastRadiusResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};
const refetch = vi.fn();
const notesMutate = vi.fn();
let notesState: { data: unknown; isPending: boolean; isError: boolean; isIdle: boolean };

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: () => blastState,
  useBlastHistoryNotes: () => ({ ...notesState, mutate: notesMutate }),
}));

// Imported below the fixtures and the mock — the factory closes over them.
import { BlastTab } from "./BlastTab";

const onOpenFile = vi.fn();
const setView = vi.fn();

function renderTab(over: Partial<React.ComponentProps<typeof BlastTab>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast }}>
      <BlastTab
        prId="pr-1"
        prFilePaths={new Set()}
        repoFullName="acme/payments-api"
        headSha="abc123"
        onOpenFile={onOpenFile}
        view="tree"
        onSetView={setView}
        {...over}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  blastState = { data: response(), isLoading: false, isError: false, refetch };
  notesState = { data: undefined, isPending: false, isError: false, isIdle: true };
  onOpenFile.mockClear();
  notesMutate.mockClear();
  refetch.mockClear();
  setView.mockClear();
});
afterEach(cleanup);

describe("the header counts what was measured", () => {
  it("counts an endpoint reached through two symbols once", () => {
    blastState.data = response({
      changed_symbols: [
        { name: "alpha", file: "a.ts", kind: "function" },
        { name: "beta", file: "b.ts", kind: "function" },
      ],
      downstream: [
        {
          symbol: "alpha",
          callers: [
            {
              name: "x",
              file: "x.ts",
              line: 1,
              endpoints_affected: ["POST /pay"],
              crons_affected: [],
            },
          ],
          endpoints_affected: ["POST /pay"],
          crons_affected: [],
          resolution: "found",
          mentions: 1,
        },
        {
          symbol: "beta",
          callers: [
            {
              name: "y",
              file: "y.ts",
              line: 2,
              endpoints_affected: ["POST /pay"],
              crons_affected: [],
            },
          ],
          endpoints_affected: ["POST /pay"],
          crons_affected: [],
          resolution: "found",
          mentions: 1,
        },
      ],
    });
    renderTab();

    // POST /pay is reachable twice but is one endpoint. getByText returns the
    // stat span itself, whose text is the value followed by the label.
    expect(screen.getByText("endpoints").textContent).toBe("1endpoints");
    expect(screen.getByText("callers").textContent).toBe("2callers");
  });
});

describe("the tree", () => {
  it("reveals callers only once the symbol is expanded", () => {
    blastState.data = response({ downstream: TWO_CALLERS });
    renderTab();

    expect(screen.queryByText("src/api/public/index.ts:23")).toBeNull();
    const row = screen.getByRole("button", { name: /rateLimit/ });
    expect(row).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
  });

  it("opens a caller that IS in the diff in the app", () => {
    blastState.data = response({ downstream: TWO_CALLERS });
    renderTab({ prFilePaths: new Set(["src/api/public/index.ts"]) });

    fireEvent.click(screen.getByRole("button", { name: /rateLimit/ }));
    // In-diff renders a <button>; out-of-diff renders an <a href>. Asserting the
    // role is what makes each test say which affordance it expects.
    fireEvent.click(screen.getByRole("button", { name: "src/api/public/index.ts:23" }));

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith("src/api/public/index.ts", 23, 23);
  });

  it("sends a caller OUTSIDE the diff to GitHub instead of producing a dead link", () => {
    // The Files tab renders only the PR's own files, so routing this one there
    // would switch tabs and then show nothing.
    blastState.data = response({ downstream: TWO_CALLERS });
    renderTab({ prFilePaths: new Set() });

    fireEvent.click(screen.getByRole("button", { name: /rateLimit/ }));
    const link = screen.getByRole("link", { name: "src/api/public/index.ts:23" });
    fireEvent.click(link);

    expect(onOpenFile).not.toHaveBeenCalled();
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123/src/api/public/index.ts#L23",
    );
  });
});

describe("an empty result means different things", () => {
  it("reads as a measured no-impact when the index is healthy", () => {
    blastState.data = response({ downstream: [], state: "ok" });
    renderTab();

    expect(screen.getByText("No downstream impact found")).toBeInTheDocument();
    expect(screen.queryByText(/index is incomplete/)).toBeNull();
  });

  it("does NOT read as no-impact when the index is degraded", () => {
    blastState.data = response({ downstream: [], state: "degraded", reason: "no_data" });
    renderTab();

    expect(
      screen.getByText("No callers found — but the index is incomplete"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No downstream impact found")).toBeNull();
    expect(screen.getByText("Reason: no_data")).toBeInTheDocument();
  });

  it("warns on a partial index without hiding what it did find", () => {
    blastState.data = response({
      downstream: TWO_CALLERS,
      state: "partial",
      reason: "index_partial",
    });
    renderTab();

    expect(screen.getByText("This list may be incomplete")).toBeInTheDocument();
    // The content is still there — a partial index degrades the label, not the data.
    expect(screen.getByRole("button", { name: /rateLimit/ })).toBeInTheDocument();
  });
});

describe("the graph", () => {
  it("draws one edge per real caller→endpoint pair, not the product", () => {
    blastState.data = response({ downstream: TWO_CALLERS });
    const { container } = renderTab({ view: "graph" });

    // 2 callers x 2 endpoints would be 4 caller→endpoint edges if the flat
    // per-symbol union were used; the real answer is 2. Asserted per kind so an
    // offsetting regression in the other group cannot keep the total at 4.
    expect(container.querySelectorAll(`[data-edge="caller-endpoint"]`)).toHaveLength(2);
    expect(container.querySelectorAll(`[data-edge="symbol-caller"]`)).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
  });
});

describe("the view toggle", () => {
  it("reports the chosen view to the caller so it reaches the URL", () => {
    blastState.data = response({ downstream: TWO_CALLERS });
    renderTab({ view: "tree" });

    const graph = screen.getByRole("button", { name: "graph" });
    expect(screen.getByRole("button", { name: "tree" })).toHaveAttribute("aria-pressed", "true");
    expect(graph).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(graph);
    expect(setView).toHaveBeenCalledTimes(1);
    expect(setView).toHaveBeenCalledWith("graph");
  });
});

describe("prior PRs", () => {
  const withPrior = () =>
    response({
      prior_prs: [
        {
          pr_number: 401,
          title: "Introduce public API namespace",
          author: "deepak.r",
          merged_at: "2026-03-18T00:00:00.000Z",
          files_overlap: ["src/api/public/index.ts"],
          notes: "",
        },
      ],
    });

  it("does not pay for notes while the section is collapsed", () => {
    blastState.data = withPrior();
    renderTab();
    expect(notesMutate).not.toHaveBeenCalled();
  });

  it("asks for notes once, on the first expand", () => {
    blastState.data = withPrior();
    renderTab();

    const toggle = screen.getByRole("button", { name: /Prior PRs touching these files/ });
    fireEvent.click(toggle);
    expect(notesMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Introduce public API namespace")).toBeInTheDocument();

    // Collapsing and expanding again must not buy the same notes twice. The
    // mutation is no longer idle once it has fired.
    notesState.isIdle = false;
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(notesMutate).toHaveBeenCalledTimes(1);
  });

  it("keeps the list visible when the notes call fails", () => {
    blastState.data = withPrior();
    notesState.isError = true;
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /Prior PRs touching these files/ }));
    expect(screen.getByText("Introduce public API namespace")).toBeInTheDocument();
    expect(screen.getByText("Notes could not be generated.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// A zero is a finding only over a complete index. On a real 130-symbol pull
// request the index had resolved 8% of the repository's references, so almost
// every zero meant "could not tell" — and the row printed "0 callers".
// ---------------------------------------------------------------------------

describe("a caller count says only what the index can support", () => {
  // A name of its own: TWO_CALLERS is also `rateLimit`, and a row query that
  // matches both is not testing which row said what.
  const quiet: BlastRadiusResponse["downstream"] = [
    node({ symbol: "untouched", resolution: "unreferenced" }),
  ];

  it("states the reason, never a bare zero, over a complete index", () => {
    // `state: "ok"` — the emptiness IS the answer, and the answer is which kind
    // of empty. "0 callers" is not a string this UI can produce any more: every
    // zero has a reason attached, and printing the number instead of the reason
    // is what made 117 unexamined rows look examined.
    blastState.data = response({ downstream: [...quiet, ...TWO_CALLERS], state: "ok" });
    renderTab();

    expect(screen.getByText("not referenced")).toBeInTheDocument();
    expect(screen.queryByText("0 callers")).not.toBeInTheDocument();
    expect(screen.queryByText("callers unknown")).not.toBeInTheDocument();
  });

  it("counts the mentions when the name is used but unresolvable", () => {
    // The injected-port case. Eight mentions none of which could be tied to this
    // declaration is a place to look, and the row says so instead of shrugging.
    blastState.data = response({
      downstream: [
        node({ symbol: "github", resolution: "unresolved", mentions: 8 }),
        ...TWO_CALLERS,
      ],
      state: "ok",
    });
    renderTab();

    expect(screen.getByText("8 mention(s), unresolved")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /github/ }));
    expect(screen.getByText(/no mention could be tied to this declaration/)).toBeInTheDocument();
  });

  it("says unknown instead of zero over a partial index", () => {
    blastState.data = response({
      downstream: [...quiet, ...TWO_CALLERS],
      state: "partial",
      reason: "index_partial",
    });
    renderTab();

    expect(screen.getByText("callers unknown")).toBeInTheDocument();
    expect(screen.queryByText("0 callers")).not.toBeInTheDocument();
  });

  it("leaves a non-zero count alone over a partial index", () => {
    // Two callers were actually found; incompleteness makes that a lower bound,
    // not an unknown, and the banner already says so.
    blastState.data = response({ downstream: TWO_CALLERS, state: "partial" });
    renderTab();

    expect(screen.getByText("2 callers")).toBeInTheDocument();
    expect(screen.queryByText("callers unknown")).not.toBeInTheDocument();
  });

  it("explains the unknown inside the expanded row too", () => {
    blastState.data = response({
      downstream: [...quiet, ...TWO_CALLERS],
      state: "degraded",
      reason: "no_import_graph",
    });
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /untouched/ }));
    expect(screen.getByText(/Absent here means unknown, not none/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 31 of 130 rows on that pull request were interfaces. The index resolves
// invocations, so their zero was never a measurement of anything.
// ---------------------------------------------------------------------------

describe("types are set aside, not listed", () => {
  const mixed = (): BlastRadiusResponse =>
    response({
      changed_symbols: [
        { name: "rateLimit", file: "a.ts", kind: "function" },
        { name: "RowShape", file: "a.ts", kind: "interface" },
        { name: "Alias", file: "a.ts", kind: "type" },
      ],
      downstream: [
        ...TWO_CALLERS,
        node({ symbol: "RowShape", resolution: "not_callable" }),
        node({ symbol: "Alias", resolution: "not_callable" }),
      ],
    });

  it("keeps the type rows out of the tree, in a section of their own", () => {
    blastState.data = mixed();
    renderTab();

    expect(screen.queryByText("RowShape()")).not.toBeInTheDocument();
    expect(screen.queryByText("Alias()")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Types and interfaces/ })).toBeInTheDocument();
  });

  it("lists them by name and file once the section is expanded", () => {
    // Set aside, not dropped: expanding must show what was held back, and from
    // where, or the count is an unverifiable claim.
    blastState.data = mixed();
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /Types and interfaces/ }));
    expect(screen.getByText("RowShape")).toBeInTheDocument();
    expect(screen.getByText("Alias")).toBeInTheDocument();
    expect(screen.getByText(/a type is annotated rather than called/)).toBeInTheDocument();
  });

  it("shows no section at all when nothing was set aside", () => {
    blastState.data = response({ downstream: TWO_CALLERS });
    renderTab();

    expect(screen.queryByRole("button", { name: /Types and interfaces/ })).not.toBeInTheDocument();
  });

  it("keeps the symbols count honest — set aside is not dropped", () => {
    // The header still reports all three changed symbols. Hiding a row must not
    // quietly shrink what the tab claims to have looked at.
    blastState.data = mixed();
    renderTab();

    expect(screen.getByText("3").parentElement).toHaveTextContent("symbols");
  });

  it("shows a type row anyway when callers were actually found for it", () => {
    // A measured caller outranks a kind label claiming there cannot be one — an
    // interface with a resolved call site is a bug in the extractor's kind, and
    // hiding the evidence is the wrong way to react to it.
    blastState.data = response({
      changed_symbols: [{ name: "RowShape", file: "a.ts", kind: "interface" }],
      downstream: [
        {
          symbol: "RowShape",
          callers: [
            {
              name: "use",
              file: "b.ts",
              line: 7,
              endpoints_affected: [],
              crons_affected: [],
            },
          ],
          endpoints_affected: [],
          crons_affected: [],
          // The server already applied the rule; this pins that the client
          // honours it and does not re-hide the row from the kind.
          resolution: "found",
          mentions: 1,
        },
      ],
    });
    renderTab();

    expect(screen.getByText("RowShape()")).toBeInTheDocument();
  });

  it("shows an unrecognised kind rather than hiding it", () => {
    // TWO_CALLERS is here only so the tree renders at all: with nothing calling
    // anything the tab is an empty state, and there are no rows to inspect.
    blastState.data = response({
      changed_symbols: [
        { name: "rateLimit", file: "a.ts", kind: "function" },
        { name: "widget", file: "a.ts", kind: "gadget" },
      ],
      downstream: [
        ...TWO_CALLERS,
        node({ symbol: "widget", resolution: "unresolved" }),
      ],
    });
    renderTab();

    expect(screen.getByText("widget()")).toBeInTheDocument();
  });
});

describe("an empty result over an incomplete index is not a finding", () => {
  it("does not claim 'no downstream impact' when the index is only partial", () => {
    // `partial` is not `degraded`, so this branch used to fall through to the
    // neutral copy — the same lie the branch order exists to prevent, one notch
    // quieter. Nothing was found AND nothing could be trusted to be absent.
    blastState.data = response({ downstream: [], state: "partial", reason: "index_partial" });
    renderTab();

    expect(screen.queryByText("No downstream impact found")).not.toBeInTheDocument();
    expect(screen.getByText(/the index is incomplete/)).toBeInTheDocument();
  });

  it("still claims it over a complete index", () => {
    blastState.data = response({ downstream: [], state: "ok" });
    renderTab();

    expect(screen.getByText("No downstream impact found")).toBeInTheDocument();
  });
});

describe("loading and failure", () => {
  it("offers a retry when the request failed", () => {
    blastState = { data: undefined, isLoading: false, isError: true, refetch };
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
