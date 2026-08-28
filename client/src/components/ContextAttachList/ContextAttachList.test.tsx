/**
 * SPEC-01 — the shared `Context` tab attach list (AC-13, AC-14, AC-16, AC-17,
 * AC-18, AC-36).
 *
 * Spec-first: derived from `specs/01-project-context-documents.md`.
 *
 * API names RECONCILED against the landed code: `ContextAttachList({ kind,
 * parentId, repoId })` plus `useContextAttachments` / `useSetContextAttachments`
 * in `src/lib/hooks/context.ts` are what shipped, and `attachable` /
 * `not_attachable_reason` are on `SpecFile`. The criteria fix the behaviour; the
 * names are the component's. If a name moves, move it here — never weaken an
 * assertion to get green.
 *
 * One deliberate implementation choice not to fight: rows use a native
 * `<input type="checkbox">` rather than the `@devdigest/ui` `Checkbox`, which
 * renders `<button role="checkbox">` whose `.checked` DOM property is
 * `undefined` — `boxes.find((b) => !b.checked)` would then always pick row 0.
 *
 * Seam: the hooks in `src/lib/hooks/`, not `fetch`. `fireEvent` only —
 * `@testing-library/user-event` is not installed here. Every mutation
 * assertion counts calls BEFORE checking arguments (`client/insights.md`).
 *
 * Depth: ContextAttachList → components → src → client. Three segments.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/context.json";

const SPEC = "specs/public-api.md";
const DOC = "docs/architecture.md";
const INSIGHT = "insights/perf.md";

function doc(path: string, over: Record<string, unknown> = {}) {
  const dir = path.slice(0, path.indexOf("/"));
  return {
    path,
    dir,
    // AC-41: the displayed type is the matched root's own directory name,
    // verbatim — no mapping onto a closed vocabulary, no i18n key.
    doc_type: dir,
    size: 1200,
    tokens: 300,
    used_by: 0,
    updated_at: "2026-08-27T10:00:00.000Z",
    attachable: true,
    ...over,
  };
}

const DOCS = [doc(SPEC), doc(DOC, { tokens: 120 }), doc(INSIGHT, { tokens: 50 })];

const setAttachments = { mutate: vi.fn(), isPending: false, error: null };
/** Two of the three are attached, in this persisted order. */
let attachments: { data: { path: string; order: number }[]; isLoading: boolean; error: unknown } = {
  data: [
    { path: SPEC, order: 0 },
    { path: DOC, order: 1 },
  ],
  isLoading: false,
  error: null,
};

// Hoisted function, not a `const` arrow: `vi.mock` runs before the file body,
// so a const factory is read inside its own temporal dead zone.
function contextHooks() {
  return {
    useContextFiles: () => ({ data: DOCS, isLoading: false, error: null }),
    useContextFile: () => ({ data: null, isLoading: false, error: null }),
    useContextAttachments: () => attachments,
    useSetContextAttachments: () => setAttachments,
  };
}
vi.mock("@/lib/hooks/context", contextHooks);
vi.mock("@/lib/hooks", contextHooks);
vi.mock("@/lib/hooks/core", contextHooks);

import { ContextAttachList } from "./ContextAttachList";

afterEach(() => {
  cleanup();
  setAttachments.mutate.mockReset();
  attachments = {
    data: [
      { path: SPEC, order: 0 },
      { path: DOC, order: 1 },
    ],
    isLoading: false,
    error: null,
  };
});

function renderList() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextAttachList kind="agent" parentId="agent-1" repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

/** The persisted set the component sent, however it wraps it. */
function persistedPaths(call: unknown[]): unknown {
  const arg = call[0] as Record<string, unknown> | string[];
  return Array.isArray(arg) ? arg : (arg.paths ?? arg);
}

/** The reorder handle: an icon-only button, so it must have an accessible name. */
function handles() {
  return screen.getAllByRole("button", { name: /reorder|move|drag/i });
}

describe("SPEC-01 · Context attach list", () => {
  it("AC-13 / AC-18 — every row, the header counts and filter, and the footer token total and untrusted statement are present", () => {
    renderList();

    // Per row: an attach checkbox, the file name, its directory, its type and a
    // preview affordance.
    expect(screen.getAllByRole("checkbox")).toHaveLength(DOCS.length);
    expect(screen.getByText(/public-api\.md/)).toBeInTheDocument();
    expect(screen.getByText(/architecture\.md/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /preview/i }).length).toBeGreaterThan(0);

    // Header: how many of the available documents are attached, plus a filter.
    const header = screen.getByText(/2\D+3/);
    expect(header).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    // Footer: the SET's total token cost — server-counted figures summed
    // (300 + 120); the client counts nothing itself.
    expect(screen.getByText(/420/)).toBeInTheDocument();
    // …and the statement that the set is injected as an untrusted
    // `## Project context` block into every run.
    const footer = screen.getByText(/## Project context/);
    expect(footer).toBeInTheDocument();
    expect(footer.textContent ?? "").toMatch(/untrusted/i);
  });

  it("AC-14 — attaching a document persists the whole ordered set in one request", () => {
    renderList();

    const boxes = screen.getAllByRole("checkbox");
    const unchecked = boxes.find((box) => !(box as HTMLInputElement).checked);
    expect(unchecked).toBeDefined();
    fireEvent.click(unchecked!);

    expect(setAttachments.mutate).toHaveBeenCalledTimes(1);
    expect(persistedPaths(setAttachments.mutate.mock.calls[0]!)).toEqual([SPEC, DOC, INSIGHT]);
  });

  it("AC-16 / AC-36 — ArrowDown on the named drag handle reorders and persists the new order", () => {
    renderList();

    const [first] = handles();
    expect(first).toBeDefined();
    // AC-36: the icon-only handle carries an accessible name (the query above
    // resolves by name, so reaching it at all is the assertion).
    expect(first!).toHaveAccessibleName();

    fireEvent.keyDown(first!, { key: "ArrowDown" });

    expect(setAttachments.mutate).toHaveBeenCalledTimes(1);
    expect(persistedPaths(setAttachments.mutate.mock.calls[0]!)).toEqual([DOC, SPEC]);
  });

  it("AC-17 — filtering changes only which rows are shown, never the persisted set", () => {
    renderList();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "architecture" } });

    expect(screen.getByText(/architecture\.md/)).toBeInTheDocument();
    expect(screen.queryByText(/public-api\.md/)).not.toBeInTheDocument();
    expect(screen.queryByText(/perf\.md/)).not.toBeInTheDocument();
    expect(setAttachments.mutate).not.toHaveBeenCalled();
  });

  it("AC-40 — an oversized document is shown, marked with its reason, and cannot be attached", () => {
    // The server supplies both the mark and the reason; the client knows no limit.
    const huge = doc("docs/huge.md", { attachable: false, not_attachable_reason: "too_large" });
    DOCS.push(huge);
    try {
      renderList();
      expect(screen.getByText(/huge\.md/)).toBeInTheDocument();
      const boxes = screen.getAllByRole("checkbox");
      expect(boxes.some((box) => (box as HTMLInputElement).disabled)).toBe(true);
    } finally {
      DOCS.pop();
    }
  });
});
