/* /skills — Skills Lab with no selection; the right pane prompts to pick one. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SkillsLabView } from "./_components/SkillsLabView";
import { DEFAULT_TAB, VALID_TABS } from "./_components/SkillEditor";

export default function SkillsPage() {
  const search = useSearchParams();
  const router = useRouter();
  const raw = search.get("tab") ?? "";
  const tab = VALID_TABS.includes(raw) ? raw : DEFAULT_TAB;

  // No skill selected yet — remember the tab so clicking a card lands on it.
  return <SkillsLabView tab={tab} onTab={(t) => router.replace(`/skills?tab=${t}`)} />;
}
