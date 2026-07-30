import { describe, it, expect } from "vitest";
import type { FindingRecord, ReviewRecord, Severity } from "@devdigest/shared";
import { parseSeverity, latestRunPerAgent, countBySeverity, runMatches } from "./severity";

function finding(
  id: string,
  severity: Severity,
  over: Partial<FindingRecord> = {},
): FindingRecord {
  return {
    id,
    severity,
    category: "security",
    title: `finding ${id}`,
    file: "src/config.ts",
    start_line: 1,
    end_line: 1,
    rationale: "because",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

function review(
  id: string,
  agentId: string | null,
  findings: FindingRecord[],
  createdAt = "2026-06-13T20:00:00.000Z",
): ReviewRecord {
  return {
    id,
    pr_id: "pr1",
    agent_id: agentId,
    run_id: `run-${id}`,
    agent_name: agentId ?? "Agent",
    kind: "review",
    verdict: "request_changes",
    summary: null,
    score: 60,
    model: "gpt-4.1",
    created_at: createdAt,
    findings,
  };
}

describe("parseSeverity", () => {
  it("accepts the contract levels in any case", () => {
    expect(parseSeverity("CRITICAL")).toBe("CRITICAL");
    expect(parseSeverity("critical")).toBe("CRITICAL");
    expect(parseSeverity("Warning")).toBe("WARNING");
    expect(parseSeverity("suggestion")).toBe("SUGGESTION");
  });

  it("degrades to no filter on absent or unknown values", () => {
    expect(parseSeverity(null)).toBeNull();
    expect(parseSeverity(undefined)).toBeNull();
    expect(parseSeverity("")).toBeNull();
    // INFO exists in the UI token map but the wire contract can't produce it.
    expect(parseSeverity("INFO")).toBeNull();
    expect(parseSeverity("../../etc/passwd")).toBeNull();
  });
});

describe("latestRunPerAgent", () => {
  it("keeps only the newest review per agent (input is newest-first)", () => {
    const newest = review("a2", "agent-a", []);
    const older = review("a1", "agent-a", []);
    const other = review("b1", "agent-b", []);

    expect(latestRunPerAgent([newest, other, older]).map((r) => r.id)).toEqual(["a2", "b1"]);
  });

  it("treats each null-agent review as its own run", () => {
    const one = review("x1", null, []);
    const two = review("x2", null, []);

    expect(latestRunPerAgent([one, two]).map((r) => r.id)).toEqual(["x1", "x2"]);
  });

  it("returns an empty list for no reviews", () => {
    expect(latestRunPerAgent([])).toEqual([]);
  });
});

describe("countBySeverity", () => {
  it("tallies every level and always returns all three keys", () => {
    const counts = countBySeverity([
      review("a", "agent-a", [
        finding("f1", "CRITICAL"),
        finding("f2", "CRITICAL"),
        finding("f3", "WARNING"),
      ]),
      review("b", "agent-b", [finding("f4", "WARNING")]),
    ]);

    expect(counts).toEqual({ CRITICAL: 2, WARNING: 2, SUGGESTION: 0 });
  });

  it("excludes dismissed findings but counts accepted ones", () => {
    const counts = countBySeverity([
      review("a", "agent-a", [
        finding("f1", "CRITICAL", { dismissed_at: "2026-06-13T21:00:00.000Z" }),
        finding("f2", "CRITICAL", { accepted_at: "2026-06-13T21:00:00.000Z" }),
      ]),
    ]);

    expect(counts).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
  });

  it("ignores a severity outside the contract (the DB column is plain text)", () => {
    const counts = countBySeverity([
      review("a", "agent-a", [finding("f1", "INFO" as Severity), finding("f2", "WARNING")]),
    ]);

    expect(counts).toEqual({ CRITICAL: 0, WARNING: 1, SUGGESTION: 0 });
  });
});

describe("runMatches", () => {
  it("is true when the run has a live finding at that level", () => {
    const r = review("a", "agent-a", [finding("f1", "WARNING")]);
    expect(runMatches(r, "WARNING")).toBe(true);
    expect(runMatches(r, "CRITICAL")).toBe(false);
  });

  it("is false when the only finding at that level is dismissed", () => {
    const r = review("a", "agent-a", [
      finding("f1", "CRITICAL", { dismissed_at: "2026-06-13T21:00:00.000Z" }),
      finding("f2", "WARNING"),
    ]);

    expect(runMatches(r, "CRITICAL")).toBe(false);
    expect(runMatches(r, "WARNING")).toBe(true);
  });
});
