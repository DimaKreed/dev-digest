/**
 * SPEC-01 — the run trace's project-context surfaces (AC-31 client half, AC-32).
 *
 * Spec-first: derived from `specs/01-project-context-documents.md`. These two
 * criteria are served by server work plus the trace affordances that already
 * exist here, so this file pins the rendering the spec depends on rather than
 * asking for new UI: the documents read are named, and the full injected
 * `## Project context` text is openable from `Prompt assembly`.
 *
 * `fireEvent` only — `@testing-library/user-event` is not installed here.
 *
 * Depth: TraceBody → _components → RunTraceDrawer → _components → [number] →
 * pulls → [repoId] → repos → app → src → client. Ten segments.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/runs.json";
import { TraceBody } from "./TraceBody";

const INJECTED =
  '<untrusted source="spec-0">\n# Public API invariants\nEvery exported route is versioned.\n</untrusted>';

const TRACE: RunTrace = {
  config: {
    agent: "Security",
    version: "1",
    provider: "openai",
    model: "gpt-4.1",
    pr: 482,
    source: "local",
  },
  stats: {
    duration_ms: 8200,
    tokens_in: 12000,
    tokens_out: 1500,
    cost_usd: 0.0612,
    findings: 1,
    grounding: "1/1 passed",
  },
  prompt_assembly: {
    system: "You are a reviewer.",
    skills: null,
    memory: null,
    specs: INJECTED,
    user: `## Project context\n${INJECTED}\n\n## Diff to review`,
  },
  tool_calls: [],
  raw_output: "{}",
  memory_pulled: [],
  specs_read: ["specs/public-api.md", "docs/architecture.md"],
  log: [],
};

afterEach(cleanup);

function renderBody(trace: RunTrace) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">
        <TraceBody trace={trace} findings={[]} />
      </div>
    </NextIntlClientProvider>,
  );
}

describe("SPEC-01 · run trace project context", () => {
  it("AC-31 — the trace names every document that was read", () => {
    renderBody(TRACE);

    expect(screen.getByText("specs/public-api.md")).toBeInTheDocument();
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
  });

  it("AC-32 — the full injected `## Project context` text is openable from Prompt assembly", () => {
    renderBody(TRACE);

    // `Prompt assembly` is collapsed by default; open it, then open the block.
    fireEvent.click(screen.getByText("Prompt assembly"));
    const label = screen.getByText("Project context (dynamic)");
    expect(label).toBeInTheDocument();

    fireEvent.click(label);
    expect(screen.getByText(/Every exported route is versioned\./)).toBeInTheDocument();
  });

  it("AC-23 — a run with no attached documents shows no project-context block at all", () => {
    renderBody({
      ...TRACE,
      specs_read: [],
      prompt_assembly: { ...TRACE.prompt_assembly, specs: null, user: "## Diff to review" },
    });

    fireEvent.click(screen.getByText("Prompt assembly"));
    expect(screen.queryByText("Project context (dynamic)")).not.toBeInTheDocument();
  });
});
