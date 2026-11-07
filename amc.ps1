# AMC web app launcher for Windows (on macOS and Linux, use ./amc).
# Run it through amc.cmd:  amc help
#
# Keep this file working with Windows PowerShell 5.1 (built into Windows)
# as well as PowerShell 7:
# - Native commands are checked through $LASTEXITCODE: with
#   $ErrorActionPreference = 'Stop', Windows PowerShell 5.1 turns any stderr
#   output from docker or git into a fatal error.
# - Shell snippets passed to `docker ... sh -c` contain no quote characters:
#   Windows PowerShell 5.1 mangles quotes in native command arguments. They
#   start with `set -f; IFS=` so values with spaces stay whole without quotes.

$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot

$Service    = 'amc-web'           # service name in docker-compose.yml
$Image      = 'amc-web'           # image name in docker-compose.yml
$MinCompose = [version]'2.24.4'   # first version supporting `!override`
$LoginFiles = 'docker-compose.yml,docker-compose.override.yml,compose.login.yml'
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
  import [--user NAME] <folder>...
                       Copy existing AMC project folders into the app

Shared machine (sign-in, HTTPS, one projects folder per teacher):
  login on [--local]   Turn it on; --local keeps it reachable from this computer only
  login off            Back to this computer only, without sign-in
  user add NAME [--admin] [--temporary]
                       Create an account (--admin: can manage accounts;
                       --temporary: print a starting password to change at sign-in)
  user passwd NAME     Set an account's password
  user list            List accounts
  user enable NAME     Re-enable a disabled account
  cert                 Show how browsers can trust the app's HTTPS certificate

  printer              Direct printing is Linux only; on Windows, teachers save
                       the PDFs in the Print step and print them anywhere

  backup               Save all projects (and, on a shared machine, accounts and
                       the certificate authority) to AMC_DATA_DIR/backups
  doctor [--rebuild-index]
                       Check every exam's and bank's history (git fsck), the
                       trash and the bank search index; changes nothing
                       (--rebuild-index builds the search index again)
  help                 Show this help

Settings are in .env, created on first start (see .env.example).
'@ | Write-Host
}

# --- settings ---------------------------------------------------------------

function Get-EnvValue([string]$Key, [string]$Default) {
  if (-not (Test-Path -LiteralPath $EnvFile)) { return $Default }
  $pattern = '^\s*' + [regex]::Escape($Key) + '='
  $line = Get-Content -LiteralPath $EnvFile -Encoding UTF8 | Where-Object { $_ -match $pattern } | Select-Object -Last 1
  if (-not $line) { return $Default }
  return ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}

function Write-EnvLines([object[]]$Lines) {
  [System.IO.File]::WriteAllText($EnvFile, ((@($Lines) -join "`n") + "`n"), $Utf8NoBom)
}

# Set KEY in .env, keeping every other line.
function Set-EnvValue([string]$Key, [string]$Value) {
  $pattern = '^\s*' + [regex]::Escape($Key) + '='
  $done = $false
  $out = New-Object System.Collections.ArrayList
  foreach ($l in @(Get-Content -LiteralPath $EnvFile -Encoding UTF8)) {
    if ($l -match $pattern) {
      if (-not $done) { [void]$out.Add("$Key=$Value"); $done = $true }
    } else {
      [void]$out.Add($l)
    }
  }
  if (-not $done) { [void]$out.Add("$Key=$Value") }
  Write-EnvLines $out
}

function Remove-EnvValue([string]$Key) {
  $pattern = '^\s*' + [regex]::Escape($Key) + '='
  Write-EnvLines @(Get-Content -LiteralPath $EnvFile -Encoding UTF8 | Where-Object { $_ -notmatch $pattern })
}

