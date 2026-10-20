#!/usr/bin/env bash
#
# 打包 COROS 训练看板，用于部署到云服务器。
#
# 生成两个包：
#   coros-dashboard.tar.gz   代码（不含依赖、不含数据、不含 git 历史）
#   coros-data.tar.gz        数据（数据库 + OAuth 凭证）
#
# 之所以分成两个：数据里有明文 OAuth token 和全部训练记录，
# 不该跟着代码一起进版本库，也不该随便丢在共享目录里。
#
# 用法：./pack.sh  →  两个包都放在项目根目录

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${COROS_DATA_DIR:-$HOME/.coros-dashboard}"
STAMP="$(date +%Y%m%d)"

cd "$ROOT"

# ---------- 代码包 ----------
# 排除的东西：
#   node_modules   依赖要到服务器上按 bun.lock 重装，带过去没意义还臃肿
#   .git           900K 历史，纯负担
#   .shots         51M 截图，里面是你真实训练数据，绝不能外传
#   .logs          PID 和日志
#   dist           前端产物，服务器上 build 一次更干净（也能保证版本一致）
echo "▸ 打包代码…"
# --no-xattrs / --no-mac-metadata 不一定都支持，先探测再用支持的。
# 没有它的话 macOS 会把 Finder 标签（文件颜色、来源标记）一起塞进包，
# Linux 上解压会刷几百行 "Ignoring unknown extended header keyword"，无害但很吵。
XATTR_OPTS=""
if tar --help 2>&1 | grep -q -- '--no-mac-metadata'; then
  XATTR_OPTS="--no-mac-metadata --no-xattrs"   # bsdtar（macOS 自带）
elif tar --help 2>&1 | grep -q -- '--no-xattrs'; then
  XATTR_OPTS="--no-xattrs"                     # GNU tar（Linux）
fi

# shellcheck disable=SC2086  # XATTR_OPTS 是刻意拆成多个参数
tar -czf "coros-dashboard-$STAMP.tar.gz" $XATTR_OPTS \
  --exclude='./node_modules' \
  --exclude='./server/node_modules' \
  --exclude='./web/node_modules' \
  --exclude='./.git' \
  --exclude='./.shots' \
  --exclude='./.logs' \
  --exclude='./docs' \
  --exclude='*.tsbuildinfo' \
  --exclude='*.tar.gz' \
  --exclude='*.db' \
  --exclude='*.db-wal' \
  --exclude='*.db-shm' \
  --exclude='tokens.json' \
  --exclude='._*' \
  --exclude='.DS_Store' \
  .

# ---------- 数据包 ----------
# 前置：把 WAL 合并进主库。
# SQLite 默认开 WAL，最近写入的数据还留在 coros.db-wal 里，
# 只拷 .db 的话会丢掉最后一次同步后的所有记录 —— 这坑很安静，不报错，
# 只是数据莫名其妙少了一点。checkpoint 是官方标准操作，不会丢数据。
echo "▸ 合并 WAL…"
if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$DATA_DIR/coros.db" ]]; then
  sqlite3 "$DATA_DIR/coros.db" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
  sqlite3 "$DATA_DIR/coros.db" "PRAGMA integrity_check;" | grep -qx ok \
    || { echo "✗ 数据库完整性检查失败，中止打包"; exit 1; }
fi

echo "▸ 打包数据…"
# probe/ 是探测缓存、*.bak-* 是历史备份、removed-before-open-source/ 是删剩的旧数据
# 都不需要带上。只保留数据库本体和凭证。
# shellcheck disable=SC2086
tar -czf "coros-data-$STAMP.tar.gz" $XATTR_OPTS \
  -C "$DATA_DIR" \
  --exclude='probe' \
  --exclude='*.bak-*' \
  --exclude='removed-before-open-source' \
  --exclude='._*' \
  --exclude='.DS_Store' \
  coros.db tokens.json

# 自检：包里绝不能出现 AppleDouble 或 .DS_Store。
# 这类文件在 Linux 上无害但会让后端启动失败（client.ts 会把 ._*.sql 当迁移读），
# 属于「本地看不出来、到了服务器才炸」的问题，所以在打包时就拦住。
if tar -tzf "coros-dashboard-$STAMP.tar.gz" 2>/dev/null | grep -qE '(^|/)\._|\.DS_Store'; then
  echo "✗ 代码包里混进了 macOS 元数据文件，中止"
  exit 1
fi

echo
echo "✓ 完成："
ls -lh coros-dashboard-*.tar.gz coros-data-*.tar.gz | awk '{print "  " $9 "  " $5}'
echo
echo "传到服务器："
echo "  scp coros-dashboard-$STAMP.tar.gz coros-data-$STAMP.tar.gz root@<服务器IP>:/tmp/"