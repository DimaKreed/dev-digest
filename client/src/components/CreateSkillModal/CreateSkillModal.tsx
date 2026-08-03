/* CreateSkillModal — name / description / type / markdown body.
   Promoted out of app/skills/_components/ so a second route (the Conventions
   page) can open it with a server-rendered draft prefilled. With no `initial`
   it is the original create-from-scratch modal, unchanged. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { Skill, SkillSource, SkillType } from "@devdigest/shared";
import { useCreateSkill, type CreateSkillInput } from "@/lib/hooks/skills";
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
}) {
  const t = useTranslations("skills");
  const create = useCreateSkill();
  const [name, setName] = React.useState(initial?.name ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const [type, setType] = React.useState<SkillType>(initial?.type ?? DEFAULT_TYPE);
  const [body, setBody] = React.useState(initial?.body ?? "");

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
      subtitle={subtitle ?? t("config.descriptionHint")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={!canSubmit}>
            {create.isPending ? t("config.saving") : t("config.save")}
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
        <FormField label={t("config.type")}>
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
        </FormField>
        <FormField label={t("config.body")} hint={t("config.bodyHint")} required>
          <Textarea
            value={body}
            onChange={setBody}
            rows={10}
            mono
            placeholder={t("config.bodyPlaceholder")}
          />
        </FormField>
      </div>
    </Modal>
  );
}