function Get-IanaTimeZone {
  $id = [System.TimeZoneInfo]::Local.Id
  if ($id -match '/') { return $id }   # already an IANA name (PowerShell 7 off Windows)
  # PowerShell 7 (.NET 6+) can convert Windows names; 5.1 can't.
  $iana = $null
  $method = [System.TimeZoneInfo].GetMethod('TryConvertWindowsIdToIanaId', [type[]]@([string], [string].MakeByRefType()))
  if ($method -and [System.TimeZoneInfo]::TryConvertWindowsIdToIanaId($id, [ref]$iana)) { return $iana }
  $known = @{
    'India Standard Time'     = 'Asia/Kolkata'
    'UTC'                     = 'UTC'
    'GMT Standard Time'       = 'Europe/London'
    'W. Europe Standard Time' = 'Europe/Berlin'
    'Romance Standard Time'   = 'Europe/Paris'
    'Eastern Standard Time'   = 'America/New_York'
    'Central Standard Time'   = 'America/Chicago'
    'Pacific Standard Time'   = 'America/Los_Angeles'
  }
  if ($known.ContainsKey($id)) { return $known[$id] }
  return 'UTC'
}

function Initialize-EnvFile {
  if (Test-Path -LiteralPath $EnvFile) { return }
  Say 'First run: writing settings to .env'
  $data = (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'AMC-Web') -replace '\\', '/'
  Write-EnvLines @(
    '# AMC web app settings (see .env.example). Run "amc restart" after editing.'
    'AMC_PORT=8090'
    'AMC_BIND=127.0.0.1'
    "AMC_DATA_DIR=$data"
    "TZ=$(Get-IanaTimeZone)"
    'AMC_SERVER_LOGGING=INFO'
  )
}

function Test-LoginMode { return ((Get-EnvValue 'AMC_LOGIN' '0') -eq '1') }

