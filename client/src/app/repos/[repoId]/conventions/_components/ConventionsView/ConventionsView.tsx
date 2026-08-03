/* ConventionsView — /repos/:repoId/conventions.
   Scan the clone for house-rules, triage the verified candidates, and merge the
   accepted ones into a Skill. The scan report is deliberately on the page: the
   drop counts are the only honest read on how much the model got wrong. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { ConventionStatus, Skill, SkillDraft } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { CreateSkillModal } from "@/components/CreateSkillModal";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import {
  useConventions,
  useConventionSkillDraft,
  useConventionsPlugin,
  useExtractConventions,
  useLinkConventionSkill,
  useUpdateConvention,
} from "@/lib/hooks/conventions";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import { ConventionCard } from "../ConventionCard";
import { ScanReport } from "../ScanReport";
import { downloadJson, isRepoNotIndexed, scanTime } from "./helpers";
import { s } from "./styles";

const SKELETON_CARDS = 3;

export function ConventionsView() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const toast = useToast();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, error, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);
  const skillDraft = useConventionSkillDraft(repoId);
  const linkSkill = useLinkConventionSkill(repoId);
  const plugin = useConventionsPlugin(repoId);

  const [reportOpen, setReportOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<SkillDraft | null>(null);

  const candidates = data?.candidates ?? [];
  const acceptedIds = candidates.filter((c) => c.status === "accepted").map((c) => c.id);
  const lastScanAt = data?.last_scan_at ?? null;
  // The GET is the source of truth, but show the fresh scorecard immediately
  // after an extract, before the invalidated query has come back.
  const stats = data?.stats ?? extract.data?.stats ?? null;
  const repoName = activeRepo?.full_name ?? t("page.repoFallback");
  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  const runExtract = async () => {
    try {
      await extract.mutateAsync();
    } catch (e) {
      // 409 repo_not_indexed is a next step, not a failure — it gets its own
      // inline message below instead of a generic error toast.
      if (!isRepoNotIndexed(e)) toast.error(t("page.extractionFailed"));
    }
  };

  const deselectAll = () => {
    for (const id of acceptedIds) update.mutate({ id, patch: { status: "pending" } });
  };

  const openDraft = async () => {
    try {
      setDraft(await skillDraft.mutateAsync(acceptedIds));
    } catch {
      toast.error(t("modal.failed"));
    }
  };

  const onCreated = async (skill: Skill) => {
    const ids = acceptedIds;
    setDraft(null);
    try {
      await linkSkill.mutateAsync({ skillId: skill.id, conventionIds: ids });
      toast.success(t("modal.created", { count: ids.length }));
    } catch {
      toast.error(t("modal.failed"));
    }
  };

  const exportPlugin = async () => {
    try {
      const bundle = await plugin.mutateAsync();
      downloadJson(`${repoName.replace("/", "-")}-conventions-plugin.json`, bundle);
    } catch {
      toast.error(t("page.exportFailed"));
    }
  };

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>
            {t("page.headingPrefix")}
            <span className="mono" style={s.repoName}>
              {repoName}
            </span>
          </h1>
          <p style={s.pageSubtitle}>
            {stats || lastScanAt ? (
              <>
                {stats && t("page.detectedFrom", { count: stats.sampled_files })}
                {stats && lastScanAt && " · "}
                {lastScanAt && t("page.lastScan", { when: scanTime(lastScanAt) })}
              </>
            ) : (
              t("page.subtitle")
            )}
          </p>
        </div>
        <div style={s.headerActions}>
          <Button
            kind="ghost"
            icon="Boxes"
            onClick={exportPlugin}
            loading={plugin.isPending}
            disabled={candidates.length === 0}
          >
            {plugin.isPending ? t("page.exportingPlugin") : t("page.exportPlugin")}
          </Button>
          <Button kind="secondary" icon="RefreshCw" onClick={runExtract} loading={extract.isPending}>
            {extract.isPending
              ? t("page.scanning")
              : lastScanAt
                ? t("page.rescan")
                : t("page.runExtraction")}
          </Button>
        </div>
      </div>

      <div style={s.main}>
        {isRepoNotIndexed(extract.error) && (
          <div style={s.notIndexed} role="status">
            <Icon.AlertTriangle size={14} />
            {t("page.notIndexed")}
          </div>
        )}

        {isError ? (
          <ErrorState
            title={t("page.loadError")}
            body={error instanceof ApiError ? error.message : undefined}
            onRetry={() => refetch()}
          />
        ) : isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
              <Skeleton key={i} height={150} />
            ))}
          </div>
        ) : (
          <>
            {candidates.length > 0 && (
              <div style={s.toolbar}>
                <Button
                  kind="ghost"
                  size="sm"
                  onClick={deselectAll}
                  disabled={acceptedIds.length === 0}
                >
                  {t("page.deselectAll")}
                </Button>
                <span style={s.acceptedCount}>
                  {t("page.acceptedCount", {
                    accepted: acceptedIds.length,
                    total: candidates.length,
                  })}
                </span>
                <div style={s.toolbarRight}>
                  <Button
                    kind="primary"
                    icon="Sparkles"
                    onClick={openDraft}
                    loading={skillDraft.isPending}
                    disabled={acceptedIds.length === 0}
                  >
                    {t("page.createSkill")}
                  </Button>
                </div>
              </div>
            )}

            {stats && (
              <ScanReport
                stats={stats}
                open={reportOpen}
                onToggle={() => setReportOpen((o) => !o)}
              />
            )}

            {candidates.length === 0 ? (
              lastScanAt ? (
                <EmptyState
                  icon="ListChecks"
                  title={t("page.emptyAfterScan.title")}
                  body={t("page.emptyAfterScan.body")}
                />
              ) : (
                <EmptyState
                  icon="ListChecks"
                  title={t("page.empty.title")}
                  body={t("page.empty.body")}
                  cta={t("page.empty.cta")}
                  onCta={runExtract}
                  ctaLoading={extract.isPending}
                />
              )
            ) : (
              <>
                <div style={s.acceptedCount}>
                  {t("page.candidateCount", { count: candidates.length })}
                </div>
                <div style={s.list}>
                  {candidates.map((c) => (
                    <ConventionCard
                      key={c.id}
                      c={c}
                      saving={update.isPending && update.variables?.id === c.id}
                      onStatus={(status: ConventionStatus) =>
                        update.mutate({ id: c.id, patch: { status } })
                      }
                      onRule={(rule) => update.mutate({ id: c.id, patch: { rule } })}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {draft && (
        <CreateSkillModal
          initial={{
            name: draft.name,
            description: draft.description,
            type: draft.type,
            body: draft.body,
            evidenceFiles: draft.evidence_files,
          }}
          source="extracted"
          title={t("modal.title")}
          banner={t("modal.mergedFrom", { count: acceptedIds.length, repo: repoName })}
          onClose={() => setDraft(null)}
          onCreated={onCreated}
        />
      )}
    </AppShell>
  );
}
