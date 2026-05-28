param(
  [switch]$Install,
  [switch]$Start,
  [switch]$Status
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK($msg) { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  ✗ $msg" -ForegroundColor Red }

if (-not $Install -and -not $Start -and -not $Status) {
  Write-Host @"

CineRemaster AI — Setup Helper
══════════════════════════════

Usage:
  .\setup.ps1 -Install     Install prerequisites (MongoDB, Redis)
  .\setup.ps1 -Start       Start services
  .\setup.ps1 -Status      Check service status
"@ -ForegroundColor White
  exit
}

if ($Status) {
  Write-Step "Service Status"
  
  $mongoOk = $false
  try { $mongoOk = (Test-NetConnection -ComputerName localhost -Port 27017 -WarningAction SilentlyContinue).TcpTestSucceeded } catch {}
  if ($mongoOk) { Write-OK "MongoDB running on port 27017" } else { Write-Warn "MongoDB not running" }

  $redisOk = $false
  try { $redisOk = (Test-NetConnection -ComputerName localhost -Port 6379 -WarningAction SilentlyContinue).TcpTestSucceeded } catch {}
  if ($redisOk) { Write-OK "Redis running on port 6379" } else { Write-Warn "Redis not running" }

  $dockerOk = $false
  try { $dockerOk = (docker info 2>$null) -match "Server Version" } catch {}
  if ($dockerOk) { Write-OK "Docker Desktop running" } else { Write-Warn "Docker Desktop not running" }

  $redisVer = ""
  try { 
    $r = redis-cli INFO server 2>$null
    if ($r -match "redis_version:(\S+)") { $redisVer = $matches[1] }
  } catch {}
  if ($redisVer) { Write-OK "Redis v$redisVer installed locally" }

  exit
}

if ($Install) {
  Write-Step "Checking Prerequisites"

  # Node.js
  try { $v = node --version; Write-OK "Node.js $v" } catch { Write-Fail "Node.js not found — install from https://nodejs.org" }

  # Python
  try { $v = python --version; Write-OK "Python $v" } catch { Write-Fail "Python not found — install Python 3.10+" }

  # FFmpeg
  try { $v = ffmpeg -version 2>&1 | Select-Object -First 1; Write-OK "FFmpeg: $v" } catch { Write-Warn "FFmpeg not found — install from https://ffmpeg.org or: winget install FFmpeg" }

  # Docker
  $dockerOk = $false
  try { $dockerOk = (docker info 2>$null) -match "Server Version" } catch {}
  if ($dockerOk) { Write-OK "Docker Desktop running" } else { Write-Warn "Docker Desktop not running — will try local installs" }

  # MongoDB via Docker
  if ($dockerOk) {
    Write-Step "Starting MongoDB via Docker"
    docker rm -f cine-mongo 2>$null
    docker run -d --name cine-mongo -p 27017:27017 mongo:7 2>$null
    if ($?) { Write-OK "MongoDB started in Docker" } else { Write-Fail "Failed to start MongoDB container" }
  } else {
    Write-Step "Installing MongoDB locally"
    try {
      $installed = Get-WmiObject -Class Win32_Product | Where-Object { $_.Name -like "*MongoDB*" }
      if (-not $installed) {
        Write-Warn "MongoDB not installed. Install via: winget install MongoDB.Server"
        Write-Warn "Or start Docker Desktop and rerun: .\setup.ps1 -Start"
      }
    } catch { Write-Warn "Could not check MongoDB installation" }
  }

  # Redis via Docker
  if ($dockerOk) {
    Write-Step "Starting Redis via Docker"
    docker rm -f cine-redis 2>$null
    docker run -d --name cine-redis -p 6379:6379 redis:7-alpine 2>$null
    if ($?) { Write-OK "Redis started in Docker" } else { Write-Fail "Failed to start Redis container" }
  }

  # Python deps
  Write-Step "Installing Python dependencies"
  Push-Location python-engine
  pip install -r requirements.txt 2>$null
  if ($?) { Write-OK "Python packages installed" } else { Write-Warn "pip install had issues — check python-engine/requirements.txt" }
  Pop-Location

  # Node deps
  Write-Step "Installing Node dependencies"
  npm install; if ($?) { Push-Location backend; npm install; Pop-Location }
  if ($?) { Write-OK "Backend packages installed" } else { Write-Warn "Backend install had issues" }
  Push-Location frontend; npm install; Pop-Location
  if ($?) { Write-OK "Frontend packages installed" } else { Write-Warn "Frontend install had issues" }

  Write-Host "`n✨ Setup complete!" -ForegroundColor Green
  exit
}

if ($Start) {
  Write-Step "Starting Services"

  $dockerOk = $false
  try { $dockerOk = (docker info 2>$null) -match "Server Version" } catch {}

  if ($dockerOk) {
    docker start cine-mongo 2>$null; if ($?) { Write-OK "MongoDB started" } else {
      docker run -d --name cine-mongo -p 27017:27017 mongo:7 2>$null
      if ($?) { Write-OK "MongoDB container created and started" }
    }
    docker start cine-redis 2>$null; if ($?) { Write-OK "Redis started" } else {
      docker run -d --name cine-redis -p 6379:6379 redis:7-alpine 2>$null
      if ($?) { Write-OK "Redis container created and started" }
    }
  } else {
    Write-Warn "Docker not running. Start services manually or run Docker Desktop first."
  }
}
