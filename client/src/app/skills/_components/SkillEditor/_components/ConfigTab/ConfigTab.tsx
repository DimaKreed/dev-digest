"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Icon, SelectInput, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { SKILL_TYPES } from "../../../CreateSkillModal/constants";
import { s } from "./styles";

/** Config tab — name / description / type / markdown body + enabled toggle. */
export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [note, setNote] = React.useState("");
  const [enabled, setEnabled] = React.useState(skill.enabled);

  // Reset the local form when switching skills.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setNote("");
    setEnabled(skill.enabled);
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const bodyDirty = body !== skill.body;
  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const save = () =>
    update.mutate(
      {
        id: skill.id,
        patch: {
          name,
          description,
          type,
          body,
          enabled,
          // Only meaningful when the body changed — that's the only edit that
          // creates a version to attach the note to.
          ...(bodyDirty && note.trim() ? { note: note.trim() } : {}),
        },
      },
      {
        onSuccess: (data) => {
          setNote("");
          toast.success(t("config.savedToast", { version: data.version }));
        },
      },
    );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <Badge color="var(--text-muted)" icon="Eye" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
        <label style={s.enabledLabel}>
          {t("config.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>

      <FormField label={t("config.name")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>

      {/* The description is the skill's interface — the hint says so explicitly,
          because a vague description is what makes an agent misapply a skill. */}
      <FormField label={t("config.description")} hint={t("config.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>

      <FormField label={t("config.type")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={typeOptions}
        />
      </FormField>

      <FormField label={t("config.body")} hint={t("config.bodyHint")} required>
        <div>
          <div style={s.bodyHead}>
            <Icon.FileText size={13} />
            <span className="mono" style={s.bodyFile}>
              {skill.name}.md
            </span>
            {bodyDirty && <Badge color="var(--warning)">{t("config.unsaved")}</Badge>}
            {/* Counted server-side (the client has no tokenizer), so while the
                body is dirty this is the SAVED body's cost, not the draft's. */}
            <span className="tnum" style={s.bodyTokens}>
              {t("config.tokens", { count: skill.tokens })}
            </span>
          </div>
          <Textarea
            value={body}
            onChange={setBody}
            rows={20}
            mono
            placeholder={t("config.bodyPlaceholder")}
          />
        </div>
      </FormField>

      {bodyDirty && (
        <FormField label={t("config.noteLabel")} hint={t("config.noteHint")}>
          <TextInput
            value={note}
            onChange={setNote}
            placeholder={t("config.notePlaceholder")}
          />
        </FormField>
      )}

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
        {update.isSuccess && (
          <span style={s.savedNote}>
            {t("config.saved", { version: update.data?.version ?? skill.version })}
          </span>
        )}
      </div>
    </div>
  );
}
