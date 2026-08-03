"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../lib/hooks/skills";
import { DEFAULT_TYPE, MODAL_WIDTH, SKILL_TYPES } from "./constants";
import { s } from "./styles";

/** Create-skill modal — name / description / type / markdown body. */
export function CreateSkillModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (skill: Skill) => void;
}) {
  const t = useTranslations("skills");
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>(DEFAULT_TYPE);
  const [body, setBody] = React.useState("");

  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));
  const canSubmit = name.trim().length > 0 && body.trim().length > 0 && !create.isPending;

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim(),
      description: description.trim(),
      type,
      body,
      note: "Initial version",
    });
    onCreated(skill);
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("editor.createFromScratch")}
      subtitle={t("config.descriptionHint")}
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
