param(
    [int]$Port = 7860,
    [switch]$NoBrowser,
    [switch]$NoSetup,
    [string]$IndexUrl = "",
    [string]$ModelUrl = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $env:PYTHONUTF8 = "1"
    $env:PYTHONIOENCODING = "utf-8"
} catch { }

$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Model = Join-Path $Root "models\big-lama.pt"

if (-not (Test-Path $Python) -or -not (Test-Path $Model)) {
    if ($NoSetup) {
        if (-not (Test-Path $Python)) {
            Write-Host "Python environment missing. Run .\scripts\setup.ps1 first." -ForegroundColor Red
        }
        if (-not (Test-Path $Model)) {
            Write-Host "LaMa model missing. Run .\scripts\setup.ps1 (or scripts\download_model.py) first." -ForegroundColor Red
        }
        exit 1
    }
    Write-Host ""
    Write-Host "  First run: installing environment and model (one-off, a few minutes)..." -ForegroundColor Cyan
    $setupArgs = @{}
    if ($IndexUrl) { $setupArgs["IndexUrl"] = $IndexUrl }
    if ($ModelUrl) { $setupArgs["ModelUrl"] = $ModelUrl }
    & (Join-Path $Root "scripts\setup.ps1") @setupArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Python) -or -not (Test-Path $Model)) {
        Write-Host "  Setup did not complete. Fix the error above and re-run .\run.ps1." -ForegroundColor Red
        exit 1
    }
}

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

if ($device -ne "cpu" -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
    $cudaReady = & $Python -c "import torch; print('1' if torch.cuda.is_available() else '0')" 2>$null
    if ($cudaReady -ne "1") {
        Write-Host "  GPU found, but torch is the CPU build: each frame takes ~10 s." -ForegroundColor Yellow
        Write-Host "  Enable the GPU once with:  .\scripts\setup.ps1 -Cuda   (~3 GB)" -ForegroundColor Yellow
    }
}

Write-Host ""

if (-not $NoBrowser) {
    Start-Job -ScriptBlock {
        param($target)
        Start-Sleep -Seconds 2
        Start-Process $target
    } -ArgumentList $url | Out-Null
}

& $Python -m uvicorn app.main:app --host 127.0.0.1 --port $Port
