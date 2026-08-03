/* Skills Lab — two-pane shell shared by /skills and /skills/:id.
   Left: the skill list + "Add Skill". Right: the editor, or a select prompt. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Dropdown,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
  TextInput,
} from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { SkillCard } from "../SkillCard";
import { SkillEditor } from "../SkillEditor";
import { ImportSkillDrawer } from "../ImportSkillDrawer";
import { CreateSkillModal } from "@/components/CreateSkillModal";
import { useSkills, useSkill, useUpdateSkill } from "../../../../lib/hooks/skills";
import { ApiError } from "../../../../lib/api";
import { matchesQuery } from "./helpers";
import { s } from "./styles";

export function SkillsLabView({ skillId, tab, onTab }: {
  skillId?: string;
  tab: string;
  onTab: (t: string) => void;
}) {
  const t = useTranslations("skills");
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [importOpen, setImportOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  const { data: skills, isLoading: listLoading, isError, error, refetch } = useSkills();
  const { data: skill, isLoading: skillLoading } = useSkill(skillId);
  const update = useUpdateSkill();

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    ...(skill ? [{ label: skill.name }] : []),
  ];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("page.loadError")}
          body={error instanceof ApiError ? error.message : t("page.loadError")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  const visible = (skills ?? []).filter((sk) => matchesQuery(sk, query));

  return (
    <AppShell crumb={crumb}>
      <div style={s.wrap}>
        <div style={s.sidebar}>
          <div style={s.sidebarHead}>
            <div style={s.titleRow}>
              <h1 style={s.title}>{t("page.heading")}</h1>
              <Dropdown
                width={210}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus">
                    {t("page.addSkill")}
                  </Button>
                }
                items={[
                  {
                    label: t("editor.createFromScratch"),
                    icon: "Edit",
                    onClick: () => setCreateOpen(true),
                  },
                  {
                    label: t("editor.importFromFile"),
                    icon: "Upload",
                    onClick: () => setImportOpen(true),
                  },
                ]}
              />
            </div>
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder={t("page.searchPlaceholder")}
            />
          </div>

          <div style={s.list}>
            {listLoading && <Skeleton height={92} />}
            {!listLoading &&
              visible.map((sk) => (
                <SkillCard
                  key={sk.id}
                  skill={sk}
                  active={sk.id === skillId}
                  onClick={() => router.push(`/skills/${sk.id}?tab=${tab}`)}
                  onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
                />
              ))}
          </div>
        </div>

        {!skillId ? (
          <div style={s.placeholder}>
            <EmptyState
              icon="Sparkles"
              title={
                (skills ?? []).length === 0
                  ? t("page.empty.title")
                  : t("page.selectPrompt.title")
              }
              body={
                (skills ?? []).length === 0
                  ? t("page.empty.body")
                  : t("page.selectPrompt.body")
              }
              cta={(skills ?? []).length === 0 ? t("editor.importFromFile") : undefined}
              onCta={() => setImportOpen(true)}
            />
          </div>
        ) : skillLoading || !skill ? (
          <div style={s.loading}>
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={s.main}>
            <div style={s.mainHead}>
              <Icon.Sparkles size={18} style={{ color: "var(--accent)" }} />
              <h1 className="mono" style={s.mainTitle}>
                {skill.name}
              </h1>
              <Badge color="var(--text-secondary)">{t(`listItem.type.${skill.type}`)}</Badge>
              <Badge color="var(--text-muted)" icon="Eye" mono>
                {t("preview.version", { version: skill.version })}
              </Badge>
              {!skill.enabled && (
                <Badge color="var(--text-muted)">{t("editor.disabled")}</Badge>
              )}
              <div style={{ marginLeft: "auto" }}>
                <Button
                  kind="secondary"
                  size="sm"
                  icon="GitPullRequest"
                  onClick={() => router.push("/")}
                >
                  {t("editor.runOnPr")}
                </Button>
              </div>
            </div>
            <div style={s.mainBody}>
              <SkillEditor skill={skill} tab={tab} onTab={onTab} />
            </div>
          </div>
        )}
      </div>

      {importOpen && (
        <ImportSkillDrawer
          onClose={() => setImportOpen(false)}
          onSaved={(created) => {
            setImportOpen(false);
            router.push(`/skills/${created.id}?tab=config`);
          }}
        />
      )}

      {createOpen && (
        <CreateSkillModal
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setCreateOpen(false);
            router.push(`/skills/${created.id}?tab=config`);
          }}
        />
      )}
    </AppShell>
  );
}
