# pr-gate.ps1 — PreToolUse hook for Bash + PowerShell.
#
# Blocks PR creation until a FRESH, CRITICAL-free self-review exists. Deterministic: no LLM, no
# network. Local only — nothing is ever sent to GitHub.
#
#   report : .devdigest/cache/pr-self-review/report.json   (already gitignored, .gitignore:19)
#   scope  : .claude/hooks/pr-review-scope.ps1             (shared with the skill — one impl)
#   skill  : .claude/skills/pr-self-review/SKILL.md
#
# Reads JSON from stdin. On a block, emits deny JSON to stdout and exits 0.
# On no match — and on any internal failure — exits 0 silently, so a broken gate never wedges
# the session. Override: DEVDIGEST_PR_GATE=off, parent environment only (see row 3).

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ExpectedSchema   = 1
$ExpectedAlgo     = 'devdigest-pr-scope/1'
$ExpectedExcludes = @('insights.md', '*/insights.md')
$ReportRel        = '.devdigest/cache/pr-self-review/report.json'
$MaxAgeHours      = if ($env:DEVDIGEST_PR_GATE_MAX_AGE_HOURS -match '^\d+$') {
                        [int]$env:DEVDIGEST_PR_GATE_MAX_AGE_HOURS
                    } else { 24 }

function Deny {
    param([string]$Problem, [string[]]$Detail = @())
    $lines = @(
        'PR gate (.claude/hooks/pr-gate.ps1) blocked this command. Nothing was sent to GitHub.',
        '',
        "PROBLEM: $Problem"
    )
    if ($Detail.Count) { $lines += ''; $lines += $Detail }
    $lines += @(
        '',
        'NEXT STEP: run the /pr-self-review skill, resolve or dismiss every CRITICAL it reports,',
        "then retry this command. The skill rewrites $ReportRel and this hook re-checks it.",
        '',
        'A CRITICAL is only one of: exploitable security defect | data loss or irreversible',
        'migration | broken repo contract (severity/verdict enums, the two vendor/shared copies',
        'diverging, a tsconfig alias not mirrored into vitest.config.ts, a new pnpm arch',
        'violation) | deleted "do not touch" scaffolding | code that does not typecheck or build.',
        'Anything else is WARNING or SUGGESTION and does not block.',
        '',
        'Do not hand-edit the report and do not disable this hook. If a human has genuinely',
        'decided to ship anyway, they set DEVDIGEST_PR_GATE=off in their own shell and restart.'
    )
    $out = @{
        hookSpecificOutput = @{
            hookEventName            = 'PreToolUse'
            permissionDecision       = 'deny'
            permissionDecisionReason = ($lines -join "`n")
        }
    } | ConvertTo-Json -Depth 5 -Compress
    [Console]::Out.WriteLine($out)
    exit 0
}

# --- rows 0-1: defensive early exits ----------------------------------------------------------
$stdin = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($stdin)) { exit 0 }
try { $payload = $stdin | ConvertFrom-Json -ErrorAction Stop } catch { exit 0 }

$toolName = $payload.tool_name
if ($toolName -ne 'Bash' -and $toolName -ne 'PowerShell') { exit 0 }

$cmd = $payload.tool_input.command
if ([string]::IsNullOrWhiteSpace($cmd)) { exit 0 }

$lower = (($cmd -replace '\s+', ' ').Trim()).ToLowerInvariant()

