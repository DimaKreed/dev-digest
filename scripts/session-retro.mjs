#!/usr/bin/env node
// session-retro.mjs — read-only metrics for a finished multi-agent run.
//
// Streams a Claude Code session transcript and emits the run's skeleton: every agent launch in
// order, its type, resolved model, description and prompt size, plus main-session token usage.
// Owned by the `workflow-retro` skill (.claude/skills/workflow-retro/SKILL.md), which is manual-only.
//
//   node scripts/session-retro.mjs [--json|--table] [--session <id>] [--project <dir>] [--usage <file>]
//
// Writes nothing. Prints the report to stdout, diagnostics to stderr.
//
// Why streaming is not optional: transcripts reach megabytes on single lines, and a readFileSync
// or grep pass over them times out. Never buffer the whole file.
//
// WHAT IS NOT ON DISK — the constraint that shapes this whole script. An agent's completion
// notification carries subagent_tokens, tool_uses and duration_ms, but that notification is
// injected into the caller's live context and is NEVER written to the transcript (verified: zero
// `<task-notification>` lines in a session that received three). Its own transcript under
// tasks/*.output is 0 bytes, and there are no isSidechain lines. So per-agent cost is observable
// *live, at completion, once* — and unrecoverable afterwards.
//
// Hence --usage: the skill transcribes the figures from the completion notifications in its own
// context into a small JSON file, and this script merges them so the derived numbers (concurrency,
// parallelism ratio) are computed one way in one place. Without it, those fields stay null rather
// than being estimated.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

function parseArgs(argv) {
  const out = { format: 'json', session: null, project: null, usage: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') out.format = 'json'
    else if (a === '--table') out.format = 'table'
    else if (a === '--session') out.session = argv[++i]
    else if (a === '--project') out.project = argv[++i]
    else if (a === '--usage') out.usage = argv[++i]
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`unknown argument: ${a}`)
  }
  return out
}

const USAGE = `session-retro — run skeleton and cost for a finished multi-agent run

  node scripts/session-retro.mjs [--json|--table] [--session <id>] [--project <dir>] [--usage <file>]

  --json            machine-readable output (default)
  --table           human summary
  --session <id>    a specific session id; default is the most recently modified transcript
  --project <dir>   the projects/<slug> directory, if slug derivation picks the wrong one
  --usage <file>    JSON of per-agent figures taken from the completion notifications, which are
                    not persisted in the transcript. Either shape:

                      { "a5c06e2329179dd78": { "tokens": 63768, "toolUses": 13, "durationMs": 149695 } }
                      [ { "seq": 1, "tokens": 63768, "toolUses": 13, "durationMs": 149695 } ]

                    Keys are the agentId the Agent tool returned, or the 1-based launch seq.
                    Anything omitted stays null. Never fill this in from memory or estimate.
`

