#!/usr/bin/env node
// ============================================================================
//  开发启动器：一条命令同时拉起 Vite（热更新）和 Electron（指向它）
//
//  用法：
//    npm run dev:app                 # 正常开发
//    npm run dev:app -- --smoke      # 额外参数透传给 Electron（CI/截图用）
//
//  做的事：
//    1. 起 Vite 开发服务器（固定 5173，占用则直接报错而不是悄悄换端口）
//    2. 等它真的能响应（不是仅端口 listen）
//    3. 以 VITE_DEV_SERVER_URL 起 Electron，渲染层吃 HMR
//    4. 任一方退出就收拾另一方（Windows 下整树 taskkill，避免留孤儿）
//
//  两个 Windows 专坑（都踩过）：
//    - 不用 npx + shell:true：那会多套一层 cmd.exe，kill 只杀到 cmd，
//      node/vite 变孤儿把父进程的输出管道占住，终端看起来"卡住"。
//      这里直接调 node + node_modules 里的可执行文件。
//    - 若环境里有 ELECTRON_RUN_AS_NODE，Electron 会退化成纯 Node
//      （窗口打不开且不报错），这里显式清掉。
// ============================================================================
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(import.meta.dirname, '..')
const PORT = 5173
const DEV_URL = `http://localhost:${PORT}`
const extraArgs = process.argv.slice(2)
const isWin = process.platform === 'win32'

/** 子进程环境：清掉会把 Electron 降级成 Node 的变量 */
const childEnv = { ...process.env }
delete childEnv.ELECTRON_RUN_AS_NODE

/** electron 包导出的就是可执行文件路径 */
const electronBin = require('electron')
const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')

const children = []
let shuttingDown = false

function killTree(child) {
  if (!child || child.exitCode !== null) return
  try {
    if (isWin) {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    /* 已经没了 */
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const { child } of children) killTree(child)
  setTimeout(() => process.exit(code), 200)
}

function launch(name, bin, args, env = childEnv) {
  const child = spawn(bin, args, { cwd: ROOT, env, stdio: 'inherit' })
  children.push({ name, child })
  child.on('error', (err) => {
    console.error(`[dev] ${name} 启动失败：${err.message}`)
    shutdown(1)
  })
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.log(`\n[dev] ${name} 退出（code=${code} signal=${signal}），一起收工`)
    shutdown(code ?? 0)
  })
  return child
}

async function waitForDevServer(timeoutMs = 60000) {
  const started = Date.now()
  for (;;) {
    if (Date.now() - started > timeoutMs) throw new Error(`等待 Vite 超时（${DEV_URL}）`)
    try {
      const res = await fetch(DEV_URL, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return
    } catch {
      /* 还没起来 */
    }
    await sleep(200)
  }
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('[dev] 启动 Vite…')
launch('vite', process.execPath, [viteBin, '--port', String(PORT), '--strictPort'])

try {
  await waitForDevServer()
} catch (err) {
  console.error('[dev] ' + err.message)
  shutdown(1)
}

console.log(`[dev] Vite 就绪：${DEV_URL}`)
console.log('[dev] 启动 Electron（渲染层走开发服务器，改代码即时热更新）')

launch('electron', electronBin, ['.', ...extraArgs], {
  ...childEnv,
  VITE_DEV_SERVER_URL: DEV_URL,
})
