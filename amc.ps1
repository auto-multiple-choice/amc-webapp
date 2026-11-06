# AMC web app launcher for Windows (on macOS and Linux, use ./amc).
# Run it through amc.cmd:  amc help
#
# Keep this file working with Windows PowerShell 5.1 (built into Windows)
# as well as PowerShell 7. Native commands are checked through
# $LASTEXITCODE: with $ErrorActionPreference = 'Stop', Windows PowerShell 5.1
# turns any stderr output from docker or git into a fatal error.

$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot

$Service    = 'amc-web'           # service name in docker-compose.yml
$Image      = 'amc-web'           # image name in docker-compose.yml
$MinCompose = [version]'2.24.4'   # first version supporting `!override`
$EnvFile    = Join-Path $PSScriptRoot '.env'
$Utf8NoBom  = New-Object System.Text.UTF8Encoding $false

function Say([string]$m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host "OK  $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "Warning: $m" -ForegroundColor Yellow }
function Die([string]$m)  { Write-Host "Error: $m" -ForegroundColor Red; exit 1 }

function Show-Usage {
  @'
AMC web app launcher

Usage: amc <command> [options]

Commands:
  start [--no-open]    Build if needed, start the app and open it in the browser
  stop                 Stop the app (projects are kept)
  restart [--no-open]  Stop, then start (needed after editing .env)
  status               Show whether the app is running, and where
  logs                 Follow the server log (Ctrl+C to quit)
  open                 Open the app in the browser
  update [--no-open]   Pull the latest version of this repository, then restart
  import <folder>...   Copy existing AMC project folders into the app
  help                 Show this help

Settings are in .env, created on first start (see .env.example).
'@ | Write-Host
}

# --- settings ---------------------------------------------------------------

function Get-EnvValue([string]$Key, [string]$Default) {
  if (-not (Test-Path -LiteralPath $EnvFile)) { return $Default }
  $pattern = '^\s*' + [regex]::Escape($Key) + '='
  $line = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match $pattern } | Select-Object -Last 1
  if (-not $line) { return $Default }
  return ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}

function Get-IanaTimeZone {
  $id = [System.TimeZoneInfo]::Local.Id
  if ($id -match '/') { return $id }   # already an IANA name (PowerShell 7 off Windows)
  # PowerShell 7 (.NET 6+) can convert Windows names; 5.1 can't.
  $iana = $null
  $method = [System.TimeZoneInfo].GetMethod('TryConvertWindowsIdToIanaId', [type[]]@([string], [string].MakeByRefType()))
  if ($method -and [System.TimeZoneInfo]::TryConvertWindowsIdToIanaId($id, [ref]$iana)) { return $iana }
  $known = @{
    'India Standard Time'   = 'Asia/Kolkata'
    'UTC'                   = 'UTC'
    'GMT Standard Time'     = 'Europe/London'
    'W. Europe Standard Time' = 'Europe/Berlin'
    'Romance Standard Time' = 'Europe/Paris'
    'Eastern Standard Time' = 'America/New_York'
    'Central Standard Time' = 'America/Chicago'
    'Pacific Standard Time' = 'America/Los_Angeles'
  }
  if ($known.ContainsKey($id)) { return $known[$id] }
  return 'UTC'
}

function Initialize-EnvFile {
  if (Test-Path -LiteralPath $EnvFile) { return }
  Say 'First run: writing settings to .env'
  $data = (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'AMC-Web') -replace '\\', '/'
  $lines = @(
    '# AMC web app settings (see .env.example). Run "amc restart" after editing.'
    'AMC_PORT=8090'
    'AMC_BIND=127.0.0.1'
    "AMC_DATA_DIR=$data"
    "TZ=$(Get-IanaTimeZone)"
    'AMC_SERVER_LOGGING=INFO'
  )
  [System.IO.File]::WriteAllText($EnvFile, (($lines -join "`n") + "`n"), $Utf8NoBom)
}

function Read-Settings {
  $script:Port    = Get-EnvValue 'AMC_PORT' '8090'
  $script:Bind    = Get-EnvValue 'AMC_BIND' '127.0.0.1'
  $script:DataDir = Get-EnvValue 'AMC_DATA_DIR' ''
  if ($script:Port -notmatch '^\d+$') { Die "AMC_PORT in .env must be a number (got '$($script:Port)')." }
  if (-not $script:DataDir) { Die 'AMC_DATA_DIR is not set in .env.' }
  if (-not [System.IO.Path]::IsPathRooted($script:DataDir)) {
    Die "AMC_DATA_DIR in .env must be an absolute path (got '$($script:DataDir)')."
  }
  $script:Url = "http://localhost:$($script:Port)"
}

# --- docker -----------------------------------------------------------------

function Test-Native([scriptblock]$Block) {
  & $Block *> $null
  return ($LASTEXITCODE -eq 0)
}

