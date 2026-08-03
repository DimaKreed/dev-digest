import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@devdigest/shared";
import messages from "../../../../messages/en/shell.json";
import { DiffViewer } from "./DiffViewer";

// jsdom has no layout, so scrollIntoView doesn't exist on elements.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

/** A patch whose new-side numbering runs 40…49. */
const PATCH = [
  "@@ -40,4 +40,10 @@",
  " ctx40",
  " ctx41",
  " ctx42",
  " ctx43",
  "+add44",
  "+add45",
  "-removed",
  "+add46",
  " ctx47",
  " ctx48",
  " ctx49",
].join("\n");

const SMALL: PrFile = { path: "src/small.ts", additions: 3, deletions: 1, patch: PATCH };
/** Over AUTO_EXPAND_MAX_LINES (200), so it starts collapsed. */
const BIG: PrFile = { path: "src/big.ts", additions: 400, deletions: 20, patch: PATCH };

function renderViewer(files: PrFile[], target?: React.ComponentProps<typeof DiffViewer>["target"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      <DiffViewer files={files} target={target} />
    </NextIntlClientProvider>,
  );
}

/** The row elements the highlight marks. */
function highlightedTexts(): string[] {
  return Array.from(document.querySelectorAll("[data-highlighted]")).map(
    (el) => el.textContent ?? "",
  );
}

describe("DiffViewer deep-link target", () => {
  it("renders nothing highlighted without a target", () => {
    renderViewer([SMALL]);
    expect(highlightedTexts()).toHaveLength(0);
  });

  it("highlights only the rows inside the range, on the new side", () => {
    renderViewer([SMALL], { path: "src/small.ts", start: 44, end: 46, nonce: 1 });

    const texts = highlightedTexts().join(" ");
    expect(texts).toContain("add44");
    expect(texts).toContain("add45");
    expect(texts).toContain("add46");
    // Out of range, and the deleted line has no new-side number at all.
    expect(texts).not.toContain("ctx43");
    expect(texts).not.toContain("ctx47");
    expect(texts).not.toContain("removed");
  });

  it("scrolls the first row of the range into view", () => {
    renderViewer([SMALL], { path: "src/small.ts", start: 45, end: 46, nonce: 1 });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("force-expands a file that would otherwise start collapsed", () => {
    // Without a target the big file is closed, so its lines aren't in the DOM.
    renderViewer([BIG]);
    expect(screen.queryByText("add44")).not.toBeInTheDocument();

    cleanup();
    renderViewer([BIG], { path: "src/big.ts", start: 44, end: 44, nonce: 1 });
    expect(screen.getByText("add44")).toBeInTheDocument();
  });

  it("leaves other files alone", () => {
    renderViewer([SMALL, { ...BIG, path: "src/other.ts" }], {
      path: "src/small.ts",
      start: 44,
      end: 44,
      nonce: 1,
    });
    // The untargeted big file stays collapsed.
    expect(screen.getAllByText("add44")).toHaveLength(1);
  });
});
