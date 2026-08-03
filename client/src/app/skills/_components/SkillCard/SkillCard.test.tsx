import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@devdigest/shared";
// Depth: SkillCard → _components → skills → app → src → client. Count the
// segments; the depth differs per route nesting and there is no messages alias.
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../lib/toast";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rubric for evaluating overall PR quality",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric",
  enabled: true,
  version: 5,
  tokens: 166,
  used_by: 3,
};

/** Mirrors the app's real provider stack: SkillCard uses a query hook and a toast. */
function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SkillCard", () => {
  it("renders name, type, source and the two computed numbers", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("3 agents")).toBeInTheDocument();
    expect(screen.getByText("166 tokens")).toBeInTheDocument();
  });

  it("pluralises used_by down to zero", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, used_by: 0 }} />);
    expect(screen.getByText("No agents")).toBeInTheDocument();
    cleanup();
    renderWithIntl(<SkillCard skill={{ ...SKILL, used_by: 1 }} />);
    expect(screen.getByText("1 agent")).toBeInTheDocument();
  });

  it("falls back to a translated placeholder when description is empty", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("marks a disabled skill from an untrusted source as needing vetting", () => {
    renderWithIntl(
      <SkillCard skill={{ ...SKILL, source: "imported_file", enabled: false }} />,
    );
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
  });

  it("does not nag about vetting once an imported skill is enabled", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "imported_file", enabled: true }} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });

  // Disabling detaches the skill from every agent server-side, and re-enabling
  // does NOT restore those links — so it must be confirmed, not silent.
  describe("disabling a skill that agents use", () => {
    const toggleOf = (el: HTMLElement) => el.querySelector('[role="switch"]') as HTMLElement;

    it("asks for confirmation and reports how many agents are affected", () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      const onToggle = vi.fn();
      const { container } = renderWithIntl(
        <SkillCard skill={SKILL} onToggle={onToggle} />, // used_by: 3
      );
      fireEvent.click(toggleOf(container));

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0]![0]).toContain("3 agents");
      expect(onToggle).toHaveBeenCalledWith(false);
      confirm.mockRestore();
    });

    it("cancelling leaves the skill enabled", () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const onToggle = vi.fn();
      const { container } = renderWithIntl(<SkillCard skill={SKILL} onToggle={onToggle} />);
      fireEvent.click(toggleOf(container));

      expect(onToggle).not.toHaveBeenCalled();
      confirm.mockRestore();
    });

    it("does not prompt when no agent uses the skill", () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      const onToggle = vi.fn();
      const { container } = renderWithIntl(
        <SkillCard skill={{ ...SKILL, used_by: 0 }} onToggle={onToggle} />,
      );
      fireEvent.click(toggleOf(container));

      expect(confirm).not.toHaveBeenCalled();
      expect(onToggle).toHaveBeenCalledWith(false);
      confirm.mockRestore();
    });

    it("does not prompt when ENABLING a skill", () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      const onToggle = vi.fn();
      const { container } = renderWithIntl(
        <SkillCard skill={{ ...SKILL, enabled: false }} onToggle={onToggle} />,
      );
      fireEvent.click(toggleOf(container));

      expect(confirm).not.toHaveBeenCalled();
      expect(onToggle).toHaveBeenCalledWith(true);
      confirm.mockRestore();
    });
  });
});