# Does this command create or publish a PR? Regex FIRST, git second — the fingerprint costs
# ~26 ms/file and must never be paid on an ordinary Bash call.
# The boundary class includes quotes and '(' so `cmd.exe /c "gh pr create"` and
# `sh -c 'gh pr create'` match, while `somegh pr create` does not.
$b = '(^|[\s;&|`(''"])'
$gatePatterns = @(
    @{ pattern = $b + 'gh\s+pr\s+create\b'; label = 'gh pr create' }
    @{ pattern = $b + 'gh\s+pr\s+ready\b';  label = 'gh pr ready'  }   # draft -> review-ready
    @{ pattern = $b + 'gh\s+pr\s+merge\b';  label = 'gh pr merge'  }
    @{ pattern = $b + 'gh\s+api\b[^\r\n]*\bpulls\b[^\r\n]*(--method\s+post|-x\s+post)'; label = 'gh api ... /pulls POST' }
    @{ pattern = $b + 'gh\s+api\b[^\r\n]*(--method\s+post|-x\s+post)[^\r\n]*\bpulls\b'; label = 'gh api ... POST ... /pulls' }
    @{ pattern = $b + 'curl\b[^\r\n]*api\.github\.com[^\r\n]*/pulls\b'; label = 'curl api.github.com/.../pulls' }
)
$matched = $null
foreach ($g in $gatePatterns) { if ($lower -match $g.pattern) { $matched = $g.label; break } }
if (-not $matched) { exit 0 }

# --- rows 2-3: the override, and the attempt to grant it to oneself ---------------------------
# DEVDIGEST_PR_GATE is read from the environment this process inherited. Setting it inside a tool
# call only affects that tool's own child process, so it cannot lift the gate. Deny loudly rather
# than let the agent believe a silent no-op worked.
if ($lower -match 'devdigest_pr_gate') {
    Deny "the command tries to set DEVDIGEST_PR_GATE itself ('$matched')." @(
        'That variable is read from the environment Claude Code was launched with, so assigning',
        'it inside a tool call cannot lift the gate. Only a human''s own shell can.'
    )
}
if ($env:DEVDIGEST_PR_GATE -eq 'off') { exit 0 }

# --- row 4: locate the repo and the scope script. THE ONLY FAIL-OPEN. -------------------------
$cwd = if     ($payload.cwd)              { [string]$payload.cwd }
       elseif ($env:CLAUDE_PROJECT_DIR)   { $env:CLAUDE_PROJECT_DIR }
       else                               { (Get-Location).Path }

try {
    $top = & git -C $cwd rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $top) { exit 0 }
    $root = ([string]$top).Trim()

    $scopeScript = Join-Path $PSScriptRoot 'pr-review-scope.ps1'
    if (-not (Test-Path -LiteralPath $scopeScript)) { exit 0 }
    . $scopeScript
    $scope = Get-PrReviewScope -RepoRoot $root
} catch { exit 0 }

# --- row 5: is there a report at all? --------------------------------------------------------
$reportPath = Join-Path $root $ReportRel
if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) {
    Deny "no PR self-review report exists for this repo ('$matched' requires one)." @(
        "Expected: $ReportRel",
        "Branch '$($scope.branch)' | base $($scope.baseRef) | $($scope.fileCount) file(s) in scope."
    )
}

# --- row 6: parseable, and carries what the gate needs ----------------------------------------
try {
    $r = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
} catch {
    Deny "the review report is not valid JSON ($ReportRel)."
}

if ($r.schemaVersion -ne $ExpectedSchema) {
    Deny "review report schemaVersion is '$($r.schemaVersion)'; this hook requires $ExpectedSchema."
}
if ($null -eq $r.scope -or [string]::IsNullOrWhiteSpace([string]$r.scope.fingerprint) -or
    $null -eq $r.counts -or $null -eq $r.counts.CRITICAL -or $null -eq $r.groups) {
    Deny 'the review report is missing required fields (scope.fingerprint, counts.CRITICAL, groups).'
}

# --- rows 7-8: the report must not redefine the scope it was judged against -------------------
if ([string]$r.scope.algo -ne $ExpectedAlgo) {
    Deny "the report was produced by fingerprint algorithm '$($r.scope.algo)'; this hook requires '$ExpectedAlgo'."
}
$reportExcl = @($r.scope.excludes | ForEach-Object { [string]$_ })
if (($reportExcl -join '|') -ne ($ExpectedExcludes -join '|')) {
    Deny 'the report declares a different fingerprint exclude list than this hook allows.' @(
        "report: $($reportExcl -join ', ')",
        "hook:   $($ExpectedExcludes -join ', ')"
    )
}

