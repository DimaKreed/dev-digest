/* helpers.test.ts — AppShell's pure helpers.

   Scope here is the `/onboarding` collision only: `/onboarding` is the
   add-repository route (`src/app/onboarding/page.tsx`) while the SPEC-02
   onboarding tour lives at `/repos/:repoId/onboarding`, so one substring test
   cannot serve both. Derived from the plan's W13 Done-when. */

import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

describe("activeKeyFor", () => {
  it("marks the repo-scoped tour route as the onboarding tour", () => {
    expect(activeKeyFor("/repos/abc/onboarding")).toBe("onboarding-tour");
  });

  it("leaves the bare add-repository route unmatched", () => {
    expect(activeKeyFor("/onboarding")).toBe("");
  });

  it("still resolves the sibling repo-scoped routes", () => {
    expect(activeKeyFor("/repos/abc/conventions")).toBe("conventions");
    expect(activeKeyFor("/repos/abc/context")).toBe("context");
    expect(activeKeyFor("/repos/abc/pulls/482")).toBe("pulls");
    expect(activeKeyFor("/settings")).toBe("settings");
  });
});
