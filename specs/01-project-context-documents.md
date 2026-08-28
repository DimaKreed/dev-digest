# Spec: Project Context — attach repository markdown documents to agents and skills
Spec ID: SPEC-01
Status: approved

## Problem and user

A reviewer agent in this studio has no access to the project's own written rules. Its knowledge is
the system prompt, its linked skill bodies, the diff, and derived repo facts — so an invariant that
lives in a markdown document in the repository (`specs/public-api.md`, an architecture note, an
insights file) cannot inform a review, and the user has no way to make it do so.

The evidence that this is the intended shape, not a new idea, is that the seam is already built and
dormant: `reviewer-core/src/prompt.ts:149` renders a `## Project context` section from
`PromptParts.specs`, `ReviewInput.specs?: string[]` is threaded through
`reviewer-core/src/review/run.ts:62-63` and `:162`, the trace carries `PromptAssembly.specs`
(`server/src/vendor/shared/contracts/trace.ts:48`) and `RunTrace.specs_read`
(`trace.ts:112`), the trace drawer already renders both
(`client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:39-51`,
`:92-94`), and the `context` i18n namespace exists (`client/messages/en/context.json`). Nothing
populates any of it: `server/src/modules/reviews/run-executor.ts:256` never passes `specs`, and the
trace hardcodes `specs_read: []` (`:376`, `:641`) and `specs: null` (`:635`).

The user is the person configuring an agent in the studio. Today they can attach skills; they cannot
attach the repository's own documents, and no page in the app lists them.

## Goals / Non-goals

**Goals**

- A read-only **Project Context** page listing every markdown document discovered in a repository's
  local clone.
- A `Context` tab in the agent editor and in the skill editor: attach, detach, reorder, filter,
  preview, with the attachment set's token cost shown in place.
- Server-side reading of the attached documents at run time and injection of their **text** into the
  existing `## Project context` prompt section.
- A run trace that names which documents were read, how large each was in tokens, and the reason any
  document was skipped — plus the full injected text, openable from `Prompt assembly`.

**Non-goals**

- **Automatic selection by pull-request content.** The user picks documents by hand; a content-aware
  selector is a separate feature.
- **Editing documents from the studio.** The clone is depth-1 and gets resynced
  (`CLONE_DEPTH = 1`), so writing needs a commit-and-push story this feature does not own.
  `context.json`'s `mode.edit`, `editor.save` and `editor.saving` keys stay unused scaffolding.
- **Indexing, chunking or embedding markdown.** The code indexer cannot see `.md` at all
  (`server/src/modules/repo-intel/constants.ts:14`, enforced at `pipeline/walk.ts:101`), and this
  feature does not extend it. `code_chunks.source = 'docs' | 'spec'`
  (`server/src/db/schema/context.ts:44`) and `IndexStatus.chunks_indexed`
  (`contracts/platform.ts:284`) remain untouched scaffolding — the root `CLAUDE.md` § *Do not touch*
  protects that file.
- **A coverage score.** The design's `78 COVERAGE` ring has no formula anywhere in this repo and is
  not invented here.
- Any contract this spec requires is a **two-package change**: `@devdigest/shared` exists twice
  (`server/src/vendor/shared/`, `client/src/vendor/shared/`), the copies have already diverged, and
  the PR gate blocks a one-sided diff. A new column likewise requires a migration step —
  migrations do not run on boot.
- A second locale. Only `en` exists.

## User stories

- As an agent author, I want to attach my repository's specs to an agent, so that its findings are
  judged against our written invariants instead of generic best practice.
- As a skill author, I want documents attached to a skill, so that every agent using that skill
  inherits them without re-attaching.
- As a reviewer of a run, I want to see exactly which documents were injected, how big each was, and
  the text that went in, so that I can tell a bad review from a bad context set.

## Acceptance criteria (EARS)

### Discovery and the Project Context page

- **AC-01** — The system shall discover a repository's context documents by reading `.md` files
  recursively from that repository's local clone under configured search roots, without consulting
  the code index, an embedding store or the database for file contents.
- **AC-02** — The system shall derive each discovered document's displayed type from which
  configured search root matched it.
- **AC-03** — WHEN the Project Context page is opened for a repository, the system shall list every
  discovered document with its file name, its containing directory and its type.
