#!/usr/bin/env bash
#
# 安装两个 systemd 服务：后端 + Cloudflare 隧道。
#
# 为什么要做成服务：
#   · 服务器重启后不用手动敲两条命令
#   · 隧道进程崩了会自动拉起（快速隧道没有 SLA，得自己看着）
#   · 不用每次都带 COROS_DATA_DIR
#
# 用法：
#   sudo ./setup-server.sh                       # 用默认路径 /home/coros-dashboard
#   sudo ALLOWED_MAIL=me@x.com ./setup-server.sh # 顺便锁定访问邮箱（强烈建议）
#
# 装完：
#   systemctl status coros-api coros-tunnel
#   journalctl -u coros-tunnel -f        # 看当前访问地址
#   ./stop.sh                            # 停服（沿用原脚本）

set -euo pipefail

ROOT="${ROOT:-/home/coros-dashboard}"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
ALLOWED_MAIL="${ALLOWED_MAIL:-}"

if [[ $EUID -ne 0 ]]; then echo "请用 sudo 跑"; exit 1; fi
if [[ ! -f "$ROOT/start.sh" ]]; then echo "✗ 在 $ROOT 找不到 start.sh，先确认安装路径"; exit 1; fi
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "✗ 没装 cloudflared。先执行："
  echo "  curl -L -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
  echo "  chmod +x /usr/local/bin/cloudflared"
  exit 1
fi
if [[ ! -f "$DATA_DIR/coros.db" ]]; then
  echo "✗ $DATA_DIR/coros.db 不存在，先解压数据包"
  exit 1
fi

# ---------- 后端 ----------
# 不用 start.sh：它会自己 build 前端、并用 nohup 起进程，
# 这些在 systemd 里是反模式（systemd 以为进程立刻退出了）。
# 这里直接跑 bun，前端构建交给 deploy.service。
cat > /etc/systemd/system/coros-api.service <<EOF
[Unit]
Description=COROS Dashboard API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
Environment=COROS_DATA_DIR=$DATA_DIR
Environment=PORT=43124
Environment=HOST=127.0.0.1
ExecStart=$HOME/.bun/bin/bun run server/src/index.ts
Restart=always
RestartSec=10
StandardOutput=append:$ROOT/.logs/api.log
StandardError=append:$ROOT/.logs/api.log

[Install]
WantedBy=multi-user.target
EOF

# ---------- 前端构建 ----------
# 只在启动前跑一次，失败就不启动后端（否则会服务一个空 dist）。
cat > /etc/systemd/system/coros-build.service <<EOF
[Unit]
Description=Build COROS Dashboard frontend
Before=coros-api.service
PartOf=coros-api.service

[Service]
Type=oneshot
WorkingDirectory=$ROOT
Environment=COROS_DATA_DIR=$DATA_DIR
ExecStart=$HOME/.bun/bin/bun run --cwd web build
RemainAfterExit=yes
EOF

# ---------- 隧道 ----------
# 没给ALLOWED_MAIL 就不加认证参数 —— 但那等于把数据公开，
# 所以默认拒绝安装，必须显式给邮箱。
if [[ -z "$ALLOWED_MAIL" ]]; then
  echo "✗ 必须提供 ALLOWED_MAIL，否则隧道地址是完全公开的："
  echo "    sudo ALLOWED_MAIL=you@example.com ./setup-server.sh"
  echo "  （不加的话任何拿到地址的人都能看你的全部训练数据）"
  exit 1
fi

TUNNEL_ARGS="--url http://127.0.0.1:43124 --protocol http2 --allowed-mail $ALLOWED_MAIL"

cat > /etc/systemd/system/coros-tunnel.service <<EOF
[Unit]
Description=COROS Dashboard via Cloudflare Quick Tunnel
After=network-online.target coros-api.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate $TUNNEL_ARGS
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

mkdir -p "$ROOT/.logs"

systemctl daemon-reload
systemctl enable --now coros-build.service
systemctl enable --now coros-api.service
systemctl enable --now coros-tunnel.service

echo
echo "✓ 已安装并启动。当前地址："
sleep 5
journalctl -u coros-tunnel --no-pager -n 40 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
echo
echo "常用命令："
echo "  systemctl status coros-api coros-tunnel"
echo "  journalctl -u coros-tunnel -f# 看地址变化"
echo "  systemctl restart coros-api"
echo
echo "⚠ 快速隧道地址每次重启都会变。手机收藏夹会失效，"
echo "  需要固定地址就得有自己的域名并改用命名隧道。"