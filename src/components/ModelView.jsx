import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { parseMetrics, pick } from '../metrics.js'
import { labelPair, nextLang, normLang } from '../i18n.js'

const api = window.zenith

/// 术语语言：'zh' 中文为主（副标英文旗标）；'en' 英文旗标为主
const LANG = createContext('zh')

/* ============================ 参数元数据 ============================ */

const CTX_PRESETS = [
  { v: 2048, t: '2k' },
  { v: 4096, t: '4k' },
  { v: 8192, t: '8k' },
  { v: 16384, t: '16k' },
  { v: 32768, t: '32k' },
  { v: 65536, t: '64k' },
  { v: 131072, t: '128k' },
  { v: 196608, t: '192k' },
  { v: 262144, t: '262k' },
]

/// 每项同时给英文代号与中文含义，供中/英模式切换
const KV_DTYPES = [
  { v: 0, code: 'BF16', zh: '半精度浮点，最准但最占显存' },
  { v: 1, code: 'INT8', zh: '整型 8 位' },
  { v: 2, code: 'FP8', zh: '8 位浮点' },
  { v: 3, code: 'RK8V4', zh: '旋转 8 位 Key + 4 位 Value' },
  { v: 4, code: 'NVFP4', zh: 'NVIDIA 4 位浮点' },
  { v: 5, code: 'K8V4', zh: '8 位 Key + 4 位 Value，默认' },
  { v: 6, code: 'RK4V4', zh: '旋转 4 位 Key + 4 位 Value' },
  { v: 7, code: 'RK4V4-E8', zh: 'RK4V4 的 E8 变体' },
  { v: 8, code: 'RK2V4-E8', zh: '2 位 Key + 4 位 Value，最省显存' },
]

const SPECS = [
  { v: 0, code: 'none', zh: '不启用投机' },
  { v: 1, code: 'MTP', zh: '多 token 预测，默认' },
  { v: 2, code: 'DFlash', zh: 'DFlash 草稿头' },
  { v: 3, code: 'DFlash2', zh: '实测最快' },
]

const THINKING = [
  { v: 0, code: 'default', zh: '后端默认' },
  { v: -1, code: 'off', zh: '关（更快）' },
  { v: 1, code: 'on', zh: '开（更准）' },
]

/// 中/英模式下拼出选项文字：中文模式「代号（含义）」，英文模式只留代号
const optText = (o, lang) => (lang === 'en' ? o.code : `${o.code}（${o.zh}）`)

function capsFor(backend, modelPath) {
  const ext = (modelPath || '').toLowerCase().split('.').pop()
  const b =
    backend === 'auto' ? (ext === 'gguf' ? 'llama' : ext === 'ninfer' ? 'ninfer-native' : 'mock') : backend
  return {
    effective: b,
    llama: b === 'llama',
    ninfer: b === 'ninfer' || b === 'ninfer-native',
    native: b === 'ninfer-native',
    // llama.cpp 的 chat template 走 C API，不接受 enable_thinking 这类 kwarg，
    // 所以思考开关目前只对 NInfer 生效
    thinking: b === 'ninfer' || b === 'ninfer-native' || b === 'openai',
  }
}

function validate(s) {
  const e = {}
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN)
  if (n(s.ctx) < 512 || n(s.ctx) > 262144) e.ctx = '512 – 262144'
  if (n(s.threads) < 0 || n(s.threads) > 128) e.threads = '0 – 128'
  if (n(s.gpuLayers) < 0 || n(s.gpuLayers) > 999) e.gpuLayers = '0 – 999'
  if (n(s.batch) !== 0 && (n(s.batch) < 32 || n(s.batch) > 4096)) e.batch = '32 – 4096'
  if (n(s.spec) < 0 || n(s.spec) > 3) e.spec = '0 – 3'
  if (n(s.draft) < 1 || n(s.draft) > 15) e.draft = '1 – 15'
  if (n(s.kvDtype) < 0 || n(s.kvDtype) > 8) e.kvDtype = '0 – 8'
  if (n(s.prefillChunk) <= 0 || n(s.prefillChunk) % 128 !== 0) e.prefillChunk = '必须是 128 的倍数'
  if (n(s.maxConcurrency) < 1 || n(s.maxConcurrency) > 8) e.maxConcurrency = '1 – 8'
  if (n(s.device) < 0 || n(s.device) > 7) e.device = '0 – 7'
  return e
}

