// ============================================================================
//  ZenithDesk 主进程
//
//  为什么网络请求都放主进程：
//  渲染进程从 file:// 加载，Origin 是 null，直连网关会被 CORS 拦；
//  主进程用 Node 的 fetch 出去，再把增量通过 IPC 推给界面 —— 顺带能拿到
//  完整响应头/状态码，也避免把 token 暴露在页面里。
// ============================================================================
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { spawn, execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')

const isSmoke = process.argv.includes('--smoke')
// 冒烟/无 GPU 环境：关掉硬件加速，避免窗口创建卡住
if (isSmoke) app.disableHardwareAcceleration()
/** @type {BrowserWindow | null} */
let win = null
/** 进行中的流式请求：id -> AbortController */
const inflight = new Map()

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

const DEFAULT_SETTINGS = {
  baseUrl: 'http://127.0.0.1:8090',
  model: '',
  temperature: 0.7,
  maxTokens: 512,
  thinking: 0, // -1 关 / 0 默认 / 1 开
  systemPrompt: '',
  // 本地引擎（网关）启动参数
  gatewayExe: '',
  pluginDir: '',
  modelPath: '',
  backend: 'auto',
  engineArgs: '',
}

function readSettings() {
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8')
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function writeSettings(next) {
  const merged = { ...DEFAULT_SETTINGS, ...next }
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(merged, null, 2), 'utf8')
  return merged
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: 'ZenithDesk',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => win.show())
  // 外链走系统浏览器，不在应用内开窗
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 开发便利：F12 / Ctrl+Shift+I 开关 DevTools（打包后同样可用，便于排查线上问题）
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const isF12 = input.key === 'F12'
    const isInspect =
      (input.control || input.meta) && input.shift && String(input.key).toLowerCase() === 'i'
    if (isF12 || isInspect) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

// ---------------------------------------------------------------------------
//  本地引擎（Zenith 网关）进程管理
//
//  架构上推理在网关里（插件加载 llama.cpp / NInfer 引擎），桌面端只是客户端。
//  这个面板负责把网关**当成子进程拉起来**：选模型 → 启动 → 等 /healthz 通 → 自动连上。
// ---------------------------------------------------------------------------
/** @type {import('node:child_process').ChildProcess | null} */
let gatewayProc = null
const gatewayLogFile = () => path.join(app.getPath('userData'), 'gateway.log')

function gatewayLogTail(max = 4000) {
  try {
    const txt = fs.readFileSync(gatewayLogFile(), 'utf8')
    return txt.length > max ? txt.slice(-max) : txt
  } catch {
    return ''
  }
}

function stopGateway() {
  const proc = gatewayProc
  gatewayProc = null
  if (!proc) return false
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      proc.kill('SIGTERM')
    }
    return true
  } catch {
    return false
  }
}

async function waitHealthy(baseUrl, timeoutMs) {
  const started = Date.now()
  const url = String(baseUrl).replace(/\/+$/, '') + '/healthz'
  for (;;) {
    if (Date.now() - started > timeoutMs) return false
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (res.ok) return true
    } catch {
      /* 还没起 */
    }
    if (gatewayProc === null) return false // 进程已经挂了，不必再等
    await new Promise((r) => setTimeout(r, 500))
  }
}

