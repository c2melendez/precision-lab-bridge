[CmdletBinding()]
param([string]$WorkspaceRoot = $env:GITHUB_WORKSPACE, [string]$ArtifactRoot = "")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) { $WorkspaceRoot = (Get-Location).Path }
if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) { $ArtifactRoot = Join-Path $WorkspaceRoot "artifacts" }
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$runDir = Join-Path $ArtifactRoot "precision-lab-$stamp"
$repoDir = Join-Path $runDir "repos"
$logDir = Join-Path $runDir "logs"
New-Item -ItemType Directory -Force -Path $repoDir, $logDir | Out-Null
$script:Results = [System.Collections.Generic.List[object]]::new()
$script:Repos = [ordered]@{}
$script:Fatal = $null

function Invoke-LoggedCommand {
  param([string]$Name,[string]$WorkingDirectory,[string]$Executable,[string[]]$Arguments,[switch]$WarningOnly)
  $safeName = ($Name -replace '[^A-Za-z0-9._-]', '-')
  $logPath = Join-Path $logDir "$safeName.log"
  $started = (Get-Date).ToUniversalTime().ToString("o")
  $exitCode = 9009
  try {
    Push-Location $WorkingDirectory
    try {
      & $Executable @Arguments 2>&1 | Out-File -FilePath $logPath -Encoding utf8
      if ($null -ne $LASTEXITCODE) { $exitCode = [int]$LASTEXITCODE } else { $exitCode = 0 }
    } finally { Pop-Location }
  } catch { $_.Exception.Message | Out-File -FilePath $logPath -Append -Encoding utf8 }
  $status = if ($exitCode -eq 0) { "PASS" } elseif ($WarningOnly) { "WARN" } else { "FAIL" }
  $script:Results.Add([ordered]@{stage=$Name;status=$status;exit_code=$exitCode;started_at=$started;completed_at=(Get-Date).ToUniversalTime().ToString("o");log="logs/$safeName.log"})
  Write-Host "[$status] $Name (exit=$exitCode)"
  return ($exitCode -eq 0 -or $WarningOnly)
}

