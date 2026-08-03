# Skill samples

Importable fixtures for the Skills Lab import flow (`Add Skill → Import from file`).

| Sample | Demonstrates |
|---|---|
| [`flaky-test-detector/`](./flaky-test-detector/) | A skill packaged as a folder: `SKILL.md` plus a `scripts/detect.sh` that the importer must refuse to read. |

## Building the archive

The `.zip` is not committed — build it from the folder:

```bash
node scripts/make-skill-sample.mjs flaky-test-detector
# → docs/skill-samples/flaky-test-detector.zip
```

(Node + `fflate`, not the `zip` binary, so it works on Windows too.)

Then import that file in the UI. The preview should show:

- `SKILL.md` extracted, with its token count;
- `scripts/detect.sh` listed as **skipped (executable)**.

Nothing is written to the database until you press **Save skill** — the preview
endpoint (`POST /skills/import/preview`) performs no writes at all.

## Why this matters

An imported skill is someone else's instructions running inside your agent's
prompt. Two properties make that safe enough to demo:

1. **Executables are never read.** The archive filter admits `.md` and nothing
   else, so `scripts/detect.sh` is not decompressed, not stored, and not run.
2. **Imported skills arrive disabled.** Enabling one is a deliberate act taken
   after reading the body — see `SkillSource = 'imported_file'` handling in
   `server/src/modules/skills/`.
