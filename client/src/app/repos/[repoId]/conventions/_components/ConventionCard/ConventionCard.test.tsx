import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
// Depth: ConventionCard → _components → conventions → [repoId] → repos → app →
// src → client. Seven segments; the same nesting as pulls/_components/*.
import messages from "../../../../../../../messages/en/conventions.json";

// The card reads the active repo to build the GitHub blob URL. Mocking the
// context avoids standing up RepoProvider (which itself fetches /repos).
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { full_name: "acme/api", default_branch: "main" },
  }),
}));

import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

const CANDIDATE: ConventionCandidate = {
  id: "cv1",
  rule: "Repository functions return a Result, never throw.",
  category: "error-handling",
  evidence_path: "src/db/users.ts",
  evidence_snippet: "return ok(rows[0]);",
  evidence_start_line: 42,
  evidence_end_line: 58,
  evidence_files: ["src/db/users.ts", "src/db/orders.ts"],
  occurrences: 2,
  confidence: 0.86,
  status: "pending",
  skill_id: null,
};

function renderCard(over: Partial<ConventionCandidate> = {}, onStatus = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard
        c={{ ...CANDIDATE, ...over }}
        onStatus={onStatus}
        onRule={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  return onStatus;
}

describe("ConventionCard", () => {
  it("renders the rule, category, occurrences and confidence", () => {
    renderCard();
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText("error handling")).toBeInTheDocument();
    expect(screen.getByText("Seen in 2 files")).toBeInTheDocument();
    // PercentProgress renders 0..100, so 0.86 confidence reads as 86%.
    expect(screen.getByText("86%")).toBeInTheDocument();
  });

  it("links the evidence at the exact blob URL, line range included", () => {
    renderCard();
    const expected = "https://github.com/acme/api/blob/main/src/db/users.ts#L42-L58";
    expect(screen.getByRole("link", { name: "src/db/users.ts:42-58" })).toHaveAttribute(
      "href",
      expected,
    );
    expect(screen.getByRole("link", { name: "Open on GitHub" })).toHaveAttribute(
      "href",
      expected,
    );
  });

  describe("accept / reject toggling", () => {
    it("accepts a pending candidate", () => {
      const onStatus = renderCard();
      fireEvent.click(screen.getByRole("button", { name: "Accept" }));
      expect(onStatus).toHaveBeenCalledTimes(1);
      expect(onStatus).toHaveBeenCalledWith("accepted");
    });

    it("rejects a pending candidate", () => {
      const onStatus = renderCard();
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      expect(onStatus).toHaveBeenCalledWith("rejected");
    });

    it("clicking Accept again un-accepts it", () => {
      const onStatus = renderCard({ status: "accepted" });
      fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
      expect(onStatus).toHaveBeenCalledWith("pending");
    });

    it("clicking Reject again un-rejects it", () => {
      const onStatus = renderCard({ status: "rejected" });
      fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
      expect(onStatus).toHaveBeenCalledWith("pending");
    });
  });

  it("swaps the rule for a textarea and saves the edit", () => {
    const onRule = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ConventionCard c={CANDIDATE} onStatus={vi.fn()} onRule={onRule} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit rule" }));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "Repositories never throw." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onRule).toHaveBeenCalledWith("Repositories never throw.");
  });
});
