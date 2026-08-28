"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import type {
  BriefFileRef,
  FindingRecord,
  PrBrief,
  PrIntentDetail,
} from "@devdigest/shared";
import type { BriefAvailability } from "@/lib/hooks/brief";
import { IntentCard } from "../IntentCard";
import { PrBriefCard } from "../PrBriefCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  /** Derived PR intent — rendered above the description, per the design. */
  intent: PrIntentDetail | undefined;
  intentLoading?: boolean;
  deferredFindings: FindingRecord[];
  onRederiveIntent: () => void;
  rederivingIntent?: boolean;
  /** The stored merge-risk brief, or `null` when none has been generated. */
  brief: PrBrief | null;
  /** Computed server-side (AC-16); this tab compares no sha and no model. */
  briefStale?: boolean;
  briefLoading?: boolean;
  briefGenerating?: boolean;
  briefError?: string | null;
  /** Whether a generation can be paid for at all, decided server-side (AC-24). */
  briefAvailability?: BriefAvailability | null;
  onGenerateBrief: () => void;
  onOpenFocus: (ref: BriefFileRef) => void;
}

export function OverviewTab({
  prBody,
  intent,
  intentLoading,
  deferredFindings,
  onRederiveIntent,
  rederivingIntent,
  brief,
  briefStale,
  briefLoading,
  briefGenerating,
  briefError,
  briefAvailability,
  onGenerateBrief,
  onOpenFocus,
}: OverviewTabProps) {
  const t = useTranslations("prReview");
  return (
    <>
      {/* AC-25 — the brief card sits ABOVE the intent card. Document order is
          what "above" means for a stacked column, so the placement is a fact
          about this JSX rather than about a stylesheet. `IntentCard` itself is
          untouched by this feature (AC-27, Non-goals): the risks belong to the
          brief card and the intent card renders none. */}
      <PrBriefCard
        brief={brief}
        stale={briefStale}
        loading={briefLoading}
        generating={briefGenerating}
        error={briefError}
        availability={briefAvailability}
        onGenerate={onGenerateBrief}
        onOpenFocus={onOpenFocus}
      />
      <IntentCard
        intent={intent}
        loading={intentLoading}
        deferred={deferredFindings}
        onRederive={onRederiveIntent}
        rederiving={rederivingIntent}
      />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
