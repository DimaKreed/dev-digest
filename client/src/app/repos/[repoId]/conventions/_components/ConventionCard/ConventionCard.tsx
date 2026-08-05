/* ConventionCard — one verified house-rule candidate: the rule (editable in
   place), its category, confidence and occurrence count, the evidence that
   grounds it, and the accept/reject triage. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Chip,
  Icon,
  IconBtn,
  MonoLink,
  PercentProgress,
  Textarea,
} from "@devdigest/ui";
import type { ConventionCandidate, ConventionStatus } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { useActiveRepo } from "@/lib/repo-context";
import { s } from "./styles";

/** "42" for a single line, "42-58" for a range. */
function lineLabel(c: ConventionCandidate): string {
  return c.evidence_end_line !== c.evidence_start_line
    ? `${c.evidence_start_line}-${c.evidence_end_line}`
    : `${c.evidence_start_line}`;
}

export function ConventionCard({
  c,
  onStatus,
  onRule,
  saving,
}: {
  c: ConventionCandidate;
  onStatus: (status: ConventionStatus) => void;
  onRule: (rule: string) => void;
  saving?: boolean;
}) {
  const t = useTranslations("conventions");
  const { activeRepo } = useActiveRepo();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(c.rule);

  const accepted = c.status === "accepted";
  const rejected = c.status === "rejected";

  // Only link out when we know the repo — the blob URL needs owner/repo + branch.
  const href = activeRepo?.full_name
    ? githubBlobUrl(
        activeRepo.full_name,
        activeRepo.default_branch,
        c.evidence_path,
        c.evidence_start_line,
        c.evidence_end_line,
      )
    : undefined;

  const startEdit = () => {
    setDraft(c.rule);
    setEditing(true);
  };
  const save = () => {
    setEditing(false);
    if (draft.trim() && draft !== c.rule) onRule(draft.trim());
  };

  return (
    <div style={s.card(accepted, rejected)}>
      <div style={s.head}>
        <Chip>{t(`card.category.${c.category}`)}</Chip>
        <Badge icon="Copy" mono>
          {t("card.seenIn", { count: c.occurrences })}
        </Badge>
        {c.skill_id && (
          <Badge icon="Sparkles" color="var(--accent-text)" bg="var(--accent-bg)">
            {t("card.linkedToSkill")}
          </Badge>
        )}
        <div style={s.confidence}>
          <PercentProgress value={c.confidence * 100} label={t("card.confidence")} />
        </div>
      </div>

      {editing ? (
        <div style={s.editWrap}>
          <Textarea value={draft} onChange={setDraft} rows={3} />
          <div style={s.editActions}>
            <Button kind="primary" size="sm" icon="Check" onClick={save} disabled={saving}>
              {saving ? t("card.saving") : t("card.save")}
            </Button>
            <Button kind="ghost" size="sm" onClick={() => setEditing(false)}>
              {t("card.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div style={s.ruleRow}>
          <span style={s.rule}>{c.rule}</span>
          <IconBtn icon="Edit" label={t("card.edit")} size={26} onClick={startEdit} />
        </div>
      )}

      <div style={s.evidence}>
        <div style={s.evidenceHead}>
          {/* MonoLink is the primary target; the small anchor beside it is the
              explicit "open on GitHub" affordance, same pair as FindingSummaryRow. */}
          <MonoLink href={href}>
            {c.evidence_path}:{lineLabel(c)}
          </MonoLink>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={t("card.openOnGitHub")}
              aria-label={t("card.openOnGitHub")}
              style={s.githubLink}
            >
              <Icon.ExternalLink size={12} />
            </a>
          )}
        </div>
        <pre className="mono" style={s.snippet}>
          {c.evidence_snippet}
        </pre>
      </div>

      <div style={s.actions}>
        <Button
          kind={accepted ? "primary" : "secondary"}
          size="sm"
          icon="Check"
          onClick={() => onStatus(accepted ? "pending" : "accepted")}
        >
          {accepted ? t("card.accepted") : t("card.accept")}
        </Button>
        <Button
          kind={rejected ? "danger" : "ghost"}
          size="sm"
          icon="X"
          onClick={() => onStatus(rejected ? "pending" : "rejected")}
        >
          {rejected ? t("card.rejected") : t("card.reject")}
        </Button>
      </div>
    </div>
  );
}
