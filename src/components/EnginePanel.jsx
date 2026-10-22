import { useEffect, useMemo, useState } from 'react'

const api = window.zenith

/* ---------------- 参数元数据 ---------------- */

const KV_DTYPES = [
  { v: 0, t: 'BF16（最准，最占显存）' },
  { v: 1, t: 'INT8' },
  { v: 2, t: 'FP8' },
  { v: 3, t: 'RK8V4（旋转 8bit K + 4bit V）' },
  { v: 4, t: 'NVFP4' },
  { v: 5, t: 'K8V4（默认，省显存）' },
  { v: 6, t: 'RK4V4' },
  { v: 7, t: 'RK4V4-E8' },
  { v: 8, t: 'RK2V4-E8（最省）' },
]

const SPECS = [
  { v: 0, t: '不启用投机' },
  { v: 1, t: 'MTP（默认）' },
  { v: 2, t: 'DFlash' },
  { v: 3, t: 'DFlash2（最快）' },
]

const CTX_PRESETS = [2048, 4096, 8192, 16384, 32768]

/** 返回该后端下哪些参数组可用 */
function capsFor(backend, modelPath) {
  const ext = (modelPath || '').toLowerCase().split('.').pop()
  const b = backend === 'auto' ? (ext === 'gguf' ? 'llama' : ext === 'ninfer' ? 'ninfer-native' : 'mock') : backend
  return {
    effective: b,
    llama: b === 'llama',
    ninfer: b === 'ninfer' || b === 'ninfer-native',
    native: b === 'ninfer-native',
  }
}

/** 校验：返回 { field: 错误信息 } */
function validate(s) {
  const errs = {}
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN)

  if (n(s.ctx) < 512 || n(s.ctx) > 262144) errs.ctx = '上下文需在 512 – 262144'
  if (n(s.threads) < 0 || n(s.threads) > 128) errs.threads = '线程数 0 – 128（0 = 自动）'
  if (n(s.gpuLayers) < 0 || n(s.gpuLayers) > 999) errs.gpuLayers = 'GPU 层数 0 – 999'
  if (n(s.batch) !== 0 && (n(s.batch) < 32 || n(s.batch) > 4096)) errs.batch = '批大小 32 – 4096'
  if (n(s.spec) < 0 || n(s.spec) > 3) errs.spec = '投机档位 0 – 3'
  if (n(s.draft) < 1 || n(s.draft) > 15) errs.draft = '草稿数 1 – 15（DFlash2 建议 12）'
  if (n(s.kvDtype) < 0 || n(s.kvDtype) > 8) errs.kvDtype = 'KV 精度 0 – 8'
  if (n(s.prefillChunk) <= 0 || n(s.prefillChunk) % 128 !== 0) errs.prefillChunk = '预填分块必须是 128 的倍数'
  if (n(s.maxConcurrency) < 1 || n(s.maxConcurrency) > 8) errs.maxConcurrency = '并发 1 – 8'
  if (n(s.device) < 0 || n(s.device) > 7) errs.device = '设备序号 0 – 7'
  return errs
}

/* ---------------- 小组件 ---------------- */

function Field({ label, hint, error, disabled, children }) {
  return (
    <div className={`param ${disabled ? 'param-disabled' : ''}`}>
      <label className="param-label" title={hint || ''}>
        {label}
        {hint && <span className="param-hint">？</span>}
      </label>
      {children}
      {error && <div className="param-error">{error}</div>}
    </div>
  )
}

