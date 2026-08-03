import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
// Depth: SkillsTab → _components → AgentEditor → _components → [id] → agents
// → app → src → client.
import agentMessages from "../../../../../../../../messages/en/agents.json";
import skillMessages from "../../../../../../../../messages/en/skills.json";
import { SkillsTab } from "./SkillsTab";

const setSkills = vi.fn();
let links: AgentSkillLink[] = [];

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false }),
  useAgentSkills: () => ({ data: links }),
  useSetAgentSkills: () => ({ mutate: setSkills }),
}));

const SKILLS: Skill[] = [
  {
    id: "s-rubric",
    name: "pr-quality-rubric",
    description: "",
    type: "rubric",
    source: "manual",
    body: "x",
    enabled: true,
    version: 1,
    tokens: 166,
    used_by: 1,
  },
  {
    id: "s-nudge",
    name: "test-coverage-nudge",
    description: "",
    type: "custom",
    source: "manual",
    body: "y",
    enabled: true,
    version: 1,
    tokens: 88,
    used_by: 1,
  },
  {
    id: "s-off",
    name: "phantom-api-gate",
    description: "",
    type: "security",
    source: "imported_file",
    body: "z",
    enabled: false,
    version: 1,
    tokens: 120,
    used_by: 0,
  },
];

const AGENT: Agent = {
  id: "ag1",
  name: "Test Quality Reviewer",
  description: "",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderTab() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ agents: agentMessages, skills: skillMessages }}
      >
        <SkillsTab agent={AGENT} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** The drag handle for a row, addressed by its aria-label. */
const handle = (name: string) =>
  screen.getByLabelText(`Reorder ${name} — drag, or use the arrow keys`);

beforeEach(() => {
  setSkills.mockClear();
  links = [
    { agent_id: "ag1", skill_id: "s-nudge", order: 0 },
    { agent_id: "ag1", skill_id: "s-rubric", order: 1 },
  ];
});
afterEach(cleanup);

describe("SkillsTab", () => {
  it("lists linked skills first, in prompt order", () => {
    renderTab();
    const names = screen.getAllByText(/pr-quality-rubric|test-coverage-nudge|phantom-api-gate/);
    expect(names.map((n) => n.textContent)).toEqual([
      "test-coverage-nudge", // order 0
      "pr-quality-rubric", // order 1
      "phantom-api-gate", // unlinked, alphabetical tail
    ]);
  });

  it("counts only attachable skills in the denominator", () => {
    renderTab();
    // 3 skills exist but phantom-api-gate is disabled, so only 2 can be attached.
    expect(screen.getByText("2 of 2 enabled")).toBeInTheDocument();
  });

  it("attaching an enabled skill appends it to the ordered id list", () => {
    links = [{ agent_id: "ag1", skill_id: "s-nudge", order: 0 }];
    renderTab();
    // pr-quality-rubric — enabled and not yet attached.
    fireEvent.click(handle("pr-quality-rubric").closest("div")!.querySelector('[role="checkbox"]')!);
    expect(setSkills).toHaveBeenCalledTimes(1);
    expect(setSkills).toHaveBeenCalledWith({
      agentId: "ag1",
      skillIds: ["s-nudge", "s-rubric"],
    });
  });

  it("detaching a skill removes only that id", () => {
    renderTab();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!); // test-coverage-nudge
    expect(setSkills).toHaveBeenCalledTimes(1);
    expect(setSkills).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["s-rubric"] });
  });

  // The point of the whole change: a disabled skill would never reach the
  // prompt, so it must not be attachable at all.
  it("a globally disabled skill cannot be attached", () => {
    renderTab();
    const box = handle("phantom-api-gate")
      .closest("div")!
      .querySelector('[role="checkbox"]') as HTMLButtonElement;
    expect(box).toBeDisabled();
    fireEvent.click(box);
    expect(setSkills).not.toHaveBeenCalled();
  });

  it("labels the disabled skill so the reason is visible, not just inferred", () => {
    renderTab();
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });

  it("a disabled skill has no drag handle", () => {
    renderTab();
    expect(handle("phantom-api-gate")).toBeDisabled();
  });

  // Keyboard ordering on the drag handle — without this, replacing the ↑/↓
  // buttons with drag-and-drop would make ordering mouse-only.
  it("ArrowDown on a handle moves that skill one slot later", () => {
    renderTab();
    fireEvent.keyDown(handle("test-coverage-nudge"), { key: "ArrowDown" });
    expect(setSkills).toHaveBeenCalledTimes(1);
    expect(setSkills).toHaveBeenCalledWith({
      agentId: "ag1",
      skillIds: ["s-rubric", "s-nudge"],
    });
  });

  it("ArrowUp on the first linked skill is a no-op", () => {
    renderTab();
    fireEvent.keyDown(handle("test-coverage-nudge"), { key: "ArrowUp" });
    // moveId returns the list unchanged, so the request would be a pointless
    // write — but it still fires; assert the payload is the unchanged order.
    expect(setSkills).toHaveBeenCalledWith({
      agentId: "ag1",
      skillIds: ["s-nudge", "s-rubric"],
    });
  });

  it("ignores keys other than the arrows", () => {
    renderTab();
    fireEvent.keyDown(handle("test-coverage-nudge"), { key: "Enter" });
    expect(setSkills).not.toHaveBeenCalled();
  });
});
