#!/usr/bin/env bash
#
# 一键启动 COROS 训练看板（开发模式）
# 默认直接在后台启动。启动前会自动检测并杀死所有旧进程及占用的端口。
#
# 用法：
#   ./dev.sh              # 直接后台启动（自动杀旧进程，确认前后端就绪后返回命令行）
#   ./dev.sh --lan        # 局域网模式（允许手机等同 Wi-Fi 设备访问）
#   ./dev.sh -f           # 启动并继续在终端实时跟踪输出日志（按 Ctrl+C 可退出日志）
#

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
LOG_DIR="$ROOT/.logs"
API_PORT=43124
WEB_PORT=43125

mkdir -p "$LOG_DIR"

# ---------- 颜色与输出 ----------
if [[ -t 1 ]]; then
  C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_BOLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""; C_BOLD=""; C_OFF=""
fi

info() { echo "${C_CYAN}▸${C_OFF} $*"; }
ok()   { echo "${C_GREEN}✓${C_OFF} $*"; }
warn() { echo "${C_YELLOW}!${C_OFF} $*"; }
die()  { echo "${C_RED}✗${C_OFF} $*" >&2; exit 1; }

# ---------- 参数解析 ----------
FOLLOW=0
LAN=0
for arg in "$@"; do
  case "$arg" in
    -f|--follow|--attach)
      FOLLOW=1
      ;;
    --lan)
      LAN=1
      ;;
    -h|--help)
      echo "用法: ./dev.sh [选项]"
      echo "  直接后台启动前后端开发环境。启动前会自动清理旧进程与占用端口。"
      echo
      echo "选项:"
      echo "  -f, --follow, --attach  启动后继续在终端实时查看日志"
      echo "  --lan                   局域网模式（允许手机访问）"
      echo "  -h, --help              显示此帮助信息"
      exit 0
      ;;
  esac
done

# ---------- 前置检查 ----------
command -v bun >/dev/null 2>&1 || die "找不到 bun，请先安装：curl -fsSL https://bun.sh/install | bash"

# ---------- 递归杀进程树 ----------
kill_tree() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  kill -0 "$pid" 2>/dev/null || return 0

  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for child in $children; do
    kill_tree "$child"
  done
  kill -9 "$pid" 2>/dev/null || true
}

# ---------- 清理旧进程与端口 ----------
cleanup_old() {
  local killed=0

  # 1. 检查 PID 文件中记录的进程
  for pidfile in "$LOG_DIR/api.pid" "$LOG_DIR/web.pid"; do
    if [[ -f "$pidfile" ]]; then
      local pid
      pid="$(cat "$pidfile" 2>/dev/null || true)"
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill_tree "$pid"
        killed=1
      fi
      rm -f "$pidfile"
    fi
  done

  # 2. 检查监听目标端口的进程（43124 / 43125）
  for port in "$API_PORT" "$WEB_PORT"; do
    local pids
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      for p in $pids; do
        kill_tree "$p"
        killed=1
      done
    fi
  done

  # 3. 兜底扫描当前项目残留的 bun / vite 进程
  local extra_pids
  extra_pids="$(pgrep -f "coros-dashboard.*(server/src/index\.ts|vite)" 2>/dev/null || true)"
  if [[ -n "$extra_pids" ]]; then
    for p in $extra_pids; do
      kill_tree "$p"
      killed=1
    done
  fi

  if [[ "$killed" == "1" ]]; then
    info "检测到旧服务或端口占用，已彻底清理"
  fi

  # 4. 等待操作系统释放端口（避免 socket 处于 TIME_WAIT 导致绑定失败）
  for ((i = 0; i < 30; i++)); do
    if ! lsof -tiTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1 && ! lsof -tiTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      break
    fi
    sleep 0.1
  done

  if lsof -tiTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    die "端口 ${API_PORT}（后端）仍被占用，请手动检查：lsof -i :${API_PORT}"
  fi
  if lsof -tiTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    die "端口 ${WEB_PORT}（前端）仍被占用，请手动检查：lsof -i :${WEB_PORT}"
  fi
}

echo "🚀 一键启动 COROS 训练看板（开发模式）..."

# 清理旧进程
cleanup_old

# 清空旧日志，保证本次输出干净
> "$LOG_DIR/api.log"
> "$LOG_DIR/web.log"

