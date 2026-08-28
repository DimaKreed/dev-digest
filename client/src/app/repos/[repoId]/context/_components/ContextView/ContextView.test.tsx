/**
 * SPEC-01 — the read-only Project Context page (AC-03 … AC-10, AC-35).
 *
 * Spec-first: derived from `specs/01-project-context-documents.md`. The page
 * does not exist yet, so this file is expected to be red until it lands.
 *
 * Seam: the data hooks, not `fetch` — there is no MSW here, and every server
 * call goes through `src/lib/hooks/`. Interaction is `fireEvent`;
 * `@testing-library/user-event` is not installed in this repo.
 *
 * Hook names RECONCILED against the landed page: `useContextFiles` and
 * `useContextFile`. Both `@/lib/hooks` and `@/lib/hooks/core` are mocked,
 * because either specifier resolves for a platform hook.
 *
 * Depth: ContextView → _components → context → [repoId] → repos → app → src →
 * client. Seven segments.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../../../../messages/en/context.json";
import { ToastProvider } from "../../../../../../lib/toast";

const SPEC_PATH = "specs/api/public.md";

/** Local typed factory — this repo has no shared fixture directory. */
function doc(over: Record<string, unknown> = {}) {
  return {
    path: SPEC_PATH,
    // NESTED on purpose: `dir` is `specs/api` while the badge is the matched
    // ROOT, `specs`. A top-level fixture makes the two columns render the same
    // string, so the test would pass without distinguishing them — and that is
    // what a `getByTestId` or a scoped `within()` would paper over (AC-41).
    dir: "specs/api",
    doc_type: "specs",
    size: 1200,
    tokens: 300,
    used_by: 2,
    updated_at: "2026-08-27T10:00:00.000Z",
    content: null,
    ...over,
  };
}

let listing: { data: unknown; isLoading: boolean; error: unknown } = {
  data: [doc()],
  isLoading: false,
  error: null,
};
let preview: { data: unknown; isLoading: boolean; error: unknown } = {
  data: null,
  isLoading: false,
  error: null,
};
/** What the SERVER says it searched. The shipped default, overridden per test. */
let roots: { data: unknown; isLoading: boolean; error: unknown } = {
  data: [
    { dir: "specs", doc_type: "spec" },
    { dir: "docs", doc_type: "doc" },
    { dir: "insights", doc_type: "insight" },
  ],
  isLoading: false,
  error: null,
};
/** The selected document lives in the URL, not in component state. */
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => search,
  usePathname: () => "/repos/repo-1/context",
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "repo-1", full_name: "acme/payments-api", default_branch: "main" },
  }),
  useRepoNotFound: () => false,
}));

// Both specifiers are mocked: the barrel re-exports `core`, and either import
// path resolves for a platform hook (`src/lib/hooks/index.ts` header).
// A `const` arrow would be read in its TDZ: `vi.mock` is hoisted above the
// file body, so the factory must be a hoisted function declaration.
function hooks() {
  return {
    useContextFiles: () => listing,
    useContextFile: () => preview,
    useContextSearchRoots: () => roots,
  };
}
vi.mock("@/lib/hooks", hooks);
vi.mock("@/lib/hooks/core", hooks);

import { ContextView } from "./ContextView";