function Assert-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Die 'Docker is not installed. Get Docker Desktop: https://docs.docker.com/desktop/setup/install/windows-install/'
  }
  if (-not (Test-Native { docker compose version })) {
    Die "The 'docker compose' command is missing. Update Docker Desktop."
  }
  if (-not (Test-Native { docker info })) {
    $exe = $null
    if ($env:ProgramFiles) { $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe' }
    if (-not $exe -or -not (Test-Path -LiteralPath $exe)) { Die 'Docker is not running. Start Docker Desktop, then try again.' }
    Say 'Starting Docker Desktop...'
    Start-Process -FilePath $exe
    $deadline = (Get-Date).AddMinutes(3)
    while (-not (Test-Native { docker info })) {
      if ((Get-Date) -gt $deadline) { Die 'Docker Desktop did not start within 3 minutes.' }
      Start-Sleep -Seconds 2
    }
  }
  $v = ((& docker compose version --short 2>$null) | Out-String).Trim() -replace '^v', '' -replace '[-+].*$', ''
  $parsed = $null
  if (-not [version]::TryParse($v, [ref]$parsed) -or $parsed -lt $MinCompose) {
    Die "Docker Compose '$v' is too old; $MinCompose or newer is needed. Please update Docker Desktop."
  }
}

function Test-Running {
  $id = ((& docker compose ps --status running -q $Service 2>$null) | Out-String).Trim()
  return [bool]$id
}

function Get-PublishedPort {
  $p = ((& docker compose port $Service 8080 2>$null) | Out-String).Trim()
  if ($p -match ':(\d+)$') { return $Matches[1] }
  return ''
}

function Test-TcpOpen([string]$Address, [int]$PortNumber) {
  $ip = [System.Net.IPAddress]::Parse($Address)
  $client = New-Object System.Net.Sockets.TcpClient($ip.AddressFamily)
  try {
    $async = $client.BeginConnect($ip, $PortNumber, $null, $null)
    if ($async.AsyncWaitHandle.WaitOne(1500)) {
      try { $client.EndConnect($async); return $true } catch { return $false }
    }
    return $false
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

# Name of what listens on the port, or '' when the port is free.
function Get-PortUser([int]$PortNumber) {
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $conns = @(Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction SilentlyContinue)
    if ($conns.Count -gt 0) {
      $names = $conns | ForEach-Object {
        $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) { "$($proc.ProcessName) (pid $($proc.Id))" } else { "pid $($_.OwningProcess)" }
      }
      return (($names | Sort-Object -Unique) -join ', ')
    }
  }
  if ((Test-TcpOpen '127.0.0.1' $PortNumber) -or (Test-TcpOpen '::1' $PortNumber)) { return 'another program' }
  return ''
}

# --- helpers ----------------------------------------------------------------

function Write-AppVersion {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return }
  $v = ((& git describe --tags --always --dirty 2>$null) | Out-String).Trim()
  if (-not $v) { return }
  $file = Join-Path $PSScriptRoot 'server/version.py'
  $line = "APP_VERSION=`"$v`""
  if ((Test-Path -LiteralPath $file) -and ((Get-Content -LiteralPath $file -Raw).Trim() -eq $line)) { return }
  [System.IO.File]::WriteAllText($file, "$line`n", $Utf8NoBom)
}

function Wait-Ready {
  $deadline = (Get-Date).AddMinutes(2)
  while ($true) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$($script:Port)/" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
      if ($r.Content -match '<title>AMC') { return }
    } catch { }
    if ((Get-Date) -gt $deadline) {
      & docker compose logs --tail 30 $Service
      Die "The app did not answer at $($script:Url) within 2 minutes (server log above)."
    }
    Start-Sleep -Seconds 2
  }
}

function Get-LanAddress {
  if (-not (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue)) { return '' }
  $a = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' -and $_.PrefixOrigin -in 'Dhcp', 'Manual' } |
    Select-Object -First 1
  if ($a) { return $a.IPAddress }
  return ''
}

function Open-Url([string]$Target) {
  try { Start-Process $Target -ErrorAction Stop } catch { Write-Host "    Open $Target in your browser." }
}

function Get-OpenFlag([string[]]$Options) {
  $open = $true
  foreach ($o in $Options) {
    if ($o -eq '--no-open' -or $o -eq '-NoOpen') { $open = $false } else { Die "Unknown option: $o" }
  }
  return $open
}

# --- commands ---------------------------------------------------------------

