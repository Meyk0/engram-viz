import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicDemo } from "@/components/PublicDemo/PublicDemo";

vi.mock("@/components/Brain/Brain3D", () => ({
  Brain3D: ({ focusedMemoryIds, focusedRegions, reduceMotion }: {
    focusedMemoryIds: string[];
    focusedRegions: string[];
    reduceMotion?: boolean;
  }) => (
    <div data-reduced-motion={reduceMotion} data-testid="brain-canvas">
      {focusedMemoryIds.join(",")} / {focusedRegions.join(",")}
    </div>
  )
}));

describe("PublicDemo", () => {
  const fetchMock = vi.fn();
  const createObjectUrlMock = vi.fn(() => "blob:engram-regression");

  beforeEach(() => {
    fetchMock.mockReset();
    createObjectUrlMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrlMock });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("presents five user-paced steps and a deterministic no-fetch repair", async () => {
    const user = userEvent.setup();
    render(<PublicDemo />);

    const stepNavigation = screen.getByRole("navigation", { name: "Guided demo steps" });
    expect(within(stepNavigation).getAllByRole("button")).toHaveLength(5);
    for (const name of ["Store", "Correct", "Fail", "Repair", "Test"]) {
      expect(within(stepNavigation).getByRole("button", { name })).toBeVisible();
    }
    for (const phase of ["Capture", "Diagnose", "Replay", "Test"]) {
      expect(within(stepNavigation).getAllByText(phase).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Step 1 of 5")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Play guided demo" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Restart demo" })).toBeVisible();
    expect(screen.getByText(/Where the analogy breaks/)).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 2 of 5")).toBeVisible();
    expect(screen.getByTestId("brain-canvas")).toHaveTextContent("sample-memory-oakland / hippocampus");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 3 of 5")).toBeVisible();
    expect(screen.getByText("Agent used an outdated location")).toBeVisible();
    expect(screen.getAllByText("observed").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /influence/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Advanced evidence")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 4 of 5")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Run deterministic repair" }));
    await waitFor(() => {
      expect(screen.getByText("Verified against the incident expectation")).toBeVisible();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 5 of 5")).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy local demo command" })).toBeVisible();
    expect(screen.getByText("npx --yes @engramviz/cli demo stale-location")).toBeVisible();
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Meyk0/engram-viz"
    );

    await user.click(screen.getByRole("button", { name: "Download regression JSON" }));
    expect(createObjectUrlMock).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(within(stepNavigation).getByRole("button", { name: "Store" }));
    await user.click(within(stepNavigation).getByRole("button", { name: "Test" }));
    expect(screen.getByText("Verified against the incident expectation")).toBeVisible();
  });

  it("toggles playback and restarts the story", async () => {
    const user = userEvent.setup();
    render(<PublicDemo />);

    await user.click(screen.getByRole("button", { name: "Play guided demo" }));
    expect(screen.getByRole("button", { name: "Pause guided demo" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Pause guided demo" }));

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 2 of 5")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Restart demo" }));
    expect(screen.getByText("Step 1 of 5")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Store the original location" })).toBeVisible();
  });

  it("passes reduced-motion preference into the 3D scene", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })));

    render(<PublicDemo />);

    expect(screen.getByTestId("brain-canvas")).toHaveAttribute("data-reduced-motion", "true");
  });
});
