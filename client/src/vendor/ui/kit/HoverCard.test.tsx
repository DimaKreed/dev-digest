import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { HoverCard } from "./HoverCard";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function renderCard(props: Partial<React.ComponentProps<typeof HoverCard>> = {}) {
  return render(
    <HoverCard trigger={<button type="button">peek</button>} {...props}>
      {props.children ?? <span>panel body</span>}
    </HoverCard>,
  );
}

describe("HoverCard", () => {
  it("opens on hover after the delay and closes on leave", () => {
    vi.useFakeTimers();
    renderCard();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByText("peek"));
    // Nothing yet — the open delay guards against a cursor passing through.
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    tick(200);
    expect(screen.getByText("panel body")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByText("peek"));
    tick(300);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("stays open while the cursor is inside the panel", () => {
    vi.useFakeTimers();
    renderCard();
    fireEvent.mouseEnter(screen.getByText("peek"));
    tick(200);

    // Cursor travels off the trigger and into the panel before the close lands.
    fireEvent.mouseLeave(screen.getByText("peek"));
    fireEvent.mouseEnter(screen.getByRole("tooltip"));
    tick(300);
    expect(screen.getByText("panel body")).toBeInTheDocument();
  });

  it("opens on focus and closes on Escape", () => {
    vi.useFakeTimers();
    renderCard();
    fireEvent.focus(screen.getByText("peek"));
    tick(0);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByText("peek"), { key: "Escape" });
    tick(0);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders no panel when disabled", () => {
    vi.useFakeTimers();
    renderCard({ disabled: true });
    fireEvent.mouseEnter(screen.getByText("peek"));
    tick(300);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not build a function body until it opens", () => {
    vi.useFakeTimers();
    const build = vi.fn(() => <span>lazy body</span>);
    renderCard({ children: build });
    expect(build).not.toHaveBeenCalled();

    fireEvent.mouseEnter(screen.getByText("peek"));
    tick(200);
    expect(screen.getByText("lazy body")).toBeInTheDocument();
  });

  it("reports open state to the caller", () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    renderCard({ onOpenChange });

    fireEvent.mouseEnter(screen.getByText("peek"));
    tick(200);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    fireEvent.mouseLeave(screen.getByText("peek"));
    tick(300);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