function Invoke-Start([string[]]$Options) {
  $openBrowser = Get-OpenFlag $Options
  Assert-Docker
  Initialize-EnvFile
  Read-Settings

  if ((Get-PublishedPort) -ne $script:Port) {
    $who = Get-PortUser ([int]$script:Port)
    if ($who) { Die "Port $($script:Port) is already used by $who. Set another AMC_PORT in .env, then run amc start again." }
  }

  $projects = Join-Path $script:DataDir 'MC-Projects'
  New-Item -ItemType Directory -Force -Path $projects -ErrorAction Stop | Out-Null
  Write-AppVersion

  if (-not (Test-Native { docker image inspect $Image })) {
    Say 'First start: building the app. This downloads AMC and LaTeX (a few GB) and takes 10-30 minutes; later starts take seconds.'
  }
  Say 'Starting the AMC web app...'
  & docker compose up -d --build
  if ($LASTEXITCODE -ne 0) { Die 'docker compose up failed (see the messages above).' }
  Wait-Ready

  Ok "AMC is running at $($script:Url)"
  Write-Host "    Projects folder: $projects"
  if ($script:Bind -eq '127.0.0.1') {
    Write-Host '    Reachable from this computer only.'
  } else {
    $ip = Get-LanAddress
    if ($ip) { Write-Host "    Others on your network: http://${ip}:$($script:Port)" }
    Warn 'The app is reachable from the network and has no login yet.'
  }
  if ($openBrowser) { Open-Url $script:Url }
}

function Invoke-Stop {
  Assert-Docker
  & docker compose down
  if ($LASTEXITCODE -ne 0) { Die 'docker compose down failed (see the messages above).' }
  Ok 'Stopped. Your projects are kept.'
}

function Invoke-Status {
  Assert-Docker
  if (-not (Test-Path -LiteralPath $EnvFile)) { Write-Host 'Not set up yet. Run: amc start'; return }
  Read-Settings
  if (Test-Running) { Ok "Running at $($script:Url)" } else { Write-Host 'Stopped. Start it with: amc start' }
  Write-Host "    Projects folder: $(Join-Path $script:DataDir 'MC-Projects')"
  if ($script:Bind -eq '127.0.0.1') {
    Write-Host '    Reachable from this computer only.'
  } else {
    Write-Host "    Reachable from the network (AMC_BIND=$($script:Bind))."
  }
}

function Invoke-Update([string[]]$Options) {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die 'git is needed to update.' }
  & git rev-parse --abbrev-ref --symbolic-full-name '@{u}' *> $null
  if ($LASTEXITCODE -ne 0) { Die "This copy isn't linked to a remote branch, so there is nothing to update from." }
  $changes = ((& git status --porcelain --untracked-files=no) | Out-String).Trim()
  if ($changes) { Die 'This folder has uncommitted changes. Commit or stash them, then try again.' }
  Say 'Pulling the latest version...'
  & git pull --ff-only
  if ($LASTEXITCODE -ne 0) { Die 'git pull failed (see the messages above).' }
  Invoke-Start $Options
}

function Invoke-Import([string[]]$Folders) {
  if ($Folders.Count -eq 0) { Die 'Usage: amc import <project folder>...' }
  Initialize-EnvFile
  Read-Settings
  $projects = Join-Path $script:DataDir 'MC-Projects'
  New-Item -ItemType Directory -Force -Path $projects -ErrorAction Stop | Out-Null
  foreach ($src in $Folders) {
    $src = $src.TrimEnd('\', '/')
    if (-not (Test-Path -LiteralPath $src -PathType Container)) { Die "Not a folder: $src" }
    if (-not (Test-Path -LiteralPath (Join-Path $src 'options.xml'))) { Die "$src doesn't look like an AMC project (no options.xml inside)." }
    $name = Split-Path -Leaf $src
    $dest = Join-Path $projects $name
    if (Test-Path -LiteralPath $dest) { Die "A project named '$name' already exists in $projects" }
    Copy-Item -LiteralPath $src -Destination $dest -Recurse -ErrorAction Stop
    Ok "Imported $name"
  }
  Write-Host '    The original folders are unchanged. Work on the copies in the web app:'
  Write-Host '    its AMC is newer than desktop AMC 1.7.0.'
}

# No param() block on purpose: options such as --no-open must arrive as plain
# strings in $args instead of being parsed as PowerShell parameters.
$command = 'help'
$rest = @()
if ($args.Count -gt 0) { $command = [string]$args[0] }
if ($args.Count -gt 1) { $rest = @($args[1..($args.Count - 1)] | ForEach-Object { [string]$_ }) }

switch ($command) {
  'start'   { Invoke-Start $rest }
  'stop'    { Invoke-Stop }
  'restart' { Invoke-Stop; Invoke-Start $rest }
  'status'  { Invoke-Status }
  'logs'    { Assert-Docker; & docker compose logs -f --tail 100 $Service }
  'open'    {
    if (-not (Test-Path -LiteralPath $EnvFile)) { Die 'Not set up yet. Run: amc start' }
    Read-Settings; Open-Url $script:Url
  }
  'update'  { Invoke-Update $rest }
  'import'  { Invoke-Import $rest }
  { $_ -in 'help', '-h', '--help', '/?' } { Show-Usage }
  default   { Show-Usage; exit 1 }
}