function Num({ value, onChange, min, max, step = 1, disabled }) {
  return (
    <input
      className="input input-sm"
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

/* ---------------- 主面板 ---------------- */

export default function EnginePanel({ settings, onSave, onStarted }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [log, setLog] = useState('')
  const [running, setRunning] = useState(false)
  const [preview, setPreview] = useState({ cmdline: '' })
  const [startedArgs, setStartedArgs] = useState('') // 上次启动时的命令行，用来判断"改了没应用"
  const [showAdvanced, setShowAdvanced] = useState(false)

  const caps = useMemo(() => capsFor(settings.backend, settings.modelPath), [settings.backend, settings.modelPath])
  const errs = useMemo(() => validate(settings), [settings])
  const hasErr = Object.keys(errs).length > 0

  const refreshPreview = async () => {
    const p = await api.gatewayPreview()
    setPreview(p)
    return p
  }

  useEffect(() => {
    api.gatewayStatus().then((s) => {
      setRunning(s.running)
      setLog(s.log || '')
    })
    refreshPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    refreshPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.gatewayExe, settings.pluginDir, settings.modelPath, settings.backend, settings.baseUrl,
    settings.ctx, settings.threads, settings.gpuLayers, settings.batch, settings.flashAttn,
    settings.spec, settings.draft, settings.kvDtype, settings.prefillChunk,
    settings.maxConcurrency, settings.device, settings.engineArgs,
  ])

  const dirty = running && startedArgs && preview.cmdline !== startedArgs

  const pick = async (kind, key) => {
    const picked = await api.pick(kind)
    if (picked) onSave({ [key]: picked })
  }

  const start = async () => {
    if (hasErr) {
      setMsg('参数有误，先修红框项')
      return
    }
    setBusy(true)
    setMsg('启动中…（加载模型可能要几秒到几十秒）')
    try {
      const before = await refreshPreview()
      const r = await api.gatewayStart()
      setRunning(!!r.ok)
      setLog(r.log || '')
      setMsg(r.ok ? `已启动（pid ${r.pid}）` : r.error || '启动失败')
      if (r.ok) {
        setStartedArgs(before.cmdline)
        onStarted?.()
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
    setMsg('已停止')
  }

  return (
    <div className="panel">
      <div className="panel-title">
        本地引擎
        <span className={`dot ${running ? 'dot-ok' : 'dot-bad'}`} />
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        推理跑在 Zenith 网关里（插件加载 llama.cpp / NInfer）。这里把网关当子进程拉起，
        参数改完点「应用并重启」生效。
      </p>

      <Field label="网关程序">
        <div className="param-row">
          <input
            className="input input-path"
            value={settings.gatewayExe || ''}
            placeholder="…\build\m9\bin\ai_gateway.exe"
            onChange={(e) => onSave({ gatewayExe: e.target.value })}
          />
          <button className="btn btn-mini" onClick={() => pick('exe', 'gatewayExe')}>
            选择
          </button>
        </div>
      </Field>

      <Field label="插件目录">
        <div className="param-row">
          <input
            className="input input-path"
            value={settings.pluginDir || ''}
            placeholder="留空 = 网关默认目录"
            onChange={(e) => onSave({ pluginDir: e.target.value })}
          />
          <button className="btn btn-mini" onClick={() => pick('dir', 'pluginDir')}>
            选择
          </button>
        </div>
      </Field>

      <Field label="模型文件">
        <div className="param-row">
          <input
            className="input input-path"
            value={settings.modelPath || ''}
            placeholder="*.gguf（llama.cpp）或 *.ninfer（NInfer）"
            onChange={(e) => onSave({ modelPath: e.target.value })}
          />
          <button className="btn btn-mini" onClick={() => pick('model', 'modelPath')}>
            选择
          </button>
        </div>
      </Field>

      <Field label="后端">
        <select
          className="input"
          value={settings.backend || 'auto'}
          onChange={(e) => onSave({ backend: e.target.value })}
        >
          <option value="auto">自动（按扩展名 → {caps.effective}）</option>
          <option value="llama">llama.cpp（GGUF，进程内）</option>
          <option value="ninfer-native">NInfer C ABI（进程内，GPU）</option>
          <option value="ninfer">NInfer 子进程</option>
          <option value="openai">外部 OpenAI 上游</option>
          <option value="mock">mock（联调界面）</option>
        </select>
      </Field>

      {/* ---------- 启动参数 ---------- */}
      <div className="panel-sub">启动参数</div>

      <Field label="上下文" error={errs.ctx} hint="最大上下文长度，同时决定 NInfer 的 KV 容量">
        <div className="param-row">
          <Num value={settings.ctx} onChange={(v) => onSave({ ctx: v })} min={512} max={262144} step={512} />
          {CTX_PRESETS.map((c) => (
            <button
              key={c}
              className={`chip ${Number(settings.ctx) === c ? 'chip-on' : ''}`}
              onClick={() => onSave({ ctx: c })}
            >
              {c >= 1024 ? `${c / 1024}k` : c}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="线程数"
        error={errs.threads}
        disabled={!caps.llama}
        hint="llama.cpp 的 CPU 线程数；0 = 自动。NInfer 走 GPU，不适用"
      >
        <Num value={settings.threads} onChange={(v) => onSave({ threads: v })} min={0} max={128} disabled={!caps.llama} />
      </Field>

      <Field
        label="GPU 层数"
        error={errs.gpuLayers}
        disabled={!caps.llama}
        hint="llama.cpp 卸载到 GPU 的层数；0 = 纯 CPU"
      >
        <Num
          value={settings.gpuLayers}
          onChange={(v) => onSave({ gpuLayers: v })}
          min={0}
          max={999}
          disabled={!caps.llama}
        />
      </Field>

      <Field label="批大小" error={errs.batch} disabled={!caps.llama} hint="llama.cpp prompt 批处理；0 = 默认 512">
        <Num value={settings.batch} onChange={(v) => onSave({ batch: v })} min={0} max={4096} disabled={!caps.llama} />
      </Field>

      <Field label="FlashAttn" disabled={!caps.llama} hint="llama.cpp flash attention（需要模型支持）">
        <label className="switch">
          <input
            type="checkbox"
            checked={Number(settings.flashAttn) > 0}
            disabled={!caps.llama}
            onChange={(e) => onSave({ flashAttn: e.target.checked ? 1 : 0 })}
          />
          <span>{Number(settings.flashAttn) > 0 ? '开' : '关'}</span>
        </label>
      </Field>

      <Field
        label="投机档位"
        error={errs.spec}
        disabled={!caps.ninfer}
        hint="NInfer 的投机解码后端。DFlash2 + 12 草稿实测最快"
      >
        <select
          className="input"
          value={settings.spec ?? 1}
          disabled={!caps.ninfer}
          onChange={(e) => onSave({ spec: Number(e.target.value) })}
        >
          {SPECS.map((s) => (
            <option key={s.v} value={s.v}>
              {s.t}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="草稿数"
        error={errs.draft}
        disabled={!caps.ninfer || Number(settings.spec) === 0}
        hint="每轮预测的草稿 token 数；DFlash2 建议 12"
      >
        <Num
          value={settings.draft}
          onChange={(v) => onSave({ draft: v })}
          min={1}
          max={15}
          disabled={!caps.ninfer || Number(settings.spec) === 0}
        />
      </Field>

      <Field label="KV 精度" error={errs.kvDtype} disabled={!caps.native} hint="显存与质量权衡，越靠下越省显存">
        <select
          className="input"
          value={settings.kvDtype ?? 5}
          disabled={!caps.native}
          onChange={(e) => onSave({ kvDtype: Number(e.target.value) })}
        >
          {KV_DTYPES.map((k) => (
            <option key={k.v} value={k.v}>
              {k.t}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="预填分块"
        error={errs.prefillChunk}
        disabled={!caps.native}
        hint="prompt 分块大小，必须是 128 的倍数"
      >
        <Num
          value={settings.prefillChunk}
          onChange={(v) => onSave({ prefillChunk: v })}
          min={128}
          max={16384}
          step={128}
          disabled={!caps.native}
        />
      </Field>

      <Field label="并发上限" error={errs.maxConcurrency} disabled={!caps.native} hint="同时处理的请求数（1 – 8）">
        <Num
          value={settings.maxConcurrency}
          onChange={(v) => onSave({ maxConcurrency: v })}
          min={1}
          max={8}
          disabled={!caps.native}
        />
      </Field>

      <Field label="设备序号" error={errs.device} disabled={!caps.native} hint="多卡时选第几张 GPU（0 起）">
        <Num value={settings.device} onChange={(v) => onSave({ device: v })} min={0} max={7} disabled={!caps.native} />
      </Field>

      <button className="link-btn" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? '收起高级选项' : '高级选项（自由参数）'}
      </button>
      {showAdvanced && (
        <Field label="附加参数" hint="原样透传给网关，例如 --upstream https://…/v1；留空即可">
          <input
            className="input input-path"
            value={settings.engineArgs || ''}
            placeholder="--some-flag value"
            onChange={(e) => onSave({ engineArgs: e.target.value })}
          />
        </Field>
      )}

      {/* ---------- 生效命令预览 ---------- */}
      <div className="panel-sub">将执行</div>
      <pre className="engine-cmd">{preview.cmdline || '(未设置网关程序)'}</pre>

      <div className="engine-actions">
        <button className="btn btn-primary" disabled={busy || !settings.gatewayExe || hasErr} onClick={start}>
          {busy ? '启动中…' : running ? '重启引擎' : '启动本地引擎'}
        </button>
        <button className="btn" disabled={!running} onClick={stop}>
          停止
        </button>
        {dirty && <span className="dirty-tip">参数已修改，点「重启引擎」生效</span>}
        <span className="muted">{msg}</span>
      </div>

      {log && (
        <>
          <div className="panel-sub">引擎日志（尾部）</div>
          <pre className="engine-log">{log}</pre>
        </>
      )}
    </div>
  )
}
