import { resolve, join } from 'path'
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Marvis 官方图标：从本机腾讯 Marvis 安装目录提取（文件名带内容哈希，按版本扫描；未安装则跳过） */
function syncMarvisIcon(): void {
  try {
    const dstDir = resolve('src/renderer/public/icons')
    const dst = resolve(dstDir, 'marvis.png')
    if (existsSync(dst)) return
    const appDir = 'D:/Program Files/Tencent/Marvis/Application'
    if (!existsSync(appDir)) return
    mkdirSync(dstDir, { recursive: true })
    for (const v of readdirSync(appDir).sort().reverse()) {
      const assets = join(appDir, v, 'marvis-offline-page', 'assets')
      if (!existsSync(assets)) continue
      const hit = readdirSync(assets).find(f => /^icon-logo-static-.*\.png$/i.test(f))
      if (hit) {
        copyFileSync(join(assets, hit), dst)
        return
      }
    }
  } catch (e) {
    console.warn('[design-icons] marvis icon sync skipped:', e)
  }
}
syncMarvisIcon()

/** MiniMax Code 官方图标：从本机安装目录提取（未安装则跳过） */
function syncMinimaxCodeIcon(): void {
  try {
    const dstDir = resolve('src/renderer/public/icons')
    const dst = resolve(dstDir, 'minimax-code.png')
    if (existsSync(dst)) return
    const candidates = [
      'D:/minimax/MiniMax Code/resources/resources/daemon/browser-plugin/extension/icons/icon128.png',
      join(process.env.LOCALAPPDATA || '', 'Programs', 'MiniMax Code', 'resources', 'resources', 'daemon', 'browser-plugin', 'extension', 'icons', 'icon128.png')
    ]
    for (const src of candidates) {
      if (src && existsSync(src)) {
        mkdirSync(dstDir, { recursive: true })
        copyFileSync(src, dst)
        return
      }
    }
  } catch (e) {
    console.warn('[design-icons] minimax-code icon sync skipped:', e)
  }
}
syncMinimaxCodeIcon()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [
      // 仅开发(serve)生效：放行 Vite/React Fast Refresh 注入的 inline 预置脚本，
      // 否则 index.html 的 CSP（script-src 'self'）会拦截它，导致 React 不挂载、渲染黑屏。
      // 生产构建（loadFile）不注入该脚本，CSP 保持严格，安全性不受影响。
      {
        name: 'dev-csp-relax',
        apply: 'serve',
        transformIndexHtml: (html: string) =>
          html.replace(
            "script-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
          )
      },
      react(),
      tailwindcss()
    ]
  }
})