ipcMain.handle('gateway:start', async (_e, cfg) => {
  const s = { ...readSettings(), ...(cfg || {}) }
  stopGateway()

  if (!s.gatewayExe || !fs.existsSync(s.gatewayExe)) {
    return { ok: false, error: `网关程序不存在：${s.gatewayExe || '(未设置)'}` }
  }
  if (s.modelPath && !fs.existsSync(s.modelPath)) {
    return { ok: false, error: `模型文件不存在：${s.modelPath}` }
  }

  let port = '8090'
  try {
    port = new URL(s.baseUrl).port || port
  } catch {
    /* 用默认端口 */
  }

  const args = [port, s.pluginDir || '']
  if (s.modelPath) args.push('--model', s.modelPath)
  if (s.backend && s.backend !== 'auto') args.push('--backend', s.backend)
  if (s.engineArgs) args.push(...String(s.engineArgs).trim().split(/\s+/).filter(Boolean))

  fs.mkdirSync(path.dirname(gatewayLogFile()), { recursive: true })
  const fd = fs.openSync(gatewayLogFile(), 'w')
  try {
    gatewayProc = spawn(s.gatewayExe, args, {
      cwd: path.dirname(s.gatewayExe),
      stdio: ['ignore', fd, fd],
      windowsHide: true,
    })
  } finally {
    fs.closeSync(fd)
  }
  gatewayProc.on('error', (err) => {
    fs.appendFileSync(gatewayLogFile(), `\n[spawn error] ${err.message}\n`)
    gatewayProc = null
  })
  gatewayProc.on('exit', (code, signal) => {
    fs.appendFileSync(gatewayLogFile(), `\n[exit] code=${code} signal=${signal}\n`)
    gatewayProc = null
  })

  const pid = gatewayProc?.pid ?? 0
  const ok = await waitHealthy(s.baseUrl, 180000)
  return ok
    ? { ok: true, pid, log: gatewayLogTail() }
    : { ok: false, error: '引擎启动超时（180 s），见下方日志', pid, log: gatewayLogTail() }
})

ipcMain.handle('gateway:stop', () => ({ ok: stopGateway() }))

ipcMain.handle('gateway:status', () => ({
  running: gatewayProc !== null,
  pid: gatewayProc?.pid ?? 0,
  log: gatewayLogTail(),
}))

app.on('before-quit', () => stopGateway())
app.on('will-quit', () => stopGateway())

// 选文件（模型 / 网关程序 / 插件目录）
ipcMain.handle('dialog:pick', async (_e, payload) => {
  const { kind } = payload || {}
  if (kind === 'dir') {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return r.canceled ? '' : r.filePaths[0]
  }
  const filters =
    kind === 'model'
      ? [
          { name: '模型权重', extensions: ['gguf', 'ninfer'] },
          { name: '全部文件', extensions: ['*'] },
        ]
      : [
          { name: '可执行文件', extensions: ['exe'] },
          { name: '全部文件', extensions: ['*'] },
        ]
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters })
  return r.canceled ? '' : r.filePaths[0]
})

// ---------------------------------------------------------------------------
//  设置持久化
// ---------------------------------------------------------------------------
ipcMain.handle('settings:get', () => readSettings())
ipcMain.handle('settings:set', (_e, next) => writeSettings(next || {}))

// ---------------------------------------------------------------------------
//  会话历史（多会话 + 落盘）
//
//  存储：userData/sessions.json，单文件整体重写 + 临时文件改名（原子替换）。
//  历史是用户资产，宁可整体重写也不能写坏：临时文件 + rename 保证崩溃/断电时
//  要么是旧版本、要么是新版本，不会出现半截 JSON。
// ---------------------------------------------------------------------------
const sessionsFile = () => path.join(app.getPath('userData'), 'sessions.json')

/** @type {{version:number, activeId:string|null, sessions:any[]} | null} */
let store = null

function loadStore() {
  if (store) return store
  try {
    const raw = JSON.parse(fs.readFileSync(sessionsFile(), 'utf8'))
    if (raw && Array.isArray(raw.sessions)) store = raw
  } catch {
    /* 首次运行或文件损坏：下面重建空库 */
  }
  if (!store) store = { version: 1, activeId: null, sessions: [] }
  return store
}

function saveStore() {
  const file = sessionsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(loadStore(), null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

const nowIso = () => new Date().toISOString()
const newId = () => randomUUID()

/// 列表只要轻量字段，消息体按需单独取
function summarize(s) {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    model: s.model || '',
    messageCount: s.messages?.length || 0,
  }
}

function stateSnapshot() {
  const st = loadStore()
  const sessions = [...st.sessions].sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
  )
  return { activeId: st.activeId, sessions: sessions.map(summarize) }
}

