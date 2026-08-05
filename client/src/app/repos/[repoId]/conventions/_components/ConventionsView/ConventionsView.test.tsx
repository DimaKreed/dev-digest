import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConventionCandidate, ExtractionStats } from "@devdigest/shared";
// Depth: ConventionsView → _components → conventions → [repoId] → repos → app →
// src → client. Seven segments.
import messages from "../../../../../../../messages/en/conventions.json";
import { ToastProvider } from "../../../../../../lib/toast";

vi.mock("next/navigation", () => ({ useParams: () => ({ repoId: "repo-1" }) }));

// The shell pulls in the command palette, global shortcuts and a /repos query;
// none of that is under test here.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { full_name: "acme/api", default_branch: "main" },
  }),
  useRepoNotFound: () => false,
}));

import { ConventionsView } from "./ConventionsView";

const STATS: ExtractionStats = {
  sampled_files: 40,
  config_files: ["tsconfig.json"],
  proposed: 9,
  verified: 2,
  dropped_no_file: 3,
  dropped_no_snippet: 2,
  dropped_single_occurrence: 2,
  suppressed: 0,
  provider: "anthropic",
  model: "claude-sonnet-4",
  cost_usd: 0.021,
};

function candidate(id: string, over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id,
    rule: `rule ${id}`,
    category: "naming",
    evidence_path: "src/db/users.ts",
    evidence_snippet: "const x = 1;",
    evidence_start_line: 10,
    evidence_end_line: 12,
    evidence_files: ["src/db/users.ts", "src/db/orders.ts"],
    occurrences: 2,
    confidence: 0.9,
    status: "pending",
    skill_id: null,
    ...over,
  };
}

/** Only GET /repos/repo-1/conventions is exercised; anything else is a bug. */
function mockConventions(body: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/repos/repo-1/conventions")) {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ToastProvider>
          <ConventionsView />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ConventionsView", () => {
  it("disables Create skill until at least one candidate is accepted", async () => {
    mockConventions({
      candidates: [candidate("c1"), candidate("c2")],
      last_scan_at: "2026-08-01T10:00:00.000Z",
      stats: STATS,
    });
    renderView();

    expect(await screen.findByText("0 of 2 accepted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create skill" })).toBeDisabled();
  });

  it("enables Create skill once a candidate is accepted", async () => {
    mockConventions({
      candidates: [candidate("c1", { status: "accepted" }), candidate("c2")],
      last_scan_at: "2026-08-01T10:00:00.000Z",
      stats: STATS,
    });
    renderView();

    expect(await screen.findByText("1 of 2 accepted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create skill" })).toBeEnabled();
  });

  it("shows the pre-scan empty state and offers Run extraction", async () => {
    mockConventions({ candidates: [], last_scan_at: null, stats: null });
    renderView();

    expect(await screen.findByText("No conventions extracted yet")).toBeInTheDocument();
    // Nothing scanned yet ⇒ the header CTA reads "Run extraction", not "Re-scan".
    expect(screen.queryByRole("button", { name: "Re-scan" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Run extraction" }).length).toBeGreaterThan(0);
  });

  it("keeps the scan report when a scan ran but every candidate was dropped", async () => {
    mockConventions({ candidates: [], last_scan_at: "2026-08-01T10:00:00.000Z", stats: STATS });
    renderView();

    expect(await screen.findByText("No conventions survived verification")).toBeInTheDocument();
    expect(screen.getByText("Scan report")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show report" }));
    expect(screen.getByText("Dropped — cited a file we never sampled")).toBeInTheDocument();
    expect(screen.getByText("Survived verification")).toBeInTheDocument();
  });
});