- **AC-04** — The Project Context page shall offer no create, edit, rename, delete or save
  affordance for any document.
- **AC-05** — WHEN a document is selected on the Project Context page, the system shall render that
  document's markdown read-only.
- **AC-06** — WHILE the document list for a repository is being loaded, the system shall render a
  loading state rather than an empty list.
- **AC-07** — IF no document is discovered for a repository, THEN the system shall render the
  `context` empty state, naming the configured search roots that were searched.
- **AC-08** — IF the document listing fails, THEN the system shall render the `context.loadError`
  state, distinguishable from the empty state of AC-07.
- **AC-09** — The Project Context page shall show, per document, how many agents currently attach it.
- **AC-10** — The Project Context page shall show no indexed-chunk count and no coverage score.

### Attaching in the agent and skill editors

- **AC-11** — WHEN an agent editor is opened, the system shall present a `Context` tab alongside its
  existing tabs.
- **AC-12** — WHEN a skill editor is opened, the system shall present a `Context` tab alongside its
  existing tabs.
- **AC-13** — The `Context` tab shall show, per document row, an attach checkbox, the file name, its
  directory, its type and a preview affordance; in its header, how many of the available documents
  are attached and a text filter input; and in its footer, the attachment set's total token cost and
  the statement that the set is injected as an untrusted `## Project context` block into every run.
- **AC-14** — WHEN the user attaches or detaches a document, the system shall persist the whole
  ordered attachment set for that agent-and-repository, or skill-and-repository, in one request.
- **AC-15** — The system shall identify an attachment by agent-and-repository-and-path, or by
  skill-and-repository-and-path, together with its position in the set, and shall store paths and
  positions only — never document text.
- **AC-16** — WHEN the user reorders an attached document by its drag handle or by ArrowUp/ArrowDown
  on that same handle, the system shall persist the new order; a drag that ends where it started
  shall not write.
- **AC-17** — WHEN the user types in the `Context` tab's filter input, the system shall show only
  the document rows matching that text, leaving the persisted attachment set unchanged.
- **AC-18** — The system shall obtain every token figure shown in the `Context` tab from the
  server-side token counter and render it as an approximation, because that counter degrades
  permanently to a characters-based estimate when its encoder fails to load
  (`server/src/adapters/tokenizer/index.ts:20-39`). The client shall count no tokens itself.
- **AC-19** — The `Context` tab shall be addressable in the URL in the same way the existing editor
  tabs are, so that a reload or a shared link reopens it.

### Reading and injection at run time

- **AC-20** — WHEN an agent run starts for a pull request in a repository, the system shall read the
  text of every document attached to that agent for that repository, and of every document attached
  to each of that agent's enabled linked skills for that repository, from the clone at that moment —
  never from text stored when the attachment was saved.
- **AC-21** — The system shall inject the union of those documents, deduplicated by path, with the
  agent's attachments first in their persisted order followed by each enabled skill's attachments in
  skill order, the earliest position of a duplicated path deciding its place; a document reachable
  twice shall be read once, injected once and listed once.
- **AC-22** — The system shall inject the documents as the existing `## Project context` section,
  each document's text inside its own untrusted delimiter-wrapped block.
- **AC-23** — IF the resolved document set is empty, THEN the system shall omit the
  `## Project context` section, leaving the assembled prompt byte-identical to one assembled with no
  attachments.
- **AC-24** — IF a document is missing, unreadable, or its path resolves outside the repository
  clone, THEN the system shall skip that document from the injected block, continue the run, and
  record that document with the reason it was skipped; it shall not be dropped silently.
- **AC-25** — The system shall inject every attached document verbatim, with no size cap and no
  truncation.
- **AC-26** — IF the model provider rejects the call because the assembled prompt exceeds the
  context window, THEN the run shall fail and its trace shall still carry the list of documents read
  and each one's token size.
- **AC-27** — The system shall assemble the `## Project context` block with no additional model
  call, no embedding pass and no chunking.
- **AC-28** — The system shall pass only resolved document strings into the review engine, keeping
  document reading and token counting outside it, because the engine may touch no filesystem
  (`reviewer-core/CLAUDE.md`, onion rule C5).
- **AC-29** — IF `EMBEDDINGS_ENABLED` or `REPO_INTEL_ENABLED` is false, THEN the system shall
  discover, list and inject attached documents unchanged, because this feature reads the clone
  directly and does not use the indexer.
