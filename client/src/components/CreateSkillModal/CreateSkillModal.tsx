/* CreateSkillModal — name / description / type / markdown body.
   Promoted out of app/skills/_components/ so a second route (the Conventions
   page) can open it with a server-rendered draft prefilled. With no `initial`
   it is the original create-from-scratch modal, unchanged. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, Icon, TextInput, SelectInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillSource, SkillType } from "@devdigest/shared";
import { useCreateSkill, type CreateSkillInput } from "@/lib/hooks/skills";
import { BodyEditor } from "./_components/BodyEditor";
import { DEFAULT_TYPE, MODAL_WIDTH, SKILL_TYPES } from "./constants";
import { s } from "./styles";

/** Prefill for every editable field. Absent ⇒ the plain from-scratch modal. */
export interface CreateSkillInitial {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  /** Recorded on the skill so a reader can trace it back to the code. */
  evidenceFiles?: string[];
}

export function CreateSkillModal({
  onClose,
  onCreated,
  initial,
  source,
  title,
  subtitle,
  banner,
  submitLabel,
  footerNote,
}: {
  onClose: () => void;
  onCreated: (skill: Skill) => void;
  initial?: CreateSkillInitial;
  /** Provenance recorded server-side; omit to let the server default it. */
  source?: SkillSource;
  /** Header override. Defaults to the from-scratch wording. */
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Info strip above the form — the caller owns its namespace and wording. */
  banner?: React.ReactNode;
  /** Submit button text. Defaults to the from-scratch "Save". */
  submitLabel?: React.ReactNode;
  /** Muted line on the left of the footer, e.g. "Saved as v1". */
  footerNote?: React.ReactNode;
}) {
  const t = useTranslations("skills");
  const create = useCreateSkill();
  const [name, setName] = React.useState(initial?.name ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const [type, setType] = React.useState<SkillType>(initial?.type ?? DEFAULT_TYPE);
  const [body, setBody] = React.useState(initial?.body ?? "");
  const [enabled, setEnabled] = React.useState(true);

  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));
  const canSubmit = name.trim().length > 0 && body.trim().length > 0 && !create.isPending;

  const submit = async () => {
    // `evidence_files` is not on CreateSkillInput; widen here instead of editing
    // the shared hook (an inline object literal would trip excess-property).
    const input: CreateSkillInput & { evidence_files?: string[] } = {
      name: name.trim(),
      description: description.trim(),
      type,
      body,
      enabled,
      note: "Initial version",
      ...(source ? { source } : {}),
      ...(initial?.evidenceFiles ? { evidence_files: initial.evidenceFiles } : {}),
    };
    const skill = await create.mutateAsync(input);
    onCreated(skill);
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={title ?? t("editor.createFromScratch")}
      // With a draft prefilled the name is the useful subheading; the old
      // default repeated the Description field's own hint verbatim.
      subtitle={subtitle ?? (initial ? initial.name : t("config.descriptionHint"))}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {footerNote && (
            <span style={s.footerNote}>
              <Icon.GitBranch size={12} />
              {footerNote}
            </span>
          )}
          <Button kind="ghost" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          <Button
            kind="primary"
            icon={initial ? "Sparkles" : "Plus"}
            onClick={submit}
            disabled={!canSubmit}
          >
            {create.isPending ? t("config.saving") : (submitLabel ?? t("config.save"))}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {banner && <div style={s.banner}>{banner}</div>}
        <FormField label={t("config.name")} required>
          <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} mono />
        </FormField>
        <FormField label={t("config.description")} hint={t("config.descriptionHint")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>
        <div style={s.row}>
          <FormField label={t("config.type")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as SkillType)}
              options={typeOptions}
            />
          </FormField>
          <FormField label={t("config.enabled")} hint={t("config.enabledHint")}>
            <Toggle on={enabled} onChange={setEnabled} />
          </FormField>
        </div>
        <FormField label={t("config.body")} hint={t("config.bodyHint")} required>
          <BodyEditor
            value={body}
            onChange={setBody}
            fileName={`${name || "skill"}.md`}
            dirty={body !== (initial?.body ?? "")}
            placeholder={t("config.bodyPlaceholder")}
            unsavedLabel={t("config.unsaved")}
            tokensLabel={(count) => t("config.tokensEstimate", { count })}
          />
        </FormField>
      </div>
    </Modal>
  );
}
