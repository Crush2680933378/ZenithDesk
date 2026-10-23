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
const net = require('node:net')
const { randomUUID } = require('node:crypto')

const isSmoke = process.argv.includes('--smoke')
const isProbe = process.argv.includes('--probe')
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
  maxTokens: 0, // 0 = 不限制（引擎在 EOS / 上下文满时自然停）
  thinking: 0, // -1 关 / 0 默认 / 1 开
  systemPrompt: '',
  // 本地引擎（网关）启动参数
  gatewayExe: '',
  pluginDir: '',
  modelPath: '',
  backend: 'auto',
  engineArgs: '',
  // 启动参数（结构化；engineArgs 仍是高级逃生口）
  ctx: 4096,
  threads: 0,
  gpuLayers: 0,
  batch: 0,
  flashAttn: 0,
  spec: 1,
  draft: 4,
  kvDtype: 5,
  prefillChunk: 1024,
  maxConcurrency: 1,
  device: 0,
  thinkingDefault: 0, // 启动时的默认思考模式：-1 关 / 0 后端默认 / 1 开
  termLang: 'zh', // 术语语言：zh 中文为主 / en 英文旗标为主
}

/// 某些编辑器/脚本写出的 JSON 带 UTF-8 BOM，JSON.parse 会直接抛异常 →
/// 读之前先剥掉，否则设置会被"静默重置成默认值"
function readJsonFile(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function readSettings() {
  return { ...DEFAULT_SETTINGS, ...readJsonFile(settingsFile(), {}) }
}

function writeSettings(next) {
  const merged = { ...DEFAULT_SETTINGS, ...next }
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(merged, null, 2), { encoding: 'utf8' })
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
      // 冒烟截图走离屏渲染：窗口被遮挡/锁屏时合成器不出新帧，capturePage 会拍到空图
      offscreen: isSmoke,
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

  if (isProbe) {
    win.webContents.on('console-message', (e, level, message) => {
      console.log('[renderer]', message)
    })
    win.webContents.on('render-process-gone', (e, d) => console.log('[renderer gone]', JSON.stringify(d)))
    setTimeout(async () => {
      try {
        const r = await win.webContents.executeJavaScript(
          `(() => { const root = document.getElementById('root');
             return JSON.stringify({ bodyLen: document.body.innerHTML.length,
               rootKids: root ? root.children.length : -1,
               modelView: !!document.querySelector('.model-view'),
               mvKids: document.querySelector('.model-view') ? document.querySelector('.model-view').children.length : -1,
               text: (document.body.innerText || '').slice(0, 200) }); })()`,
        )
        console.log('[probe]', r)
      } catch (err) {
        console.log('[probe] failed:', String(err))
      }
    }, 4000)
  }
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

/** 探测端口：true = 有人监听 */
function portOpen(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port })
    const done = (v) => {
      sock.removeAllListeners()
      sock.destroy()
      resolve(v)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

/** 该地址上是不是一个活的 Zenith 网关 */
async function isZenithGateway(baseUrl) {
  try {
    const res = await fetch(String(baseUrl).replace(/\/+$/, '') + '/healthz', {
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return false
    const j = await res.json().catch(() => null)
    return !!j && j.status === 'ok'
  } catch {
    return false
  }
}

function targetHostPort(baseUrl) {
  try {
    const u = new URL(baseUrl)
    return { host: u.hostname || '127.0.0.1', port: Number(u.port || 8090) }
  } catch {
    return { host: '127.0.0.1', port: 8090 }
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

/**
 * 把设置拼成网关命令行。start 与「命令预览」共用同一份逻辑，
 * 避免界面显示的和实际执行的不一致。
 */
function buildGatewayArgs(s) {
  let port = '8090'
  try {
    port = new URL(s.baseUrl).port || port
  } catch {
    /* 用默认端口 */
  }
  const args = [port, s.pluginDir || '']
  if (s.modelPath) args.push('--model', s.modelPath)
  if (s.backend && s.backend !== 'auto') args.push('--backend', s.backend)
  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0
  if (num(s.ctx) > 0) args.push('--ctx', String(num(s.ctx)))
  if (num(s.threads) > 0) args.push('--threads', String(num(s.threads)))
  if (num(s.gpuLayers) > 0) args.push('--gpu-layers', String(num(s.gpuLayers)))
  if (num(s.batch) > 0) args.push('--batch', String(num(s.batch)))
  if (Number(s.flashAttn) > 0) args.push('--flash-attn', '1')
  if (num(s.spec) > 0) args.push('--spec', String(num(s.spec)))
  if (num(s.draft) > 0) args.push('--draft', String(num(s.draft)))
  if (num(s.kvDtype) >= 0) args.push('--kv-dtype', String(num(s.kvDtype)))
  if (num(s.prefillChunk) > 0) args.push('--prefill-chunk', String(num(s.prefillChunk)))
  if (num(s.maxConcurrency) > 0) args.push('--max-concurrency', String(num(s.maxConcurrency)))
  if (num(s.device) >= 0) args.push('--device', String(num(s.device)))
  if (Number(s.thinkingDefault) === -1 || Number(s.thinkingDefault) === 1) {
    args.push('--thinking', String(Number(s.thinkingDefault)))
  }
  if (s.engineArgs) args.push(...String(s.engineArgs).trim().split(/\s+/).filter(Boolean))
  return { exe: s.gatewayExe || '', args }
}

ipcMain.handle('gateway:preview', () => {
  const s = readSettings()
  const { exe, args } = buildGatewayArgs(s)
  return {
    exe,
    args,
    cmdline: [exe ? `"${exe}"` : '(未设置网关程序)', ...args.map((a) => (a && a.includes(' ') ? `"${a}"` : a))]
      .filter(Boolean)
      .join(' '),
  }
})

ipcMain.handle('gateway:start', async (_e, cfg) => {
  const s = { ...readSettings(), ...(cfg || {}) }
  stopGateway()

  if (!s.gatewayExe || !fs.existsSync(s.gatewayExe)) {
    return { ok: false, error: `网关程序不存在：${s.gatewayExe || '(未设置)'}` }
  }
  if (s.modelPath && !fs.existsSync(s.modelPath)) {
    return { ok: false, error: `模型文件不存在：${s.modelPath}` }
  }

  // 端口被占（多半是上次没退干净的引擎）：能复用就复用，不能就给出可操作错误
  const { host, port } = targetHostPort(s.baseUrl)
  if (await portOpen(host, port)) {
    if (await isZenithGateway(s.baseUrl)) {
      return {
        ok: true,
        reused: true,
        pid: 0,
        log: gatewayLogTail(),
        note: `${port} 上已有 Zenith 网关在跑，直接复用（未重复启动）`,
      }
    }
    return {
      ok: false,
      code: 'PORT_BUSY',
      error: `端口 ${port} 被其它程序占用（不是可用的 Zenith 网关）。可点「清理占用」结束残留的 ai_gateway.exe。`,
      log: gatewayLogTail(),
    }
  }

  const { args } = buildGatewayArgs(s)

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

/// 清理残留引擎：杀掉所有 ai_gateway.exe（含非本进程启动的）
ipcMain.handle('gateway:reclaim', async () => {
  const before = gatewayProc ? 1 : 0
  stopGateway()
  let killed = before
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/IM', 'ai_gateway.exe', '/T', '/F'], { stdio: 'ignore' })
    } else {
      execFileSync('pkill', ['-f', 'ai_gateway'], { stdio: 'ignore' })
    }
  } catch {
    /* 没有残留进程时 taskkill 会返回非零，忽略 */
  }
  await new Promise((r) => setTimeout(r, 600))
  const { host, port } = targetHostPort(readSettings().baseUrl)
  const stillBusy = await portOpen(host, port)
  return { ok: !stillBusy, stillBusy, port }
})

ipcMain.handle('gateway:status', async () => {
  const s = readSettings()
  const { host, port } = targetHostPort(s.baseUrl)
  const busy = await portOpen(host, port, 400)
  return {
    running: gatewayProc !== null,
    pid: gatewayProc?.pid ?? 0,
    external: gatewayProc === null && busy && (await isZenithGateway(s.baseUrl)),
    portBusy: busy,
    port,
    log: gatewayLogTail(),
  }
})

app.on('before-quit', () => stopGateway())
app.on('will-quit', () => stopGateway())

// ---------------------------------------------------------------------------
//  GPU 状态：nvidia-smi（没有就返回 available:false，界面自动隐藏）
// ---------------------------------------------------------------------------
ipcMain.handle('sys:gpu', async () => {
  try {
    const out = execFileSync(
      'nvidia-smi',
      ['--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu',
       '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 3000 },
    )
    const first = String(out).trim().split(/\r?\n/)[0]
    if (!first) return { available: false }
    const [name, used, total, util, temp] = first.split(',').map((x) => x.trim())
    return {
      available: true,
      name,
      usedMB: Number(used),
      totalMB: Number(total),
      utilPct: Number(util),
      tempC: Number(temp),
    }
  } catch {
    return { available: false }
  }
})

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
  const raw = readJsonFile(sessionsFile(), null)
  if (raw && Array.isArray(raw.sessions)) store = raw
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
    win.webContents.setFrameRate(30)
    // --smoke-demo：先驱动一次真实发送（经 renderer 的 __zenithDemo 钩子），
    // 这样截图里能看到流式对话与 token/耗时；纯 --smoke 拍空态。
    const demo = process.argv.includes('--smoke-demo')
    /** --demo-text=xxx 自定义发送内容；--demo-new 先新建一个会话 */
    const demoTextArg = process.argv.find((a) => a.startsWith('--demo-text='))
    const demoText = demoTextArg ? demoTextArg.slice('--demo-text='.length) : '用三句话介绍一下 Zenith 框架'
    const demoNew = process.argv.includes('--demo-new')
    const demoEngine = process.argv.includes('--demo-engine')
    const scrollArg = process.argv.find((a) => a.startsWith('--demo-scroll='))
    if (scrollArg) {
      const px = Number(scrollArg.slice('--demo-scroll='.length)) || 0
      const doScroll = () =>
        win.webContents
          .executeJavaScript(
            `(() => { const s = document.querySelector('.sidebar'); if (s) s.scrollTop = ${px}; const m = document.querySelector('.messages'); if (m) m.scrollTop = m.scrollHeight; return 'ok'; })()`,
          )
          .catch(() => {})
      setTimeout(doScroll, 2600)
      setTimeout(doScroll, 19000) // 截图前再滚一次（前面的重渲染可能重置过）
    }
    const viewArg = process.argv.find((a) => a.startsWith('--demo-view='))
    if (viewArg) {
      const v = viewArg.slice('--demo-view='.length)
      setTimeout(() => {
        win.webContents
          .executeJavaScript(`window.__zenithSetView && window.__zenithSetView('${v}')`)
          .catch(() => {})
      }, 1600)
    }
    const tabArg = process.argv.find((a) => a.startsWith('--demo-tab='))
    if (tabArg) {
      const tab = tabArg.slice('--demo-tab='.length)
      setTimeout(() => {
        win.webContents
          .executeJavaScript(`window.__zenithSetTab && window.__zenithSetTab('${tab}')`)
          .catch(() => {})
      }, 1500)
    }
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
