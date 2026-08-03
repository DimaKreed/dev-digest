import { describe, it, expect } from "vitest";
import { moveId, orderChanged, orderSkills, reorder } from "./helpers";
import type { AgentSkillLink, Skill } from "@devdigest/shared";

/**
 * The drag-and-drop reorder logic lives in `reorder`, tested here directly.
 *
 * jsdom does not implement the HTML5 drag-and-drop data model — a synthesised
 * dragstart/dragover/drop sequence proves nothing about a real drag. So the
 * component test covers the keyboard path and the disabled-checkbox rule, and
 * the ordering maths is pinned here. Real dragging is a manual check.
 */

const ids = ["a", "b", "c", "d"];

describe("reorder", () => {
  it("moves an item later, shifting the ones it passes", () => {
    expect(reorder(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item earlier", () => {
    expect(reorder(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("moving onto an adjacent neighbour is a plain swap", () => {
    expect(reorder(ids, "a", "b")).toEqual(["b", "a", "c", "d"]);
  });

  it("dropping an item on itself changes nothing", () => {
    expect(reorder(ids, "b", "b")).toBe(ids);
  });

  it("returns the list untouched when either id is unknown", () => {
    expect(reorder(ids, "zz", "b")).toBe(ids);
    expect(reorder(ids, "a", "zz")).toBe(ids);
  });

  it("never drops or duplicates an id", () => {
    for (const from of ids) {
      for (const to of ids) {
        expect([...reorder(ids, from, to)].sort()).toEqual([...ids].sort());
      }
    }
  });
});

describe("moveId (keyboard path)", () => {
  it("moves one slot in each direction", () => {
    expect(moveId(ids, "b", -1)).toEqual(["b", "a", "c", "d"]);
    expect(moveId(ids, "b", 1)).toEqual(["a", "c", "b", "d"]);
  });

  it("clamps at both ends rather than wrapping", () => {
    expect(moveId(ids, "a", -1)).toBe(ids);
    expect(moveId(ids, "d", 1)).toBe(ids);
  });
});

describe("orderChanged", () => {
  it("detects a reorder and ignores an identical list", () => {
    expect(orderChanged(["a", "b"], ["b", "a"])).toBe(true);
    expect(orderChanged(["a", "b"], ["a", "b"])).toBe(false);
    expect(orderChanged(["a"], ["a", "b"])).toBe(true);
  });
});

describe("orderSkills", () => {
  const skill = (id: string, name: string): Skill => ({
    id,
    name,
    description: "",
    type: "custom",
    source: "manual",
    body: "x",
    enabled: true,
    version: 1,
    tokens: 1,
    used_by: 0,
  });

  it("puts linked skills first in prompt order, then the rest alphabetically", () => {
    const skills = [skill("s1", "zebra"), skill("s2", "alpha"), skill("s3", "beta")];
    const links: AgentSkillLink[] = [
      { agent_id: "a", skill_id: "s3", order: 0 },
      { agent_id: "a", skill_id: "s1", order: 1 },
    ];
    expect(orderSkills(skills, links).map((s) => s.name)).toEqual(["beta", "zebra", "alpha"]);
  });
});
