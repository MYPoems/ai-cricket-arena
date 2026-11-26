#!/usr/bin/env bash
# 一键部署电子斗蛐蛐（Linux / macOS / Windows 的 Git Bash）：
#   curl -fsSL https://raw.githubusercontent.com/MYPoems/ai-cricket-arena/main/scripts/install.sh | bash
# 有 Docker 就用 Docker 在后台运行；没有 Docker 就用本机的 Node.js 24 在前台运行。
# 已经装过的再跑一次就是升级（拉取最新代码、重建），数据不会丢。
# 可选环境变量：DSQQ_DIR 安装目录（默认 ./ai-cricket-arena）、ARENA_PORT 端口（默认 3200）、DSQQ_MODE=docker|node 指定方式
set -euo pipefail

REPO="https://github.com/MYPoems/ai-cricket-arena.git"
DIR="${DSQQ_DIR:-ai-cricket-arena}"
PORT="${ARENA_PORT:-3200}"
MODE="${DSQQ_MODE:-}"

say() { printf '\033[1m== %s\033[0m\n' "$*"; }
die() { printf '出错：%s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "需要先安装 git"

# 1. 取代码
if [ -d "$DIR/.git" ]; then
  say "更新代码：$DIR"
  git -C "$DIR" pull --ff-only
else
  say "下载代码到 $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"

# 2. 选方式
if [ -z "$MODE" ]; then
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; then MODE=docker; else MODE=node; fi
fi

if [ "$MODE" = docker ]; then
  say "用 Docker 构建并启动（第一次要下载基础镜像，几分钟）"
  ARENA_PORT="$PORT" docker compose up -d --build
  say "等服务启动"
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$PORT/api/meta" >/dev/null 2>&1; then break; fi
    sleep 2
  done
  echo
  echo "电子斗蛐蛐已在后台运行：http://localhost:$PORT"
  if docker compose exec -T arena test -f /app/data/admin-initial-password.txt 2>/dev/null; then
    echo "庄家（管理员）账号和初始密码："
    docker compose exec -T arena cat /app/data/admin-initial-password.txt
  else
    echo "庄家账号是 admin；初始密码是第一次启动时生成的，已经被删掉或改过就用你自己设的密码。"
  fi
  echo
  echo "常用命令（在 $(pwd) 里）：docker compose logs -f 看日志，docker compose down 停止，再跑一次这个脚本升级。"
  exit 0
fi

# 3. 不用 Docker：本机 Node.js
command -v node >/dev/null || die "没找到 Docker，也没找到 Node.js。装 Docker（推荐）或 Node.js 24 以上再试"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || die "Node.js 版本是 $(node -v)，需要 24 以上"
say "安装依赖"
npm ci --omit=dev --no-audit --no-fund
echo
echo "启动后打开 http://localhost:$PORT 。庄家（管理员）账号 admin，第一次启动生成的初始密码在 $(pwd)/data/admin-initial-password.txt"
echo "按 Ctrl+C 停止；以后在 $(pwd) 里运行 npm start 启动。"
echo
PORT="$PORT" exec npm start