afterEach(() => {
  cleanup();
  listing = { data: [doc()], isLoading: false, error: null };
  preview = { data: null, isLoading: false, error: null };
  roots = {
    data: [
      { dir: "specs", doc_type: "spec" },
      { dir: "docs", doc_type: "doc" },
      { dir: "insights", doc_type: "insight" },
    ],
    isLoading: false,
    error: null,
  };
  search = new URLSearchParams();
});

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ToastProvider>
          <ContextView />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SPEC-01 · Project Context page", () => {
  it("AC-03 / AC-09 — lists each document with its file name, directory, type and attaching-agent count", () => {
    renderView();

    expect(screen.getByText(/public\.md/)).toBeInTheDocument();
    // AC-03: the containing directory, which for a nested document is the full
    // path minus the file name.
    expect(screen.getByText("specs/api")).toBeInTheDocument();
    // AC-41: the displayed type is the matched ROOT's own name, verbatim and
    // untranslated — `specs`, not a mapped `spec` and not an i18n key.
    expect(screen.getByText("specs")).toBeInTheDocument();
    // AC-09: how many agents currently attach it.
    expect(screen.getByText(/\b2\b/)).toBeInTheDocument();
  });

  it("AC-04 / AC-10 — offers no write affordance, no indexed-chunk count and no coverage score", () => {
    renderView();

    for (const button of screen.queryAllByRole("button")) {
      expect(button.textContent ?? "").not.toMatch(/create|edit|rename|delete|save/i);
    }
    expect(screen.queryByText(/chunk/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/coverage/i)).not.toBeInTheDocument();
  });

  it("AC-05 — a selected document's markdown renders read-only", () => {
    search = new URLSearchParams({ path: SPEC_PATH });
    preview = {
      data: doc({ content: "# Public API invariants\nEvery exported route is versioned." }),
      isLoading: false,
      error: null,
    };
    renderView();

    expect(screen.getByText(/Every exported route is versioned\./)).toBeInTheDocument();
    // Read-only: no editor affordance appears with the document open.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    for (const button of screen.queryAllByRole("button")) {
      expect(button.textContent ?? "").not.toMatch(/save|edit/i);
    }
  });

  it("AC-06 — while loading, renders a loading state rather than the empty list", () => {
    listing = { data: undefined, isLoading: true, error: null };
    renderView();

    expect(screen.queryByText(messages.empty.title)).not.toBeInTheDocument();
    expect(screen.queryByText(/public\.md/)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.loadError)).not.toBeInTheDocument();
  });

  it("AC-07 / AC-35 — an empty result renders the context empty state naming the configured search roots", () => {
    listing = { data: [], isLoading: false, error: null };
    renderView();

    expect(screen.getByText(messages.empty.title)).toBeInTheDocument();
    // The corrected copy no longer points at `.devdigest/specs/`, and it names
    // the roots by INTERPOLATION rather than as a baked-in literal.
    expect(messages.empty.body).not.toMatch(/\.devdigest\/specs/);
    expect(messages.empty.body).toContain("{roots}");
    for (const root of ["specs/", "docs/", "insights/"]) {
      expect(screen.getByText(new RegExp(root))).toBeInTheDocument();
    }
    expect(screen.queryByText(/public\.md/)).not.toBeInTheDocument();
  });

  it("AC-07 — the empty state names the roots that were ACTUALLY searched, not the shipped default", () => {
    // The whole reason DEVDIGEST_CONTEXT_ROOTS exists is that this set is
    // configurable, so an empty state naming three directories nobody searched
    // would be a wrong answer that looks like a right one. The roots come from
    // the server; the client is told them and never assumes them.
    listing = { data: [], isLoading: false, error: null };
    roots = {
      data: [
        { dir: "adr", doc_type: "doc" },
        { dir: "rfc", doc_type: "spec" },
      ],
      isLoading: false,
      error: null,
    };
    renderView();

    expect(screen.getByText(/adr\/, rfc\//)).toBeInTheDocument();
    expect(screen.queryByText(/specs\//)).not.toBeInTheDocument();
    expect(screen.queryByText(/insights\//)).not.toBeInTheDocument();
  });

  it("AC-08 — a failed listing renders the load-error state, distinguishable from the empty state", () => {
    listing = { data: undefined, isLoading: false, error: new Error("boom") };
    renderView();

    expect(screen.getByText(messages.loadError)).toBeInTheDocument();
    expect(screen.queryByText(messages.empty.title)).not.toBeInTheDocument();
    expect(screen.queryByText(/public\.md/)).not.toBeInTheDocument();
  });
});
