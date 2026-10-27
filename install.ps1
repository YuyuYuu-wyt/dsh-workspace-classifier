param(
  [string]$Profile = "desktop",
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "dsh-plugins\dsh-workspace-classifier")
)

$ErrorActionPreference = "Stop"
$repo = "https://github.com/YuyuYuu-wyt/dsh-workspace-classifier.git"

function Find-Dsh {
  $command = Get-Command dsh -ErrorAction SilentlyContinue
  if ($command -ne $null) { return $command.Source }
  $candidate = Join-Path $env:LOCALAPPDATA "Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
  if (Test-Path $candidate) { return $candidate }
  throw "dsh CLI not found. Add the DSH CLI to PATH, or run the manual install steps in the README."
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required. Install Git for Windows first: https://git-scm.com/download/win"
}

if (Test-Path (Join-Path $InstallDir ".git")) {
  Write-Host "Updating plugin at $InstallDir ..."
  git -C $InstallDir pull --ff-only
}
else {
  Write-Host "Cloning plugin into $InstallDir ..."
  $parent = Split-Path -Parent $InstallDir
  if ($parent -ne "" -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  git clone --depth 1 $repo $InstallDir
}

$dsh = Find-Dsh
Write-Host "Linking plugin into DSH profile '$Profile' ..."
& $dsh plugin --profile $Profile add "link:$InstallDir"

Write-Host ""
Write-Host "Done. Refresh DSH (Ctrl+Shift+R) and look for the grouping icon on the right side of the Workspace header." -ForegroundColor Green
Write-Host "To update later: run this installer again or 'git -C `"$InstallDir`" pull' and refresh DSH."
