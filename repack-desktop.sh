#!/usr/bin/env bash
# 一键：用最新源码重新打包 Orbit.app，替换桌面那个图标。
# 在你自己机器上跑（不是 agent 沙盒——沙盒封了 .app 需要的符号链接）：
#   cd ~/Desktop/AgentHub && bash repack-desktop.sh
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

echo "==> 1/3 构建最新前后端 (build:all)…"
npm run build:all

echo "==> 2/3 打包 Orbit.app (electron-builder)…"
npm run app:pack

APP="$(find release -maxdepth 2 -name 'Orbit.app' -type d | head -1)"
if [ -z "${APP:-}" ]; then
  echo "✗ 没找到打包产物 release/**/Orbit.app，看上面 electron-builder 的报错。"
  exit 1
fi
echo "    打包完成：$APP"

DEST="$HOME/Desktop/Orbit.app"
if [ -d "$DEST" ]; then
  BAK="$HOME/Desktop/Orbit.app.bak-$(date +%Y%m%d-%H%M%S)"
  echo "==> 3/3 备份旧应用 → $BAK"
  mv "$DEST" "$BAK"
fi
cp -R "$APP" "$DEST"
# 去掉隔离属性，避免未签名应用被 Gatekeeper 拦「已损坏」。
xattr -cr "$DEST" 2>/dev/null || true

echo ""
echo "✅ 完成！双击桌面 Orbit 打开，已是最新版（UI 理顺 + 终端标签 + 全部修复）。"
echo "   若仍提示无法打开：右键 → 打开，或先退出旧的 Orbit 进程再双击。"