function ctxHint(ctx, caps) {
  const n = Number(ctx) || 0
  if (!caps.ninfer) return ''
  if (n >= 262144) return '262k 需约 7.3 GiB KV，本机 16 GB 卡装不下（实测会报 runtime reservation 不足）'
  if (n >= 131072) return '超过 128k 后 KV 预分配很吃显存：本机实测 192k 可启动（余量约 0.5 GiB），224k 起不足'
  return ''
}

/* ============================ 小组件 ============================ */

function Num({ value, onChange, min, max, step = 1, disabled }) {
  return (
    <input
      className="input num"
      type="number"
      min={min}
      max={max}
      step={step}
      value={value ?? 0}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
    />
  )
}

/**
 * 参数行：中文标签 + 英文旗标并存。
 * lang='zh' 时中文为主、旗标为辅；lang='en' 时反过来。
 * 顶部开关切换，便于对照官方文档里的 flag 名。
 */
function Row({ label, code, hint, error, disabled, children }) {
  const lang = useContext(LANG)
  const { main, sub } = labelPair(lang, label, code)
  const title = [hint, code && `英文旗标：${code}`].filter(Boolean).join('｜')
  return (
    <div className={`mrow ${disabled ? 'mrow-off' : ''}`}>
      <label className="mrow-label" title={title}>
        <span className="mrow-main">{main}</span>
        {sub && <span className="mrow-sub">{sub}</span>}
      </label>
      <div className="mrow-body">{children}</div>
      {error && <div className="mrow-err">{error}</div>}
    </div>
  )
}

function Stat({ label, code, value, unit, tone }) {
  const lang = useContext(LANG)
  const { main, sub } = labelPair(lang, label, code)
  return (
    <div className={`stat ${tone || ''}`}>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      <div className="stat-label">
        {main}
        {sub && <span className="stat-code">{sub}</span>}
      </div>
    </div>
  )
}