/** Claude Code names a project directory after its cwd, with every non-alphanumeric character collapsed. */
function projectSlug(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

function resolveProjectDir(explicit, cwd) {
  if (explicit) return explicit
  const root = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects')
  const slug = projectSlug(cwd)
  // Windows reports the drive letter in either case, and the directory was created from whichever
  // casing was in play at the time. Try the derived form, then a lowercased one.
  for (const candidate of [slug, slug.toLowerCase()]) {
    const dir = path.join(root, candidate)
    if (fs.existsSync(dir)) return dir
  }
  throw new Error(`no transcript directory for this project under ${root} (tried slug "${slug}")`)
}

function resolveTranscript(projectDir, session) {
  if (session) {
    const file = path.join(projectDir, `${session}.jsonl`)
    if (!fs.existsSync(file)) throw new Error(`no transcript for session ${session} at ${file}`)
    return file
  }
  const files = fs
    .readdirSync(projectDir)
    .filter((n) => n.endsWith('.jsonl'))
    .map((n) => {
      const full = path.join(projectDir, n)
      return { full, mtime: fs.statSync(full).mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
  if (files.length === 0) throw new Error(`no .jsonl transcripts in ${projectDir}`)
  return files[0].full
}

function loadUsage(file) {
  if (!file) return { byAgentId: new Map(), bySeq: new Map(), provided: false }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const byAgentId = new Map()
  const bySeq = new Map()
  const take = (o) => ({
    tokens: o.tokens ?? null,
    toolUses: o.toolUses ?? null,
    durationMs: o.durationMs ?? null,
    status: o.status ?? null,
  })
  if (Array.isArray(raw)) {
    for (const e of raw) {
      if (e.agentId) byAgentId.set(e.agentId, take(e))
      else if (e.seq !== undefined) bySeq.set(Number(e.seq), take(e))
    }
  } else {
    for (const [k, v] of Object.entries(raw)) {
      if (/^\d+$/.test(k)) bySeq.set(Number(k), take(v))
      else byAgentId.set(k, take(v))
    }
  }
  return { byAgentId, bySeq, provided: true }
}

async function scan(file) {
  const launches = []
  const skills = []
  const workflows = []
  const mainToolCalls = {}
  const resultByToolUseId = new Map()
  const main = { turns: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  const meta = { sessionId: null, gitBranch: null, cwd: null, version: null, firstTs: null, lastTs: null }
  let lines = 0
  let unparsable = 0

  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })

  for await (const line of rl) {
    lines++
    if (!line.trim()) continue
    let o
    try {
      o = JSON.parse(line)
    } catch {
      unparsable++
      continue
    }

    if (o.sessionId) meta.sessionId ??= o.sessionId
    if (o.gitBranch) meta.gitBranch ??= o.gitBranch
    if (o.cwd) meta.cwd ??= o.cwd
    if (o.version) meta.version ??= o.version
    if (o.timestamp) {
      meta.firstTs ??= o.timestamp
      meta.lastTs = o.timestamp
    }

    // Subagent turns would land here if the build recorded them. It does not, but exclude them
    // anyway so main-session totals stay correct if that ever changes.
    if (o.isSidechain) continue

    const usage = o.message?.usage
    if (usage) {
      main.turns++
      main.input += usage.input_tokens ?? 0
      main.output += usage.output_tokens ?? 0
      main.cacheRead += usage.cache_read_input_tokens ?? 0
      main.cacheCreation += usage.cache_creation_input_tokens ?? 0
    }

    // The Agent tool's result is the only place agentId and resolvedModel appear.
    const tur = o.toolUseResult
    if (tur && typeof tur === 'object' && tur.agentId) {
      const content = o.message?.content
      const id = Array.isArray(content) ? content.find((b) => b?.type === 'tool_result')?.tool_use_id : null
      if (id) {
        resultByToolUseId.set(id, {
          agentId: tur.agentId,
          resolvedModel: tur.resolvedModel ?? null,
          outputFile: tur.outputFile ?? null,
          launchStatus: tur.status ?? null,
        })
      }
    }

    const content = o.message?.content
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (b?.type !== 'tool_use' || !b.name) continue
      if (b.name === 'Agent') {
        launches.push({
          seq: launches.length + 1,
          toolUseId: b.id ?? null,
          agent: b.input?.subagent_type ?? 'general-purpose',
          description: b.input?.description ?? null,
          promptChars: typeof b.input?.prompt === 'string' ? b.input.prompt.length : null,
          requestedModel: b.input?.model ?? null,
          isolation: b.input?.isolation ?? null,
          launchedAt: o.timestamp ?? null,
          // Blocks emitted in one assistant turn get distinct `uuid`s but share the message id.
          // Grouping on uuid silently reports every parallel fan-out as serial.
          messageId: o.message?.id ?? o.requestId ?? null,
        })
      } else if (b.name === 'Skill') {
        skills.push({ skill: b.input?.skill ?? null, at: o.timestamp ?? null })
      } else if (b.name === 'Workflow') {
        workflows.push({ name: b.input?.name ?? null, at: o.timestamp ?? null })
      } else {
        mainToolCalls[b.name] = (mainToolCalls[b.name] ?? 0) + 1
      }
    }
  }

  return { launches, skills, workflows, mainToolCalls, resultByToolUseId, main, meta, lines, unparsable }
}

/** Launches emitted in one assistant message were *sent* together. Whether they *ran* together is separate. */
function launchedTogether(rows) {
  const byMessage = new Map()
  for (const r of rows) {
    if (!r.messageId) continue
    if (!byMessage.has(r.messageId)) byMessage.set(r.messageId, [])
    byMessage.get(r.messageId).push(r.seq)
  }
  return [...byMessage.values()].filter((g) => g.length > 1)
}

/**
 * Agents whose [start, start+duration) intervals actually overlap. Needs --usage for the durations;
 * without it the answer is unknown rather than "none", and the caller must be able to tell those
 * apart — so this returns null when no duration is available at all.
 */
function actuallyConcurrent(rows) {
  const spans = rows
    .filter((r) => r.launchedAt && r.durationMs !== null)
    .map((r) => ({ seq: r.seq, start: Date.parse(r.launchedAt), end: Date.parse(r.launchedAt) + r.durationMs }))
  if (spans.length === 0) return null
  const groups = new Set()
  for (const a of spans) {
    const overlap = spans.filter((b) => b.seq !== a.seq && b.start < a.end && a.start < b.end).map((b) => b.seq)
    if (overlap.length) groups.add([a.seq, ...overlap].sort((x, y) => x - y).join(','))
  }
  return [...groups].map((k) => k.split(',').map(Number))
}

function build(scanned, usage) {
  const rows = scanned.launches.map((l) => {
    const result = (l.toolUseId && scanned.resultByToolUseId.get(l.toolUseId)) || {}
    const u = (result.agentId && usage.byAgentId.get(result.agentId)) || usage.bySeq.get(l.seq) || null
    return {
      ...l,
      agentId: result.agentId ?? null,
      resolvedModel: result.resolvedModel ?? null,
      outputFile: result.outputFile ?? null,
      launchStatus: result.launchStatus ?? null,
      tokens: u?.tokens ?? null,
      toolUses: u?.toolUses ?? null,
      durationMs: u?.durationMs ?? null,
      status: u?.status ?? null,
      usageSource: u ? 'notification (via --usage)' : 'unavailable',
    }
  })

  const withUsage = rows.filter((r) => r.tokens !== null || r.durationMs !== null)
  const sessionWallMs =
    scanned.meta.firstTs && scanned.meta.lastTs ? Date.parse(scanned.meta.lastTs) - Date.parse(scanned.meta.firstTs) : null
  const agentWallMs = withUsage.reduce((s, r) => s + (r.durationMs ?? 0), 0)
  const agentTokens = withUsage.reduce((s, r) => s + (r.tokens ?? 0), 0)

  return {
    session: { ...scanned.meta, sessionWallMs, transcriptLines: scanned.lines, unparsableLines: scanned.unparsable },
    agents: rows,
    launchOrder: rows.map((r) => ({ seq: r.seq, agent: r.agent, at: r.launchedAt })),
    launchedTogether: launchedTogether(rows),
    actuallyConcurrent: actuallyConcurrent(rows),
    skillsLoaded: scanned.skills,
    workflows: scanned.workflows,
    mainToolCalls: scanned.mainToolCalls,
    totals: {
      agentsLaunched: rows.length,
      agentsWithUsage: withUsage.length,
      agentsWithoutUsage: rows.length - withUsage.length,
      agentTokens: withUsage.length ? agentTokens : null,
      agentToolUses: withUsage.length ? withUsage.reduce((s, r) => s + (r.toolUses ?? 0), 0) : null,
      agentWallMs: withUsage.length ? agentWallMs : null,
      // >1 means agents overlapped: summed agent time exceeded the wall clock they ran inside.
      parallelismRatio: withUsage.length && sessionWallMs ? Number((agentWallMs / sessionWallMs).toFixed(2)) : null,
      main: scanned.main,
      agentVsMainOutputTokens:
        withUsage.length && scanned.main.output ? Number((agentTokens / scanned.main.output).toFixed(2)) : null,
    },
    limits: [
      'Agent launch order, type, resolvedModel, description and prompt size come from the transcript and are exact.',
      'Per-agent tokens / tool_uses / duration_ms are NOT in the transcript. They exist only in the completion notification in the caller\'s live context, so they are here only if passed via --usage, and are unrecoverable for a past session.',
      'A subagent\'s own tool calls are not recoverable in this build (tasks/*.output is empty, no isSidechain lines), so which files each agent read is unknown.',
      'Main-session token counts are per-request sums including cache reads. They are not a dollar figure — use /cost for that.',
      'actuallyConcurrent is null (not []) when no durations were supplied: unknown, not "nothing overlapped".',
      'sessionWallMs is the calendar span from the first to the last transcript line. A session resumed across days spans days, so it is an upper bound on active time and parallelismRatio computed against it understates the real overlap.',
    ],
  }
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return '—'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

function table(r) {
  const L = []
  L.push(`session ${r.session.sessionId ?? '—'} · branch ${r.session.gitBranch ?? '—'} · wall ${fmtMs(r.session.sessionWallMs)}`)
  L.push('')
  L.push('  # | agent                | model            | prompt | tokens  | tools | wall')
  L.push(' ---+----------------------+------------------+--------+---------+-------+-------')
  for (const a of r.agents) {
    L.push(
      `  ${String(a.seq).padStart(2)} | ${String(a.agent).slice(0, 20).padEnd(20)} | ${String(a.resolvedModel ?? '—').slice(0, 16).padEnd(16)} | ${String(a.promptChars ?? '—').padStart(6)} | ${String(a.tokens ?? '—').padStart(7)} | ${String(a.toolUses ?? '—').padStart(5)} | ${fmtMs(a.durationMs)}`,
    )
  }
  L.push('')
  const t = r.totals
  L.push(`agents        ${t.agentsLaunched} launched · ${t.agentsWithUsage} with usage · ${t.agentsWithoutUsage} without`)
  L.push(`agent tokens  ${t.agentTokens ?? '— (pass --usage)'}${t.agentToolUses !== null ? ` over ${t.agentToolUses} tool calls` : ''}`)
  L.push(`agent wall    ${fmtMs(t.agentWallMs)} inside ${fmtMs(r.session.sessionWallMs)} session (ratio ${t.parallelismRatio ?? '—'})`)
  L.push(`main session  ${t.main.turns} turns · out ${t.main.output} · in ${t.main.input} · cache read ${t.main.cacheRead}`)
  L.push(`skills loaded ${r.skillsLoaded.map((s) => s.skill).join(', ') || 'none'}`)
  L.push(`launched together   ${r.launchedTogether.map((g) => `[${g.join(' ')}]`).join(' ') || 'none'}`)
  L.push(
    `actually concurrent ${r.actuallyConcurrent === null ? 'unknown (no durations)' : r.actuallyConcurrent.map((g) => `[${g.join(' ')}]`).join(' ') || 'none'}`,
  )
  L.push('')
  L.push('limits:')
  for (const l of r.limits) L.push(`  - ${l}`)
  return L.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(USAGE)
    return
  }
  const projectDir = resolveProjectDir(args.project, process.cwd())
  const file = resolveTranscript(projectDir, args.session)
  process.stderr.write(`transcript: ${file}\n`)

  const report = build(await scan(file), loadUsage(args.usage))
  report.session.transcript = file

  if (report.totals.agentsLaunched === 0) {
    process.stderr.write('no Agent launches in this transcript — nothing to grade.\n')
  } else if (report.totals.agentsWithoutUsage > 0 && !args.usage) {
    process.stderr.write(
      `note: ${report.totals.agentsWithoutUsage} agent(s) have no usage figures. Per-agent cost is not persisted; pass --usage with the numbers from the completion notifications.\n`,
    )
  }
  process.stdout.write(args.format === 'table' ? `${table(report)}\n` : `${JSON.stringify(report, null, 2)}\n`)
}

main().catch((err) => {
  process.stderr.write(`session-retro: ${err.message}\n`)
  process.exit(1)
})
