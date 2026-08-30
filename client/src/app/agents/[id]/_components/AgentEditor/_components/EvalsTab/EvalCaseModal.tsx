/* EvalCaseModal — author a case, RUN it, and only then decide to keep it.

   Opening this over a finding writes nothing. That is the point: a case whose
   expected line is one off its own diff hunk is dropped by the grounding gate
   on every run, so it can never pass however good the agent is — and the only
   way to notice is to run it. "Run case" on an unsaved draft dry-runs it
   server-side (same engine, same scorer, no row), so the actual output is on
   screen before Save is pressed. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Modal, Tabs, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { EvalCaseRecord, EvalCaseRun } from "@devdigest/shared";
import {
  useCreateEvalCase,
  useEvalCaseRuns,
  useEvalPreview,
  useRunEvalCase,
  useUpdateEvalCase,
} from "../../../../../../../lib/hooks/eval";
import { useToast } from "../../../../../../../lib/toast";
import { ExpectedVsActual } from "./ExpectedVsActual";
import {
  draftBody,
  draftFromCase,
  draftProblem,
  emptyDraft,
  findingSkeleton,
  parseExpected,
  type CaseDraft,
} from "./helpers";
import { s } from "./styles";

export function EvalCaseModal({
  agentId,
  existing,
  seed,
  onClose,
}: {
  agentId: string;
  /** An already-saved case being edited. */
  existing?: EvalCaseRecord;
  /** A draft seeded from a finding — nothing is persisted until Save. */
  seed?: { draft: CaseDraft; sourceFindingId: string };
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const toast = useToast();
  const create = useCreateEvalCase();
  const update = useUpdateEvalCase();
  const runSaved = useRunEvalCase();
  const preview = useEvalPreview();
  const { data: history } = useEvalCaseRuns(existing?.id);

  const [draft, setDraft] = React.useState<CaseDraft>(
    () => seed?.draft ?? (existing ? draftFromCase(existing) : emptyDraft()),
  );
  const [tab, setTab] = React.useState("diff");
  const [runOnSave, setRunOnSave] = React.useState(false);
  /** This dialog's own dry run. Outranks the saved history while it is open. */
  const [previewRun, setPreviewRun] = React.useState<EvalCaseRun | null>(null);

  const problem = draftProblem(draft);
  const expectations = parseExpected(draft.expectedJson);
  const expectedValid = expectations !== null;
  const saving = create.isPending || update.isPending;
  const running = preview.isPending || runSaved.isPending;

  // What the Actual panel shows: this dialog's run first, then the case's
  // newest saved one. A brand-new draft has neither, and says so.
  const shownRun = previewRun ?? history?.[0] ?? existing?.last_run ?? null;
  const shownExpected = expectations ?? [];
  const first = shownExpected[0];
  const positive = draft.expectationKind === "must_find";

  const set = <K extends keyof CaseDraft>(key: K, value: CaseDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const onError = (e: unknown, fallback: string) =>
    toast.error(e instanceof Error ? e.message : fallback);

  /** Run the case as it stands. Dry on a draft, real on a saved case. */
  const run = () => {
    if (problem) return;
    const body = draftBody(draft);
    if (existing) {
      runSaved.mutate(
        { caseId: existing.id, agentId },
        { onError: (e) => onError(e, t("evalsTab.runFailed")) },
      );
      return;
    }
    preview.mutate(
      {
        agentId,
        input: {
          expectation_kind: body.expectation_kind,
          input_diff: body.input_diff,
          input_meta: body.input_meta,
          expected_output: body.expected_output,
        },
      },
      { onSuccess: setPreviewRun, onError: (e) => onError(e, t("evalsTab.runFailed")) },
    );
  };

  const save = () => {
    if (problem) return;
    const body = draftBody(draft);
    const done = (saved: EvalCaseRecord) => {
      if (runOnSave) {
        runSaved.mutate(
          { caseId: saved.id, agentId },
          { onError: (e) => onError(e, t("evalsTab.runFailed")) },
        );
      }
      onClose();
    };
    if (existing) {
      update.mutate(
        { caseId: existing.id, patch: body },
        { onSuccess: done, onError: (e) => onError(e, t("caseEditor.saveFailed")) },
      );
    } else {
      create.mutate(
        { agentId, input: seed ? { ...body, source_finding_id: seed.sourceFindingId } : body },
        { onSuccess: done, onError: (e) => onError(e, t("caseEditor.saveFailed")) },
      );
    }
  };

  return (
    <Modal
      width={980}
      title={existing ? t("caseEditor.caseTitle", { name: existing.name }) : t("caseEditor.newCase")}
      subtitle={seed ? t("caseEditor.seededSubtitle") : t("caseEditor.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <label style={s.runOnSave}>
            <Toggle on={runOnSave} onChange={setRunOnSave} size={16} />
            {t("caseEditor.runOnSave")}
          </label>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button kind="ghost" size="sm" onClick={onClose}>
              {t("caseEditor.cancel")}
            </Button>
            <Button
              kind="secondary"
              size="sm"
              icon="Play"
              disabled={running || problem !== null}
              onClick={run}
            >
              {running ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
            <Button
              kind="primary"
              size="sm"
              icon="Check"
              disabled={saving || problem !== null}
              onClick={save}
            >
              {saving
                ? existing
                  ? t("caseEditor.saving")
                  : t("caseEditor.creating")
                : existing
                  ? t("caseEditor.save")
                  : t("caseEditor.create")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.form}>
        {/* ---- left: what the agent will see ------------------------------ */}
        <div style={s.col}>
          {/* The assertion in one sentence, in the polarity the finding's own
              accept/dismiss decision picked. Editable on the right, but stated
              here so nobody saves a case asserting the opposite of what they
              meant — the two polarities look identical in the JSON. */}
          <div style={s.assertion(positive)}>
            <div style={s.assertionLabel(positive)}>
              {positive ? t("caseEditor.positiveCase") : t("caseEditor.negativeCase")}
            </div>
            <div style={s.assertionBody}>
              {first
                ? positive
                  ? t("expectation.mustFindLong", {
                      title: first.title ?? t("caseEditor.somethingHere"),
                      file: first.file,
                      line: first.start_line,
                    })
                  : t("expectation.mustNotFlagLong", {
                      file: first.file,
                      line: first.start_line,
                    })
                : t("caseEditor.noAssertionYet")}
            </div>
          </div>

          <FormField label={t("caseEditor.nameLabel")} required>
            <TextInput
              value={draft.name}
              placeholder={t("caseEditor.namePlaceholder")}
              onChange={(v: string) => set("name", v)}
            />
          </FormField>

          <div>
            <div style={s.label}>{t("caseEditor.inputLabel")}</div>
            <Tabs
              tabs={[
                { key: "diff", label: t("caseEditor.tabs.diff") },
                { key: "files", label: t("caseEditor.tabs.files") },
                { key: "meta", label: t("caseEditor.tabs.prMeta") },
              ]}
              value={tab}
              onChange={setTab}
            />
            <div style={{ marginTop: 10 }}>
              {tab === "diff" && (
                <Textarea
                  value={draft.inputDiff}
                  placeholder={t("caseEditor.diffPlaceholder")}
                  onChange={(v: string) => set("inputDiff", v)}
                  rows={13}
                  mono
                />
              )}
              {tab === "files" && <FilesTab diff={draft.inputDiff} />}
              {tab === "meta" && (
                <>
                  <FormField label={t("caseEditor.titleLabel")}>
                    <TextInput
                      value={draft.metaTitle}
                      placeholder={t("caseEditor.titlePlaceholder")}
                      onChange={(v: string) => set("metaTitle", v)}
                    />
                  </FormField>
                  <FormField label={t("caseEditor.bodyLabel")}>
                    <Textarea
                      value={draft.metaBody}
                      placeholder={t("caseEditor.bodyPlaceholder")}
                      onChange={(v: string) => set("metaBody", v)}
                      rows={5}
                    />
                  </FormField>
                </>
              )}
            </div>
          </div>

          <FormField label={t("caseEditor.notesLabel")}>
            <Textarea
              value={draft.notes}
              placeholder={t("caseEditor.notesPlaceholder")}
              onChange={(v: string) => set("notes", v)}
              rows={3}
            />
          </FormField>
        </div>

        {/* ---- right: what it must produce, and what it did ---------------- */}
        <div style={s.col}>
          <div>
            <div style={s.paneLabel}>
              {t("caseEditor.expectedOutput")}
              <Badge color={expectedValid ? "var(--ok)" : "var(--crit)"}>
                {expectedValid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
              </Badge>
              <span style={{ marginLeft: "auto" }}>
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Plus"
                  onClick={() => set("expectedJson", findingSkeleton(first?.file))}
                >
                  {t("caseEditor.findingSkeleton")}
                </Button>
              </span>
            </div>
            {/* Raw JSON, edited as TEXT: parsing on every keystroke and writing
                the parse back would make a half-typed `[{ "file":` unenterable. */}
            <Textarea
              value={draft.expectedJson}
              onChange={(v: string) => set("expectedJson", v)}
              rows={9}
              mono
            />
            <div style={s.polarityRow}>
              <button
                type="button"
                style={s.polarity(positive, true)}
                onClick={() => set("expectationKind", "must_find")}
              >
                <strong>{t("expectation.must_find")}</strong>
                <div>{t("expectation.mustFindHint")}</div>
              </button>
              <button
                type="button"
                style={s.polarity(!positive, false)}
                onClick={() => set("expectationKind", "must_not_flag")}
              >
                <strong>{t("expectation.must_not_flag")}</strong>
                <div>{t("expectation.mustNotFlagHint")}</div>
              </button>
            </div>
          </div>

          <div>
            <div style={s.paneLabel}>
              {t("compareCase.actualOutput")}
              {previewRun && <Badge color="var(--warn)">{t("caseEditor.dryRun")}</Badge>}
            </div>
            {/* Reuses the saved-case view, so a dry run and a real one are read
                the same way — a second rendering for the preview could disagree
                with what the same case shows a minute after Save. */}
            <ExpectedVsActual
              expected={shownExpected}
              kind={draft.expectationKind}
              run={shownRun}
              actualOnly
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The files the frozen diff touches, read off the diff itself.
 *
 * Not a stored list: the diff IS the input, so a separate file list is a second
 * source of truth that goes stale the moment the diff is edited by hand.
 */
function FilesTab({ diff }: { diff: string }) {
  const t = useTranslations("eval");
  const files = React.useMemo(() => {
    const out = new Set<string>();
    for (const line of diff.split("\n")) {
      if (line.startsWith("+++ ")) {
        const p = line.slice(4).replace(/^b\//, "").trim();
        if (p && p !== "/dev/null") out.add(p);
      }
    }
    return [...out];
  }, [diff]);

  if (files.length === 0) return <div style={s.empty}>{t("caseEditor.noFiles")}</div>;
  return (
    <div style={s.list}>
      {files.map((f) => (
        <div key={f} style={s.locRow("unknown")}>
          <span className="mono" style={s.locFile}>
            {f}
          </span>
        </div>
      ))}
    </div>
  );
}
