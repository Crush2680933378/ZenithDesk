import { useEffect, useState } from 'react'

const api = window.zenith

function Row({ label, children }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-body">{children}</div>
    </div>
  )
}

export default function EnginePanel({ settings, onSave, onStarted }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [log, setLog] = useState('')
  const [running, setRunning] = useState(false)

  useEffect(() => {
    api.gatewayStatus().then((s) => {
      setRunning(s.running)
      setLog(s.log || '')
    })
  }, [])

  const pick = async (kind, key) => {
    const picked = await api.pick(kind)
    if (picked) onSave({ [key]: picked })
  }

  const start = async () => {
    setBusy(true)
    setMsg('启动中…（首次加载模型可能要几秒到几十秒）')
    try {
      const r = await api.gatewayStart()
      setRunning(!!r.ok)
      setLog(r.log || '')
      setMsg(r.ok ? `已启动（pid ${r.pid}）` : r.error || '启动失败')
      if (r.ok) onStarted?.()
    } catch (e) {
      setMsg('启动异常：' + String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    await api.gatewayStop()
    setRunning(false)
    setMsg('已停止')
  }

  return (
    <div className="panel">
      <div className="panel-title">
        本地引擎
        <span className={`dot ${running ? 'dot-ok' : 'dot-bad'}`} />
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        推理跑在 Zenith 网关里（插件加载 llama.cpp / NInfer）。这里把网关当子进程拉起：
        选好程序与模型 → 启动 → 自动连接。
      </p>

      <Row label="网关程序">
        <input
          className="input input-path"
          value={settings.gatewayExe || ''}
          placeholder="…\build\m9\bin\ai_gateway.exe"
          onChange={(e) => onSave({ gatewayExe: e.target.value })}
        />
        <button className="btn btn-mini" onClick={() => pick('exe', 'gatewayExe')}>
          选择
        </button>
      </Row>

      <Row label="插件目录">
        <input
          className="input input-path"
          value={settings.pluginDir || ''}
          placeholder="留空 = 用网关自带的默认目录"
          onChange={(e) => onSave({ pluginDir: e.target.value })}
        />
        <button className="btn btn-mini" onClick={() => pick('dir', 'pluginDir')}>
          选择
        </button>
      </Row>

      <Row label="模型文件">
        <input
          className="input input-path"
          value={settings.modelPath || ''}
          placeholder="*.gguf（llama.cpp）或 *.ninfer（NInfer）"
          onChange={(e) => onSave({ modelPath: e.target.value })}
        />
        <button className="btn btn-mini" onClick={() => pick('model', 'modelPath')}>
          选择
        </button>
      </Row>

      <Row label="后端">
        <select
          className="input"
          value={settings.backend || 'auto'}
          onChange={(e) => onSave({ backend: e.target.value })}
        >
          <option value="auto">自动（按扩展名）</option>
          <option value="llama">llama.cpp（GGUF，进程内）</option>
          <option value="ninfer-native">NInfer C ABI（进程内，GPU）</option>
          <option value="ninfer">NInfer 子进程</option>
          <option value="openai">外部 OpenAI 上游</option>
          <option value="mock">mock（联调界面）</option>
        </select>
      </Row>

      <Row label="附加参数">
        <input
          className="input input-path"
          value={settings.engineArgs || ''}
          placeholder="例：--ctx 16384 --spec 3 --draft 12"
          onChange={(e) => onSave({ engineArgs: e.target.value })}
        />
      </Row>

      <div className="engine-actions">
        <button className="btn btn-primary" disabled={busy || !settings.gatewayExe} onClick={start}>
          {busy ? '启动中…' : '启动本地引擎'}
        </button>
        <button className="btn" disabled={!running} onClick={stop}>
          停止
        </button>
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
