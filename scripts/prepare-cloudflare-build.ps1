$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$openNextPath = Join-Path $repoRoot "apps\web\.open-next"
$repoPattern = [Regex]::Escape($repoRoot)
$commandPattern = "$repoPattern.*(opennextjs-cloudflare|wrangler|workerd|next(\.exe)?\s+(dev|start)|next\\dist\\bin\\next)"

function Get-TemporaryDriveName {
  foreach ($candidate in @("Z", "Y", "X", "W", "V", "U", "T")) {
    if (-not (Get-PSDrive -Name $candidate -ErrorAction SilentlyContinue)) {
      return $candidate
    }
  }

  throw "No free temporary PSDrive letter is available for Cloudflare build cleanup."
}

function Remove-RepoDirectoryThroughShortDrive {
  param(
    [Parameter(Mandatory = $true)]
    [string] $TargetPath
  )

  if (-not (Test-Path -LiteralPath $TargetPath)) {
    return
  }

  $resolvedTargetPath = (Resolve-Path -LiteralPath $TargetPath).Path
  if (-not $resolvedTargetPath.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTargetPath -Recurse -Force -ErrorAction Stop
    return
  }

  try {
    [System.IO.Directory]::Delete("\\?\$resolvedTargetPath", $true)
  } finally {
    if (Test-Path -LiteralPath $resolvedTargetPath) {
      Remove-Item -LiteralPath $resolvedTargetPath -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

$processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -in @("node.exe", "workerd.exe") -and
    $_.CommandLine -and
    $_.CommandLine -match $commandPattern
  }

if ($processes) {
  Write-Host "Stopping repo-local preview/dev processes that can lock .open-next..."
  foreach ($process in $processes) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      Write-Host ("  Stopped PID {0}" -f $process.ProcessId)
    } catch {
      Write-Warning ("  Failed to stop PID {0}: {1}" -f $process.ProcessId, $_.Exception.Message)
    }
  }

  Start-Sleep -Seconds 2
}

if (Test-Path $openNextPath) {
  Write-Host "Removing stale .open-next build directory..."

  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      Remove-RepoDirectoryThroughShortDrive -TargetPath $openNextPath
      break
    } catch {
      if ($attempt -eq 5) {
        throw
      }

      Start-Sleep -Seconds 2
    }
  }
}

Write-Host "Cloudflare build workspace is ready."
