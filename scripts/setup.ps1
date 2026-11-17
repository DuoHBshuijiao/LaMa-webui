param(
    [switch]$SkipModel
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host ""
Write-Host "  LAMA / 清痕 — setup" -ForegroundColor Green
Write-Host "  ----------------------------------------"

$Python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    Write-Host "  Creating .venv with the system Python..."
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "Could not create .venv. Install Python 3.10+ and retry." }
}
$Python = Join-Path $Root ".venv\Scripts\python.exe"

& $Python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }
& $Python -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }

if (-not $SkipModel) {
    & $Python scripts\download_model.py
    if ($LASTEXITCODE -ne 0) {
        throw "Model download/verification failed. If the file is corrupt, delete it and retry."
    }
}

Write-Host ""
Write-Host "  Setup complete." -ForegroundColor Green
Write-Host "  Start with:  .\run.ps1"
Write-Host "  CUDA users:  see README.md → GPU acceleration"
Write-Host ""
