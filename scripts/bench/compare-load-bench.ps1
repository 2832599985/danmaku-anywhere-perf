[CmdletBinding()]
param(
  [string]$BaselineCommit = "f3aceaf5",
  [string]$BaselineDirName = "danmaku-anywhere__baseline_f3aceaf5",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

function WriteUtf8NoBom([string]$path, [string]$content) {
  $enc = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($path, $content, $enc)
}

function EnsureWorktree([string]$repoRoot, [string]$baselineCommit, [string]$baselineDir) {
  if (Test-Path $baselineDir) {
    return
  }
  git -C $repoRoot worktree add --detach $baselineDir $baselineCommit | Out-Null
}

function GetGitFile([string]$repoRoot, [string]$commit, [string]$relPath) {
  # External command output comes back as string[] (per line). Join to preserve newlines.
  $lines = git -C $repoRoot show "$commit`:$relPath"
  return ($lines -join "`n")
}

function EnsureConverterDeps([string]$worktreeRoot) {
  $vitest = Join-Path $worktreeRoot "packages\danmaku-converter\node_modules\.bin\vitest.cmd"
  if (Test-Path $vitest) {
    return
  }
  corepack pnpm -C $worktreeRoot -r -F "./packages/danmaku-converter" install | Out-Null
}

function RunBench([string]$worktreeRoot, [string]$commitShort, [string]$outJsonPath) {
  $pkgDir = Join-Path $worktreeRoot "packages\danmaku-converter"
  $cmd = "corepack pnpm exec -- vitest bench src/canonical/comment/loadDanmaku.bench.ts --outputJson `"$outJsonPath`" --no-color"
  cmd /c "cd /d `"$pkgDir`" && $cmd" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "bench failed in $pkgDir (exit=$LASTEXITCODE)."
  }
  if (-not (Test-Path $outJsonPath)) {
    throw "bench did not produce json report: $outJsonPath"
  }
}

function ParseBenchJsonMeans([string]$jsonPath) {
  $raw = Get-Content -Raw $jsonPath
  $obj = $raw | ConvertFrom-Json

  $map = @{}
  foreach ($file in $obj.files) {
    foreach ($group in $file.groups) {
      foreach ($bench in $group.benchmarks) {
        $map[$bench.name] = [double]$bench.mean
      }
    }
  }
  return $map
}

function AppendTable(
  [System.Collections.Generic.List[string]]$lines,
  [hashtable]$baseline,
  [hashtable]$head,
  [string]$title,
  [string]$regexFilter
) {
  $keys = New-Object System.Collections.Generic.SortedSet[string]
  foreach ($k in $baseline.Keys) {
    if ($k -match $regexFilter) { [void]$keys.Add($k) }
  }
  foreach ($k in $head.Keys) {
    if ($k -match $regexFilter) { [void]$keys.Add($k) }
  }

  $lines.Add("## $title")
  $lines.Add("")
  $lines.Add("| metric | baseline mean (ms) | head mean (ms) | speedup (x) | delta (ms) |")
  $lines.Add("|---|---:|---:|---:|---:|")

  foreach ($k in $keys) {
    $b = $baseline[$k]
    $h = $head[$k]
    if ($null -eq $b -or $null -eq $h) {
      continue
    }
    $speedup = if ($h -eq 0) { [double]::NaN } else { $b / $h }
    $delta = $b - $h
    $lines.Add(("| {0} | {1:N4} | {2:N4} | {3:N3} | {4:N4} |" -f $k, $b, $h, $speedup, $delta))
  }
  $lines.Add("")
}

function WriteCompareMarkdown([hashtable]$baseline, [hashtable]$head, [string]$outPath) {
  $keys = New-Object System.Collections.Generic.SortedSet[string]
  foreach ($k in $baseline.Keys) { [void]$keys.Add($k) }
  foreach ($k in $head.Keys) { [void]$keys.Add($k) }

  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("# Load Bench Compare")
  $lines.Add("")
  AppendTable $lines $baseline $head "Focus: Mount Pipelines" '^mount (new|old) pipeline '
  AppendTable $lines $baseline $head "All Metrics" '.*'

  WriteUtf8NoBom $outPath ($lines -join "`n")
}

$repoRoot = (git rev-parse --show-toplevel).Trim()
$headCommit = (git -C $repoRoot rev-parse HEAD).Trim()
$headShort = (git -C $repoRoot rev-parse --short HEAD).Trim()
$baselineShort = (git -C $repoRoot rev-parse --short $BaselineCommit).Trim()

$repoParent = Split-Path $repoRoot -Parent
$baselineDir = Join-Path $repoParent $BaselineDirName

Write-Host "repoRoot=$repoRoot"
Write-Host "head=$headCommit ($headShort)"
Write-Host "baseline=$BaselineCommit ($baselineShort)"
Write-Host "baselineDir=$baselineDir"

EnsureWorktree $repoRoot $BaselineCommit $baselineDir

# Copy current HEAD versions of bench + vitest config into baseline worktree (do not commit baseline).
$benchRel = "packages/danmaku-converter/src/canonical/comment/loadDanmaku.bench.ts"
$vitestRel = "packages/danmaku-converter/vitest.config.ts"
$benchContent = GetGitFile $repoRoot $headCommit $benchRel
$vitestContent = GetGitFile $repoRoot $headCommit $vitestRel

$benchDst = Join-Path $baselineDir $benchRel
$vitestDst = Join-Path $baselineDir $vitestRel

WriteUtf8NoBom $benchDst $benchContent
WriteUtf8NoBom $vitestDst $vitestContent

if (-not $SkipInstall) {
  EnsureConverterDeps $baselineDir
  EnsureConverterDeps $repoRoot
}

$outBaseline = Join-Path $baselineDir "bench-baseline-$baselineShort.json"
$outHead = Join-Path $repoRoot "bench-head-$headShort.json"

RunBench $baselineDir $baselineShort $outBaseline
RunBench $repoRoot $headShort $outHead

$baselineMeans = ParseBenchJsonMeans $outBaseline
$headMeans = ParseBenchJsonMeans $outHead

$compareOut = Join-Path $repoRoot "bench-compare.md"
WriteCompareMarkdown $baselineMeans $headMeans $compareOut

Write-Host ""
Write-Host "Wrote:"
Write-Host "  $outBaseline"
Write-Host "  $outHead"
Write-Host "  $compareOut"
