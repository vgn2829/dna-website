// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { DesignStudioCard } from "../DesignStudioCard";
const observed = vi.hoisted(() => ({ initial: null as unknown, duration: -1 }));
vi.mock("motion/react", () => ({
  useReducedMotion: () => true,
  motion: {
    div: ({ initial, transition, children }: any) => {
      observed.initial = initial;
      observed.duration = transition.duration;
      return <div>{children}</div>;
    },
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("renders the studio entry without decorative entrance motion when reduced motion is requested", async () => {
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <MemoryRouter>
          <DesignStudioCard />
        </MemoryRouter>,
      ),
    );
    expect(observed.initial).toBe(false);
    expect(observed.duration).toBe(0);
    expect(host.querySelectorAll("button").length).toBeGreaterThanOrEqual(8);
    expect(host.textContent).not.toContain("accessible color palettes");
  } finally {
    await act(() => root.unmount());
  }
});
