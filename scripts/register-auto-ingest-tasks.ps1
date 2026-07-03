param(
    [ValidateSet("Install", "Remove", "Show")]
    [string]$Action = "Show",
    [string[]]$DayTimes = @("06:30", "14:30"),
    [string[]]$NightTimes = @("02:30"),
    [string]$TaskPrefix = "arch-competition-ops"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$runScript = Join-Path $scriptDir "run-ingest-batch.ps1"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

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
        -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"{0}`" -BatchId {1}" -f $runScript, $Spec.BatchId) `
        -WorkingDirectory $repoRoot
    $atTime = [datetime]::Today.Add([timespan]::Parse($Spec.TimeValue))
    $trigger = New-ScheduledTaskTrigger -Daily -At $atTime
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable

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

function Remove-OneTask {
    param(
        [pscustomobject]$Spec
    )

    if (Get-ScheduledTask -TaskName $Spec.TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $Spec.TaskName -Confirm:$false
        Write-Output ("[OK] Removed {0}" -f $Spec.TaskName)
        return
    }
    Write-Output ("[INFO] Task not found {0}" -f $Spec.TaskName)
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
            $task = Get-ScheduledTask -TaskName $spec.TaskName -ErrorAction SilentlyContinue
            if ($task) {
                Write-Output ("[OK] {0} :: {1} :: installed" -f $spec.TaskName, $spec.BatchId)
            }
            else {
                Write-Output ("[INFO] {0} :: {1} :: missing" -f $spec.TaskName, $spec.BatchId)
            }
        }
    }
}
