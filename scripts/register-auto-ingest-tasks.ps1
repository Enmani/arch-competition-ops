<#
.SYNOPSIS
    Installs, removes or shows the Windows scheduled tasks that run run-ingest-batch.ps1.

.DESCRIPTION
    Runs without administrator rights (tasks are registered for the current user only).
    Works under Windows PowerShell 5.1 and pwsh 7. Use -WhatIf with -Action Install to build
    the task definitions and print the effective settings without registering anything.

    Logon type: S4U (default). A task registered as "Interactive" only runs while the user is
    logged on, which silently skips overnight batches. S4U ("Run whether user is logged on
    or not", without storing a password) runs in a non-interactive session instead.
    S4U limitation: the task gets no network credentials and cannot use the user's
    Credential Manager / DPAPI-protected secrets or authenticate to network shares.
    Plain internet access (what the ingest does) is unaffected. If S4U registration is
    refused on a machine, retry with -LogonType Interactive and accept the logged-on limit.

    The three tasks keep their original schedule. They no longer need staggered times to avoid
    overlapping SQLite writes: the Python CLI takes a batch-level lock, so an overlapping run
    waits for or yields to the one in progress.
    Tasks registered by an older version of this script must be re-installed (-Action Install
    replaces them) to pick up the new settings.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateSet("Install", "Remove", "Show")]
    [string]$Action = "Show",
    [string[]]$DayTimes = @("06:30", "14:30"),
    [string[]]$NightTimes = @("02:30"),
    [string]$TaskPrefix = "arch-competition-ops",
    [ValidateSet("S4U", "Interactive")]
    [string]$LogonType = "S4U",
    [ValidateRange(1, 24)]
    [int]$TimeLimitHours = 2,
    [ValidateRange(0, 10)]
    [int]$RestartCount = 2,
    [ValidateRange(1, 1440)]
    [int]$RestartIntervalMinutes = 10,
    [string]$ArtifactsDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$runScript = Join-Path $scriptDir "run-ingest-batch.ps1"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not $ArtifactsDir) {
    $ArtifactsDir = Join-Path $repoRoot "artifacts"
}
$stateDir = Join-Path $ArtifactsDir "automation"

function New-TaskName {
    param(
        [string]$Prefix,
        [string]$BatchId,
        [string]$TimeValue
    )

    $safeTime = $TimeValue.Replace(":", "")
    return ("{0}-{1}-{2}" -f $Prefix, $BatchId, $safeTime)
}

function New-BatchTaskSpec {
    param(
        [string]$BatchId,
        [string[]]$Times
    )

    $specs = @()
    foreach ($timeValue in $Times) {
        $specs += [pscustomobject]@{
            BatchId = $BatchId
            TimeValue = $timeValue
            TaskName = New-TaskName -Prefix $TaskPrefix -BatchId $BatchId -TimeValue $timeValue
        }
    }
    return $specs
}

function Get-AllTaskSpecs {
    $specs = @()
    $specs += New-BatchTaskSpec -BatchId "official_daytime" -Times $DayTimes
    $specs += New-BatchTaskSpec -BatchId "secondary_nightly" -Times $NightTimes
    return $specs
}

function Register-OneTask {
    param(
        [pscustomobject]$Spec
    )

    $taskAction = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`" -BatchId {1}" -f $runScript, $Spec.BatchId) `
        -WorkingDirectory $repoRoot
    $atTime = [datetime]::Today.Add([timespan]::Parse($Spec.TimeValue))
    $trigger = New-ScheduledTaskTrigger -Daily -At $atTime
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType $LogonType -RunLevel Limited
    # ExecutionTimeLimit: a hung fetch must not block the next run forever.
    # IgnoreNew: a manual or restarted instance of the same task never stacks up.
    # StartWhenAvailable: run a missed schedule (machine was off) once the machine is back.
    # RunOnlyIfNetworkAvailable: avoid a guaranteed failure without network.
    # Restart*: retry a failed run a few times, spaced out.
    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Hours $TimeLimitHours) `
        -RunOnlyIfNetworkAvailable `
        -RestartCount $RestartCount `
        -RestartInterval (New-TimeSpan -Minutes $RestartIntervalMinutes)

    Write-Output ("[INFO] {0} :: logon={1} limit={2} multiple={3} startWhenAvailable={4} networkOnly={5} restart={6}x/{7}" -f `
            $Spec.TaskName, $principal.LogonType, $settings.ExecutionTimeLimit, $settings.MultipleInstances, `
            $settings.StartWhenAvailable, $settings.RunOnlyIfNetworkAvailable, $settings.RestartCount, $settings.RestartInterval)

    if ($PSCmdlet.ShouldProcess($Spec.TaskName, "Register scheduled task")) {
        Register-ScheduledTask `
            -TaskName $Spec.TaskName `
            -Action $taskAction `
            -Trigger $trigger `
            -Principal $principal `
            -Settings $settings `
            -Description ("Arch Competition Ops auto-ingest batch {0} at {1}" -f $Spec.BatchId, $Spec.TimeValue) `
            -Force | Out-Null
        Write-Output ("[OK] Registered {0}" -f $Spec.TaskName)
    }
}

