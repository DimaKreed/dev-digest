# Hooks

Deterministic enforcement for the [pr-self-review](../skills/pr-self-review/SKILL.md) skill.
Registered in [../settings.json](../settings.json) as a `PreToolUse` hook on `Bash|PowerShell`.

| File | Role |
|---|---|
| [pr-review-scope.ps1](pr-review-scope.ps1) | the **single** implementation of PR scope + content fingerprint. Called by the skill *and* by the gate |
| [pr-gate.ps1](pr-gate.ps1) | denies `gh pr create` / `gh pr ready` / `gh pr merge` unless a fresh, CRITICAL-free report exists |

The split matters. The reviewing is model work and lives in the skill; the blocking is a 15-row
decision table with no model in it, so a pass or a block is reproducible.

## Why one fingerprint implementation

PowerShell native-to-native pipes are not byte-transparent. Measured in this repo:

```
git diff HEAD | git hash-object --stdin
  Git Bash   -> 2b9068a1...
  PowerShell -> 70f6e8b0...      # same tree
```

PowerShell decodes the stream to strings and re-emits CRLF. Any stream-hashing fingerprint therefore
has two implementations that silently disagree, and the failure mode is *the gate blocks forever and
nobody can see why*. So the fingerprint is built from git **blob ids** only — all inputs are 40-char
ASCII — and both callers invoke the same script. Do not reimplement it in Bash.

`git hash-object <path>` applies the attributes clean filter, so with `core.autocrlf=true` a
line-ending rewrite yields an identical blob. Verified: LF and CRLF inputs both hash to
`5abde00f...`.

## Two properties worth knowing

**Committing does not invalidate a review.** `branch` and `headSha` are deliberately outside the
hash. Committing moves a path from the worktree column of the manifest to the HEAD column with the
same blob sha, so `review → switch -c → commit → push → gh pr create` passes on one review.
Verified against 80 unmodified files: worktree blob == HEAD blob, zero mismatches. `baseSha` *is*
hashed — if a fetch moves `origin/main`, the PR diff genuinely changed and re-review is correct.

**`insights.md` is excluded, on purpose.** Root `CLAUDE.md` mandates `/engineering-insights` at
end-of-task, which writes `insights.md` *between* the review and `gh pr create`. Without the
exemption the gate would false-block on the repo's own documented workflow. The exclude list is
itself hashed, and the gate rejects a report declaring a different one, so this hole cannot be
widened by whatever writes the report.

## The report lives in a gitignored directory, and must stay there

`.devdigest/cache/pr-self-review/report.json` — covered by `.devdigest/cache/` in `.gitignore`.
This is not tidiness. Untracked files are part of the fingerprint, so a report visible to
`git ls-files --others --exclude-standard` would change the fingerprint that authorises it: the gate
would nullify itself the instant it wrote its own verdict.

## Override

```powershell
$env:DEVDIGEST_PR_GATE = 'off'   # in your own shell, then restart Claude Code
```

Read from the parent environment only — the one channel the agent cannot write for the hook's own
process. Setting it inside a tool call affects only that tool's child process, so the gate denies
the attempt explicitly rather than letting a silent no-op look like success. A marker file was
rejected for the same reason: the agent could create it in one call and lift its own gate.

`DEVDIGEST_PR_GATE_MAX_AGE_HOURS` (default 24) is read the same way.

## Limits

- A `PreToolUse` hook constrains **the agent, not a human**. Anyone can run `gh pr create` in their
  own terminal. Note that the user's global `guard-bash.ps1` already denies `git push` for the
  agent, so the realistic flow *is* a human pushing from their own shell — one command from opening
  the PR themselves. The honest claim is "the agent cannot autonomously open a PR". Real enforcement
  is branch protection plus a required check.
- The report is **forgeable** by anything that can write the file and run the scope script. Quality
  gate, not security control.
- **Windows/PowerShell only.** On macOS/Linux `powershell` is absent, the hook command exits
  non-zero with no stdout, Claude Code reports a non-blocking hook error, and the gate is simply
  absent. That matches the script's own philosophy — it fails open when the gate itself is broken,
  because a quality gate that can permanently wedge a session is worse than one that can be missing.
  A `pr-gate.sh` port must call the same blob-manifest algorithm, **not** `git diff | sha256sum`.
- MCP GitHub tools and the GitHub web UI are unmatched — the matcher is `Bash|PowerShell` and MCP
  tool inputs carry no `command` field.
- The hook adds roughly 200 ms to every Bash call (PowerShell process startup). The fingerprint
  itself, ~25 ms/file, is only paid once a PR command actually matches.

## Composition

Hook configs from user, project and local settings all contribute; every matching entry runs and any
`deny` wins, so order is irrelevant. This adds a third `Bash` hook alongside the user's global
`guard-bash.ps1` and `rtk hook claude`, and changes neither.
