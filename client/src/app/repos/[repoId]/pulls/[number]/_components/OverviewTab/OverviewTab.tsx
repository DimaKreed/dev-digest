"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import type { FindingRecord, PrIntentDetail } from "@devdigest/shared";
import { IntentCard } from "../IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  /** Derived PR intent — rendered above the description, per the design. */
  intent: PrIntentDetail | undefined;
  intentLoading?: boolean;
  deferredFindings: FindingRecord[];
  onRederiveIntent: () => void;
  rederivingIntent?: boolean;
}

export function OverviewTab({
  prBody,
  intent,
  intentLoading,
  deferredFindings,
  onRederiveIntent,
  rederivingIntent,
}: OverviewTabProps) {
  const t = useTranslations("prReview");
  return (
    <>
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
