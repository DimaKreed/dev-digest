/* /skills/:id — Skills Lab with a selected skill. Tab state lives in ?tab=,
   mirroring /agents/:id. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { SkillsLabView } from "../_components/SkillsLabView";
import { DEFAULT_TAB, VALID_TABS } from "../_components/SkillEditor";

export default function SkillEditorPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();

  const raw = search.get("tab") ?? "";
  const tab = VALID_TABS.includes(raw) ? raw : DEFAULT_TAB;

  const setTab = (t: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", t);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  return <SkillsLabView skillId={id} tab={tab} onTab={setTab} />;
}
