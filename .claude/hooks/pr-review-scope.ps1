# pr-review-scope.ps1 — the SINGLE source of truth for PR review scope + content fingerprint.
#
# Called by BOTH the pr-self-review skill (to write its report) and pr-gate.ps1 (to verify it).
# Never reimplement this in another shell. PowerShell native-to-native pipes are not
# byte-transparent: `git diff HEAD | git hash-object --stdin` returns a different sha in
# PowerShell than in Git Bash for the identical tree, because PS decodes the stream to strings
# and re-emits CRLF. Any stream-hashing fingerprint therefore has two implementations that
# silently disagree, and the failure mode is "the gate blocks forever and nobody knows why".
#
# The fingerprint is built from git BLOB IDS only — every input is 40-char ASCII, so shell and
# encoding are irrelevant. `git hash-object <path>` applies the attributes clean filter, so
# core.autocrlf line-ending churn produces identical blobs.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .claude/hooks/pr-review-scope.ps1 -Json
#   . "$PSScriptRoot\pr-review-scope.ps1" ; Get-PrReviewScope -RepoRoot $root

[CmdletBinding()]
param(
    [switch]$Json,
    [string]$RepoRoot
)

$Script:ScopeAlgo     = 'devdigest-pr-scope/1'
$Script:ZeroSha       = '0' * 40

# insights.md is excluded deliberately, and the list is itself hashed into the fingerprint.
# Root CLAUDE.md mandates /engineering-insights at end-of-task, which writes insights.md
# BETWEEN the review and `gh pr create`. Without this exemption the gate false-blocks on the
# repo's own documented workflow. Changing this list invalidates every existing report, by design.
$Script:ScopeExcludes = @('insights.md', '*/insights.md')

function Invoke-Git {
    param([string]$Root, [string[]]$GitArgs)
    $out = & git -C $Root -c core.quotepath=false @GitArgs 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return $out
}

function Split-GitZ {
    # git's -z output arrives from PowerShell as one string (or an array of them); NUL-split it.
    param($Value)
    if ($null -eq $Value) { return @() }
    $s = if ($Value -is [array]) { $Value -join '' } else { [string]$Value }
    return @($s -split "`0" | Where-Object { $_ -ne '' })
}

function Test-ScopeExcluded {
    param([string]$Path)
    foreach ($p in $Script:ScopeExcludes) { if ($Path -like $p) { return $true } }
    return $false
}