# ---------- 启动后端 API ----------
info "启动后端 API（:${API_PORT}）..."
cd "$ROOT/server"
if [[ "$LAN" == "1" ]]; then
  HOST=0.0.0.0 nohup bun run --watch src/index.ts </dev/null > "$LOG_DIR/api.log" 2>&1 &
else
  nohup bun run --watch src/index.ts </dev/null > "$LOG_DIR/api.log" 2>&1 &
fi
API_PID=$!
echo "$API_PID" > "$LOG_DIR/api.pid"
cd "$ROOT"

# ---------- 启动前端 Web ----------
# 说明：直接运行 vite.js 而不是通过 bun run dev 别名启动，
# 避免 bun 包装层在终端关闭时触发 SIGHUP 导致子进程 Vite 异常退出。
info "启动前端 Web（:${WEB_PORT}）..."
cd "$ROOT/web"
if [[ "$LAN" == "1" ]]; then
  nohup bun ./node_modules/vite/bin/vite.js --host 0.0.0.0 </dev/null > "$LOG_DIR/web.log" 2>&1 &
else
  nohup bun ./node_modules/vite/bin/vite.js </dev/null > "$LOG_DIR/web.log" 2>&1 &
fi
WEB_PID=$!
echo "$WEB_PID" > "$LOG_DIR/web.pid"
cd "$ROOT"

# ---------- 轮询等待就绪 ----------
wait_for_port() {
  local port="$1" tries="${2:-40}"
  for ((i = 1; i <= tries; i++)); do
    if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

if ! wait_for_port "$API_PORT" 40; then
  warn "后端 API 启动超时，最后 20 行日志："
  tail -20 "$LOG_DIR/api.log" 2>/dev/null || true
  kill_tree "$API_PID"
  kill_tree "$WEB_PID"
  die "后端启动失败"
fi
ok "后端已监听 :${API_PORT}"

if ! wait_for_port "$WEB_PORT" 40; then
  warn "前端 Web 启动超时，最后 20 行日志："
  tail -20 "$LOG_DIR/web.log" 2>/dev/null || true
  kill_tree "$API_PID"
  kill_tree "$WEB_PID"
  die "前端启动失败"
fi
ok "前端已监听 :${WEB_PORT}"

# 健康检查
if curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT}/api/status" >/dev/null 2>&1; then
  local_count=$(curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT}/api/status" 2>/dev/null | grep -o '"activities":[0-9]*' | head -1 || echo "")
  ok "API 健康检查通过 ${local_count:+（${local_count}）}"
fi

echo
ok "${C_BOLD}COROS 训练看板已成功启动！${C_OFF}"
echo "  ${C_CYAN}👉 前端页面：http://localhost:${WEB_PORT}${C_OFF}"
echo "  ${C_DIM}⚙️  后端 API：http://localhost:${API_PORT}${C_OFF}"
echo "  ${C_DIM}📁 实时日志：${LOG_DIR}/api.log  ${LOG_DIR}/web.log${C_OFF}"
echo

if [[ "$LAN" == "1" ]]; then
  LAN_IP=""
  for dev in en0 en1 en2 en3; do
    ip="$(ipconfig getifaddr "$dev" 2>/dev/null || true)"
    [[ -n "$ip" ]] && { LAN_IP="$ip"; break; }
  done
  if [[ -n "$LAN_IP" ]]; then
    echo "  ${C_CYAN}📱 局域网访问：http://${LAN_IP}:${WEB_PORT}${C_OFF}"
  fi
fi

# ---------- 默认后台运行退出 ----------
if [[ "$FOLLOW" == "0" ]]; then
  echo "${C_DIM}  服务已在后台运行。${C_OFF}"
  echo "${C_DIM}  停止服务：./stop.sh（或再次运行 ./dev.sh 重启）${C_OFF}"
  echo "${C_DIM}  查看日志：tail -f ${LOG_DIR}/api.log ${LOG_DIR}/web.log${C_OFF}"
  echo
  exit 0
fi

# ---------- -f / --follow 模式：前台查看日志 ----------
echo "${C_DIM}  提示：按 Ctrl+C 可退出日志查看（服务仍会在后台继续运行）${C_OFF}"
echo "${C_DIM}  ---------------- 实时日志滚动 ----------------${C_OFF}"
echo

trap 'echo ""; exit 0' INT TERM
tail -n 10 -f "$LOG_DIR/api.log" "$LOG_DIR/web.log"
