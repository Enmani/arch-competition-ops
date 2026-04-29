param(
    [ValidateSet("up", "restart", "stop", "status")]
    [string]$Action = "up"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 3400
$ArtifactsDir = Join-Path $RepoRoot "artifacts"
$OutLog = Join-Path $ArtifactsDir "web-dev.out.log"
$ErrLog = Join-Path $ArtifactsDir "web-dev.err.log"
$StateFile = Join-Path $ArtifactsDir "web-dev.pid.json"
$DevUrl = "http://localhost:$Port"
$script:CommandFailed = $false

function Write-ConsoleLine {
    param(
        [string]$Message
    )

    [Console]::Out.WriteLine($Message)
    [Console]::Out.Flush()
}

function Ensure-ArtifactsDir {
    if (-not (Test-Path $ArtifactsDir)) {
        New-Item -ItemType Directory -Path $ArtifactsDir | Out-Null
    }
}

function Get-ExcludedPortRanges {
    $lines = @()

    try {
        $lines = @(netsh int ipv4 show excludedportrange protocol=tcp 2>$null)
    } catch {
        return @()
    }

    if (-not $lines) {
        return @()
    }

    return @(
        foreach ($line in $lines) {
            if ($line -match '^\s*(\d+)\s+(\d+)\s*(\*)?\s*$') {
                [pscustomobject]@{
                    Start = [int]$matches[1]
                    End = [int]$matches[2]
                    Administered = [bool]$matches[3]
                }
            }
        }
    )
}

function Get-PortExclusionRange {
    param(
        [int]$PortNumber
    )

    foreach ($range in Get-ExcludedPortRanges) {
        if ($PortNumber -ge $range.Start -and $PortNumber -le $range.End) {
            return $range
        }
    }

    return $null
}

function Show-StartupFailureDiagnostics {
    $excludedRange = Get-PortExclusionRange -PortNumber $Port
    if ($null -ne $excludedRange) {
        Write-ConsoleLine "[ERROR] Port $Port falls inside a Windows excluded TCP port range ($($excludedRange.Start)-$($excludedRange.End))."
        Write-ConsoleLine "[ERROR] This machine will block any app from binding $Port until that exclusion is removed."
        Write-ConsoleLine "[INFO] Keep the repo standard on port $Port, then clear or reconfigure the system reservation before retrying."
    }

    if (Test-Path $ErrLog) {
        $errorLines = @(
            Get-Content $ErrLog -ErrorAction SilentlyContinue |
                Where-Object { $_ -and $_.Trim().Length -gt 0 } |
                Select-Object -First 6
        )

        if ($errorLines.Count -gt 0) {
            Write-ConsoleLine "[INFO] Startup error excerpt:"
            foreach ($line in $errorLines) {
                Write-ConsoleLine "  $line"
            }
        }
    }

    Write-ConsoleLine "[INFO] Check logs: artifacts\web-dev.out.log / artifacts\web-dev.err.log"
}

function Get-PortProcessIds {
    $connections = @(
        Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
            Where-Object { $_.State -eq "Listen" }
    )

    if (-not $connections) {
        return @()
    }

    return @(
        $connections |
            Select-Object -ExpandProperty OwningProcess -Unique |
            Where-Object { ($_ -ne 0) }
    )
}

function Test-ProcessExists {
    param(
        [int]$ProcessId
    )

    if ($ProcessId -le 0) {
        return $false
    }

    try {
        Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Get-ProcessCommandLine {
    param(
        [int]$ProcessId
    )

    if (-not (Test-ProcessExists -ProcessId $ProcessId)) {
        return $null
    }

    try {
        return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId").CommandLine
    } catch {
        return $null
    }
}

function Get-State {
    if (-not (Test-Path $StateFile)) {
        return $null
    }

    try {
        return Get-Content $StateFile -Raw | ConvertFrom-Json
    } catch {
        Remove-Item $StateFile -Force -ErrorAction SilentlyContinue
        return $null
    }
}

function Remove-State {
    if (Test-Path $StateFile) {
        Remove-Item $StateFile -Force -ErrorAction SilentlyContinue
    }
}

function Save-State {
    param(
        [int]$LauncherPid,
        [int]$PortPid
    )

    Ensure-ArtifactsDir

    $state = [ordered]@{
        port = $Port
        url = $DevUrl
        startedAt = (Get-Date).ToString("o")
        launcherPid = $LauncherPid
        portPid = $PortPid
        outLog = $OutLog
        errLog = $ErrLog
        portCommandLine = Get-ProcessCommandLine -ProcessId $PortPid
    }

    $state | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8
}

function Get-ManagedServer {
    $state = Get-State
    if ($null -eq $state) {
        return $null
    }

    $portPid = [int]$state.portPid
    $launcherPid = [int]$state.launcherPid

    $launcherAlive = Test-ProcessExists -ProcessId $launcherPid
    $portAlive = Test-ProcessExists -ProcessId $portPid

    if (-not $launcherAlive -and -not $portAlive) {
        Remove-State
        return $null
    }

    return [pscustomobject]@{
        LauncherPid = $launcherPid
        LauncherAlive = $launcherAlive
        PortPid = $portPid
        PortAlive = $portAlive
        State = $state
    }
}

function Test-HttpReady {
    try {
        $request = [System.Net.HttpWebRequest]::Create($DevUrl)
        $request.Method = "HEAD"
        $request.Timeout = 2000
        $request.AllowAutoRedirect = $false
        $response = $request.GetResponse()
        if ($null -ne $response) {
            $response.Close()
        }
        return $true
    } catch [System.Net.WebException] {
        if ($null -ne $_.Exception.Response) {
            $_.Exception.Response.Close()
            return $true
        }
        return $false
    } catch {
        return $false
    }
}

function Wait-ForServerReady {
    param(
        [int]$LauncherPid
    )

    $deadline = (Get-Date).AddSeconds(45)

    while ((Get-Date) -lt $deadline) {
        $portPids = @(Get-PortProcessIds)
        if ($portPids.Count -gt 0 -and (Test-HttpReady)) {
            return [int]$portPids[0]
        }

        if (-not (Test-ProcessExists -ProcessId $LauncherPid) -and $portPids.Count -eq 0) {
            break
        }

        Start-Sleep -Milliseconds 750
    }

    return $null
}

function Wait-ForPortRelease {
    param(
        [int[]]$ProcessIds
    )

    $deadline = (Get-Date).AddSeconds(15)

    while ((Get-Date) -lt $deadline) {
        $listeningPids = @(Get-PortProcessIds)
        $alivePids = @(
            foreach ($processId in $ProcessIds) {
                if ((Test-ProcessExists -ProcessId $processId)) {
                    $processId
                }
            }
        )

        if ($listeningPids.Count -eq 0 -and $alivePids.Count -eq 0) {
            return $true
        }

        Start-Sleep -Milliseconds 500
    }

    return $false
}

function Stop-ProcessTree {
    param(
        [int]$ProcessId
    )

    if (-not (Test-ProcessExists -ProcessId $ProcessId)) {
        return $false
    }

    try {
        $taskKill = Start-Process `
            -FilePath "taskkill.exe" `
            -ArgumentList "/PID", $ProcessId, "/T", "/F" `
            -WindowStyle Hidden `
            -PassThru `
            -Wait

        return ($taskKill.ExitCode -eq 0)
    } catch {
        return $false
    }
}

function Get-PortStatus {
    $managed = Get-ManagedServer
    $portPids = @(Get-PortProcessIds)

    if ($portPids.Count -eq 0) {
        return [pscustomobject]@{
            Mode = "idle"
            Managed = $managed
            PortPids = @()
        }
    }

    if ($null -ne $managed -and ($portPids -contains $managed.PortPid)) {
        return [pscustomobject]@{
            Mode = "managed"
            Managed = $managed
            PortPids = $portPids
        }
    }

    return [pscustomobject]@{
        Mode = "external"
        Managed = $managed
        PortPids = $portPids
    }
}

function Show-Status {
    $status = Get-PortStatus

    switch ($status.Mode) {
        "idle" {
            if ($null -ne $status.Managed) {
                Write-ConsoleLine "[WARN] Managed server metadata exists, but port $Port is not listening."
                Write-ConsoleLine "[INFO] Managed PID: $($status.Managed.PortPid)"
                Write-ConsoleLine "[INFO] Logs: artifacts\web-dev.out.log / artifacts\web-dev.err.log"
                return
            }

            Write-ConsoleLine "[INFO] Port $Port is idle."
        }
        "managed" {
            Write-ConsoleLine "[OK] Managed dev server is active on $DevUrl"
            Write-ConsoleLine "[INFO] Managed PID: $($status.Managed.PortPid)"
            Write-ConsoleLine "[INFO] Logs: artifacts\web-dev.out.log / artifacts\web-dev.err.log"
        }
        "external" {
            Write-ConsoleLine "[WARN] Port $Port is already in use by a process not managed by dev-port.ps1."
            foreach ($processId in $status.PortPids) {
                Write-ConsoleLine "[INFO] External PID: $processId"
                $commandLine = Get-ProcessCommandLine -ProcessId $processId
                if ($commandLine) {
                    Write-ConsoleLine "[INFO] Command: $commandLine"
                }
            }
            Write-ConsoleLine "[INFO] URL: $DevUrl"
            Write-ConsoleLine "[INFO] Refusing to stop or restart this external process automatically."
        }
    }

}

function Stop-ManagedServer {
    $managed = Get-ManagedServer
    if ($null -eq $managed) {
        Write-ConsoleLine "[INFO] No managed dev server to stop."
        return
    }

    $stopped = $false
    foreach ($processId in @($managed.PortPid, $managed.LauncherPid) | Select-Object -Unique) {
        if (Test-ProcessExists -ProcessId $processId) {
            $taskKillStopped = Stop-ProcessTree -ProcessId $processId
            if (-not $taskKillStopped -and (Test-ProcessExists -ProcessId $processId)) {
                Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
            }
            $stopped = $true
        }
    }

    $released = Wait-ForPortRelease -ProcessIds @($managed.PortPid, $managed.LauncherPid)
    if (-not $released) {
        $remainingPortPids = @(Get-PortProcessIds)
        if ($remainingPortPids.Count -gt 0) {
            Write-ConsoleLine "[ERROR] Failed to stop managed dev server cleanly; port $Port is still listening."
            foreach ($processId in $remainingPortPids) {
                Write-ConsoleLine "[INFO] Remaining PID: $processId"
                $commandLine = Get-ProcessCommandLine -ProcessId $processId
                if ($commandLine) {
                    Write-ConsoleLine "[INFO] Command: $commandLine"
                }
            }
            Write-ConsoleLine "[INFO] Logs: artifacts\web-dev.out.log / artifacts\web-dev.err.log"
            $script:CommandFailed = $true
            return
        }
    }

    Remove-State

    if ($stopped) {
        Write-ConsoleLine "[OK] Stopped managed dev server on port $Port."
    } else {
        Write-ConsoleLine "[INFO] Managed server was already stopped."
    }

}

function Start-WebDev {
    Ensure-ArtifactsDir
    $script:CommandFailed = $false

    $excludedRange = Get-PortExclusionRange -PortNumber $Port
    if ($null -ne $excludedRange) {
        Write-ConsoleLine "[ERROR] Refusing to start because port $Port falls inside an excluded TCP port range ($($excludedRange.Start)-$($excludedRange.End))."
        Write-ConsoleLine "[INFO] Keep the repo standard on port $Port, then clear or reconfigure the system reservation before retrying."
        $script:CommandFailed = $true
        return
    }

    if (Test-Path $OutLog) {
        Remove-Item $OutLog -Force
    }

    if (Test-Path $ErrLog) {
        Remove-Item $ErrLog -Force
    }

    $launcher = Start-Process `
        -FilePath "npm.cmd" `
        -ArgumentList "run", "dev:web" `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $OutLog `
        -RedirectStandardError $ErrLog `
        -PassThru

    $portPid = Wait-ForServerReady -LauncherPid $launcher.Id
    if ($null -eq $portPid) {
        Write-ConsoleLine "[ERROR] Dev server did not become healthy on $DevUrl"
        Show-StartupFailureDiagnostics
        $script:CommandFailed = $true
        return
    }

    Save-State -LauncherPid $launcher.Id -PortPid $portPid

    Write-ConsoleLine "[OK] Dev server started on $DevUrl"
    Write-ConsoleLine "[INFO] Managed PID: $portPid"
    Write-ConsoleLine "[INFO] Logs: artifacts\web-dev.out.log / artifacts\web-dev.err.log"
}

function Start-Or-ReuseManagedServer {
    $status = Get-PortStatus

    switch ($status.Mode) {
        "managed" {
            Show-Status
            return
        }
        "external" {
            Show-Status
            return
        }
        "idle" {
            Start-WebDev
            return
        }
    }
}

function Restart-ManagedServer {
    $status = Get-PortStatus

    switch ($status.Mode) {
        "external" {
            Show-Status
            return
        }
        "managed" {
            Stop-ManagedServer | Out-Null
            Start-WebDev
            return
        }
        "idle" {
            Start-WebDev
            return
        }
    }
}

switch ($Action) {
    "status" {
        Show-Status
    }
    "stop" {
        $status = Get-PortStatus
        if ($status.Mode -eq "external") {
            Show-Status
            exit 1
        }

        Stop-ManagedServer
        if ($script:CommandFailed) {
            exit 1
        }
    }
    "restart" {
        $status = Get-PortStatus
        if ($status.Mode -eq "external") {
            Show-Status
            exit 1
        }

        Restart-ManagedServer
        if ($script:CommandFailed) {
            exit 1
        }
    }
    "up" {
        Start-Or-ReuseManagedServer
        if ($script:CommandFailed) {
            exit 1
        }
    }
}
