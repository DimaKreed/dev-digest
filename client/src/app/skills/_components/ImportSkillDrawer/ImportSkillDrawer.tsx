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
  Tabs,
  TextInput,
} from "@devdigest/ui";
import type { Skill, SkillImportPreview, SkillType } from "@devdigest/shared";
import {
  useCreateSkill,
  useImportSkillFromUrl,
  useImportSkillPreview,
} from "../../../../lib/hooks/skills";
import { useToast } from "../../../../lib/toast";
import { ApiError } from "../../../../lib/api";
import { SKILL_TYPES } from "../../../../lib/skill-types";
import { SafetyVerdict } from "./_components/SafetyVerdict";
import { ACCEPTED_EXTENSIONS, DRAWER_WIDTH, IMPORT_TABS, type ImportTab } from "./constants";
import { s } from "./styles";

/**
 * Import a skill from a .md/.zip file or from a URL.
 *
 * Three properties this flow exists to demonstrate:
 *  1. Nothing is written until "Save skill" — both preview endpoints perform no
 *     writes at all, so an import cannot quietly land in an agent's prompt.
 *  2. Executable entries in an archive are never read or run; they are listed
 *     here as skipped so the user can see exactly what was ignored.
 *  3. The body is classified for prompt injection before it is offered for
 *     saving — and when it could NOT be classified, the drawer says so rather
 *     than leaving the absence of a warning to read as approval.
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
  const filePreview = useImportSkillPreview();
  const urlPreview = useImportSkillFromUrl();
  const create = useCreateSkill();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const [tab, setTab] = React.useState<ImportTab>("file");
  const [dragging, setDragging] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [acknowledged, setAcknowledged] = React.useState(false);

  // One preview at a time, owned by the active tab: switching tabs must not
  // show the file body next to a URL you just typed.
  const active = tab === "file" ? filePreview : urlPreview;
  const data: SkillImportPreview | undefined = active.data;
  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const adopt = (p: SkillImportPreview) => {
    setName(p.name);
    setType(p.type);
    setAcknowledged(false);
  };

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    filePreview.mutate(file, { onSuccess: adopt });
  };

  const fetchUrl = () => {
    if (!url.trim()) return;
    urlPreview.mutate(url, { onSuccess: adopt });
  };

  const switchTab = (next: string) => {
    setTab(next as ImportTab);
    setAcknowledged(false);
  };

  // An `unsafe` verdict means the model found an instruction aimed at the
  // reviewing agent. Saving stays possible — the user may know better than the
  // classifier — but only as a deliberate act.
  const blockedUnsafe = data?.safety?.verdict === "unsafe" && !acknowledged;
  const canSave = !!data && !create.isPending && !blockedUnsafe;

  const save = async () => {
    if (!data || blockedUnsafe) return;
    const skill = await create.mutateAsync({
      name: name.trim() || data.name,
      description: data.description,
      type,
      source: tab === "url" ? "imported_url" : "imported_file",
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
          {blockedUnsafe && <span style={s.gateHint}>{t("import.safety.unsafeBlocked")}</span>}
          <Button kind="ghost" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          <Button kind="primary" icon="Check" onClick={save} disabled={!canSave}>
            {create.isPending ? t("import.saving") : t("import.save")}
          </Button>
        </div>
      }
    >
      <Tabs
        tabs={IMPORT_TABS.map((k) => ({ key: k, label: t(`import.tabs.${k}`) }))}
        value={tab}
        onChange={switchTab}
        pad="0"
      />

      <div style={s.body}>
        {tab === "file" ? (
          <>
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
                chooseFile(e.dataTransfer.files[0]);
              }}
              style={s.dropzone(dragging)}
            >
              <Icon.Upload size={22} />
              <span>{filePreview.isPending ? t("import.choosing") : t("import.dropzone")}</span>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              hidden
              onChange={(e) => chooseFile(e.target.files?.[0])}
            />
          </>
        ) : (
          <FormField label={t("import.url.label")} hint={t("import.url.hint")}>
            <div style={s.urlRow}>
              <div style={s.urlInput}>
                <TextInput
                  value={url}
                  onChange={setUrl}
                  placeholder={t("import.url.placeholder")}
                  mono
                />
              </div>
              <Button
                kind="secondary"
                icon="Globe"
                onClick={fetchUrl}
                disabled={!url.trim() || urlPreview.isPending}
              >
                {urlPreview.isPending ? t("import.url.fetching") : t("import.url.fetch")}
              </Button>
            </div>
          </FormField>
        )}

        {active.isError && (
          <span style={s.error}>
            {active.error instanceof ApiError ? active.error.message : t("import.failed")}
          </span>
        )}

        {data && (
          <>
            <div style={s.extracted}>
              <Icon.Check size={14} />
              <span>
                {tab === "url"
                  ? t("import.url.fetched", { file: data.source_file })
                  : t("import.extracted", { file: data.source_file })}
              </span>
              <span className="tnum" style={s.tokens}>
                {t("config.tokens", { count: data.tokens })}
              </span>
            </div>

            <SafetyVerdict
              verdict={data.safety}
              acknowledged={acknowledged}
              onAcknowledge={setAcknowledged}
            />

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