ipcMain.handle('sessions:state', () => stateSnapshot())

ipcMain.handle('sessions:get', (_e, id) => {
  const st = loadStore()
  return st.sessions.find((s) => s.id === id) || null
})

ipcMain.handle('sessions:create', (_e, title) => {
  const st = loadStore()
  const s = {
    id: newId(),
    title: title || '新会话',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    model: '',
    messages: [],
  }
  st.sessions.push(s)
  st.activeId = s.id
  saveStore()
  return { session: s, state: stateSnapshot() }
})

ipcMain.handle('sessions:activate', (_e, id) => {
  const st = loadStore()
  if (st.sessions.some((s) => s.id === id)) st.activeId = id
  saveStore()
  return stateSnapshot()
})

ipcMain.handle('sessions:rename', (_e, payload) => {
  const { id, title } = payload || {}
  const st = loadStore()
  const s = st.sessions.find((x) => x.id === id)
  if (s && title) {
    s.title = String(title).slice(0, 80)
    s.updatedAt = nowIso()
    saveStore()
  }
  return stateSnapshot()
})

ipcMain.handle('sessions:save', (_e, payload) => {
  const { id, title, model, messages } = payload || {}
  const st = loadStore()
  const s = st.sessions.find((x) => x.id === id)
  if (!s) return { ok: false }
  if (typeof title === 'string' && title) s.title = title.slice(0, 80)
  if (typeof model === 'string') s.model = model
  if (Array.isArray(messages)) {
    // 只落稳定字段：pending / 流式中间态不入库
    s.messages = messages
      .filter((m) => m && m.role)
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content || '',
        reasoning: m.reasoning || '',
        meta: m.meta || null,
        error: m.error || null,
      }))
  }
  s.updatedAt = nowIso()
  saveStore()
  return { ok: true, state: stateSnapshot() }
})

ipcMain.handle('sessions:delete', (_e, id) => {
  const st = loadStore()
  st.sessions = st.sessions.filter((s) => s.id !== id)
  if (st.activeId === id) st.activeId = st.sessions[0]?.id || null
  saveStore()
  return stateSnapshot()
})

// ---------------------------------------------------------------------------
//  只读接口：模型 / 状态 / 指标
// ---------------------------------------------------------------------------
function joinUrl(base, p) {
  return String(base || '').replace(/\/+$/, '') + p
}

ipcMain.handle('api:models', async (_e, baseUrl) => {
  const res = await fetch(joinUrl(baseUrl, '/v1/models'))
  if (!res.ok) throw new Error(`GET /v1/models -> HTTP ${res.status}`)
  return res.json()
})

ipcMain.handle('api:status', async (_e, baseUrl) => {
  const res = await fetch(joinUrl(baseUrl, '/zenith/ai/status'))
  if (!res.ok) throw new Error(`GET /zenith/ai/status -> HTTP ${res.status}`)
  return res.json()
})

ipcMain.handle('api:metrics', async (_e, baseUrl) => {
  const res = await fetch(joinUrl(baseUrl, '/metrics'))
  if (!res.ok) throw new Error(`GET /metrics -> HTTP ${res.status}`)
  return res.text()
})

// ---------------------------------------------------------------------------
//  流式对话：主进程解析 SSE，把增量推给渲染进程
// ---------------------------------------------------------------------------
ipcMain.handle('chat:cancel', (_e, id) => {
  const ac = inflight.get(id)
  if (ac) {
    ac.abort()
    inflight.delete(id)
    return true
  }
  return false
})

