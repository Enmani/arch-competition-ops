param(
    [Parameter(Mandatory = $true)]
    [string]$BatchId,
    [int]$LimitPerSource,
    [string]$PublicationDateFrom,
    [switch]$FailFast
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$logDir = Join-Path $repoRoot "artifacts\\logs\\auto-ingest"
$cleanupStateDir = Join-Path $repoRoot "artifacts\\automation"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $logDir ("{0}-{1}.log" -f $BatchId, $timestamp)

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}
if (-not (Test-Path $cleanupStateDir)) {
    New-Item -ItemType Directory -Path $cleanupStateDir -Force | Out-Null
}

$uvPath = $null
$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
if ($uvCommand) {
    $uvPath = $uvCommand.Source
}
else {
    $uvCandidatePaths = @()
    if ($env:USERPROFILE) {
        $uvCandidatePaths += (Join-Path $env:USERPROFILE ".local\bin\uv.exe")
    }
    if ($env:LOCALAPPDATA) {
        $uvCandidatePaths += (Join-Path $env:LOCALAPPDATA "Programs\uv\uv.exe")
    }

    foreach ($candidatePath in $uvCandidatePaths) {
        if (Test-Path $candidatePath) {
            $uvPath = $candidatePath
            break
        }
    }
}

if (-not $uvPath) {
    "uv is not available on PATH or in the expected user install locations." |
        Tee-Object -FilePath $logPath -Append
    exit 1
}

$commandArgs = @(
    "run",
    "python",
    "apps/worker/scripts/ingest_batch.py",
    "--batch-id",
    $BatchId
)

if ($PSBoundParameters.ContainsKey("LimitPerSource")) {
    $commandArgs += @("--limit-per-source", $LimitPerSource.ToString())
}
if ($PublicationDateFrom) {
    $commandArgs += @("--publication-date-from", $PublicationDateFrom)
}
if ($FailFast) {
    $commandArgs += "--fail-fast"
}

Push-Location $repoRoot
try {
    $cleanupStatePath = Join-Path $cleanupStateDir "expired-competition-cleanup-state.json"
    $todayKey = (Get-Date).ToString("yyyy-MM-dd")
    $cleanupAlreadyRan = $false

    if (Test-Path $cleanupStatePath) {
        try {
            $cleanupState = Get-Content $cleanupStatePath -Raw | ConvertFrom-Json
            if ($cleanupState.last_run_date -eq $todayKey) {
                $cleanupAlreadyRan = $true
            }
        }
        catch {
            $cleanupAlreadyRan = $false
        }
    }

    if (-not $cleanupAlreadyRan) {
        Write-Output "[INFO] Running expired competition cleanup"
        & $uvPath run arch-competition-ops cleanup-expired-competitions 2>&1 | Tee-Object -FilePath $logPath -Append
        if ($LASTEXITCODE -ne 0) {
            throw "Expired competition cleanup failed."
        }
    }
    else {
        Write-Output "[INFO] Expired competition cleanup already ran today" | Tee-Object -FilePath $logPath -Append
    }

    Write-Output "[INFO] Running auto-ingest batch $BatchId"
    Write-Output "[INFO] Log file $logPath"
    & $uvPath @commandArgs 2>&1 | Tee-Object -FilePath $logPath -Append
    $exitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

if ($null -eq $exitCode) {
    $exitCode = 0
}
if ($exitCode -ne 0) {
    Write-Error ("Batch {0} failed with exit code {1}. See {2}" -f $BatchId, $exitCode, $logPath)
    exit $exitCode
}

Write-Output "[OK] Batch completed"
exit 0
