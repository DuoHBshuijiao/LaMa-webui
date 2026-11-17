param(
    [switch]$SkipModel,
    [switch]$Cuda,
    [string]$IndexUrl = "",
    [string]$ModelUrl = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

# The console must speak UTF-8 before any Chinese text is printed.
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $env:PYTHONUTF8 = "1"
    $env:PYTHONIOENCODING = "utf-8"
} catch { }

if ($IndexUrl) {
    # Slow access to pypi.org is the usual cause of a stalled first install.
    $env:PIP_INDEX_URL = $IndexUrl
}

$MinMinor = 11
$MaxMinor = 13
$Supported = "3.$MinMinor - 3.$MaxMinor"

function Get-PythonVersion([string]$Exe) {
    try {
        $out = & $Exe -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
        return ([string]$out).Trim()
    } catch { return $null }
}

function Test-Supported([string]$Version) {
    if (-not $Version) { return $false }
    $minor = [int]($Version.Split('.')[1])
    return ($minor -ge $MinMinor -and $minor -le $MaxMinor)
}

# Find a CPython that torch 2.7.1 actually ships wheels for.  Prefer 3.12,
# then 3.13, then 3.11.  `python` on PATH is only a last resort because it can
# point at 3.10 or 3.14, which cannot install these pins.
function Resolve-Interpreter {
    $probes = @()
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in @("3.12", "3.13", "3.11")) { $probes += ,@("py", @("-$v")) }
    }
    if (Get-Command python -ErrorAction SilentlyContinue) { $probes += ,@("python", @()) }
    foreach ($probe in $probes) {
        $exe = $probe[0]
        $pre = $probe[1]
        try {
            $path = & $exe @pre -c "import sys; print(sys.executable)" 2>$null
            if ($LASTEXITCODE -ne 0 -or -not $path) { continue }
            $path = ([string]$path).Trim()
            if (-not (Test-Path $path)) { continue }
            $version = Get-PythonVersion $path
            if (Test-Supported $version) {
                return @{ Path = $path; Version = $version }
            }
        } catch { continue }
    }
    return $null
}

Write-Host ""
Write-Host "  LAMA / 清痕 — setup" -ForegroundColor Green
Write-Host "  ----------------------------------------"

$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
if (Test-Path $VenvPython) {
    $version = Get-PythonVersion $VenvPython
    if (-not (Test-Supported $version)) {
        Write-Host "  .venv 使用的 Python $version 不在支持范围（$Supported）。" -ForegroundColor Red
        Write-Host "  torch 2.7.1 没有 Python 3.14 的 wheel，numpy 2.5+ 又要求 3.12+。" -ForegroundColor Yellow
        Write-Host "  请删除 .venv 后重新运行本脚本，它会自动挑选 3.12 / 3.13 / 3.11。" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "  Using existing .venv (Python $version)" -ForegroundColor DarkGray
} else {
    $interpreter = Resolve-Interpreter
    if (-not $interpreter) {
        Write-Host "  找不到可用的 Python（需要 $Supported）。" -ForegroundColor Red
        Write-Host "  torch 2.7.1 只提供到 Python 3.13 的 wheel；请安装 Python 3.12：" -ForegroundColor Yellow
        Write-Host "    winget install -e --id Python.Python.3.12" -ForegroundColor Yellow
        Write-Host "  安装后重新运行 .\scripts\setup.ps1。" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "  Creating .venv with Python $($interpreter.Version) ($($interpreter.Path))"
    & $interpreter.Path -m venv .venv
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $VenvPython)) {
        Write-Host "  创建 .venv 失败。请确认 Python 安装完整（含 venv 模块）。" -ForegroundColor Red
        exit 1
    }
    $version = Get-PythonVersion $VenvPython
}

$Python = $VenvPython

& $Python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    Write-Host "  pip 升级失败，请检查网络或代理设置。" -ForegroundColor Red
    exit 1
}

& $Python -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  依赖安装失败（当前解释器：Python $version）。" -ForegroundColor Red
    Write-Host "  requirements.txt 需要 $Supported；请确认网络可达，并在必要时删除 .venv 后重试。" -ForegroundColor Yellow
    exit 1
}

if ($Cuda) {
    Write-Host ""
    Write-Host "  Installing CUDA 12.8 build of torch 2.7.1 (about 3 GB)..." -ForegroundColor Cyan
    & $Python -m pip install --force-reinstall --index-url https://download.pytorch.org/whl/cu128 torch==2.7.1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  CUDA 版 torch 安装失败；CPU 版仍可正常使用。" -ForegroundColor Yellow
        exit 1
    }
}

if (-not $SkipModel) {
    $modelArgs = @("scripts\download_model.py")
    if ($ModelUrl) {
        Write-Host "  Model source: $ModelUrl" -ForegroundColor DarkGray
        $modelArgs += @("--url", $ModelUrl)
    }
    & $Python @modelArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  模型下载或校验失败。文件损坏时删除 models\big-lama.pt 后重试。" -ForegroundColor Red
        Write-Host "  直连 GitHub 慢时可换镜像，例如：" -ForegroundColor Yellow
        Write-Host "    .\scripts\setup.ps1 -ModelUrl https://gh-proxy.com/https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt" -ForegroundColor DarkGray
        exit 1
    }
}

Write-Host ""
Write-Host "  Setup complete." -ForegroundColor Green
Write-Host "  Start with:  .\run.ps1"
& $Python -c "import torch; print('  torch ' + torch.__version__ + '  cuda=' + str(torch.cuda.is_available()))"
Write-Host ""