ipcMain.handle('chat:start', async (event, payload) => {
  const { id, baseUrl, body } = payload || {}
  if (!id) throw new Error('missing request id')
  const ac = new AbortController()
  inflight.set(id, ac)

  const send = (channel, data) => {
    if (!event.sender.isDestroyed()) event.sender.send(channel, data)
  }

  let usage = null
  let finishReason = null
  let assistant = ''
  let reasoning = ''

  try {
    const res = await fetch(joinUrl(baseUrl, '/v1/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buf = ''

    // 一行行解：SSE 里我们只关心 data: 载荷（event: 之类忽略）
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') {
          send('chat:done', { id, assistant, reasoning, usage, finishReason })
          inflight.delete(id)
          return { ok: true }
        }
        let chunk
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }
        if (chunk.usage) usage = chunk.usage
        const choice = chunk.choices && chunk.choices[0]
        if (!choice) continue
        if (choice.finish_reason) finishReason = choice.finish_reason
        const delta = choice.delta || {}
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          reasoning += delta.reasoning_content
          send('chat:chunk', { id, kind: 'reasoning', text: delta.reasoning_content })
        }
        if (typeof delta.content === 'string' && delta.content) {
          assistant += delta.content
          send('chat:chunk', { id, kind: 'content', text: delta.content })
        }
      }
    }
    send('chat:done', { id, assistant, reasoning, usage, finishReason })
    inflight.delete(id)
    return { ok: true }
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || String(err).includes('aborted'))
    send('chat:error', { id, message: aborted ? '已取消' : String(err.message || err) })
    inflight.delete(id)
    return { ok: false, aborted }
  }
})

// ---------------------------------------------------------------------------
//  启动
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  createWindow()

  if (isSmoke) {
    // --smoke-demo：先驱动一次真实发送（经 renderer 的 __zenithDemo 钩子），
    // 这样截图里能看到流式对话与 token/耗时；纯 --smoke 拍空态。
    const demo = process.argv.includes('--smoke-demo')
    /** --demo-text=xxx 自定义发送内容；--demo-new 先新建一个会话 */
    const demoTextArg = process.argv.find((a) => a.startsWith('--demo-text='))
    const demoText = demoTextArg ? demoTextArg.slice('--demo-text='.length) : '用三句话介绍一下 Zenith 框架'
    const demoNew = process.argv.includes('--demo-new')
    const demoEngine = process.argv.includes('--demo-engine')
    const js = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const sendLater = (delay) => {
      setTimeout(() => {
        win.webContents
          .executeJavaScript(`window.__zenithDemo && window.__zenithDemo('${js(demoText)}')`)
          .catch((e) => console.error('[smoke] demo send failed:', e))
      }, delay)
    }
    if (demoEngine) {
      // 先让界面把网关拉起来（真实加载模型），就绪后再发消息
      setTimeout(() => {
        win.webContents
          .executeJavaScript('window.__zenithStartEngine && window.__zenithStartEngine()')
          .then((r) => {
            console.log('[smoke] engine ->', JSON.stringify(r))
            if (r && r.ok && demo) sendLater(1200)
          })
          .catch((e) => console.error('[smoke] engine start failed:', e))
      }, 1200)
    } else if (demo) {
      if (demoNew) {
        setTimeout(() => win.webContents.executeJavaScript('window.__zenithNewSession && window.__zenithNewSession()'), 1500)
      }
      sendLater(demoNew ? 2600 : 2000)
    }
    setTimeout(
      async () => {
        try {
          const img = await win.capturePage()
          const name = !demo ? 'screenshot.png' : demoNew ? 'screenshot-sessions.png' : 'screenshot-chat.png'
          // 打包后 __dirname 在 app.asar 里（只读），截图必须落到用户数据目录
          const out = app.isPackaged
            ? path.join(app.getPath('userData'), name)
            : path.join(__dirname, '..', name)
          fs.writeFileSync(out, img.toPNG())
          console.log('[smoke] screenshot ->', out)
        } catch (e) {
          console.error('[smoke] capture failed:', e)
        }
        app.exit(0)
      },
      demoEngine ? 22000 : demo ? 6500 : 4500,
    )
    // 兜底：超时强退，避免无人值守卡死
    setTimeout(() => app.exit(2), demoEngine ? 90000 : demo ? 15000 : 10000)
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
