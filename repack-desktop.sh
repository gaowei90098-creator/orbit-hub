#!/usr/bin/env bash
# 把最新源码塞进桌面 Orbit.app（不重新打包，绕开 electron-builder 的 ensureSymlink bug）。
# 现有 Orbit.app 的 Electron 外壳是好的，只需更新里面的 app payload（dist + dashboard/dist
# + node-pty）。在你自己机器上跑：  cd ~/Desktop/AgentHub && bash repack-desktop.sh
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

APP="$HOME/Desktop/Orbit.app/Contents/Resources/app"
if [ ! -d "$APP" ]; then
  echo "✗ 没找到 ~/Desktop/Orbit.app。把 Orbit.app 放到桌面后再跑。"
  exit 1
fi

echo "==> 1/3 构建最新前后端 (build:all)…"
npm run build:all

echo "==> 2/3 按系统 node 重建 node-pty（嵌入终端用；hub 跑系统 node，ABI 要对）…"
npm rebuild node-pty >/dev/null 2>&1 || echo "    (node-pty 重建跳过——终端会优雅降级，不影响其余功能)"

echo "==> 3/3 同步进桌面 Orbit.app（纯文件，无符号链接）…"
rsync -a --delete --no-links dist/ "$APP/dist/"
rsync -a --delete --no-links dashboard/dist/ "$APP/dashboard/dist/"
rsync -a --no-links electron/ "$APP/electron/"
mkdir -p "$APP/node_modules/node-pty"
rsync -a --no-links node_modules/node-pty/ "$APP/node_modules/node-pty/"
xattr -cr "$HOME/Desktop/Orbit.app" 2>/dev/null || true

echo ""
echo "✅ 完成。完全退出正在运行的 Orbit（⌘Q），再双击桌面 Orbit 即是最新版。"
