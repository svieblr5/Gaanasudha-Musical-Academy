# Install Caddy as an auto-starting Windows service (so HTTPS stays up after reboot).
# Prerequisite (one-time):  winget install NSSM.NSSM
# Run this from an elevated PowerShell.

$ErrorActionPreference = 'Stop'

$caddy = (Get-Command caddy -ErrorAction SilentlyContinue).Source
if (-not $caddy) { throw "caddy not found on PATH. Restart the shell after installing Caddy." }
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) { throw "nssm not found. Run: winget install NSSM.NSSM" }

$deploy = "G:\Gaanasudha Musical Academy\deploy"
$cfg    = Join-Path $deploy 'Caddyfile'
$data   = Join-Path $deploy 'caddy-data'
New-Item -ItemType Directory -Force -Path $data | Out-Null

# Remove any previous instance, then (re)create.
nssm stop    GaanasudhaCaddy 2>$null
nssm remove  GaanasudhaCaddy confirm 2>$null

nssm install GaanasudhaCaddy "$caddy" run --config "$cfg" --adapter caddyfile
nssm set     GaanasudhaCaddy AppDirectory "$deploy"
# Keep certificates in a stable folder the LocalSystem service can always reach.
nssm set     GaanasudhaCaddy AppEnvironmentExtra "XDG_DATA_HOME=$data" "XDG_CONFIG_HOME=$data"
nssm set     GaanasudhaCaddy Start SERVICE_AUTO_START
nssm set     GaanasudhaCaddy DisplayName "Gaanasudha Caddy (HTTPS proxy)"
nssm start   GaanasudhaCaddy

Write-Host "Caddy service installed and started. It will now run at boot." -ForegroundColor Green