# --- row 9: age -------------------------------------------------------------------------------
$gen = [datetime]::MinValue
if (-not [datetime]::TryParse([string]$r.generatedAt, [ref]$gen)) {
    Deny 'the report has no parseable generatedAt timestamp.'
}
$ageH = ([datetime]::UtcNow - $gen.ToUniversalTime()).TotalHours
if ($ageH -gt $MaxAgeHours) {
    Deny ('the review is {0:N1} h old (limit {1} h).' -f $ageH, $MaxAgeHours) @(
        'Content drift is caught by the fingerprint; this age limit catches drift outside git',
        '(dependencies installed, database migrated). Re-run /pr-self-review.'
    )
}

# --- row 10: freshness -- the content fingerprint ---------------------------------------------
if ([string]$r.scope.fingerprint -ne [string]$scope.fingerprint) {
    $detail = @(
        "reviewed fingerprint: $($r.scope.fingerprint)",
        "current  fingerprint: $($scope.fingerprint)"
    )
    if ([string]$r.scope.baseSha -ne [string]$scope.baseSha) {
        $detail += ''
        $detail += "The base moved: $($r.scope.baseSha) -> $($scope.baseSha) ($($scope.baseRef))."
        $detail += 'A fetch or rebase changed what the PR will contain, so the review no longer applies.'
    }
    if ($r.scope.files) {
        $old   = @($r.scope.files | ForEach-Object { [string]$_ })
        $new   = @($scope.files   | ForEach-Object { [string]$_ })
        $drift = @(Compare-Object -ReferenceObject $old -DifferenceObject $new |
                   ForEach-Object { ($_.InputObject -split ' ', 2)[1] } |
                   Sort-Object -Unique)
        if ($drift.Count) {
            $detail += ''
            $detail += "Changed since the review ($($drift.Count) path(s)):"
            $detail += @($drift | Select-Object -First 5 | ForEach-Object { "  - $_" })
            if ($drift.Count -gt 5) { $detail += "  ... and $($drift.Count - 5) more" }
        }
    }
    Deny 'the working tree no longer matches what was reviewed.' $detail
}

# --- row 11: a partial fan-out is not a pass --------------------------------------------------
$bad = @($r.groups | Where-Object { [string]$_.status -ne 'ok' })
if ($bad.Count) {
    Deny "the review did not finish: $($bad.Count) lane(s) did not complete." (
        @($bad | ForEach-Object { "  - $($_.lane): $($_.status)" }) +
        @('A partial review is not a pass. Re-run /pr-self-review.')
    )
}

# --- row 12: typecheck ------------------------------------------------------------------------
if ($r.checks -and $r.checks.typecheck -and [string]$r.checks.typecheck.status -eq 'fail') {
    $pkgs = @()
    if ($r.checks.typecheck.packages) {
        $pkgs = @($r.checks.typecheck.packages.PSObject.Properties |
                  Where-Object { [string]$_.Value.status -eq 'fail' } |
                  ForEach-Object { "  - $($_.Name): $($_.Value.cmd) -> exit $($_.Value.exitCode)" })
    }
    Deny 'the reviewed code does not typecheck (a CRITICAL by definition).' $pkgs
}

# --- row 13: CRITICAL findings ----------------------------------------------------------------
$crit = [int]$r.counts.CRITICAL
if ($crit -gt 0) {
    $detail = @(
        "verdict: $($r.verdict) | score: $($r.score) | CRITICAL $crit, WARNING $($r.counts.WARNING), SUGGESTION $($r.counts.SUGGESTION)",
        ''
    )
    $detail += @($r.blocking | ForEach-Object { "  [$($_.reason)] $($_.file):$($_.line) - $($_.title) ($($_.id))" })
    Deny "the last self-review found $crit CRITICAL finding(s)." $detail
}

# --- row 14: pass. Stay SILENT -- never emit permissionDecision 'allow', which would suppress
# the normal permission prompt and auto-approve the command. Passing the gate is not consent.
exit 0
