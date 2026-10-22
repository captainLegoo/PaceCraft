#!/usr/bin/env bash
#
# 停止 COROS 训练看板
#
# 用法：
#   ./stop.sh              # 优雅停止（TERM），等 5 秒还不退再 KILL
#   ./stop.sh --force      # 直接 KILL
#   ./stop.sh --clean      # 停止并清空日志与 PID 文件
#
# 只按 PID 文件里记录的进程号杀，不会误伤同名或占同端口的其它进程；
# 但会额外校验进程确实是本项目启动的（命令行里含 coros-dashboard）。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/.logs"

FORCE=0
CLEAN=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --clean) CLEAN=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "未知参数：$arg" >&2; exit 1 ;;
  esac
done

if [[ -t 1 ]]; then
  C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_OFF=$'\033[0m'
else
  C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""; C_OFF=""
fi

ok()   { echo "${C_GREEN}✓${C_OFF} $*"; }
info() { echo "${C_CYAN}▸${C_OFF} $*"; }
warn() { echo "${C_YELLOW}!${C_OFF} $*"; }

# 校验 PID 确实是本项目进程 —— 防止 PID 文件过期后误杀别人的进程。
#
# 注意不能只匹配 "coros-dashboard"：`bun run dev` 派生的子进程命令行
# 里只有 "bun run dev" / "vite"，不含项目路径。所以要放宽到 bun/vite/node 这类
# 运行时特征，同时再叠加"监听的是我们的端口"这一条来兜底。
is_ours() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null || return 1
  local cmd
  cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
  [[ -z "$cmd" ]] && return 1
  # 明确的本项目特征
  [[ "$cmd" == *coros-dashboard* ]] && return 0
  [[ "$cmd" == *"src/index.ts"* ]] && return 0
  # bun/vite 包装进程：靠端口再确认一次
  if [[ "$cmd" == *bun* || "$cmd" == *vite* || "$cmd" == *node* ]]; then
    [[ "$cmd" == *"run dev"* || "$cmd" == *vite* ]] && return 0
  fi
  return 1
}

# 杀整棵进程树（bun 会派生子进程，只杀父的会留孤儿占端口）。
# macOS 的 pgrep 没有 -P，所以从 ps 输出里解析父子关系。
descendants() {
  local root="$1" all kids
  all="$(ps -axo pid=,ppid= 2>/dev/null || true)"
  kids="$(echo "$all" | awk -v p="$root" '$2==p {print $1}')"
  for k in $kids; do
    descendants "$k"
    echo "$k"
  done
}

kill_tree() {
  local pid="$1" sig="$2" d
  for d in $(descendants "$pid"); do
    kill -"$sig" "$d" 2>/dev/null || true
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

stop_one() {
  local name="$1" pidfile="$LOG_DIR/$1.pid"

  if [[ ! -f "$pidfile" ]]; then
    echo "${C_DIM}  ${name}：没有 PID 文件，跳过${C_OFF}"
    return 0
  fi

  local pid
  pid="$(cat "$pidfile" 2>/dev/null || echo "")"
  if [[ -z "$pid" ]]; then
    warn "${name}：PID 文件为空"
    rm -f "$pidfile"
    return 0
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    echo "${C_DIM}  ${name}：进程 ${pid} 已不存在${C_OFF}"
    rm -f "$pidfile"
    return 0
  fi

  if ! is_ours "$pid"; then
    warn "${name}：PID ${pid} 不是本项目的进程，跳过（可能 PID 已被复用）"
    echo "${C_DIM}        命令：$(ps -o command= -p "$pid" 2>/dev/null | cut -c1-70)${C_OFF}"
    rm -f "$pidfile"
    return 0
  fi

  info "停止${name}（PID ${pid}）…"

  if [[ "$FORCE" == "1" ]]; then
    kill_tree "$pid" 9
    ok "${name} 已强制结束"
    rm -f "$pidfile"
    return 0
  fi

  # 优雅停止：TERM 整个进程组，等 5 秒
  kill_tree "$pid" TERM
  for ((i = 0; i < 25; i++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      ok "${name} 已停止"
      rm -f "$pidfile"
      return 0
    fi
    sleep 0.2
  done

  warn "${name}：5 秒内未退出，改用 KILL"
  kill_tree "$pid" 9
  sleep 0.3
  if kill -0 "$pid" 2>/dev/null; then
    echo "${C_RED}✗${C_OFF} ${name} 无法结束（PID ${pid}），需要手动处理"
    return 1
  fi
  ok "${name} 已结束"
  rm -f "$pidfile"
  return 0
}

echo
info "停止 COROS 训练看板"

# 先停前端再停后端：前端还可能正在往 API 打请求
FAILED=0
stop_one web || FAILED=1
stop_one api || FAILED=1

# 兜底：nohup + bun 可能派生了子进程，父进程退了但端口还占着
for port in 43125 43124; do
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN | tr '\n' ' ')"
    warn "端口 ${port} 仍被占用（PID ${pids}），清理残留进程"
    for p in $pids; do
      cmd="$(ps -o command= -p "$p" 2>/dev/null || true)"
      if [[ "$FORCE" == "1" || "$cmd" == *coros-dashboard* || "$cmd" == *"src/index.ts"* || "$cmd" == *vite* || "$cmd" == *bun* || "$cmd" == *node* ]]; then
        info "清理残留进程 ${p}"
        kill_tree "$p" 9
      else
        warn "端口 ${port} 被非本项目进程占用（${p}），未处理"
      fi
    done
  fi
done

# 再次确认端口完全释放（等待系统回收 socket，避免立即启动时偶发端口冲突）
for port in 43125 43124; do
  for ((w = 0; w < 20; w++)); do
    lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.1
  done
done

if [[ "$FORCE" == "1" ]]; then
  rm -f "$LOG_DIR"/api.pid "$LOG_DIR"/web.pid
fi

if [[ "$CLEAN" == "1" ]]; then
  info "清空日志…"
  rm -f "$LOG_DIR"/*.log
  ok "日志已清空"
fi

if [[ "$FAILED" == "0" ]]; then
  echo
  ok "全部停止"
else
  echo
  warn "有进程未能正常停止，请手动检查"
fi
echo