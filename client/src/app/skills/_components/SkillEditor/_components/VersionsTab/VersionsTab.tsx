"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Modal, Skeleton } from "@devdigest/ui";
import type { Skill, SkillVersion } from "@devdigest/shared";
import {
  useRestoreSkillVersion,
  useSkillVersions,
} from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { diffLines, versionDate } from "./helpers";
import { s } from "./styles";

/**
 * Versions tab — immutable body snapshots, newest first.
 *
 * "Restore" never rewrites history: it saves the old body as a NEW version, so
 * a run scored against v3 still resolves to exactly the v3 text.
 */
export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [diffFor, setDiffFor] = React.useState<SkillVersion | null>(null);

  if (isLoading) return <Skeleton height={180} />;
  if (isError || !versions) {
    return <ErrorState title={t("versions.loadError")} onRetry={() => refetch()} />;
  }

  const onRestore = (v: SkillVersion) => {
    if (!window.confirm(t("versions.restoreConfirm", { version: v.version }))) return;
    restore.mutate(
      { id: skill.id, version: v.version },
      {
        onSuccess: (updated) =>
          toast.success(
            t("versions.restored", { version: v.version, newVersion: updated.version }),
          ),
      },
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <h2 style={s.h2}>{t("versions.title")}</h2>
        <Badge color="var(--text-secondary)">
          {t("versions.count", { count: versions.length })}
        </Badge>
      </div>
      <p style={s.subtitle}>{t("versions.subtitle")}</p>

      {versions.map((v) => {
        const current = v.version === skill.version;
        return (
          <div key={v.version} style={s.row(current)}>
            <span className="mono" style={s.versionChip}>
              v{v.version}
            </span>
            <div style={s.meta}>
              <div style={s.note}>{v.note || t("versions.noNote")}</div>
              <div className="tnum" style={s.date}>
                {versionDate(v.created_at)}
              </div>
            </div>
            <div style={s.actions}>
              {current ? (
                <Badge color="var(--ok)" dot>
                  {t("versions.current")}
                </Badge>
              ) : (
                <>
                  <Button kind="ghost" size="sm" icon="Eye" onClick={() => setDiffFor(v)}>
                    {t("versions.diff")}
                  </Button>
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="History"
                    onClick={() => onRestore(v)}
                    disabled={restore.isPending}
                  >
                    {restore.isPending ? t("versions.restoring") : t("versions.restore")}
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {diffFor && (
        <Modal
          width={860}
          title={t("versions.diffTitle", { version: diffFor.version })}
          onClose={() => setDiffFor(null)}
        >
          <DiffView before={diffFor.body} after={skill.body} />
        </Modal>
      )}
    </div>
  );
}

function DiffView({ before, after }: { before: string; after: string }) {
  const t = useTranslations("skills");
  const lines = React.useMemo(() => diffLines(before, after), [before, after]);
  const changed = lines.some((l) => l.kind !== "same");

  if (!changed) return <div style={s.identical}>{t("versions.identical")}</div>;

  return (
    <div className="mono" style={s.diffBody}>
      {lines.map((l, i) => (
        <span key={i} style={s.diffLine(l.kind)}>
          {l.kind === "added" ? "+ " : l.kind === "removed" ? "- " : "  "}
          {l.text}
        </span>
      ))}
    </div>
  );
}
