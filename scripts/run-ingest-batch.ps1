<#
.SYNOPSIS
    Runs one auto-ingest batch (called by Windows Task Scheduler or by hand).

.DESCRIPTION
    This script only invokes, logs, judges exit codes and raises alerts. The Python CLI owns
    the real work: the batch-level lock (artifacts/automation/ingest.lock) and the
    once-per-day expired-competition cleanup live inside `arch-competition-ops`, so
    this script neither takes a lock nor decides whether cleanup already ran.

    Works on Windows PowerShell 5.1 (powershell.exe, what the scheduled task uses) and pwsh 7.

    Outputs, all under -ArtifactsDir (default: <repo>\artifacts):
      logs\auto-ingest\<BatchId>-<yyyyMMdd>.log  one appended log per batch per day, pruned after -LogRetentionDays
      automation\last-success.json              latest successful run (any batch)
      automation\last-failure.json              latest failed run; cleared only by a later success of the SAME batch
    Failures are also written to the Windows Application event log when the event source
    "arch-competition-ops" is registered (see Write-FailureEvent). That is best effort;
    last-failure.json is the reliable alert surface.

    Exit code: 0 on success, otherwise the first non-zero exit code of the failed steps.

.PARAMETER UvPath
    Explicit uv executable. Mainly for tests (inject a stand-in); normally auto-discovered.

.PARAMETER ArtifactsDir
    Root for logs and state files. Mainly for tests.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$BatchId,
    [int]$LimitPerSource,
    [string]$PublicationDateFrom,
    [switch]$FailFast,
    [string]$UvPath,
    [string]$ArtifactsDir,
    [ValidateRange(1, 3650)]
    [int]$LogRetentionDays = 30,
    [ValidateRange(1, 500)]
    [int]$FailureTailLines = 30
)

Set-StrictMode -Version Latest
# Applies to PowerShell cmdlets only. Native commands are wrapped in Invoke-LoggedNative, which
# switches to Continue: under Windows PowerShell 5.1 any stderr line from a native command
# (uv prints a deprecation warning on every run) becomes a terminating error when this is "Stop".
$ErrorActionPreference = "Stop"

$EventSource = "arch-competition-ops"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
if (-not $ArtifactsDir) {
    $ArtifactsDir = Join-Path $repoRoot "artifacts"
}
$logDir = Join-Path $ArtifactsDir "logs\auto-ingest"
$stateDir = Join-Path $ArtifactsDir "automation"
$logPath = Join-Path $logDir ("{0}-{1}.log" -f $BatchId, (Get-Date -Format "yyyyMMdd"))
$failurePath = Join-Path $stateDir "last-failure.json"
$successPath = Join-Path $stateDir "last-success.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$runOutput = New-Object System.Collections.Generic.List[string]
$startedAt = Get-Date

function Write-Log {
    param([string]$Message)
    $stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $line = "{0} {1}" -f $stamp, $Message
    # Explicit UTF-8: Tee-Object / Out-File -Append would write UTF-16 under Windows PowerShell 5.1.
    [System.IO.File]::AppendAllText($logPath, $line + [Environment]::NewLine, $utf8NoBom)
    Write-Host $line
    $runOutput.Add($Message)
}

function Write-JsonFile {
    param([string]$Path, $Value)
    $json = ConvertTo-Json -InputObject $Value -Depth 5
    $tmp = "$Path.tmp"
    [System.IO.File]::WriteAllText($tmp, $json, $utf8NoBom)
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Invoke-LoggedNative {
    # Runs a native command, appends stdout+stderr to the log, returns its exit code.
    param([string]$Step, [string]$FilePath, [string[]]$Arguments)

    Write-Log ("[INFO] {0}: {1} {2}" -f $Step, $FilePath, ($Arguments -join " "))
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $global:LASTEXITCODE = 0
    $exitCode = 0
    try {
        & $FilePath @Arguments 2>&1 | ForEach-Object {
            # With 2>&1 the stderr lines arrive as ErrorRecord objects; keep only the text.
            if ($_ -is [System.Management.Automation.ErrorRecord]) {
                Write-Log $_.Exception.Message
            }
            else {
                Write-Log ([string]$_)
            }
        }
        $exitCode = $global:LASTEXITCODE
    }
    catch {
        Write-Log ("[ERROR] {0}: could not run command: {1}" -f $Step, $_.Exception.Message)
        $exitCode = 1
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($null -eq $exitCode) {
        $exitCode = 0
    }
    return [int]$exitCode
}

function Remove-OldLogs {
    $cutoff = (Get-Date).AddDays(-$LogRetentionDays)
    Get-ChildItem -LiteralPath $logDir -Filter "*.log" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt $cutoff } |
        ForEach-Object {
            $oldLog = $_
            try {
                Remove-Item -LiteralPath $oldLog.FullName -Force -ErrorAction Stop
            }
            catch {
                Write-Log ("[WARN] Could not delete old log {0}: {1}" -f $oldLog.Name, $_.Exception.Message)
            }
        }
}

function Write-FailureEvent {
    # Best effort. Registering an event source needs administrator rights, so on a normal
    # user-level install this is skipped and last-failure.json stays the only alert surface.
    # To enable once (elevated): New-EventLog -LogName Application -Source arch-competition-ops
    # Uses the .NET EventLog class because Write-EventLog does not exist in pwsh 7.
    param([string]$Message)
    try {
        if (-not [System.Diagnostics.EventLog]::SourceExists($EventSource)) {
            return "skipped: event source '$EventSource' is not registered"
        }
        [System.Diagnostics.EventLog]::WriteEntry($EventSource, $Message, [System.Diagnostics.EventLogEntryType]::Error, 1001)
        return "written"
    }
    catch {
        return "skipped: " + $_.Exception.Message
    }
}

function Resolve-UvPath {
    if ($UvPath) {
        if (Test-Path -LiteralPath $UvPath) {
            return (Resolve-Path -LiteralPath $UvPath).Path
        }
        return $null
    }
    $command = Get-Command uv -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    $candidates = @()
    if ($env:USERPROFILE) { $candidates += (Join-Path $env:USERPROFILE ".local\bin\uv.exe") }
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "Programs\uv\uv.exe") }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }
    return $null
}