/** 最近 N 个采样点的折线（SVG，无依赖） */
function Spark({ points, height = 54 }) {
  const w = 240
  if (!points.length) return <div className="spark-empty">等待数据…</div>
  const max = Math.max(...points, 1)
  const step = points.length > 1 ? w / (points.length - 1) : w
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - (p / max) * (height - 6) - 3).toFixed(1)}`)
    .join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.6" />
      <text x="2" y="10" className="spark-max">
        {Math.round(max)}
      </text>
    </svg>
  )
}

/* ============================ 主组件 ============================ */

export default function ModelView({ settings, onSave, onStarted }) {
  const [running, setRunning] = useState(false)
  const [external, setExternal] = useState(false)
  const [portBusy, setPortBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [log, setLog] = useState('')
  const [preview, setPreview] = useState({ cmdline: '' })
  const [startedArgs, setStartedArgs] = useState('')

  const [status, setStatus] = useState(null)
  const [metrics, setMetrics] = useState({})
  const lastPushed = useRef(0)
  const [gpu, setGpu] = useState({ available: false })
  const [tpsHistory, setTpsHistory] = useState([])
  const [showLog, setShowLog] = useState(false)
  const logRef = useRef(null)

  const lang = normLang(settings.termLang)
  const caps = useMemo(() => capsFor(settings.backend, settings.modelPath), [settings.backend, settings.modelPath])
  const errs = useMemo(() => validate(settings), [settings])
  const hasErr = Object.keys(errs).length > 0
  const dirty = running && startedArgs && preview.cmdline !== startedArgs

  const refreshPreview = async () => {
    const p = await api.gatewayPreview()
    setPreview(p)
    return p
  }

  /* ---------- 轮询：状态 1s / GPU 2s ---------- */
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const st = await api.gatewayStatus()
        if (!alive) return
        setRunning(!!st.running)
        setExternal(!!st.external)
        setPortBusy(!!st.portBusy && !st.running)
        if (st.running || st.external) {
          const [s, mtext] = await Promise.all([
            api.status(settings.baseUrl),
            api.metrics(settings.baseUrl).catch(() => ''),
          ])
          if (!alive) return
          setStatus(s)
          setMetrics(parseMetrics(mtext))
        }
        const g = await api.gpu()
        if (alive) setGpu(g || { available: false })
      } catch {
        /* 网关没起来时忽略 */
      }
    }
    tick()
    const t = setInterval(tick, 1500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [settings.baseUrl])

  useEffect(() => {
    refreshPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.gatewayExe, settings.pluginDir, settings.modelPath, settings.backend, settings.baseUrl,
    settings.ctx, settings.threads, settings.gpuLayers, settings.batch, settings.flashAttn,
    settings.spec, settings.draft, settings.kvDtype, settings.prefillChunk,
    settings.maxConcurrency, settings.device, settings.engineArgs, settings.thinkingDefault,
  ])

  // 注意：不要叫 pick —— 会遮蔽从 metrics.js 导入的 pick()，导致 decode 变成 Promise
  const pickFile = async (kind, key) => {
    const v = await api.pick(kind)
    if (v) onSave({ [key]: v })
  }

  const start = async () => {
    if (hasErr) return setMsg('参数有误，先修红框项')
    setBusy(true)
    setMsg('启动中…（加载模型可能要几秒到几十秒）')
    try {
      const before = await refreshPreview()
      const r = await api.gatewayStart()
      setRunning(!!r.ok)
      setLog(r.log || '')
      setPortBusy(r.code === 'PORT_BUSY')
      if (r.ok && r.reused) {
        setExternal(true)
        setMsg(r.note || '已复用现有网关')
      } else {
        setMsg(r.ok ? `已启动（pid ${r.pid}）` : r.error || '启动失败')
      }
      if (r.ok) {
        setStartedArgs(before.cmdline)
        onStarted?.()
        setTimeout(() => api.gatewayStatus().then((s) => setLog(s.log || '')), 1200)
      }
    } catch (e) {
      setMsg('启动异常：' + String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    await api.gatewayStop()
    setRunning(false)
    setStartedArgs('')
    setStatus(null)
    setTpsHistory([])
    setMsg('已停止')
  }

  const reclaim = async () => {
    setBusy(true)
    setMsg('正在清理残留的 ai_gateway.exe…')
    try {
      const r = await api.gatewayReclaim()
      setPortBusy(!!r.stillBusy)
      setMsg(r.ok ? `已清理，端口 ${r.port} 已释放，正在重启…` : `端口 ${r.port} 仍被占用`)
      setBusy(false)
      if (r.ok) await start()
    } catch (e) {
      setMsg('清理失败：' + String(e?.message || e))
      setBusy(false)
    }
  }

  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log, showLog])

  /* ---------- 派生指标 ---------- */
  const eng = status?.engine || {}
  const counters = status?.counters || {}
  // C ABI / 进程内后端不填 engine.last_*，真实 timings 只进了 Prometheus gauge
  const decode = eng.last_decode_tps || pick(metrics, 'zenith_ai_decode_tps') || 0
  const prefill = eng.last_prefill_tps || pick(metrics, 'zenith_ai_prefill_tps') || 0
  const ttft = eng.last_ttft_ms || pick(metrics, 'zenith_ai_ttft_ms') || 0

  // 吞吐曲线：数值变化才追加一个点（依赖放在 decode 声明之后，避免 TDZ）
  useEffect(() => {
    if (decode > 0 && Math.abs(decode - lastPushed.current) > 0.01) {
      lastPushed.current = decode
      setTpsHistory((h) => [...h.slice(-59), decode])
    }
  }, [decode])

  const acceptRate = eng.draft_total > 0 ? (eng.draft_accepted / eng.draft_total) * 100 : null
  const modelName = status?.models?.[0] || (settings.modelPath || '').split(/[\\/]/).pop() || '—'
  const vramPct = gpu.available && gpu.totalMB ? (gpu.usedMB / gpu.totalMB) * 100 : 0

  return (
    <LANG.Provider value={lang}>
    <div className="model-view">
      {/* ================= 左：启动配置 ================= */}
      <section className={`mv-config ${lang === 'both' ? 'labels-wide' : ''}`}>
        <header className="mv-head">
          <h2>模型启动</h2>
          <div className="mv-head-right">
            <button
              className="lang-toggle"
              title="切换术语语言：中文为主 ↔ 英文旗标为主（悬停任一参数也能看到英文原意）"
              onClick={() => onSave({ termLang: nextLang(lang) })}
            >
              {lang === 'zh' ? '术语：中文' : lang === 'en' ? '术语：EN' : '术语：中+EN'}
              <span className="lang-next">
                {' → '}
                {nextLang(lang) === 'zh' ? '中文' : nextLang(lang) === 'en' ? 'EN' : '中+EN'}
              </span>
            </button>
            <span className={`badge ${running || external ? 'badge-ok' : 'badge-bad'}`}>
              {running ? '已托管' : external ? '使用已有网关' : '未运行'}
            </span>
          </div>
        </header>

        <Row label="网关" code="gateway.exe">
          <input
            className="input path"
            title={settings.gatewayExe || ''}
            value={settings.gatewayExe || ''}
            placeholder="…\build\m9\bin\ai_gateway.exe"
            onChange={(e) => onSave({ gatewayExe: e.target.value })}
          />
          <button className="btn btn-mini" onClick={() => pickFile('exe', 'gatewayExe')}>选择</button>
        </Row>
        <Row label="插件" code="plugin dir">
          <input
            className="input path"
            title={settings.pluginDir || ''}
            value={settings.pluginDir || ''}
            placeholder="留空 = 网关默认目录"
            onChange={(e) => onSave({ pluginDir: e.target.value })}
          />
          <button className="btn btn-mini" onClick={() => pickFile('dir', 'pluginDir')}>选择</button>
        </Row>
        <Row label="模型" code="model file">
          <input
            className="input path"
            title={settings.modelPath || ''}
            value={settings.modelPath || ''}
            placeholder="*.gguf 或 *.ninfer"
            onChange={(e) => onSave({ modelPath: e.target.value })}
          />
          <button className="btn btn-mini" onClick={() => pickFile('model', 'modelPath')}>选择</button>
        </Row>
        <Row label="后端" code="--backend">
          <select className="input" value={settings.backend} onChange={(e) => onSave({ backend: e.target.value })}>
            <option value="auto">自动（→ {caps.effective}）</option>
            <option value="llama">llama.cpp（GGUF，进程内）</option>
            <option value="ninfer-native">NInfer C ABI（进程内，自研 C ABI）</option>
            <option value="ninfer">NInfer 子进程（需 zenith_ai_ninfer.dll）</option>
            <option value="openai">外部 OpenAI 上游</option>
            <option value="mock">mock（联调）</option>
          </select>
        </Row>

        {settings.backend === 'ninfer' && /plugins-native/i.test(settings.pluginDir || '') && (
          <div className="param-warn" style={{ marginBottom: 8 }}>
            ⚠ 当前插件目录是 <code>plugins-native</code>（只有进程内原生插件）。
            「NInfer 子进程」需要 <code>zenith_ai_ninfer.dll</code>；不改也能启动——网关会自动回退到进程内形态。
          </div>
        )}

        <Row
          label="思考"
          code="--thinking"
          hint="启动时的默认思考模式；对话页顶栏的下拉框可按单次请求覆盖。llama.cpp 走 C API 模板，暂不支持该开关"
          disabled={!caps.thinking}
        >
          <select
            className="input"
            value={settings.thinkingDefault ?? 0}
            disabled={!caps.thinking}
            onChange={(e) => onSave({ thinkingDefault: Number(e.target.value) })}
          >
            {THINKING.map((t) => (
              <option key={t.v} value={t.v}>{optText(t, lang)}</option>
            ))}
          </select>
        </Row>
        {!caps.thinking && (
          <div className="mv-note">当前后端（{caps.effective}）不支持思考开关，选了也不会传给引擎。</div>
        )}

        <div className="mv-sub">启动参数</div>

        <Row label="上下文" code="--ctx" error={errs.ctx}>
          <Num value={settings.ctx} onChange={(v) => onSave({ ctx: v })} min={512} max={262144} step={512} />
          <div className="chips">
            {CTX_PRESETS.map((p) => (
              <button
                key={p.v}
                className={`chip ${Number(settings.ctx) === p.v ? 'chip-on' : ''}`}
                onClick={() => onSave({ ctx: p.v })}
              >
                {p.t}
              </button>
            ))}
          </div>
        </Row>
        {ctxHint(settings.ctx, caps) && <div className="param-warn">⚠ {ctxHint(settings.ctx, caps)}</div>}

        <div className={`mv-group ${caps.llama ? '' : 'mv-group-off'}`}>
          <div className="mv-group-title">llama.cpp</div>
          <Row label="线程" code="--threads" hint="CPU 线程数，0=自动" error={errs.threads} disabled={!caps.llama}>
            <Num value={settings.threads} onChange={(v) => onSave({ threads: v })} min={0} max={128} disabled={!caps.llama} />
          </Row>
          <Row label="GPU 层" code="--gpu-layers" hint="卸载到 GPU 的层数，0=纯 CPU" error={errs.gpuLayers} disabled={!caps.llama}>
            <Num value={settings.gpuLayers} onChange={(v) => onSave({ gpuLayers: v })} min={0} max={999} disabled={!caps.llama} />
          </Row>
          <Row label="批大小" code="--batch" hint="prompt 批处理，0=默认 512" error={errs.batch} disabled={!caps.llama}>
            <Num value={settings.batch} onChange={(v) => onSave({ batch: v })} min={0} max={4096} disabled={!caps.llama} />
          </Row>
          <Row label="FlashAttn" code="--flash-attn" disabled={!caps.llama}>
            <label className="switch">
              <input
                type="checkbox"
                checked={Number(settings.flashAttn) > 0}
                disabled={!caps.llama}
                onChange={(e) => onSave({ flashAttn: e.target.checked ? 1 : 0 })}
              />
              <span>{Number(settings.flashAttn) > 0 ? '开' : '关'}</span>
            </label>
          </Row>
        </div>

        <div className={`mv-group ${caps.ninfer ? '' : 'mv-group-off'}`}>
          <div className="mv-group-title">NInfer</div>
          <Row label="投机" code="--spec" error={errs.spec} disabled={!caps.ninfer} hint="投机解码后端">
            <select
              className="input"
              value={settings.spec}
              disabled={!caps.ninfer}
              onChange={(e) => onSave({ spec: Number(e.target.value) })}
            >
              {SPECS.map((s) => (
                <option key={s.v} value={s.v}>{optText(s, lang)}</option>
              ))}
            </select>
          </Row>
          <Row label="草稿数" code="--draft" error={errs.draft} disabled={!caps.ninfer || Number(settings.spec) === 0} hint="每轮草稿数，DFlash2 建议 12">
            <Num
              value={settings.draft}
              onChange={(v) => onSave({ draft: v })}
              min={1}
              max={15}
              disabled={!caps.ninfer || Number(settings.spec) === 0}
            />
          </Row>
          <Row label="KV 精度" code="--kv-dtype" error={errs.kvDtype} disabled={!caps.native} hint="显存↔质量">
            <select
              className="input"
              value={settings.kvDtype}
              disabled={!caps.native}
              onChange={(e) => onSave({ kvDtype: Number(e.target.value) })}
            >
              {KV_DTYPES.map((k) => (
                <option key={k.v} value={k.v}>{optText(k, lang)}</option>
              ))}
            </select>
          </Row>
          <Row label="预填分块" code="--prefill-chunk" error={errs.prefillChunk} disabled={!caps.native} hint="128 的倍数">
            <Num
              value={settings.prefillChunk}
              onChange={(v) => onSave({ prefillChunk: v })}
              min={128}
              max={16384}
              step={128}
              disabled={!caps.native}
            />
          </Row>
          <Row label="并发" code="--max-concurrency" error={errs.maxConcurrency} disabled={!caps.native} hint="同时处理的请求数">
            <Num
              value={settings.maxConcurrency}
              onChange={(v) => onSave({ maxConcurrency: v })}
              min={1}
              max={8}
              disabled={!caps.native}
            />
          </Row>
          <Row label="设备号" code="--device" error={errs.device} disabled={!caps.native} hint="多卡时选卡">
            <Num value={settings.device} onChange={(v) => onSave({ device: v })} min={0} max={7} disabled={!caps.native} />
          </Row>
        </div>

        <Row label="附加参数" code="--…" hint="原样透传，例如 --upstream https://…/v1">
          <input
            className="input path"
            title={settings.engineArgs || ''}
            value={settings.engineArgs || ''}
            placeholder="留空即可"
            onChange={(e) => onSave({ engineArgs: e.target.value })}
          />
        </Row>

        <div className="mv-cmd" title="实际执行的命令行">
          {preview.cmdline || '(未设置网关程序)'}
        </div>

        <div className="mv-actions">
          <button className="btn btn-primary" disabled={busy || !settings.gatewayExe || hasErr} onClick={start}>
            {busy ? '处理中…' : running ? '重启引擎' : '启动模型'}
          </button>
          <button className="btn" disabled={!running} onClick={stop}>停止</button>
          {portBusy && <button className="btn btn-danger" disabled={busy} onClick={reclaim}>清理占用并重启</button>}
          {dirty && <span className="dirty-tip">参数已改，点「重启引擎」生效</span>}
        </div>
        {msg && <div className="mv-msg">{msg}</div>}
      </section>

      {/* ================= 右：实时运行监控 ================= */}
      <section className="mv-monitor">
        <header className="mv-monitor-head">
          <div>
            <div className="mv-model-name">{modelName}</div>
            <div className="mv-model-sub">
              {running || external ? `● ${status?.backend || '—'}` : '○ 未运行'}
              {eng.pid ? ` · pid ${eng.pid}` : ''}
              {status?.models?.length ? ` · ${status.models.length} 个模型` : ''}
            </div>
          </div>
          <div className="mv-live">
            {running || external ? <span className="live-dot" /> : null}
            {running || external ? '实时' : '待启动'}
          </div>
        </header>

        <div className="stat-grid">
          <Stat label="解码速度" code="decode tps" value={decode ? decode.toFixed(1) : '—'} unit="tok/s" tone={decode > 300 ? 'good' : ''} />
          <Stat label="预填速度" code="prefill tps" value={prefill ? Math.round(prefill) : '—'} unit="tok/s" />
          <Stat label="首 token" code="ttft" value={ttft ? Math.round(ttft) : '—'} unit="ms" />
          <Stat label="投机接受" code="draft accept" value={acceptRate === null ? '—' : acceptRate.toFixed(0)} unit="%" tone={acceptRate > 60 ? 'good' : ''} />
          <Stat label="请求数" code="requests" value={eng.requests ?? counters.requests_total ?? 0} />
          <Stat label="输出 token" code="completion tokens" value={counters.completion_tokens_total ?? 0} />
        </div>

        <div className="mv-cards">
          <div className="mv-card">
            <div className="mv-card-title">解码吞吐（最近 60 次请求）</div>
            <Spark points={tpsHistory} />
            <div className="mv-card-foot">
              峰值 {tpsHistory.length ? Math.max(...tpsHistory).toFixed(1) : '—'} tok/s
            </div>
          </div>

          <div className="mv-card">
            <div className="mv-card-title">GPU</div>
            {gpu.available ? (
              <>
                <div className="gpu-name">{gpu.name}</div>
                <div className="bar">
                  <div className={`bar-fill ${vramPct > 92 ? 'bar-warn' : ''}`} style={{ width: `${Math.min(100, vramPct)}%` }} />
                </div>
                <div className="gpu-line">
                  显存 {(gpu.usedMB / 1024).toFixed(1)} / {(gpu.totalMB / 1024).toFixed(1)} GiB
                  <span className="muted">（{vramPct.toFixed(0)}%）</span>
                </div>
                <div className="gpu-line muted">
                  利用率 {gpu.utilPct}% · 温度 {gpu.tempC}°C
                </div>
              </>
            ) : (
              <div className="muted">未检测到 nvidia-smi（非 NVIDIA 或未安装驱动）</div>
            )}
          </div>
        </div>

        <div className="mv-logbar">
          <button className="link-btn" onClick={() => setShowLog((v) => !v)}>
            {showLog ? '收起引擎日志' : '展开引擎日志'}
          </button>
          {eng.last_line && <span className="mv-last-line">{eng.last_line}</span>}
        </div>
        {showLog && (
          <pre className="engine-log" ref={logRef}>
            {log || '（暂无日志）'}
          </pre>
        )}
      </section>
    </div>
    </LANG.Provider>
  )
}
