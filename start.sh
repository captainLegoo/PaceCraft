#!/usr/bin/env bash
#
# 启动 COROS 训练看板（后端 API + 前端界面）
#
# 用法：
#   ./start.sh              # 开发模式：后端 43124 + 前端 43125（带热更新）
#   ./start.sh prod         # 生产模式：构建前端，由后端一并托管在 43124
#   ./start.sh sync         # 先同步一次数据再启动
#   ./start.sh workflow     # 只跑一遍自动化工作流，不启动服务
#
# 日志统一在 .logs/ 下，PID 记在 .logs/*.pid

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/.logs"
API_PORT=43124
WEB_PORT=43125
API_URL="http://127.0.0.1:${API_PORT}"

mkdir -p "$LOG_DIR"

# ---------- 颜色 ----------
if [[ -t 1 ]]; then
  C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_OFF=$'\033[0m'
else
  C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""; C_OFF=""
fi

info() { echo "${C_CYAN}▸${C_OFF} $*"; }
ok()   { echo "${C_GREEN}✓${C_OFF} $*"; }
warn() { echo "${C_YELLOW}!${C_OFF} $*"; }
die()  { echo "${C_RED}✗${C_OFF} $*" >&2; exit 1; }

# ---------- 前置检查 ----------
command -v bun >/dev/null 2>&1 || die "找不到 bun，请先安装：curl -fsSL https://bun.sh/install | bash"

# 端口占用检查。
# 关键：必须只查 LISTEN 状态。用裸 lsof -ti:<port> 会把「连出时占用临时端口」
# 的客户端也算进来 —— 实测 Edge 会随机占用 43124 作为源端口，
# 导致误判端口被占用而拒绝启动。真正冲突的只有监听方。
port_busy() { lsof -tiTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# 占用者详情（用于报错时说明）
port_owner() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print $1" ("$2")"}' | tr '
' ' '
}

check_port_free() {
  local port="$1" name="$2"
  if port_busy "$port"; then
    die "端口 ${port}（${name}）已被监听：PID $(port_owner "$port")
     先跑 ./stop.sh，或换个端口（PORT / vite.config.ts）。"
  fi
}

# ---------- 启动 ----------
# 后台启动并记录 PID。
#
# 为什么不用 setsid：macOS 默认没有，装它要额外 brew 装 util-linux，
# 为了「干净地杀进程」而给用户加一个系统级依赖不划算。
# 改用 nohup + disown（防止被 Ctrl-C 的信号组波及），
# 子进程残留的问题交给 stop.sh 按端口兜底清理。
start_api() {
  info "启动后端 API（:${API_PORT}）…"
  # 注意不能用 ( cd ... & ) 那种子 shell —— 那样 $! 拿到的是子 shell 的 PID，
  # 子 shell 退出后 bun 就变成孤儿，stop.sh 也找不到正确的进程。
  cd "$ROOT/server" || return 1
  nohup bun run src/index.ts > "$LOG_DIR/api.log" 2>&1 &
  local pid=$!
  cd "$ROOT" || return 1
  echo "$pid" > "$LOG_DIR/api.pid"
  disown "$pid" 2>/dev/null || true
}

start_web() {
  info "启动前端 dev server（:${WEB_PORT}）…"
  cd "$ROOT/web" || return 1
  nohup bun run dev > "$LOG_DIR/web.log" 2>&1 &
  local pid=$!
  cd "$ROOT" || return 1
  echo "$pid" > "$LOG_DIR/web.pid"
  disown "$pid" 2>/dev/null || true
}

# 轮询等待端口就绪，而不是 sleep 固定秒数（慢机器上 sleep 不够）
wait_for_http() {
  local url="$1" name="$2" tries="${3:-40}"
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
      ok "$name 已就绪"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

wait_for_port() {
  local port="$1" name="$2" tries="${3:-40}"
  for ((i = 1; i <= tries; i++)); do
    if port_busy "$port"; then
      ok "$name 已监听 :$port"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

run_sync() {
  info "同步 COROS 数据…"
  cd "$ROOT/server"
  bun run src/cli/sync.ts 2>&1 | tail -20
  cd "$ROOT"
}

run_workflow() {
  info "跑一遍自动化工作流…"
  cd "$ROOT/server"
  bun -e '
    import "./src/workflow/steps.ts";
    import { runWorkflow } from "./src/workflow/engine.ts";
    const r = await runWorkflow({ labelIds: [] });
    console.log("  " + r.summary + `（${r.durationMs}ms）`);
    for (const s of r.steps) {
      const icon = { ok: "✓", skipped: "○", failed: "✗", disabled: "·" }[s.status];
      console.log(`  ${icon} ${s.label.padEnd(14)} ${s.message}`);
    }
    if (!r.ok) process.exit(1);
  '
  cd "$ROOT"
}

MODE="${1:-dev}"

case "$MODE" in
  sync)
    run_sync
    echo
    info "同步完成。再跑 ./start.sh 启动服务。"
    exit 0
    ;;
  workflow)
    run_workflow
    exit 0
    ;;
  dev|prod) ;;
  *)
    die "未知参数：${MODE}（可用：dev | prod | sync | workflow）"
    ;;
esac

echo
info "启动 COROS 训练看板（${MODE} 模式）"
echo "${C_DIM}  日志目录：${LOG_DIR}${C_OFF}"
echo

# 已存在就直接退出，不要重复启动
if [[ -f "$LOG_DIR/api.pid" ]] && kill -0 "$(cat "$LOG_DIR/api.pid")" 2>/dev/null; then
  die "后端已在运行（PID $(cat "$LOG_DIR/api.pid")）。要重启请先跑 ./stop.sh"
fi

check_port_free "$API_PORT" "后端 API"

if [[ "$MODE" == "dev" ]]; then
  check_port_free "$WEB_PORT" "前端 dev"
fi

# ---- 先起后端：前端代理要打过来，后端得先在 ----
start_api

if ! wait_for_port "$API_PORT" "后端"; then
  warn "后端启动超时，最后 20 行日志："
  tail -20 "$LOG_DIR/api.log" || true
  die "后端启动失败"
fi

if curl -fsS --max-time 5 "$API_URL/api/status" >/dev/null 2>&1; then
  local_count=$(curl -fsS --max-time 5 "$API_URL/api/status" 2>/dev/null | grep -o '"activities":[0-9]*' | head -1 || echo "")
  ok "API 健康检查通过 ${local_count:+（${local_count}）}"
fi

if [[ "$MODE" == "dev" ]]; then
  start_web
  if ! wait_for_port "$WEB_PORT" "前端"; then
    warn "前端启动超时，最后 20 行日志："
    tail -20 "$LOG_DIR/web.log" || true
    die "前端启动失败"
  fi
  URL="http://localhost:${WEB_PORT}"
else
  # 生产模式：构建前端，由后端静态托管，全部走 43124 一个端口
  info "构建前端…"
  (cd "$ROOT/web" && bun run build) || die "前端构建失败"
  URL="$API_URL"
fi

echo
ok "已启动"
echo "  ${C_CYAN}${URL}${C_OFF}"
echo "  ${C_DIM}后端日志：${LOG_DIR}/api.log${C_OFF}"
[[ "$MODE" == "dev" ]] && echo "  ${C_DIM}前端日志：${LOG_DIR}/web.log${C_OFF}"
echo
echo "${C_DIM}  停止：./stop.sh    查看日志：tail -f ${LOG_DIR}/api.log${C_OFF}"
echo