foreach ($dir in @($logDir, $stateDir)) {
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

# Child processes: UTF-8 stdout so log text (Italian / German / Chinese titles) is not mangled
# by the console code page, and no ANSI colour codes in log files.
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:NO_COLOR = "1"
try {
    [Console]::OutputEncoding = $utf8NoBom
}
catch {
    # No console attached (scheduled task): the child output is then decoded with the default code page.
}

$failedSteps = New-Object System.Collections.Generic.List[object]
$overallExit = 0

try {
    Remove-OldLogs
    Write-Log ("[INFO] Batch {0} starting (PowerShell {1}, log {2})" -f $BatchId, $PSVersionTable.PSVersion, $logPath)

    $uv = Resolve-UvPath
    if (-not $uv) {
        Write-Log "[ERROR] uv is not available on PATH, in the expected user install locations, or at -UvPath."
        $failedSteps.Add([pscustomobject]@{ step = "locate-uv"; exit_code = 1 })
        $overallExit = 1
    }
    else {
        Push-Location $repoRoot
        try {
            # The command de-duplicates itself to once per day; calling it every time is intended.
            # A cleanup failure is recorded but does not block ingestion.
            $cleanupExit = Invoke-LoggedNative -Step "cleanup" -FilePath $uv -Arguments @("run", "arch-competition-ops", "cleanup-expired-competitions")
            if ($cleanupExit -ne 0) {
                $failedSteps.Add([pscustomobject]@{ step = "cleanup-expired-competitions"; exit_code = $cleanupExit })
                if ($overallExit -eq 0) { $overallExit = $cleanupExit }
            }

            $ingestArgs = @("run", "arch-competition-ops", "ingest-batch", "--batch-id", $BatchId)
            if ($PSBoundParameters.ContainsKey("LimitPerSource")) {
                $ingestArgs += @("--limit-per-source", $LimitPerSource.ToString())
            }
            if ($PublicationDateFrom) {
                $ingestArgs += @("--publication-date-from", $PublicationDateFrom)
            }
            if ($FailFast) {
                $ingestArgs += "--fail-fast"
            }
            $ingestExit = Invoke-LoggedNative -Step "ingest-batch" -FilePath $uv -Arguments $ingestArgs
            if ($ingestExit -ne 0) {
                $failedSteps.Add([pscustomobject]@{ step = "ingest-batch"; exit_code = $ingestExit })
                # The ingest exit code is the more informative one.
                $overallExit = $ingestExit
            }
        }
        finally {
            Pop-Location
        }
    }
}
catch {
    Write-Log ("[ERROR] Unexpected failure: {0}" -f $_.Exception.Message)
    $failedSteps.Add([pscustomobject]@{ step = "script"; exit_code = 1 })
    if ($overallExit -eq 0) { $overallExit = 1 }
}

$finishedAt = Get-Date
$durationSeconds = [math]::Round(($finishedAt - $startedAt).TotalSeconds, 1)

if ($overallExit -ne 0) {
    $tail = @($runOutput | Select-Object -Last $FailureTailLines)
    $summary = "Batch {0} failed (exit {1}, steps: {2}). Log: {3}" -f $BatchId, $overallExit, (($failedSteps | ForEach-Object { $_.step }) -join ", "), $logPath
    Write-Log ("[FAIL] " + $summary)
    $eventResult = Write-FailureEvent -Message ($summary + [Environment]::NewLine + ($tail -join [Environment]::NewLine))
    try {
        Write-JsonFile -Path $failurePath -Value ([ordered]@{
                failed_at = $finishedAt.ToString("o")
                batch_id = $BatchId
                exit_code = $overallExit
                failed_steps = $failedSteps.ToArray()
                duration_seconds = $durationSeconds
                log_path = $logPath
                event_log = $eventResult
                tail = $tail
            })
    }
    catch {
        Write-Host ("[ERROR] Could not write {0}: {1}" -f $failurePath, $_.Exception.Message)
    }
    exit $overallExit
}

Write-Log ("[OK] Batch {0} completed in {1}s" -f $BatchId, $durationSeconds)
try {
    Write-JsonFile -Path $successPath -Value ([ordered]@{
            finished_at = $finishedAt.ToString("o")
            batch_id = $BatchId
            exit_code = 0
            duration_seconds = $durationSeconds
            log_path = $logPath
        })
    # Clear the failure marker only when the batch that failed has now succeeded, so a green
    # daytime run does not hide a red nightly run.
    if (Test-Path -LiteralPath $failurePath) {
        $previous = $null
        try { $previous = Get-Content -LiteralPath $failurePath -Raw | ConvertFrom-Json } catch { $previous = $null }
        if (($null -eq $previous) -or ($previous.PSObject.Properties.Name -notcontains "batch_id") -or ($previous.batch_id -eq $BatchId)) {
            Remove-Item -LiteralPath $failurePath -Force
        }
    }
}
catch {
    Write-Host ("[WARN] Could not update state files: {0}" -f $_.Exception.Message)
}
exit 0
