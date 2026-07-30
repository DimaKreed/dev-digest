import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import { SeverityFilterBar } from "./SeverityFilterBar";
import type { SeverityCounts } from "@/lib/severity";

afterEach(cleanup);

const COUNTS: SeverityCounts = { CRITICAL: 3, WARNING: 5, SUGGESTION: 0 };

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function chip(level: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(level) });
}

describe("SeverityFilterBar", () => {
  it("renders one chip per severity with its count", () => {
    renderWithIntl(<SeverityFilterBar counts={COUNTS} active={null} onSelect={() => {}} />);

    expect(chip("CRITICAL")).toHaveTextContent("3");
    expect(chip("WARNING")).toHaveTextContent("5");
    expect(chip("SUGGESTION")).toHaveTextContent("0");
  });

  it("disables a level with no findings", () => {
    renderWithIntl(<SeverityFilterBar counts={COUNTS} active={null} onSelect={() => {}} />);

    expect(chip("SUGGESTION")).toBeDisabled();
    expect(chip("CRITICAL")).toBeEnabled();
  });

  it("marks only the active level as pressed", () => {
    renderWithIntl(<SeverityFilterBar counts={COUNTS} active="CRITICAL" onSelect={() => {}} />);

    expect(chip("CRITICAL")).toHaveAttribute("aria-pressed", "true");
    expect(chip("WARNING")).toHaveAttribute("aria-pressed", "false");
  });

  it("selects an inactive level and toggles the active one off", () => {
    const onSelect = vi.fn();
    const { rerender } = renderWithIntl(
      <SeverityFilterBar counts={COUNTS} active={null} onSelect={onSelect} />,
    );

    fireEvent.click(chip("WARNING"));
    expect(onSelect).toHaveBeenCalledWith("WARNING");

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <SeverityFilterBar counts={COUNTS} active="WARNING" onSelect={onSelect} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(chip("WARNING"));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("renders nothing for a PR with no findings", () => {
    const { container } = renderWithIntl(
      <SeverityFilterBar
        counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }}
        active={null}
        onSelect={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the active level clickable once its last finding is gone", () => {
    const onSelect = vi.fn();
    renderWithIntl(
      <SeverityFilterBar
        counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }}
        active="CRITICAL"
        onSelect={onSelect}
      />,
    );

    expect(chip("CRITICAL")).toBeEnabled();
    fireEvent.click(chip("CRITICAL"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