function Get-PrReviewBase {
    # origin/HEAD -> probe remote -> probe local. Deliberately NOT @{u}: on a pushed feature
    # branch @{u} resolves to origin/<feature>, i.e. the branch itself, which makes the base the
    # branch and the diff empty. It only looks correct while HEAD happens to be the default branch.
    param([string]$Root)

    $def = $null
    $source = 'origin-head'

    $sym = Invoke-Git $Root @('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
    if ($sym) { $def = (([string]$sym).Trim() -replace '^origin/', '') }

    if (-not $def) {
        $source = 'origin-probe'
        foreach ($c in @('main', 'master', 'trunk', 'develop')) {
            if (Invoke-Git $Root @('rev-parse', '--verify', '--quiet', "refs/remotes/origin/$c")) { $def = $c; break }
        }
    }
    if (-not $def) {
        $source = 'local-probe'
        foreach ($c in @('main', 'master', 'trunk', 'develop')) {
            if (Invoke-Git $Root @('rev-parse', '--verify', '--quiet', "refs/heads/$c")) { $def = $c; break }
        }
    }
    if (-not $def) { return @{ ref = ''; sha = ''; source = 'none'; defaultBranch = ''; drift = $false } }

    # Prefer origin/<default>: GitHub computes the PR diff against the remote ref, so that is the
    # base the reviewer must see even when local <default> has drifted.
    $ref = $null
    if     (Invoke-Git $Root @('rev-parse', '--verify', '--quiet', "refs/remotes/origin/$def")) { $ref = "origin/$def" }
    elseif (Invoke-Git $Root @('rev-parse', '--verify', '--quiet', "refs/heads/$def"))          { $ref = $def; $source = 'local-default' }
    else   { return @{ ref = ''; sha = ''; source = 'none'; defaultBranch = $def; drift = $false } }

    $mb  = Invoke-Git $Root @('merge-base', $ref, 'HEAD')
    $sha = if ($mb) { ([string]$mb).Trim() } else { '' }
    if (-not $sha) { $source = 'no-merge-base' }   # shallow clone / unrelated histories

    # Drift = the remote default tip differs from the local default tip, i.e. a fetch is pending
    # or local is ahead. Informational: it tells the reviewer the diff may not be what GitHub shows.
    $drift = $false
    if ($ref -like 'origin/*') {
        $r = Invoke-Git $Root @('rev-parse', '--verify', '--quiet', "refs/remotes/origin/$def")
        $l = Invoke-Git $Root @('rev-parse', '--verify', '--quiet', "refs/heads/$def")
        if ($r -and $l) { $drift = (([string]$r).Trim() -ne ([string]$l).Trim()) }
    }

    return @{ ref = $ref; sha = $sha; source = $source; defaultBranch = $def; drift = $drift }
}

function Get-PrReviewScope {
    param([string]$RepoRoot)

    $top = Invoke-Git $RepoRoot @('rev-parse', '--show-toplevel')
    if (-not $top) { throw "not a git work tree: $RepoRoot" }
    $root = ([string]$top).Trim()

    $headRaw = Invoke-Git $root @('rev-parse', 'HEAD')
    $head    = if ($headRaw) { ([string]$headRaw).Trim() } else { '' }    # '' = unborn HEAD
    $brRaw   = Invoke-Git $root @('symbolic-ref', '--short', 'HEAD')
    $branch  = if ($brRaw)   { ([string]$brRaw).Trim() }   else { '' }    # '' = detached

    $base = Get-PrReviewBase -Root $root

    # --- the three path sets that make up "everything not on the base branch" ---
    $committed = @()
    if ($base.sha -and $head) {
        $committed = Split-GitZ (Invoke-Git $root @('diff', '--name-only', '-z', $base.sha, 'HEAD'))
    }
    $dirty     = if ($head) { Split-GitZ (Invoke-Git $root @('diff', 'HEAD', '--name-only', '-z')) } else { @() }
    $untracked = Split-GitZ (Invoke-Git $root @('ls-files', '--others', '--exclude-standard', '-z'))

    # HEAD blob map — one call, no pathspec, so there is no command-line length ceiling.
    $headBlobs = @{}
    if ($head) {
        foreach ($e in Split-GitZ (Invoke-Git $root @('ls-tree', '-r', '-z', 'HEAD'))) {
            $tab = $e.IndexOf("`t")
            if ($tab -lt 0) { continue }
            $meta = $e.Substring(0, $tab) -split '\s+'
            if ($meta.Count -ge 3) { $headBlobs[$e.Substring($tab + 1)] = $meta[2] }
        }
    }

    $dirtySet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($p in $dirty) { [void]$dirtySet.Add($p) }

    # Worktree blobs for dirty + untracked files that exist on disk.
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $live = [System.Collections.Generic.List[string]]::new()
    foreach ($p in ($dirty + $untracked)) {
        if (Test-ScopeExcluded $p) { continue }
        if (-not $seen.Add($p)) { continue }
        if (Test-Path -LiteralPath (Join-Path $root $p) -PathType Leaf) { $live.Add($p) }
    }

    # `git hash-object -- a b c` emits one sha per line in argument order. Batched to stay well
    # inside the Windows command-line limit.
    $wtBlobs = @{}
    for ($i = 0; $i -lt $live.Count; $i += 100) {
        $take  = [Math]::Min(100, $live.Count - $i)
        $chunk = $live.GetRange($i, $take).ToArray()
        $shas  = @(Invoke-Git $root (@('hash-object', '--') + $chunk))
        if ($shas.Count -ne $chunk.Count) {
            throw "git hash-object returned $($shas.Count) sha(s) for $($chunk.Count) path(s)"
        }
        for ($k = 0; $k -lt $chunk.Count; $k++) { $wtBlobs[$chunk[$k]] = ([string]$shas[$k]).Trim() }
    }

    # Ordinal sort so the manifest order is culture-invariant.
    $paths = [System.Collections.Generic.SortedSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($p in ($committed + $dirty + $untracked)) {
        if (-not (Test-ScopeExcluded $p)) { [void]$paths.Add($p) }
    }

    # The effective content manifest: the final content the PR will contain, per path.
    $entries = [System.Collections.Generic.List[string]]::new()
    foreach ($p in $paths) {
        $sha =
            if     ($wtBlobs.ContainsKey($p))   { $wtBlobs[$p] }        # final content = worktree
            elseif ($dirtySet.Contains($p))     { $Script:ZeroSha }     # deleted / staged delete
            elseif ($headBlobs.ContainsKey($p)) { $headBlobs[$p] }      # final content = committed
            else                                { $Script:ZeroSha }     # deleted vs base
        $entries.Add("$sha $p")
    }

    # branch and headSha are deliberately NOT hashed. The load-bearing property is that
    # review -> branch -> commit -> push -> PR must not invalidate the review: committing moves a
    # path from the worktree column to the headBlobs column with the SAME blob sha, so the
    # fingerprint is unchanged. baseSha IS hashed — if a fetch moves origin/main the PR diff
    # genuinely changed and re-review is correct.
    $lines = @(
        "algo $Script:ScopeAlgo"
        "base $($base.sha)"
        "excludes $($Script:ScopeExcludes -join ',')"
    ) + $entries

    $bytes  = [System.Text.Encoding]::UTF8.GetBytes(($lines -join "`n") + "`n")
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $fp = ([BitConverter]::ToString($sha256.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant()
    } finally { $sha256.Dispose() }

    $commitCount = 0
    if ($base.sha -and $head) {
        $rc = Invoke-Git $root @('rev-list', '--count', "$($base.sha)..HEAD")
        if ($rc) { $commitCount = [int](([string]$rc).Trim()) }
    }

    return [ordered]@{
        algo          = $Script:ScopeAlgo
        fingerprint   = $fp
        excludes      = $Script:ScopeExcludes
        repoRoot      = $root
        baseRef       = $base.ref
        baseSha       = $base.sha
        baseSource    = $base.source
        baseDrift     = $base.drift
        branch        = $branch
        headSha       = $head
        onBaseBranch  = ([bool]$branch -and $branch -eq $base.defaultBranch)
        commitCount   = $commitCount
        fileCount     = $entries.Count
        files         = @($entries)
    }
}

if ($Json) {
    $root = if ($RepoRoot) { $RepoRoot }
            elseif ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR }
            else { (Get-Location).Path }
    (Get-PrReviewScope -RepoRoot $root) | ConvertTo-Json -Depth 6
}
