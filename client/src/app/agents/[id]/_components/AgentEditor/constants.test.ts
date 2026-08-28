/**
 * SPEC-01 — the agent editor's `Context` tab (AC-11, AC-19, AC-35).
 *
 * Spec-first: derived from `specs/01-project-context-documents.md`, not from
 * the editor. `VALID_TABS` is derived from `TABS`, so the tab being present in
 * the descriptor list is what makes `?tab=context` addressable (AC-19) — and
 * its label must come from the `agents` namespace (AC-35).
 *
 * Depth: AgentEditor → _components → [id] → agents → app → src → client.
 * Six segments.
 */
import { describe, it, expect } from "vitest";
import messages from "../../../../../../messages/en/agents.json";
import { TABS, VALID_TABS } from "./constants";

describe("SPEC-01 · agent editor tabs", () => {
  it("AC-11 — a Context tab sits alongside the existing tabs", () => {
    expect(TABS.map((tab) => tab.key)).toContain("context");
    // Alongside, not instead of: the pre-existing tabs survive.
    expect(TABS.map((tab) => tab.key)).toEqual(
      expect.arrayContaining(["config", "skills", "context"]),
    );
  });

  it("AC-19 — the tab is addressable in the URL the same way the others are", () => {
    expect(VALID_TABS).toContain("context");
  });

  it("AC-35 — its label resolves in the `agents` namespace", () => {
    const tab = TABS.find((entry) => entry.key === "context");
    expect(tab).toBeDefined();
    const key = tab!.labelKey.split(".").reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      messages,
    );
    expect(typeof key).toBe("string");
    expect(String(key).length).toBeGreaterThan(0);
  });
});
