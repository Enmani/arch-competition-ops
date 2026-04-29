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
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $logDir ("{0}-{1}.log" -f $BatchId, $timestamp)

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCommand) {
    Write-Error "uv is not available on PATH."
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
    Write-Output "[INFO] Running auto-ingest batch $BatchId"
    Write-Output "[INFO] Log file $logPath"
    & $uvCommand.Source @commandArgs 2>&1 | Tee-Object -FilePath $logPath
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
}

Write-Output "[OK] Batch completed"
exit 0
