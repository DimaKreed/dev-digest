# devdigest-conventions

A Claude Code plugin that ships the coding conventions DevDigest extracted from a
repository, as an installable skill.

## Contents

| Path | What it is |
| --- | --- |
| `.claude-plugin/plugin.json` | Plugin manifest, version `1.0.0` |
| `skills/dev-digest-conventions/SKILL.md` | The convention skill for `DimaKreed/dev-digest` |

Once installed, the skill is available as `/dev-digest-conventions`, and Claude invokes
it on its own when a task matches its description.

> The bundled `SKILL.md` is **real extractor output**, written straight from
> `GET /repos/:id/conventions/plugin`: three accepted rules, each carrying the `file:line`
> it was verified at. Re-export rather than hand-editing it.
>
> The subject is `dev-digest` rather than the demo repo `acme/payments-api` because the
> extractor can only run where it can read code: it samples ranked files from a **clone** and
> re-reads every cited anchor out of that clone before a rule is persisted. `acme/payments-api`
> is seeded from PR patches with no clone and no index, so a scan there returns
> `409 repo_not_indexed` by design.

## Install

The marketplace manifest lives at `.claude-plugin/marketplace.json` in the root of this
repository, so this repo *is* the marketplace. From inside Claude Code:

```
/plugin marketplace add DimaKreed/dev-digest
/plugin install devdigest-conventions@devdigest
```

Or from a local clone, pointing at the checkout directory rather than the manifest file:

```
/plugin marketplace add /path/to/dev-digest
/plugin install devdigest-conventions@devdigest
```

The same two commands work outside a session as `claude plugin marketplace add ...` and
`claude plugin install ...`. Pull later changes with `/plugin marketplace update devdigest`;
because `plugin.json` pins `version`, users only receive updates when that field is bumped.

## Provenance

The rules are not a wishlist. DevDigest mines candidate conventions from the repository's
own code, then verifies each candidate against real occurrences — a concrete file and
line — before it is accepted. Candidates that fail verification are rejected and never
reach the skill, so every rule in `SKILL.md` is one the codebase demonstrably already
follows. Accepted rules are merged into a single skill named after the repository.
