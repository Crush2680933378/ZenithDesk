import { fmtNum, pick } from '../metrics.js'
import { normLang, t } from '../i18n.js'

/** 一个小格子：标签 + 值，过窄时省略 */
function Chip({ label, value, tone, title, lang }) {
  return (
    <span className={`chipinfo ${tone || ''}`} title={title || ''}>
      <span className="chipinfo-label">{label}</span>
      <span className="chipinfo-value">{lang === 'en' ? value.en || value.zh || value : value.zh || value}</span>
    </span>
  )
}

/**
 * 聊天页底部状态条：把和模型相关的一切压成一行，随时能看。
 * 数据来自 /zenith/ai/status + /metrics + nvidia-smi（App 统一轮询后传下来）。
 */
export default function ChatStatusBar({ status, metrics, gpu, models, connected, lang: langProp }) {
  const lang = normLang(langProp)
  const eng = status?.engine || {}
  const counters = status?.counters || {}

  const decode = eng.last_decode_tps || pick(metrics, 'zenith_ai_decode_tps') || 0
  const prefill = eng.last_prefill_tps || pick(metrics, 'zenith_ai_prefill_tps') || 0
  const ttft = eng.last_ttft_ms || pick(metrics, 'zenith_ai_ttft_ms') || 0

  const kvUsed = Number(eng.kv_used_tokens) || 0
  const kvCap = Number(eng.kv_capacity_tokens) || 0
  const kvPct = kvCap > 0 ? (kvUsed / kvCap) * 100 : 0
  const lastCtx = Number(eng.last_context_tokens) || 0

  const accept =
    eng.draft_total > 0 ? Math.round((eng.draft_accepted / eng.draft_total) * 100) : null
  const pending =
    Number(pick(metrics, 'zenith_http_inflight') || 0) > 0 ? 'busy' : 'idle'
  const model = status?.models?.[0] || (models.length ? models[0].id : '—')

  const sep = <span className="chipinfo-sep" />

  return (
    <div className="chat-status">
      <span className={`live-dot ${connected ? '' : 'live-dot-off'}`} />
      <span className="cs-model" title={model}>
        {model}
      </span>
      <span className="muted">{status?.backend || t(lang, '未连接', 'offline')}</span>

      {sep}
      <Chip
        lang={lang}
        label={t(lang, '上下文', 'ctx')}
        value={{
          zh: kvCap > 0 ? `${fmtNum(kvUsed)} / ${fmtNum(kvCap)}（${kvPct.toFixed(1)}%）` : lastCtx ? `${lastCtx} token` : '—',
          en: kvCap > 0 ? `${fmtNum(kvUsed)}/${fmtNum(kvCap)} (${kvPct.toFixed(1)}%)` : lastCtx ? `${lastCtx} tok` : '—',
        }}
        tone={kvPct > 85 ? 'chip-warn' : ''}
        title={t(lang, 'KV 池实时占用 / 容量', 'live KV occupancy / capacity')}
      />

      {sep}
      <Chip
        lang={lang}
        label={t(lang, '解码', 'decode')}
        value={{ zh: decode ? `${decode.toFixed(0)} tok/s` : '—', en: decode ? `${decode.toFixed(0)} tok/s` : '—' }}
      />
      <Chip
        lang={lang}
        label={t(lang, '预填', 'prefill')}
        value={{ zh: prefill ? `${fmtNum(prefill)} tok/s` : '—', en: prefill ? `${fmtNum(prefill)} tok/s` : '—' }}
      />
      <Chip
        lang={lang}
        label={t(lang, '首字', 'ttft')}
        value={{ zh: ttft ? `${Math.round(ttft)} ms` : '—', en: ttft ? `${Math.round(ttft)} ms` : '—' }}
      />
      <Chip
        lang={lang}
        label={t(lang, '投机', 'draft')}
        value={{ zh: accept === null ? '—' : `${accept}%`, en: accept === null ? '—' : `${accept}%` }}
        tone={accept !== null && accept > 60 ? 'chip-good' : ''}
      />

      {sep}
      <Chip
        lang={lang}
        label={t(lang, '累计', 'total')}
        value={{
          zh: `${fmtNum(counters.requests_total || 0)} 请求 · ↓${fmtNum(counters.completion_tokens_total || 0)}`,
          en: `${fmtNum(counters.requests_total || 0)} req · ↓${fmtNum(counters.completion_tokens_total || 0)}`,
        }}
        title={t(lang, '累计请求数 / 输出 token', 'total requests / completion tokens')}
      />

      {gpu?.available && (
        <>
          {sep}
          <Chip
            lang={lang}
            label={t(lang, '显存', 'vram')}
            value={{
              zh: `${(gpu.usedMB / 1024).toFixed(1)} / ${(gpu.totalMB / 1024).toFixed(1)} GiB`,
              en: `${(gpu.usedMB / 1024).toFixed(1)}/${(gpu.totalMB / 1024).toFixed(1)} GiB`,
            }}
            tone={gpu.totalMB && gpu.usedMB / gpu.totalMB > 0.92 ? 'chip-warn' : ''}
            title={`${gpu.name} · ${t(lang, '利用率', 'util')} ${gpu.utilPct}% · ${gpu.tempC}°C`}
          />
        </>
      )}

      <span className="cs-spacer" />
      <span className="muted">{pending === 'busy' ? t(lang, '生成中', 'generating') : t(lang, '空闲', 'idle')}</span>
    </div>
  )
}
