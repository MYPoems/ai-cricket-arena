# 一键部署电子斗蛐蛐（Windows PowerShell）：
#   irm https://raw.githubusercontent.com/MYPoems/ai-cricket-arena/main/scripts/install.ps1 | iex
# 有 Docker Desktop 就用 Docker 在后台运行；没有就用本机的 Node.js 24 在当前窗口运行。
# 已经装过的再跑一次就是升级（拉取最新代码、重建），数据不会丢。
# 可选环境变量：$env:DSQQ_DIR 安装目录（默认 .\ai-cricket-arena）、$env:ARENA_PORT 端口（默认 3200）、$env:DSQQ_MODE = 'docker' 或 'node'

$ErrorActionPreference = 'Stop'
$Repo = 'https://github.com/MYPoems/ai-cricket-arena.git'
$Dir = if ($env:DSQQ_DIR) { $env:DSQQ_DIR } else { 'ai-cricket-arena' }
$Port = if ($env:ARENA_PORT) { $env:ARENA_PORT } else { '3200' }
$Mode = $env:DSQQ_MODE

function Say($t) { Write-Host "== $t" -ForegroundColor Yellow }
function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

if (-not (Test-Cmd git)) { throw '需要先安装 git：https://git-scm.com/download/win' }

# 1. 取代码
if (Test-Path (Join-Path $Dir '.git')) {
  Say "更新代码：$Dir"
  git -C $Dir pull --ff-only
} else {
  Say "下载代码到 $Dir"
  git clone --depth 1 $Repo $Dir
}
if ($LASTEXITCODE -ne 0) { throw 'git 失败' }
Set-Location $Dir

# 2. 选方式
if (-not $Mode) {
  $Mode = 'node'
  if (Test-Cmd docker) {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { $Mode = 'docker' }
  }
}

if ($Mode -eq 'docker') {
  Say '用 Docker 构建并启动（第一次要下载基础镜像，几分钟）'
  $env:ARENA_PORT = $Port
  docker compose up -d --build
  if ($LASTEXITCODE -ne 0) { throw 'docker compose 启动失败' }
  Say '等服务启动'
  for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-WebRequest "http://127.0.0.1:$Port/api/meta" -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 2 }
  }
  Write-Host ''
  Write-Host "电子斗蛐蛐已在后台运行：http://localhost:$Port"
  docker compose exec -T arena test -f /app/data/admin-initial-password.txt *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Host '庄家（管理员）账号和初始密码：'
    docker compose exec -T arena cat /app/data/admin-initial-password.txt
  } else {
    Write-Host '庄家账号是 admin；初始密码是第一次启动时生成的，已经被删掉或改过就用你自己设的密码。'
  }
  Write-Host ''
  Write-Host "常用命令（在 $(Get-Location) 里）：docker compose logs -f 看日志，docker compose down 停止，再跑一次这个脚本升级。"
  return
}

# 3. 不用 Docker：本机 Node.js
if (-not (Test-Cmd node)) { throw '没找到 Docker，也没找到 Node.js。装 Docker Desktop（推荐）或 Node.js 24 以上再试' }
$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 24) { throw "Node.js 版本是 $(node -v)，需要 24 以上" }
Say '安装依赖'
npm ci --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm 安装依赖失败' }
Write-Host ''
Write-Host "启动后打开 http://localhost:$Port 。庄家（管理员）账号 admin，第一次启动生成的初始密码在 $(Join-Path (Get-Location) 'data\admin-initial-password.txt')"
Write-Host "按 Ctrl+C 停止；以后在 $(Get-Location) 里运行 npm start 启动。"
Write-Host ''
$env:PORT = $Port
npm start