function Read-Settings {
  $script:Port    = Get-EnvValue 'AMC_PORT' '8090'
  $script:Bind    = Get-EnvValue 'AMC_BIND' '127.0.0.1'
  $script:DataDir = Get-EnvValue 'AMC_DATA_DIR' ''
  if ($script:Port -notmatch '^\d+$') { Die "AMC_PORT in .env must be a number (got '$($script:Port)')." }
  if (-not $script:DataDir) { Die 'AMC_DATA_DIR is not set in .env.' }
  if (-not [System.IO.Path]::IsPathRooted($script:DataDir)) {
    Die "AMC_DATA_DIR in .env must be an absolute path (got '$($script:DataDir)')."
  }
  if (Test-LoginMode) { $script:Url = "https://localhost:$($script:Port)" }
  else { $script:Url = "http://localhost:$($script:Port)" }
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

function Test-Running([string]$Name) {
  $id = ((& docker compose ps --status running -q $Name 2>$null) | Out-String).Trim()
  return [bool]$id
}

function Get-PublishedPort {
  if (Test-LoginMode) { $p = ((& docker compose port caddy $script:Port 2>$null) | Out-String).Trim() }
  else { $p = ((& docker compose port $Service 8080 2>$null) | Out-String).Trim() }
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

# Runs a quote-free shell snippet in a one-off container of the volume-owner
# service, with extra `docker run` options (mounts, environment).
function Invoke-VolumeShell([string[]]$Options, [string]$Script) {
  & docker compose run --rm --no-deps -T @Options --entrypoint sh amc-home-init -c "set -f; IFS=; $Script"
  return ($LASTEXITCODE -eq 0)
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

function Get-LanAddress {
  if (-not (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue)) { return '' }
  $a = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' -and $_.PrefixOrigin -in 'Dhcp', 'Manual' } |
    Select-Object -First 1
  if ($a) { return $a.IPAddress }
  return ''
}

# Names and addresses the HTTPS certificate must cover: browsers only accept
# the certificate for the exact name or address they connect to. Sets the
# variables compose.login.yml and the Caddyfile read.
function Set-SiteVariables {
  $script:LanIp = Get-LanAddress
  $hosts = New-Object System.Collections.ArrayList
  foreach ($h in @('localhost', $script:LanIp, [System.Net.Dns]::GetHostName()) +
                 ((Get-EnvValue 'AMC_HOSTNAMES' '') -split '[, ]+')) {
    if (-not $h) { continue }
    $h = $h.ToLowerInvariant()
    if ($h -match '^[a-z0-9][a-z0-9.-]*$' -and -not $hosts.Contains($h)) { [void]$hosts.Add($h) }
  }
  $sites = @($hosts | ForEach-Object { "https://${_}:$($script:Port)" })
  $env:AMC_SITES = $sites -join ', '
  $env:AMC_ORIGINS = $sites -join ','
  if ($script:LanIp) { $env:AMC_DEFAULT_SNI = $script:LanIp } else { $env:AMC_DEFAULT_SNI = 'localhost' }
  # A label on the caddy service (compose.login.yml), so that `up` recreates
  # caddy when the Caddyfile changed: caddy reads it only when it starts.
  $env:AMC_CADDYFILE_HASH = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'caddy/Caddyfile') -Algorithm SHA256).Hash
}

function Test-PageContains([string]$Uri, [string]$Text) {
  try {
    if ($PSVersionTable.PSVersion.Major -ge 6) {
      $r = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3 -SkipCertificateCheck -ErrorAction Stop
    } else {
      # Windows PowerShell 5.1: no -SkipCertificateCheck. The certificate comes
      # from the app's own authority, which this computer may not trust yet.
      [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
      [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
      $r = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    }
    return ($r.Content -match [regex]::Escape($Text))
  } catch {
    return $false
  }
}

function Wait-Ready {
  $deadline = (Get-Date).AddMinutes(2)
  while ($true) {
    if (Test-LoginMode) {
      # The sign-in page through caddy (which only answers for the names it
      # holds certificates for), and AMC itself behind it.
      if ((Test-PageContains "https://localhost:$($script:Port)/auth/login" 'Sign in') -and
          (Test-Native { docker compose exec -T $Service curl -fs -m 3 http://127.0.0.1:8080/public/status.json })) { return }
    } else {
      if (Test-PageContains "http://127.0.0.1:$($script:Port)/" '<title>AMC') { return }
    }
    if ((Get-Date) -gt $deadline) {
      & docker compose logs --tail 30
      Die "The app did not answer at $($script:Url) within 2 minutes (server log above)."
    }
    Start-Sleep -Seconds 2
  }
}

# AMC runs each teacher's LaTeX and scoring commands in a sandbox limited to
# their own projects (Landlock). It silently does nothing on a kernel without
# Landlock, and it can't follow files on some shared folders, so check on the
# real projects storage that it lets the allowed folder through and blocks
# the rest.
function Assert-Sandbox {
  if ((Get-EnvValue 'AMC_ALLOW_UNISOLATED' '0') -eq '1') {
    Warn "The sandbox between teachers is off (AMC_ALLOW_UNISOLATED=1): a teacher's LaTeX can read other teachers' projects."
    return
  }
  $probe = 'd=/amc-web/files/MC-Projects/.amc-sandbox-check; mkdir -p $d/ok; echo fine > $d/ok/f; echo secret > $d/secret; ' +
           'run() { landrun --best-effort --log-level error --rox $AMC_ISOLATE_ROX --ro /etc --rw $d/ok -- $@; }; ' +
           'if ! run cat $d/ok/f >/dev/null 2>&1; then echo broken; elif run cat $d/secret >/dev/null 2>&1; then echo open; else echo isolated; fi; rm -rf $d'
  $result = ((& docker compose exec -T $Service sh -c $probe 2>$null) | Out-String).Trim()
  if ($result -eq 'isolated') { return }
  if ($result -eq 'open') {
    $problem = "The sandbox doesn't isolate anything here: this Linux kernel lacks Landlock. A teacher's LaTeX could read other teachers' projects."
  } else {
    $problem = "The sandbox would stop AMC from reading its own projects here (result: '$result')."
  }
  & docker compose down *> $null
  Die "$problem The app was stopped. If you trust every teacher, set AMC_ALLOW_UNISOLATED=1 in .env (this turns the sandbox off) and start again."
}

function Test-Interactive { return (-not [Console]::IsInputRedirected) }

function Invoke-Auth([string[]]$Arguments) {
  if (Test-Interactive) { & docker compose exec amc-auth flask user @Arguments }
  else { & docker compose exec -T amc-auth flask user @Arguments }
  return ($LASTEXITCODE -eq 0)
}

function Get-AccountCount {
  return (((& docker compose exec -T amc-auth flask user count 2>$null) | Out-String) -replace '[^0-9]', '')
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

function Show-Where {
  if (Test-LoginMode) {
    Write-Host "    On this computer:  $($script:Url)"
    if ($script:Bind -ne '127.0.0.1' -and $script:LanIp) {
      Write-Host "    Colleagues:        https://$($script:LanIp):$($script:Port)"
    } elseif ($script:Bind -eq '127.0.0.1') {
      Write-Host '    Reachable from this computer only (login on --local).'
    }
    Write-Host '    Projects:          in a Docker volume, one folder per teacher (amc backup exports them)'
    Write-Host '    Browsers warn about the certificate until they trust it: amc cert'
  } else {
    Write-Host "    Projects folder: $(Join-Path $script:DataDir 'MC-Projects')"
    if ($script:Bind -eq '127.0.0.1') {
      Write-Host '    Reachable from this computer only.'
    } else {
      $ip = Get-LanAddress
      if ($ip) { Write-Host "    Others on your network: http://${ip}:$($script:Port)" }
      Warn 'The app is reachable from the network without sign-in. Use "amc login on" for a shared machine.'
    }
  }
}

# --- commands ---------------------------------------------------------------

function Invoke-Start([string[]]$Options) {
  $openBrowser = Get-OpenFlag $Options
  Assert-Docker
  Initialize-EnvFile
  Read-Settings
  # Public server mode (compose.tunnel.yml) is set up by ./amc on Linux.
  if ((Get-EnvValue 'AMC_PUBLIC_HOST' '') -ne '') {
    Die "AMC_PUBLIC_HOST is set in .env: public server mode is only run by ./amc (Linux or macOS). Remove it from .env to use this launcher."
  }
  if (Test-LoginMode) {
    Set-SiteVariables
    if ((Get-EnvValue 'AMC_ALLOW_UNISOLATED' '0') -eq '1') { $env:AMC_ISOLATE = '0' }
  }

  if ((Get-PublishedPort) -ne $script:Port) {
    $who = Get-PortUser ([int]$script:Port)
    if ($who) { Die "Port $($script:Port) is already used by $who. Set another AMC_PORT in .env, then run amc start again." }
  }

  New-Item -ItemType Directory -Force -Path (Join-Path $script:DataDir 'MC-Projects') -ErrorAction Stop | Out-Null
  if (Test-LoginMode) {
    # amc-auth and caddy keep their data in these; make them before `up`.
    foreach ($d in 'auth', 'caddy') { New-Item -ItemType Directory -Force -Path (Join-Path $script:DataDir $d) -ErrorAction Stop | Out-Null }
  }
  Write-AppVersion

  if (-not (Test-Native { docker image inspect $Image })) {
    Say 'First start: building the app. This downloads AMC and LaTeX (a few GB) and takes 10-30 minutes; later starts take seconds.'
  }
  Say 'Starting the AMC web app...'
  & docker compose up -d --build --remove-orphans
  if ($LASTEXITCODE -ne 0) { Die 'docker compose up failed (see the messages above).' }
  Wait-Ready
  if (Test-LoginMode) {
    Assert-Sandbox
    Ok 'AMC is running in shared-machine mode (sign-in required)'
  } else {
    Ok "AMC is running at $($script:Url)"
  }
  Show-Where
  if ((Test-LoginMode) -and (Get-AccountCount) -eq '0') {
    Warn 'There are no accounts yet. Create the first admin with: amc user add <name> --admin'
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
  if (Test-LoginMode) { Set-SiteVariables }
  if (Test-Running $Service) {
    if (Test-LoginMode) { Ok 'Running in shared-machine mode (sign-in required)' } else { Ok "Running at $($script:Url)" }
  } else {
    Write-Host 'Stopped. Start it with: amc start'
  }
  Show-Where
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

function Invoke-Import([string[]]$Arguments) {
  $user = ''
  $folders = @($Arguments)
  if ($folders.Count -ge 1 -and $folders[0] -eq '--user') {
    if ($folders.Count -lt 2) { Die 'Usage: amc import --user NAME <project folder>...' }
    $user = $folders[1].ToLowerInvariant()   # accounts are lower-case
    $folders = @($folders | Select-Object -Skip 2)
  }
  if ($folders.Count -eq 0) { Die 'Usage: amc import [--user NAME] <project folder>...' }
  Initialize-EnvFile
  Read-Settings
  foreach ($src in $folders) {
    $src = $src.TrimEnd('\', '/')
    if (-not (Test-Path -LiteralPath $src -PathType Container)) { Die "Not a folder: $src" }
    if (-not (Test-Path -LiteralPath (Join-Path $src 'options.xml'))) { Die "$src doesn't look like an AMC project (no options.xml inside)." }
  }
  if (Test-LoginMode) {
    if (-not $user) { Die 'In shared-machine mode, say whose projects these are: amc import --user NAME <folder>...' }
    if ($user -notmatch '^[a-z0-9][a-z0-9._-]{1,31}$') { Die "Invalid username: $user" }
    Assert-Docker
    $owner = "$(Get-EnvValue 'AMC_UID' '1000'):$(Get-EnvValue 'AMC_GID' '0')"
    foreach ($src in $folders) {
      $abs = (Resolve-Path -LiteralPath $src).Path -replace '\\', '/'
      $name = Split-Path -Leaf $abs
      $script = 'dest=/amc-web/files/MC-Projects/$U/$N; if [ -e $dest ]; then exit 3; fi; ' +
                'mkdir -p /amc-web/files/MC-Projects/$U && cp -a /from $dest && chown -R $OWNER /amc-web/files/MC-Projects/$U'
      if (-not (Invoke-VolumeShell @('-v', "${abs}:/from:ro", '-e', "U=$user", '-e', "N=$name", '-e', "OWNER=$owner") $script)) {
        Die "Could not import $name (a project with that name may already exist for $user)."
      }
      Ok "Imported $name for $user"
    }
  } else {
    if ($user) { Die '--user only applies in shared-machine mode (amc login on).' }
    $projects = Join-Path $script:DataDir 'MC-Projects'
    New-Item -ItemType Directory -Force -Path $projects -ErrorAction Stop | Out-Null
    foreach ($src in $folders) {
      $name = Split-Path -Leaf (Resolve-Path -LiteralPath $src).Path
      $dest = Join-Path $projects $name
      if (Test-Path -LiteralPath $dest) { Die "A project named '$name' already exists in $projects" }
      Copy-Item -LiteralPath $src -Destination $dest -Recurse -ErrorAction Stop
      Ok "Imported $name"
    }
  }
  Write-Host '    The original folders are unchanged. Work on the copies in the web app:'
  Write-Host '    its AMC is newer than desktop AMC 1.7.0.'
}

# Projects from this-computer-only mode are in the host folder; shared-machine
# mode keeps one folder per teacher in a Docker volume. Copy them over (the
# originals stay where they are).
function Copy-SingleUserProjects([string]$User) {
  $root = Join-Path $script:DataDir 'MC-Projects'
  $found = @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'options.xml') })
  if ($found.Count -eq 0) { return }
  Write-Host "    Projects from this-computer-only mode: $(($found | ForEach-Object Name) -join ', ')"
  $reply = ''
  if (Test-Interactive) { $reply = Read-Host "    Copy them into $User's projects? [y/N]" }
  if ($reply -notmatch '^(y|yes)$') {
    Write-Host "    Not copied. Later: amc import --user $User <folder>"
    return
  }
  Invoke-Import (@('--user', $User) + @($found | ForEach-Object FullName))
}

function New-FirstAdmin {
  if (-not (Test-Interactive)) {
    Warn 'There are no accounts yet. Create the first admin with: amc user add <name> --admin'
    return
  }
  Say 'Create the first admin account. It can add the other teachers on the Admin page.'
  $name = ''
  while (-not $name) { $name = (Read-Host 'Admin username').Trim() }
  if (-not (Invoke-Auth @('add', $name, '--admin'))) { return }
  Copy-SingleUserProjects $name.ToLowerInvariant()
}

function Invoke-Login([string[]]$Arguments) {
  $sub = ''
  if ($Arguments.Count -gt 0) { $sub = $Arguments[0] }
  $rest = @($Arguments | Select-Object -Skip 1)
  switch ($sub) {
    'on' {
      $bind = '0.0.0.0'
      foreach ($a in $rest) { if ($a -eq '--local') { $bind = '127.0.0.1' } else { Die "Unknown option: $a" } }
      Assert-Docker
      Initialize-EnvFile
      if (Test-LoginMode) {
        Say 'Shared-machine mode is already on.'
      } else {
        Say 'Turning on shared-machine mode: sign-in, HTTPS, one projects folder per teacher.'
        & docker compose down *> $null
        Set-EnvValue 'AMC_LOGIN' '1'
        Set-EnvValue 'COMPOSE_PATH_SEPARATOR' ','
        Set-EnvValue 'COMPOSE_FILE' $LoginFiles
      }
      Set-EnvValue 'AMC_BIND' $bind
      Invoke-Start @('--no-open')
      if ((Get-AccountCount) -eq '0') { New-FirstAdmin }
    }
    'off' {
      if ($rest.Count -gt 0) { Die "Unknown option: $($rest[0])" }
      Assert-Docker
      Initialize-EnvFile
      if (Test-LoginMode) {
        Say 'Turning off shared-machine mode: this computer only, no sign-in.'
        & docker compose down *> $null
      } else {
        Say 'Shared-machine mode is already off.'
      }
      Set-EnvValue 'AMC_LOGIN' '0'
      Remove-EnvValue 'COMPOSE_FILE'
      Remove-EnvValue 'COMPOSE_PATH_SEPARATOR'
      Set-EnvValue 'AMC_BIND' '127.0.0.1'
      Invoke-Start @('--no-open')
      Warn "Teachers' projects stay in the Docker volume and come back with: amc login on"
    }
    default { Die 'Usage: amc login on [--local] | amc login off' }
  }
}

function Invoke-User([string[]]$Arguments) {
  Assert-Docker
  if (-not (Test-Path -LiteralPath $EnvFile)) { Die 'Not set up yet. Run: amc login on' }
  if (-not (Test-LoginMode)) { Die 'Accounts only exist in shared-machine mode. Turn it on with: amc login on' }
  if (-not (Test-Running 'amc-auth')) { Die "The app isn't running. Start it with: amc start" }
  if ($Arguments.Count -eq 0) { Die 'Usage: amc user add NAME [--admin] [--temporary] | passwd NAME | list | enable NAME' }
  if (-not (Invoke-Auth $Arguments)) { exit 1 }
}

function Invoke-Doctor($Arguments) {
  Assert-Docker
  Initialize-EnvFile
  Read-Settings
  if (-not (Test-Running $Service)) { Die "The app isn't running. Start it first: amc start" }
  # Histories (git fsck), the trash and the bank search index, for every teacher.
  & docker compose exec -T $Service python3 /amc-web/server/ui_doctor.py @Arguments
  exit $LASTEXITCODE
}

function Invoke-Backup {
  Assert-Docker
  Initialize-EnvFile
  Read-Settings
  $dir = Join-Path $script:DataDir 'backups'
  New-Item -ItemType Directory -Force -Path $dir -ErrorAction Stop | Out-Null
  $name = "amc-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').tar.gz"
  $data = $script:DataDir -replace '\\', '/'
  if (Test-LoginMode) {
    # Projects from the volume, plus accounts and the certificate authority.
    # busybox tar honours only one -C, so gather the folders with symlinks.
    foreach ($d in 'auth', 'caddy') { New-Item -ItemType Directory -Force -Path (Join-Path $script:DataDir $d) | Out-Null }
    $script = "mkdir /stage && ln -s /amc-web/files/MC-Projects /stage/MC-Projects && ln -s /auth /stage/auth && " +
              "ln -s /caddy /stage/caddy && tar czhf /backup/$name -C /stage MC-Projects auth caddy && chmod 600 /backup/$name"
    $ok = Invoke-VolumeShell @('-v', "${data}/backups:/backup", '-v', "${data}/auth:/auth:ro", '-v', "${data}/caddy:/caddy:ro") $script
  } else {
    $script = "cd /data && tar czf /backup/$name MC-Projects `$(ls -d .AMC.d 2>/dev/null) && chmod 600 /backup/$name"
    & docker run --rm -v "${data}:/data:ro" -v "${data}/backups:/backup" alpine:3 sh -c $script
    $ok = ($LASTEXITCODE -eq 0)
  }
  if (-not $ok) {
    Remove-Item -LiteralPath (Join-Path $dir $name) -ErrorAction SilentlyContinue
    Die 'The backup failed (messages above).'
  }
  Ok "Backup written to $(Join-Path $dir $name)"
}

function Invoke-Cert {
  Initialize-EnvFile
  Read-Settings
  if (-not (Test-LoginMode)) { Die 'HTTPS is only used in shared-machine mode (amc login on).' }
  $ca = Join-Path $script:DataDir 'caddy/caddy/pki/authorities/local/root.crt'
  $copy = Join-Path $script:DataDir 'amc-ca.crt'
  if (Test-Path -LiteralPath $ca) {
    Copy-Item -LiteralPath $ca -Destination $copy -Force
  } else {
    # Read it through the container when the host can't see caddy's files.
    Assert-Docker
    $pem = ((& docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt 2>$null) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $pem) { Die 'There is no certificate yet. Start the app once with: amc start' }
    [System.IO.File]::WriteAllText($copy, $pem + "`n", $Utf8NoBom)
  }
  $ip = Get-LanAddress
  if (-not $ip) { $ip = 'localhost' }
  Write-Host @"
The app's HTTPS certificate comes from its own certificate authority:
    $copy
Colleagues can also download it from https://${ip}:$($script:Port)/amc-ca.crt
(the browser warns once before the download).

Install it once on each computer so browsers trust the app:
  Windows:  double-click it > Install Certificate > Current User >
            Place in "Trusted Root Certification Authorities".
  macOS:    double-click it to add it to the login keychain, open it in
            Keychain Access and set "When using this certificate" to "Always Trust".
  Linux:    sudo cp amc-ca.crt /usr/local/share/ca-certificates/amc-ca.crt
            sudo update-ca-certificates
  Firefox may keep its own list: Settings > Privacy & Security > Certificates >
            View Certificates > Authorities > Import.
"@
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
  'logs'    { Assert-Docker; & docker compose logs -f --tail 100 }
  'open'    {
    if (-not (Test-Path -LiteralPath $EnvFile)) { Die 'Not set up yet. Run: amc start' }
    Read-Settings; Open-Url $script:Url
  }
  'update'  { Invoke-Update $rest }
  'import'  { Invoke-Import $rest }
  'login'   { Invoke-Login $rest }
  'user'    { Invoke-User $rest }
  'cert'    { Invoke-Cert }
  'backup'  { Invoke-Backup }
  'doctor'  { Invoke-Doctor $rest }
  'printer' { Die 'Direct printing only works when the shared machine runs Linux. On Windows, teachers save the PDFs in the Print step and print them from any computer.' }
  { $_ -in 'help', '-h', '--help', '/?' } { Show-Usage }
  default   { Show-Usage; exit 1 }
}
