param(
    [int]$Port = 7860,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Model = Join-Path $Root "models\big-lama.pt"
if (-not (Test-Path $Python)) {
    Write-Host "Python environment missing. Run .\scripts\setup.ps1 first." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $Model)) {
    Write-Host "LaMa model missing. Run .\scripts\setup.ps1 (or scripts\download_model.py) first." -ForegroundColor Red
    exit 1
}

$env:PYTHONUTF8 = "1"
$device = if ($env:LAMA_DEVICE) { $env:LAMA_DEVICE } else { "auto" }
$url = "http://127.0.0.1:$Port"
$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listener) {
    Write-Host "Port $Port is already in use (PID $($listener[0].OwningProcess))." -ForegroundColor Red
    Write-Host "Try: .\run.ps1 -Port 7861"
    exit 1
}

Write-Host ""
Write-Host "  LAMA / 清痕" -ForegroundColor Green
Write-Host "  $url"
Write-Host "  Device: $device   ·   Ctrl+C to stop"
Write-Host ""

if (-not $NoBrowser) {
    Start-Job -ScriptBlock {
        param($target)
        Start-Sleep -Seconds 2
        Start-Process $target
    } -ArgumentList $url | Out-Null
}

& $Python -m uvicorn app.main:app --host 127.0.0.1 --port $Port