function Clone-Repo {
  param([string]$Name,[string]$Repository,[string]$Branch)
  $path = Join-Path $repoDir $Name
  $ok = Invoke-LoggedCommand -Name "clone-$Name" -WorkingDirectory $repoDir -Executable "git" -Arguments @("clone","--depth","1","--branch",$Branch,"https://github.com/$Repository.git",$path)
  if (-not $ok) { throw "CLONE_FAILED:$Repository" }
  $sha = (& git -C $path rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[0-9a-f]{40}$') { throw "SHA_RESOLUTION_FAILED:$Repository" }
  $script:Repos[$Name] = [ordered]@{repository=$Repository;branch=$Branch;sha=$sha}
  return $path
}

function Read-CanonicalBranch {
  param([string]$ReadmePath)
  $content = Get-Content -Raw -LiteralPath $ReadmePath
  $match = [regex]::Match($content, '(?m)^## Rama canónica activa\s*\r?\n\s*`([^`]+)`')
  if (-not $match.Success) { throw "CANONICAL_BRANCH_NOT_FOUND:$ReadmePath" }
  return $match.Groups[1].Value.Trim()
}

try {
  foreach ($tool in @("git","node","npm.cmd","python","bun")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "MISSING_REQUIRED_TOOL:$tool" }
  }
  $null = Invoke-LoggedCommand -Name "runtime-versions" -WorkingDirectory $WorkspaceRoot -Executable "powershell" -Arguments @("-NoProfile","-Command","git --version; node --version; npm.cmd --version; python --version; bun --version")

  $liteMain = Clone-Repo -Name "lite-pointer" -Repository "c2melendez/precision-lab-lite" -Branch "main"
  $plusMain = Clone-Repo -Name "plus-pointer" -Repository "c2melendez/precision-lab-plus" -Branch "main"
  $liteCanonical = Read-CanonicalBranch -ReadmePath (Join-Path $liteMain "qa/certification/README.md")
  $plusCanonical = Read-CanonicalBranch -ReadmePath (Join-Path $plusMain "qa/certification/README.md")
  if ($liteCanonical -ne $plusCanonical) { throw "CANONICAL_BRANCH_MISMATCH:lite=$liteCanonical;plus=$plusCanonical" }

  foreach ($entry in @(@{Name="lite";Path=$liteMain},@{Name="plus";Path=$plusMain})) {
    $fetchOk = Invoke-LoggedCommand -Name "fetch-canonical-$($entry.Name)" -WorkingDirectory $entry.Path -Executable "git" -Arguments @("fetch","--depth","1","origin",$liteCanonical)
    if (-not $fetchOk) { throw "CANONICAL_FETCH_FAILED:$($entry.Name)" }
    $checkoutOk = Invoke-LoggedCommand -Name "checkout-canonical-$($entry.Name)" -WorkingDirectory $entry.Path -Executable "git" -Arguments @("checkout","--detach","FETCH_HEAD")
    if (-not $checkoutOk) { throw "CANONICAL_CHECKOUT_FAILED:$($entry.Name)" }
    $sha = (& git -C $entry.Path rev-parse HEAD).Trim()
    $script:Repos[$entry.Name] = [ordered]@{repository="c2melendez/precision-lab-$($entry.Name)";branch=$liteCanonical;sha=$sha}
  }

  $bridge = Clone-Repo -Name "bridge-tca1" -Repository "c2melendez/precision-lab-bridge" -Branch "feat/tca1-local-ollama-harness"
  $observer = Clone-Repo -Name "observer" -Repository "c2melendez/precision-lab-readonly-api" -Branch "main"
  $script:Repos["certification_pointer"] = [ordered]@{lite=$liteCanonical;plus=$plusCanonical;agreement=$true}

  Invoke-LoggedCommand -Name "bridge-bun-install" -WorkingDirectory $bridge -Executable "bun" -Arguments @("install","--frozen-lockfile") | Out-Null
  Invoke-LoggedCommand -Name "bridge-unit-tests" -WorkingDirectory $bridge -Executable "bun" -Arguments @("run","test") | Out-Null
  Invoke-LoggedCommand -Name "bridge-lint" -WorkingDirectory $bridge -Executable "bun" -Arguments @("run","lint") | Out-Null
  Invoke-LoggedCommand -Name "bridge-build" -WorkingDirectory $bridge -Executable "bun" -Arguments @("run","build") | Out-Null

  Invoke-LoggedCommand -Name "lite-npm-ci" -WorkingDirectory $liteMain -Executable "npm.cmd" -Arguments @("ci") | Out-Null
  Invoke-LoggedCommand -Name "lite-npm-audit-hard-gate" -WorkingDirectory $liteMain -Executable "npm.cmd" -Arguments @("audit","--package-lock-only","--json") | Out-Null
  Invoke-LoggedCommand -Name "lite-typecheck" -WorkingDirectory $liteMain -Executable "npm.cmd" -Arguments @("run","typecheck") | Out-Null
  Invoke-LoggedCommand -Name "lite-unit-tests" -WorkingDirectory $liteMain -Executable "npm.cmd" -Arguments @("test") | Out-Null
  Invoke-LoggedCommand -Name "lite-build" -WorkingDirectory $liteMain -Executable "npm.cmd" -Arguments @("run","build") | Out-Null

  $plusBackend = Join-Path $plusMain "backend"
  $plusFrontend = Join-Path $plusMain "frontend"
  Invoke-LoggedCommand -Name "plus-backend-install" -WorkingDirectory $plusBackend -Executable "python" -Arguments @("-m","pip","install","-r","requirements.txt","-r","requirements-qa.txt","pytest-cov") | Out-Null
  Invoke-LoggedCommand -Name "plus-backend-tests" -WorkingDirectory $plusBackend -Executable "python" -Arguments @("-m","pytest","-q","--cov=app","--cov-report=term-missing","--cov-fail-under=75","--disable-warnings") | Out-Null
  Invoke-LoggedCommand -Name "plus-frontend-npm-ci" -WorkingDirectory $plusFrontend -Executable "npm.cmd" -Arguments @("ci") | Out-Null
  Invoke-LoggedCommand -Name "plus-frontend-typecheck" -WorkingDirectory $plusFrontend -Executable "npm.cmd" -Arguments @("run","typecheck") | Out-Null
  Invoke-LoggedCommand -Name "plus-frontend-tests" -WorkingDirectory $plusFrontend -Executable "npm.cmd" -Arguments @("test") | Out-Null
  Invoke-LoggedCommand -Name "plus-frontend-build" -WorkingDirectory $plusFrontend -Executable "npm.cmd" -Arguments @("run","build") | Out-Null
  Invoke-LoggedCommand -Name "plus-frontend-audit" -WorkingDirectory $plusFrontend -Executable "npm.cmd" -Arguments @("audit","--audit-level=moderate") -WarningOnly | Out-Null

  Invoke-LoggedCommand -Name "observer-install" -WorkingDirectory $observer -Executable "python" -Arguments @("-m","pip","install","-r","requirements-dev.txt") | Out-Null
  Invoke-LoggedCommand -Name "observer-tests" -WorkingDirectory $observer -Executable "python" -Arguments @("-m","pytest","-q") | Out-Null
  $benchmarkBridge = Clone-Repo -Name "bridge-cb-benchmark" -Repository "c2melendez/precision-lab-bridge" -Branch "feat/cb1-cb10-local-llm-benchmark"
  Invoke-LoggedCommand -Name "bridge-cb-benchmark-install" -WorkingDirectory $benchmarkBridge -Executable "bun" -Arguments @("install","--frozen-lockfile") | Out-Null

  $benchmarkStarted = (Get-Date).ToUniversalTime().ToString("o")
  $benchmarkStatus = "BLOCKED"
  $benchmarkReason = $null
  $benchmarkExitCode = $null
  $benchmarkModel = if ([string]::IsNullOrWhiteSpace($env:OLLAMA_MODEL)) { "qwen3" } else { $env:OLLAMA_MODEL }
  $benchmarkOutput = Join-Path $runDir "llm-benchmark"
  $benchmarkStatusPath = Join-Path $runDir "llm-benchmark-status.json"
  $benchmarkLogPath = Join-Path $logDir "llm-capability-cb1-cb10.log"
  $ollamaCommand = Get-Command "ollama" -ErrorAction SilentlyContinue

  if (-not $ollamaCommand) {
    $benchmarkReason = "OLLAMA_NOT_INSTALLED"
  } else {
    $ollamaList = @(& ollama list 2>&1)
    $ollamaListExit = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
    if ($ollamaListExit -ne 0) {
      $benchmarkReason = "OLLAMA_NOT_RUNNING_OR_UNAVAILABLE"
      $ollamaList | Out-File -FilePath (Join-Path $logDir "ollama-list.log") -Encoding utf8
    } else {
      $escapedModel = [regex]::Escape($benchmarkModel)
      $modelPattern = if ($benchmarkModel.Contains(":")) {
        "^\s*$escapedModel\s"
      } else {
        "^\s*$escapedModel(?::\S+)?\s"
      }
      $modelInstalled = @($ollamaList | Where-Object { $_ -match $modelPattern }).Count -gt 0
      if (-not $modelInstalled) { $benchmarkReason = "OLLAMA_MODEL_NOT_INSTALLED:$benchmarkModel" }
    }
  }

  if (-not $benchmarkReason) {
    $previousOutputDir = $env:LLM_BENCHMARK_OUTPUT_DIR
    $previousSourceSha = $env:SOURCE_SHA
    $previousModel = $env:OLLAMA_MODEL
    try {
      $env:LLM_BENCHMARK_OUTPUT_DIR = $benchmarkOutput
      $env:SOURCE_SHA = $script:Repos["bridge-cb-benchmark"].sha
      $env:OLLAMA_MODEL = $benchmarkModel
      Push-Location $benchmarkBridge
      try {
        & bun run llm:benchmark 2>&1 | Out-File -FilePath $benchmarkLogPath -Encoding utf8
        $benchmarkExitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
      } finally { Pop-Location }
      $benchmarkStatus = if ($benchmarkExitCode -eq 0) { "PASS" } elseif ($benchmarkExitCode -eq 2) { "CRITICAL" } else { "FAIL" }
    } catch {
      $_.Exception.Message | Out-File -FilePath $benchmarkLogPath -Append -Encoding utf8
      $benchmarkStatus = "FAIL"
      $benchmarkExitCode = 9009
    } finally {
      if ($null -eq $previousOutputDir) { Remove-Item Env:LLM_BENCHMARK_OUTPUT_DIR -ErrorAction SilentlyContinue } else { $env:LLM_BENCHMARK_OUTPUT_DIR = $previousOutputDir }
      if ($null -eq $previousSourceSha) { Remove-Item Env:SOURCE_SHA -ErrorAction SilentlyContinue } else { $env:SOURCE_SHA = $previousSourceSha }
      if ($null -eq $previousModel) { Remove-Item Env:OLLAMA_MODEL -ErrorAction SilentlyContinue } else { $env:OLLAMA_MODEL = $previousModel }
    }
  }

  $script:Results.Add([ordered]@{
    stage="llm-capability-cb1-cb10"
    status=$benchmarkStatus
    exit_code=$benchmarkExitCode
    blocking_reason=$benchmarkReason
    model=$benchmarkModel
    repetitions=3
    started_at=$benchmarkStarted
    completed_at=(Get-Date).ToUniversalTime().ToString("o")
    evidence="llm-benchmark/results.json; llm-benchmark/summary.json"
    log="logs/llm-capability-cb1-cb10.log"
  })
  $script:Repos["bridge_tca1_harness_path"] = $bridge
  $script:Repos["bridge_cb_benchmark"] = [ordered]@{
    repository="c2melendez/precision-lab-bridge"
    branch="feat/cb1-cb10-local-llm-benchmark"
    sha=$script:Repos["bridge-cb-benchmark"].sha
  }
  @{stage="llm-capability-cb1-cb10";status=$benchmarkStatus;model=$benchmarkModel;exit_code=$benchmarkExitCode;blocking_reason=$benchmarkReason;secret_value_logged=$false} |
    ConvertTo-Json | Set-Content -LiteralPath $benchmarkStatusPath -Encoding utf8
  Write-Host "[$benchmarkStatus] llm-capability-cb1-cb10 (model=$benchmarkModel)"

} catch {
  $script:Fatal = $_.Exception.Message
  Write-Host "PRECISION_LAB_SUITE_BLOCKED_OR_FAILED:$script:Fatal" -ForegroundColor Red
}

$critical = @($script:Results | Where-Object { $_.status -eq "CRITICAL" }).Count -gt 0
$failed = @($script:Results | Where-Object { $_.status -eq "FAIL" }).Count -gt 0
$summary = [ordered]@{
  schema_version=1
  suite="precision-lab-windows-local"
  created_at=(Get-Date).ToUniversalTime().ToString("o")
  host_os=[System.Runtime.InteropServices.RuntimeInformation]::OSDescription
  runner_os=$env:RUNNER_OS
  github_run_id=$env:GITHUB_RUN_ID
  github_sha=$env:GITHUB_SHA
  repositories=$script:Repos
  stages=@($script:Results)
  fatal_error_code=$script:Fatal
  outcome=$(if ($script:Fatal) {"BLOCKED"} elseif ($critical) {"CRITICAL"} elseif ($failed) {"FAIL"} else {"PASS_SCOPED"})
}
$summaryPath = Join-Path $runDir "evidence.json"
$summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summaryPath -Encoding utf8
Write-Host "EVIDENCE_FILE=$summaryPath"
Write-Host "SUITE_OUTCOME=$($summary.outcome)"
if ($script:Fatal -or $failed -or $critical) { exit 1 }
exit 0
