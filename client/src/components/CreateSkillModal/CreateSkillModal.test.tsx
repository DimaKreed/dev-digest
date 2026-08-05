import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@devdigest/shared";
// Depth: CreateSkillModal → components → src → client. Three segments.
import messages from "../../../messages/en/skills.json";
import { CreateSkillModal } from "./CreateSkillModal";

const CREATED: Skill = {
  id: "sk-new",
  name: "repo-conventions",
  description: "House rules",
  type: "convention",
  source: "extracted",
  body: "# Rules",
  enabled: true,
  version: 1,
  tokens: 12,
  used_by: 0,
};

function mockCreate() {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(CREATED), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The JSON body of the nth fetch call. */
function sentBody(fetchMock: ReturnType<typeof mockCreate>, n = 0): unknown {
  return JSON.parse(String(fetchMock.mock.calls[n]![1]!.body));
}

function renderModal(props: Partial<React.ComponentProps<typeof CreateSkillModal>> = {}) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <CreateSkillModal onClose={vi.fn()} onCreated={vi.fn()} {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const nameBox = () => screen.getByPlaceholderText("pr-quality-rubric") as HTMLInputElement;
const bodyBox = () => screen.getByPlaceholderText(/^# Rule/) as HTMLTextAreaElement;

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CreateSkillModal without `initial` (the /skills behaviour)", () => {
  it("opens empty, with the from-scratch header and no banner", () => {
    renderModal();
    expect(screen.getByText("Create from scratch")).toBeInTheDocument();
    expect(nameBox().value).toBe("");
    expect(bodyBox().value).toBe("");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("posts only the from-scratch fields — no source, no evidence_files", async () => {
    const fetchMock = mockCreate();
    const onCreated = vi.fn();
    renderModal({ onCreated });

    fireEvent.change(nameBox(), { target: { value: "my-skill" } });
    fireEvent.change(bodyBox(), { target: { value: "# Body" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    expect(sentBody(fetchMock)).toEqual({
      name: "my-skill",
      description: "",
      type: "custom",
      body: "# Body",
      // The modal now owns the Enabled toggle (it is in the design), so a
      // from-scratch skill states its own default rather than leaving the
      // server to infer one. New on purpose, not an accident.
      enabled: true,
      note: "Initial version",
    });
  });

  it("sends enabled:false when the toggle is switched off", async () => {
    const fetchMock = mockCreate();
    renderModal({});

    fireEvent.change(nameBox(), { target: { value: "my-skill" } });
    fireEvent.change(bodyBox(), { target: { value: "# Body" } });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sentBody(fetchMock)).toMatchObject({ enabled: false }));
  });
});

describe("CreateSkillModal with `initial` (the conventions draft)", () => {
  const initial = {
    name: "acme-api-conventions",
    description: "Merged house rules",
    type: "convention" as const,
    body: "# Conventions\n\n- Rule one",
    evidenceFiles: ["src/db/users.ts", "src/db/orders.ts"],
  };

  it("prefills every field and renders the caller's banner and title", () => {
    renderModal({
      initial,
      title: "Create skill from conventions",
      banner: "Merged from 2 accepted conventions in acme/api.",
    });
    expect(screen.getByText("Create skill from conventions")).toBeInTheDocument();
    expect(
      screen.getByText("Merged from 2 accepted conventions in acme/api."),
    ).toBeInTheDocument();
    expect(nameBox().value).toBe("acme-api-conventions");
    expect(bodyBox().value).toBe("# Conventions\n\n- Rule one");
  });

  it("posts the edited draft with source and evidence_files", async () => {
    const fetchMock = mockCreate();
    const onCreated = vi.fn();
    renderModal({ initial, source: "extracted", onCreated });

    fireEvent.change(bodyBox(), { target: { value: "# Conventions (edited)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));
    expect(sentBody(fetchMock)).toMatchObject({
      name: "acme-api-conventions",
      type: "convention",
      source: "extracted",
      body: "# Conventions (edited)",
      evidence_files: ["src/db/users.ts", "src/db/orders.ts"],
    });
  });
});
