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

function EnsureConverterDeps([string]$worktreeRoot) {
  $vitest = Join-Path $worktreeRoot "packages\danmaku-converter\node_modules\.bin\vitest.cmd"
  if (Test-Path $vitest) {
    return
  }
  corepack pnpm -C $worktreeRoot -r -F "./packages/danmaku-converter" install | Out-Null
}

function RunBench([string]$worktreeRoot, [string]$commitShort, [string]$outPath) {
  $pkgDir = Join-Path $worktreeRoot "packages\danmaku-converter"
  $cmd = "corepack pnpm exec -- vitest bench src/canonical/comment/loadDanmaku.bench.ts --no-color"
  # Use cmd.exe to preserve piping behavior consistently.
  cmd /c "cd /d `"$pkgDir`" && $cmd" | Tee-Object -FilePath $outPath | Out-Null
}

function ParseBenchMeans([string]$path) {
  $map = @{}
  foreach ($line in Get-Content $path) {
    # vitest bench lines look like:
    #   · name .... hz min max mean ...
    if ($line -match '^\s*·\s+(?<name>.+?)\s+(?<hz>[0-9,]+(?:\.[0-9]+)?)\s+(?<min>[0-9.]+)\s+(?<max>[0-9.]+)\s+(?<mean>[0-9.]+)\s') {
      $map[$matches['name'].Trim()] = [double]$matches['mean']
    }
  }
  return $map
}

function WriteCompareMarkdown([hashtable]$baseline, [hashtable]$head, [string]$outPath) {
  $keys = New-Object System.Collections.Generic.SortedSet[string]
  foreach ($k in $baseline.Keys) { [void]$keys.Add($k) }
  foreach ($k in $head.Keys) { [void]$keys.Add($k) }

  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("# Load Bench Compare")
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
$benchContent = (git -C $repoRoot show "$headCommit`:$benchRel")
$vitestContent = (git -C $repoRoot show "$headCommit`:$vitestRel")

$benchDst = Join-Path $baselineDir $benchRel
$vitestDst = Join-Path $baselineDir $vitestRel

WriteUtf8NoBom $benchDst $benchContent
WriteUtf8NoBom $vitestDst $vitestContent

if (-not $SkipInstall) {
  EnsureConverterDeps $baselineDir
  EnsureConverterDeps $repoRoot
}

$outBaseline = Join-Path $baselineDir "bench-baseline-$baselineShort.txt"
$outHead = Join-Path $repoRoot "bench-head-$headShort.txt"

RunBench $baselineDir $baselineShort $outBaseline
RunBench $repoRoot $headShort $outHead

$baselineMeans = ParseBenchMeans $outBaseline
$headMeans = ParseBenchMeans $outHead

$compareOut = Join-Path $repoRoot "bench-compare.md"
WriteCompareMarkdown $baselineMeans $headMeans $compareOut

Write-Host ""
Write-Host "Wrote:"
Write-Host "  $outBaseline"
Write-Host "  $outHead"
Write-Host "  $compareOut"