- **AC-30** — The system shall never place a document path unescaped in a prompt section header or in
  an untrusted block's source label; only wrapped content is escaped
  (`server/src/modules/reviews/intent.ts:305-311`).

### Run trace

- **AC-31** — WHEN a run completes or fails, its trace shall name every document read and, per
  document, its size in tokens.
- **AC-32** — The trace's `Prompt assembly` section shall make the full injected
  `## Project context` text openable and readable through the existing prompt-block affordances.
- **AC-33** — Every new trace field this feature adds shall tolerate its own absence, so a trace
  written before the field existed still parses (`insights.md:81`; `contracts/trace.ts:42-45`).
- **AC-34** — WHEN a run resolves its attached documents, the system shall record in the run log how
  many were read and how many were skipped, in the manner the skills line already does
  (`run-executor.ts:246-250`).

### Non-functional (see `## Non-functional requirements`)

- **AC-35** — The system shall render every user-facing string this feature adds from a next-intl
  namespace, reusing `context` and `runs` and adding a `Context` tab label key to the `agents` and
  `skills` namespaces; `context.empty.body`'s `.devdigest/specs/` wording shall be corrected to the
  configured search roots.
- **AC-36** — The `Context` tab's icon-only drag handle shall carry an accessible name, and that
  same handle shall support ArrowUp/ArrowDown reordering, so ordering is not mouse-only.

### End-to-end acceptance

- **AC-37** — WHEN a document stating an invariant is attached to an agent and that agent reviews a
  pull request violating it, the resulting finding shall cite that document's path in its text, using
  only the existing severity and verdict vocabulary and no new finding field.

### Resolved at the stage-5 gate (2026-08-27) — see open questions 1 and 4

- **AC-39** — The system shall take its search roots as a list of **named directory prefixes**, not
  as a glob, so that each discovered document's displayed type is the label of the root that matched
  it; the shipped default shall be `specs`, `docs`, `insights`, searched recursively, with no
  clone-root entry. (Supersedes the proposed default behind AC-01/AC-02; a glob was rejected because
  AC-02 needs a named matched root to derive the badge from.)
- **AC-40** — IF a discovered document exceeds the configured per-file size limit, THEN the system
  shall still list it, shall mark it not-attachable together with the reason, and shall carry that
  mark from the server so the client needs no knowledge of the limit. This bounds discovery and
  attachment only: AC-25 is unchanged, so a document already attached before it grew past the limit
  is still injected in full.

### Resolved 2026-08-27 — the document type is the root's own name

- **AC-41** — The system shall render a document's displayed type as the **matched search root's own
  directory name**, verbatim, for every configured root rather than mapping it onto a fixed set of
  values; two documents under different configured roots shall therefore never display the same
  type. This supersedes the closed `ContextDocType` vocabulary in both `vendor/shared` copies, so
  the type is carried as data rather than as one of three known values, and the badge text is
  therefore **not** a translated string — the same rule AC-07's interpolated root list already
  follows. Refines AC-02 and AC-39 without replacing either: the type is still derived from the
  matched root, and the roots are still named prefixes.
  *(Reason: the closed enum collapsed every non-default root onto `doc`, so `adr/` and `rfc/` were
  indistinguishable. It was also a deviation from the supplied design, whose badges read `specs`,
  `docs`, `insights` — the directory names, in the plural.)*
  *(Note: the closed-vocabulary rule in the root `CLAUDE.md` governs `Severity` and `Verdict` only;
  `ContextDocType` is not covered by it and widening it trips no gate beyond the two-copy rule.)*

### Resolved 2026-08-27 — search roots match a directory NAME at any depth

