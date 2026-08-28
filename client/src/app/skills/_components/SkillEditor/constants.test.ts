/**
 * SPEC-01 — the skill editor's `Context` tab (AC-12, AC-19, AC-35).
 *
 * Spec-first, same shape as the agent editor's test. Depth: SkillEditor →
 * _components → skills → app → src → client. Five segments.
 */
import { describe, it, expect } from "vitest";
import messages from "../../../../../messages/en/skills.json";
import { TABS, VALID_TABS } from "./constants";

describe("SPEC-01 · skill editor tabs", () => {
  it("AC-12 — a Context tab sits alongside the existing tabs", () => {
    expect(TABS.map((tab) => tab.key)).toContain("context");
    expect(TABS.map((tab) => tab.key)).toEqual(
      expect.arrayContaining(["config", "preview", "stats", "versions", "context"]),
    );
  });

  it("AC-19 — the tab is addressable in the URL the same way the others are", () => {
    expect(VALID_TABS).toContain("context");
  });

  it("AC-35 — its label resolves in the `skills` namespace", () => {
    const tab = TABS.find((entry) => entry.key === "context");
    expect(tab).toBeDefined();
    const label = tab!.labelKey.split(".").reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      messages,
    );
    expect(typeof label).toBe("string");
    expect(String(label).length).toBeGreaterThan(0);
  });
});
