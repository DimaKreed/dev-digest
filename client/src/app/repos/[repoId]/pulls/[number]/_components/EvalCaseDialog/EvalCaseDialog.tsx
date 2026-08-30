/* EvalCaseDialog — the bridge from a finding on a pull request to the eval
   case editor.

   It exists because the editor lives in the Agents route and needs a resolved
   draft, while the click happens here and knows only a finding id. So this
   fetches the draft (a GET — nothing is written), and hands it to the same
   editor the Evals tab uses. One editor, two entry points: a case authored
   from a finding and a case authored by hand must not diverge into two forms
   with different validation. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Skeleton } from "@devdigest/ui";
import { EvalCaseModal } from "../../../../../../agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalCaseModal";
import { draftFromSeed } from "../../../../../../agents/[id]/_components/AgentEditor/_components/EvalsTab/helpers";
import { useEvalCaseDraft } from "../../../../../../../lib/hooks/eval";
import { ApiError } from "../../../../../../../lib/api";

export function EvalCaseDialog({
  findingId,
  onClose,
}: {
  findingId: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const { data, isLoading, isError, error } = useEvalCaseDraft(findingId);

  if (isLoading) {
    return (
      <Modal width={560} title={t("caseEditor.newCase")} onClose={onClose}>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t("caseEditor.loadingDraft")}
          </div>
          <Skeleton height={120} />
        </div>
      </Modal>
    );
  }

  if (isError || !data) {
    // The server rejects a finding with no owning agent, and one whose file has
    // no stored patch, with a 422 that says which. Its message is shown as-is:
    // the two are fixed differently, and a generic failure hides that.
    return (
      <Modal width={560} title={t("caseEditor.draftFailed")} onClose={onClose}>
        <div style={{ padding: 24, fontSize: 13, lineHeight: 1.6 }}>
          {error instanceof ApiError ? error.message : t("finding.failed")}
        </div>
      </Modal>
    );
  }

  return (
    <EvalCaseModal
      agentId={data.agent_id}
      seed={{ draft: draftFromSeed(data), sourceFindingId: data.source_finding_id }}
      onClose={onClose}
    />
  );
}
