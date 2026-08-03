"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Drawer,
  FormField,
  Icon,
  Markdown,
  SelectInput,
  TextInput,
} from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useCreateSkill, useImportSkillPreview } from "../../../../lib/hooks/skills";
import { useToast } from "../../../../lib/toast";
import { ApiError } from "../../../../lib/api";
import { SKILL_TYPES } from "../CreateSkillModal/constants";
import { ACCEPTED_EXTENSIONS, DRAWER_WIDTH } from "./constants";
import { s } from "./styles";

/**
 * Import a skill from a .md file or a .zip archive.
 *
 * Two properties this flow exists to demonstrate:
 *  1. Nothing is written until "Save skill" — the preview endpoint performs no
 *     writes at all, so an import cannot quietly land in an agent's prompt.
 *  2. Executable entries in an archive are never read or run; they are listed
 *     here as skipped so the user can see exactly what was ignored.
 */
export function ImportSkillDrawer({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (skill: Skill) => void;
}) {
  const t = useTranslations("skills");
  const toast = useToast();
  const preview = useImportSkillPreview();
  const create = useCreateSkill();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");

  const data = preview.data;
  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const choose = (file: File | undefined) => {
    if (!file) return;
    preview.mutate(file, {
      onSuccess: (p) => {
        setName(p.name);
        setType(p.type);
      },
    });
  };

  const save = async () => {
    if (!data) return;
    const skill = await create.mutateAsync({
      name: name.trim() || data.name,
      description: data.description,
      type,
      source: "imported_file",
      body: data.body,
      // Imported skills arrive DISABLED. Enabling someone else's instructions
      // is a deliberate act taken after reading the body.
      enabled: false,
      note: `Imported from ${data.source_file}`,
    });
    toast.success(t("import.saved", { name: skill.name }));
    onSaved(skill);
  };

  return (
    <Drawer
      width={DRAWER_WIDTH}
      title={t("import.title")}
      subtitle={t("import.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Check"
            onClick={save}
            disabled={!data || create.isPending}
          >
            {create.isPending ? t("import.saving") : t("import.save")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(e.dataTransfer.files[0]);
          }}
          style={s.dropzone(dragging)}
        >
          <Icon.Upload size={22} />
          <span>{preview.isPending ? t("import.choosing") : t("import.dropzone")}</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          hidden
          onChange={(e) => choose(e.target.files?.[0])}
        />

        {preview.isError && (
          <span style={s.error}>
            {preview.error instanceof ApiError
              ? preview.error.message
              : t("import.failed")}
          </span>
        )}

        {data && (
          <>
            <div style={s.extracted}>
              <Icon.Check size={14} />
              <span>{t("import.extracted", { file: data.source_file })}</span>
              <span className="tnum" style={s.tokens}>
                {t("config.tokens", { count: data.tokens })}
              </span>
            </div>

            {data.skipped.length > 0 && (
              <div style={s.skippedBox}>
                <div style={s.skippedTitle}>
                  <Icon.AlertTriangle size={14} />
                  {t("import.skippedTitle", { count: data.skipped.length })}
                </div>
                {data.skipped.map((sk) => (
                  <div key={sk.path} style={s.skippedRow}>
                    <span className="mono" style={s.skippedPath}>
                      {sk.path}
                    </span>
                    <span>— {t(`import.skipReason.${sk.reason}`)}</span>
                  </div>
                ))}
              </div>
            )}

            <FormField label={t("import.nameLabel")} required>
              <TextInput value={name} onChange={setName} mono />
            </FormField>
            <FormField label={t("import.typeLabel")}>
              <SelectInput
                value={type}
                onChange={(v) => setType(v as SkillType)}
                options={typeOptions}
              />
            </FormField>

            <FormField label={t("previewTab.title")}>
              <div style={s.previewBox}>
                <Markdown>{data.body}</Markdown>
              </div>
            </FormField>

            <div style={s.warning}>
              <Icon.Shield size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{t("import.trustWarning")}</span>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