function Remove-OneTask {
    param(
        [pscustomobject]$Spec
    )

    if (Get-ScheduledTask -TaskName $Spec.TaskName -ErrorAction SilentlyContinue) {
        if ($PSCmdlet.ShouldProcess($Spec.TaskName, "Unregister scheduled task")) {
            Unregister-ScheduledTask -TaskName $Spec.TaskName -Confirm:$false
            Write-Output ("[OK] Removed {0}" -f $Spec.TaskName)
        }
        return
    }
    Write-Output ("[INFO] Task not found {0}" -f $Spec.TaskName)
}

function Show-OneTask {
    param(
        [pscustomobject]$Spec
    )

    $task = Get-ScheduledTask -TaskName $Spec.TaskName -ErrorAction SilentlyContinue
    if (-not $task) {
        Write-Output ("[INFO] {0} :: {1} :: missing" -f $Spec.TaskName, $Spec.BatchId)
        return
    }
    $info = Get-ScheduledTaskInfo -TaskName $Spec.TaskName
    # 267011 (0x41303) = task has never run. Everything else non-zero is a failed last run.
    $resultText = if ($info.LastTaskResult -eq 0) { "success" }
    elseif ($info.LastTaskResult -eq 267011) { "never run" }
    else { "FAILED (0x{0:X})" -f [uint32]$info.LastTaskResult }
    Write-Output ("[OK] {0} :: {1} :: installed :: state={2} :: logon={3}" -f $Spec.TaskName, $Spec.BatchId, $task.State, $task.Principal.LogonType)
    Write-Output ("     last run {0} :: result {1} :: next run {2}" -f $info.LastRunTime, $resultText, $info.NextRunTime)
}

function Show-StateFile {
    param([string]$Label, [string]$FileName)

    $path = Join-Path $stateDir $FileName
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Output ("[INFO] {0}: none ({1})" -f $Label, $path)
        return
    }
    try {
        $data = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    }
    catch {
        Write-Output ("[WARN] {0}: unreadable {1}: {2}" -f $Label, $path, $_.Exception.Message)
        return
    }
    $when = if ($data.PSObject.Properties.Name -contains "failed_at") { $data.failed_at } else { $data.finished_at }
    Write-Output ("[{0}] {1}: batch={2} exit={3} at={4}" -f $(if ($Label -eq "last-failure") { "FAIL" } else { "OK" }), $Label, $data.batch_id, $data.exit_code, $when)
    Write-Output ("     log {0}" -f $data.log_path)
    if ($data.PSObject.Properties.Name -contains "tail") {
        foreach ($line in @($data.tail | Select-Object -Last 8)) {
            Write-Output ("     | {0}" -f $line)
        }
    }
}

$taskSpecs = Get-AllTaskSpecs

switch ($Action) {
    "Install" {
        foreach ($spec in $taskSpecs) {
            Register-OneTask -Spec $spec
        }
    }
    "Remove" {
        foreach ($spec in $taskSpecs) {
            Remove-OneTask -Spec $spec
        }
    }
    "Show" {
        foreach ($spec in $taskSpecs) {
            Show-OneTask -Spec $spec
        }
        Show-StateFile -Label "last-success" -FileName "last-success.json"
        Show-StateFile -Label "last-failure" -FileName "last-failure.json"
    }
}
