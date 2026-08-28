/* OnboardingView — /repos/:repoId/onboarding.

   The tour is generated on explicit request and read back with a banner for
   every way it can be less than it looks: not indexed, no provider key, written
   without a model, rank-only ordering, or written for a different commit. None
   of those is an error state — the tour still renders underneath them.

   The visible section list is DERIVED during render from the stored document,
   never mirrored into state: a regeneration replaces the document, and a copy
   in state would be one render behind it. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import { useGenerateOnboarding, useOnboarding } from "@/lib/hooks/onboarding";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { PageToc } from "./_components/PageToc";
import { SectionCard } from "./_components/SectionCard";
import { isStale, relativeTime, visibleSections } from "./helpers";
import { s } from "./styles";

const SKELETON_CARDS = 3;

/** One banner. `role` is `alert` only where the message is a refusal. */
function Banner({
  title,
  body,
  cta,
  onCta,
  assertive,
}: {
  title: string;
  body: string;
  cta?: string;
  onCta?: () => void;
  assertive?: boolean;
}) {
  return (
    <Card>
      <div role={assertive ? "alert" : "status"} aria-label={title}>
        <div style={{ fontWeight: 650, marginBottom: 4 }}>{title}</div>
        <div style={s.note}>{body}</div>
        {cta && onCta && (
          <div style={{ marginTop: 10 }}>
            <Button kind="secondary" size="sm" onClick={onCta}>
              {cta}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function OnboardingView() {
  const t = useTranslations("onboarding");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, error, refetch } = useOnboarding(repoId);
  const generate = useGenerateOnboarding(repoId);

  // Announced, not shown — the outcome of a regeneration reaches a screen
  // reader through the live region below rather than through a toast.
  const [announcement, setAnnouncement] = React.useState("");

  const tour = data?.tour ?? null;
  const sections = visibleSections(tour);
  const availability = data?.availability;
  const repoName = activeRepo?.full_name ?? null;
  const crumb = [{ label: t("title") }];

  const runGenerate = async () => {
    setAnnouncement("");
    try {
      await generate.mutateAsync();
      setAnnouncement(t("regenerated"));
    } catch (e) {
      const reason = e instanceof ApiError ? e.message : t("unknownError");
      setAnnouncement(t("regenerateFailed", { reason }));
    }
  };

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const canGenerate = availability?.can_generate ?? false;

  return (
    <AppShell crumb={crumb}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>
            {t("title")}
            {repoName && (
              <>
                {" · "}
                <span className="mono" style={s.repoName}>
                  {repoName}
                </span>
              </>
            )}
          </h1>
          {data?.generated_at && (
            <p style={s.pageSubtitle}>
              {t("generated", { when: relativeTime(data.generated_at) })}
            </p>
          )}
        </div>
        <div style={s.headerActions}>
          {/* Regenerate lives here only once a tour exists. Before that the
              empty state carries the one and only generate action, so the page
              never offers the same generation from two places. */}
          {tour && (
            <Button
              kind="primary"
              icon="Sparkles"
              onClick={runGenerate}
              loading={generate.isPending}
              disabled={generate.isPending || !canGenerate}
            >
              {generate.isPending ? t("regenerating") : t("regenerate")}
            </Button>
          )}
        </div>
      </div>

      <div aria-live="polite" style={s.srOnly}>
        {announcement}
      </div>

      <div style={s.main}>
        <div style={s.column}>
          {isLoading && (
            <>
              {Array.from({ length: SKELETON_CARDS }, (_, i) => (
                <Skeleton key={i} height={120} />
              ))}
            </>
          )}

          {!isLoading && isError && (
            <ErrorState
              title={t("loadError.title")}
              body={t("errorState.body", {
                reason: error instanceof Error ? error.message : t("unknownError"),
              })}
              onRetry={() => void refetch()}
            />
          )}

          {!isLoading && !isError && (
            <>
              <div style={s.banners}>
                {availability?.reason === "index_missing" && (
                  <Banner
                    assertive
                    title={t("banner.notIndexed.title")}
                    body={t("banner.notIndexed.body")}
                  />
                )}
                {availability?.reason === "flag_off" && (
                  <Banner
                    assertive
                    title={t("banner.flagOff.title")}
                    body={t("banner.flagOff.body")}
                  />
                )}
                {availability?.reason === "missing_key" && (
                  <Banner
                    assertive
                    title={t("banner.noKey.title")}
                    body={t("banner.noKey.body")}
                  />
                )}
                {tour?.generated_without_model === true && (
                  <Banner
                    title={t("banner.noModel.title")}
                    body={t("banner.noModel.body")}
                    cta={canGenerate ? t("banner.noModel.cta") : undefined}
                    onCta={canGenerate ? runGenerate : undefined}
                  />
                )}
                {isStale(tour?.sha, data?.current_sha) && (
                  <Banner
                    title={t("banner.stale.title")}
                    body={t("banner.stale.body")}
                    cta={canGenerate ? t("banner.stale.cta") : undefined}
                    onCta={canGenerate ? runGenerate : undefined}
                  />
                )}
              </div>

              {!tour && (
                <EmptyState
                  icon="Sparkles"
                  title={t("generate.title")}
                  body={t("generate.body")}
                  // No key, no index, flag off: the action is not offered at
                  // all rather than offered and refused. The banner above says
                  // which of the three it is.
                  cta={
                    canGenerate
                      ? generate.isPending
                        ? t("generate.generating")
                        : t("generate.cta")
                      : undefined
                  }
                  onCta={canGenerate ? runGenerate : undefined}
                  ctaLoading={generate.isPending}
                />
              )}

              {tour && (
                <>
                  {sections.map((section) => (
                    <SectionCard
                      key={section.kind}
                      section={section}
                      fullName={repoName}
                      sha={tour.sha}
                    />
                  ))}

                  {tour.hotness_available === false && <p style={s.note}>{t("hotnessNote")}</p>}
                  {typeof tour.dropped_links === "number" && tour.dropped_links > 0 && (
                    <p style={s.note}>{t("droppedLinks", { count: tour.dropped_links })}</p>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {tour && <PageToc kinds={sections.map((section) => section.kind)} />}
      </div>
    </AppShell>
  );
}