- **AC-42** — The system shall treat each configured search root as a **directory name matched at
  any depth** below the clone root, not as a top-level directory path; a document under
  `server/specs/`, `client/docs/` or `packages/x/specs/` shall therefore be discovered by the roots
  `specs` and `docs` without those paths being configured individually. **Supersedes the top-level
  reading of AC-01 and AC-39**; the roots remain a configured list of names, and the shipped default
  is unchanged (`specs`, `docs`, `insights`).
  - **AC-42.1** — The displayed type shall remain the matched directory's **own name**, not its path,
    so a document under `server/specs/` displays `specs`. This keeps AC-41 intact rather than
    reinterpreting it.
  - **AC-42.2** — WHERE a document sits beneath two matching directories, the system shall attribute
    it to the **nearest** one, so `docs/specs/x.md` is a `specs` document.
  - **AC-42.3** — The system shall not descend into a **nested repository** — any directory
    containing a `.git` entry — so a clone that vendors another checkout does not report that
    checkout's documents as its own. This is load-bearing rather than defensive: this very repository
    holds a full clone of itself under `server/clones/`, which a name-matched walk would otherwise
    report twice.
  - **AC-42.4** — The existing excluded-directory list and the per-file size ceiling shall continue
    to apply unchanged, with exactly one addition: the system shall not discover documents under
    the clone's `.devdigest/cache` path, because that is the agent-workflow cache — briefings, plans
    and run ledgers — and offering this workflow's own briefing as attachable "project context" is
    incoherent. The exclusion is that **path**, not the name `.devdigest` and not the name `cache`:
    `.devdigest/specs/` stays discoverable, since it is a convention the product itself proposed
    (`context.json`'s original empty state directed users to put PRDs there) and AC-42 now makes it
    work with no configuration.

  *(Reason: the original requirement was `**/{specs,docs,insights}/**/*.md` — a directory name at any
  depth. AC-39 narrowed it to named top-level prefixes to obtain a badge label, which AC-41 has since
  supplied by other means; the narrowing was an unnoticed cost, and in a repository whose packages
  each carry their own `specs/` and `docs/` it made almost every document undiscoverable.)*

  *(Known and NOT addressed here: `insights` is a **file** — `insights.md`, one per package — in this
  repository, not a directory, so the `insights` root still matches nothing here. Matching file names
  as well as directory names is a separate decision and is recorded in `## Open questions`.)*

### Injection guard (resolved after approval — see open question 3)

- **AC-38** — The injection guard appended to every system prompt shall name attached project
  documents among the untrusted sources it enumerates, and shall do so by wording alone: no keyword
  scanning and no heuristic filtering of document content is introduced
  (`prompt.ts:16-28`; `reviewer-core/CLAUDE.md` forbids heuristic filtering outright). Every prompt
  baseline that asserts guard text shall be updated in the same change.

## Edge cases

- **A document deleted or renamed in the repository after it was attached** — covered by AC-24 at run
  time (skipped, named with a reason). Surfacing it in the editor before a run is open question 10.
- **A repository with no clone** — `repos.clone_path` is nullable
  (`server/src/db/schema/repos.ts:16`) and `conventions/service.ts:130-146` answers `409
  repo_not_indexed` in the same situation. No criterion covers it: open question 11.
- **A resync between saving an attachment and running** changes the injected bytes, by design —
  AC-20 requires the fresh read and AC-31/AC-32 make what was actually injected visible.
- **Two browser tabs reordering the same set** — the whole ordered set is one request (AC-14), which
  makes it last-write-wins, as `POST /agents/:id/skills` already is
  (`server/src/modules/agents/routes.ts:152-165`). No criterion states what the losing tab observes:
  open question 12.
- **A partial write while persisting a set** — `server/` has exactly one `.transaction(` call today,
  so a multi-write sequence is presumed non-atomic. No criterion states what a reader observes when
  the first write lands and the second fails: open question 13.
- **The API returning an unexpected shape** — no criterion covers it, and that is acceptable here:
  `@devdigest/shared` is types-only on the client and a runtime import breaks the Next build, so
  there is no client-side validation anywhere in this app to be consistent with. Adding one for this
  feature alone would specify infrastructure that does not exist.
- **Bad request bodies** — server validation is schema-first and rejects with **422 before the
  handler runs**; no criterion here composes a different status or message for invalid input.
- **A large attachment set** — bounded only by AC-25 (no cap) and AC-26 (the run fails at the
  provider). Discovery-side limits are open question 4.

## Non-functional requirements

Worked in the five areas of `.claude/skills/spec-creator/references/nfr-checklist.md`:

- **Internationalisation — convention exists ⇒ criterion.** AC-35.
- **Accessibility — partial convention ⇒ one criterion.** AC-36 covers the two of the five rules in
  `.claude/skills/react-best-practices/SKILL.md:145-151` that this surface has (icon-only button
  name, non-mouse reordering), already repo practice at
  `.../AgentEditor/_components/SkillsTab/SkillsTab.tsx:67-73`, `:129-137`. No conformance level is
  claimed: open question 7.
- **Performance — no budget exists in this repository ⇒ shape, not thresholds.** AC-27 and AC-01
  state the verifiable shape (no model call, no embedding, no chunking, a direct filesystem read).
  Two facts that may be cited but are not targets: the Postgres pool is ~10, and `p-queue` governs
  fan-out to external services. A latency or volume number is open question 14.
- **Observability — narrow criteria only, because the user asked for them.** AC-24, AC-31, AC-32 and
  AC-34. This feature deliberately does the opposite of the adjacent precedent, where grounding drops
  ungrounded findings silently (`server/CLAUDE.md:73-74`). No required-log-events list, correlation-id
  rule or redaction policy exists in this repo: open question 15.
- **Error copy and empty states — de facto pattern ⇒ criteria.** AC-06, AC-07, AC-08 require the
  three states explicitly, because this app has no `loading.tsx`, `error.tsx` or `not-found.tsx` and
  those states are therefore not free. The exact wording of new copy — a skipped-document reason and
  the corrected `context.empty.body` — is open question 16.

## Inputs and provenance

| Input | Producer / owner | Absent or stale |
|---|---|---|
| Document list for a repository | **server**, from a recursive `.md` read of the local clone at `<cloneDir>/<owner>/<repo>`, default `~/.devdigest/workspace` (`server/src/platform/config.ts:66-68`, `adapters/git/simple-git.ts:37-39`) | Empty ⇒ AC-07; failed ⇒ AC-08; no clone ⇒ open question 11 |
| Document text at run time | **server**, read per run through the clone-contained read primitive that `realpath`s both sides and throws `path escapes the repo clone` (`adapters/git/simple-git.ts:140-147`); precedent for prompt-building through it at `modules/conventions/service.ts:335` | Missing / unreadable / escaping ⇒ AC-24 |
| Configured search roots | **server** configuration; the type badge derives from the matched root (AC-02) | Key and default: open question 1 |
| Attachment set (paths + order) | **server** persistence, keyed per AC-15; written as one ordered set per AC-14 | Empty ⇒ AC-23 (section omitted) |
| Token figures | **server**, `container.tokenizer` (`adapters/tokenizer/index.ts:16-24`) — the same producer as `Skill.tokens`, whose contract note states *"counted server-side. The client has no tokenizer"* (`contracts/knowledge.ts:138-139`) | Encoder load failure ⇒ permanent characters-based estimate ⇒ AC-18's approximation |
| Injected document strings | **server → reviewer-core**, as `ReviewInput.specs?: string[]` (`reviewer-core/src/review/run.ts:62-63`), rendered as `## Project context` (`prompt.ts:113-116`, `:149`) | Undefined/empty ⇒ section omitted (AC-23) |
| Trace record | **server → client**, `RunTrace.specs_read` and `PromptAssembly.specs` in `contracts/trace.ts:48`, `:112`; consumed by `TraceBody.tsx:39-51`, `:92-94` | New fields must be absence-tolerant (AC-33) |
| Client-side reads | **client**, through hooks over `src/lib/api.ts`; `useContextFiles` / `useReindexContext` already exist, marked *"safe to call once API exposes it"* (`client/src/lib/hooks/core.ts:122-137`) | Types only, no runtime validation — see `## Edge cases` |

Criteria naming a contract are written against the **canonical** copy in
`server/src/vendor/shared/`; the client copy has already diverged and must be edited alongside it.

## Untrusted inputs

- **Every attached document's text** is repository content, therefore attacker-controlled in the
  general case, therefore data and never instructions. AC-22 requires it inside untrusted delimiter
  blocks, which is what the existing section already does (`prompt.ts:113-116`), and the shared
  `INJECTION_GUARD` (`prompt.ts:16-28`) is what tells the model those blocks are data. Whether that
  guard's enumeration of sources is amended to name attached documents is open question 3.
- **Every document path** is repository-derived. AC-30 forbids placing it unescaped in a section
  header or a source label, because the wrapper escapes only what it wraps
  (`intent.ts:305-311`), and AC-24 requires a path resolving outside the clone to be skipped — the
  read primitive's docblock spells out the symlink attack this prevents, a `docs/plan.md` symlink to
  `~/.devdigest/secrets.json` (`simple-git.ts:129-147`).
- **Rendered markdown previews** (page and tab) display repository content in the studio; the
  content is data to display, never instructions, and never markup that executes.
- **The pull-request diff, title and description** remain untrusted as they are today; this feature
  does not change their handling.

## Open questions

1. **The exact configuration key and its default value for the reader's search roots.** Proposed
   default: `**/{specs,docs,insights}/**/*.md`. **User or `implementation-planner`.** Blocks the
   stated default behind AC-01 and AC-02, not the criteria themselves.
2. **Does the `Context` tab show a repository selector, or silently follow the repository selected in
   the sidebar?** The keying is settled (AC-15); the affordance is not, and it decides what the tab
   shows when no repository is selected. The design shows no selector. **User.** Blocks AC-11/AC-12
   completeness.
3. ~~**Whether `INJECTION_GUARD` is amended** to name attached project documents among its untrusted
   sources.~~ **Resolved 2026-08-27 by the user at the stage-1 gate: amend it.** Now stated as
   **AC-38**. Kept here as a numbered entry so the remaining numbering is stable; the criterion, not
   this entry, is what downstream cites.
4. **Discovery limits.** `MAX_INDEXED_FILES = 5000` and `MAX_FILE_SIZE = 400 * 1024`
   (`repo-intel/constants.ts:42-43`) govern the code indexer and do not apply to this reader.
   Proposed default: reuse the 400 KB per-file limit for discovery, no cap on document count. Note
   `.gitignore` is not honored by the existing walker (`pipeline/walk.ts:15-18`) and symlinks are
   never followed (`:89`). **`implementation-planner`.** Blocks AC-01's bounds.
5. **`POST /repos/:id/context/reindex`.** `useReindexContext` already calls it and `context.json`
   already carries `reindex` / `indexing` / `resync` / `resyncing`. Does the route stay unbuilt, or
   does it mean *rescan the document list* rather than an embedding pass? **User.** Blocks whether
   those i18n keys stay scaffolding.
6. **Confirm `IndexStatus.chunks_indexed` and `code_chunks.source = 'docs' | 'spec'` remain untouched
   scaffolding.** Stated as a non-goal here; the root `CLAUDE.md` § *Do not touch* and the PR gate
   both protect them, so no work item may remove either. **`implementation-planner`.**
7. **A WCAG conformance level.** None exists in this repository. Proposed default: only the five
   rules in `react-best-practices/SKILL.md:145-151` apply and no level is claimed. **User.** Blocks
   nothing but the scope of AC-36.
8. *(none — reserved so 1–7 keep the briefing's numbering)*
9. *(none — reserved)*
10. **A row whose path no longer resolves in the clone.** Proposed: mark it in the `Context` tab so
    the user learns it there rather than from a failed run's trace. Not confirmed, so no criterion.
    **User.**
11. **A repository with no local clone.** What the Project Context page and the `Context` tab show,
    and what the listing request answers. Nearest precedent: `409 repo_not_indexed`
    (`conventions/service.ts:130-146`). **User.** Blocks the page's third state.
12. **Concurrent reorder from two browser tabs.** Last-write-wins follows from AC-14, but what the
    losing tab observes — a silent overwrite, a refetch, a conflict — is undesigned. **User.**
13. **Atomicity of persisting an attachment set.** What a reader observes if the first write lands
    and the second fails. Proposed default: state an atomicity requirement rather than ship the
    partial set. **User, then `implementation-planner`.**
14. **A performance figure of any kind** for discovery or per-run reading. None exists in this repo;
    proposed default: no numeric budget, AC-27's shape only. **User.**
15. **An observability policy** beyond AC-31/AC-34 — required log events, redaction of document
    content in logs, correlation ids. None exists in this repo. Proposed default: none added.
    **User.**
16. **Exact copy** for a skipped-document reason, for the corrected `context.empty.body`, and for the
    two new tab labels. Proposed shape: follow `common.repoNotFound.{title,body,cta}` — short title,
    body saying why, a call to action. **User.** Blocks which keys get created.
17. **A token count on the trace's `## Project context` prompt block itself**, as `skills` already
    has (`TraceBody.tsx:83`, `PromptAssembly.skills_tokens`). Per-document sizes are required
    (AC-31); a block total is a proposal. **User.**
