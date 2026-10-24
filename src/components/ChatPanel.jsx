import { useEffect, useRef, useState } from 'react'
import { normLang, t } from '../i18n.js'

function Reasoning({ text, lang, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!text) return null
  return (
    <details className="reasoning" open={open} onToggle={(e) => setOpen(e.target.open)}>
      <summary>
        {t(lang, '思考过程', 'reasoning')} · {text.length} {t(lang, '字', 'chars')}
        {open ? '' : t(lang, '（点击展开）', ' (click to expand)')}
      </summary>
      <pre>{text}</pre>
    </details>
  )
}

/** DSH 风格的统计行：输入/输出 tok · tok/s · 首 token · 缓存命中 */
function StatsLine({ meta, lang }) {
  if (!meta) return null
  const parts = []
  if (meta.prompt != null) parts.push(`${t(lang, '输入', 'in')} ${meta.prompt} tok`)
  if (meta.completion != null) parts.push(`${t(lang, '输出', 'out')} ${meta.completion} tok`)
  if (meta.elapsed) parts.push(`${(meta.elapsed / 1000).toFixed(2)} s`)
  if (meta.tps) parts.push(`${Math.round(meta.tps)} tok/s`)
  if (meta.ttft) parts.push(`${t(lang, '首 token', 'ttft')} ${Math.round(meta.ttft)} ms`)
  if (meta.finish && meta.finish !== 'stop') parts.push(meta.finish)
  if (parts.length === 0) return null
  return <div className="msg-stats">{parts.join(' · ')}</div>
}

export default function ChatPanel({
  messages,
  streamingId,
  onSend,
  onCancel,
  disabled,
  lang: langProp,
  onOpenSettings,
  onCommand,
  context = {},
}) {
  const lang = normLang(langProp)
  const [input, setInput] = useState('')
  const [slash, setSlash] = useState(false)
  const scroller = useRef(null)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  const commands = [
    { cmd: '/new', zh: '新会话', en: 'New session', run: () => onCommand?.('new') },
    { cmd: '/trace', zh: '打开轨迹', en: 'Open trace', run: () => onCommand?.('trace') },
    { cmd: '/settings', zh: '设置', en: 'Settings', run: () => onOpenSettings?.() },
    { cmd: '/stop', zh: '停止生成', en: 'Stop generating', run: () => onCancel?.() },
    { cmd: '/clear', zh: '清空输入', en: 'Clear input', run: () => setInput('') },
  ]

  const submit = () => {
    const text = input.trim()
    if (!text || disabled) return
    if (text.startsWith('/')) {
      const hit = commands.find((c) => c.cmd === text.split(' ')[0])
      if (hit) {
        hit.run()
        setInput('')
        setSlash(false)
        return
      }
    }
    onSend(text)
    setInput('')
    setSlash(false)
  }

  const onInputChange = (v) => {
    setInput(v)
    setSlash(v.startsWith('/') && !v.includes(' '))
  }

  const matchCmd = slash ? commands.filter((c) => c.cmd.startsWith(input.split(' ')[0])) : []

  const ctxPct = context.percent || 0
  const ctxBreakdown = context.breakdown || ''

  return (
    <div className="chat">
      <div className="messages" ref={scroller}>
        {messages.length === 0 && (
          <div className="empty">
            <h2>天顶，顶点，万物之巅</h2>
            <p>{t(lang, '描述你想要构建的内容', 'Describe what you want to build')}</p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-role">{m.role === 'user' ? t(lang, '我', 'me') : 'Zenith'}</div>
            <div className="msg-body">
              {m.role === 'assistant' && (
                <Reasoning
                  text={m.reasoning}
                  lang={lang}
                  defaultOpen={!m.pending && !m.content && !!m.reasoning}
                />
              )}
              <div className="msg-text">{m.content || (m.pending ? '…' : '')}</div>
              {!m.content && !m.pending && (
                <div className="msg-warn">
                  {t(
                    lang,
                    '这一轮没有输出正文（模型可能在思考阶段用尽了预算）。可以重发一次，或在设置里调整。',
                    'No answer text this round (the model likely used its budget on reasoning). Retry, or adjust in Settings.',
                  )}
                </div>
              )}
              {m.error && <div className="msg-error">{m.error}</div>}
              {m.role === 'assistant' && <StatsLine meta={m.meta} lang={lang} />}

              {!m.pending && (
                <div className="msg-actions">
                  <button
                    className="msg-action"
                    title={t(lang, '复制', 'copy')}
                    onClick={() => navigator.clipboard?.writeText(m.content || '')}
                  >
                    {t(lang, '复制', 'Copy')}
                  </button>
                  <button
                    className="msg-action"
                    title={t(lang, '重新生成', 'regenerate')}
                    onClick={() => {
                      const idx = messages.findIndex((x) => x.id === m.id)
                      const prevUser = [...messages.slice(0, idx)].reverse().find((x) => x.role === 'user')
                      if (prevUser) onSend(prevUser.content)
                    }}
                  >
                    {t(lang, '重新生成', 'Regenerate')}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="composer">
        {matchCmd.length > 0 && (
          <div className="slash-menu">
            <div className="slash-title">{t(lang, '命令', 'Commands')}</div>
            {matchCmd.map((c) => (
              <button
                key={c.cmd}
                className="slash-item"
                onClick={() => {
                  c.run()
                  setInput('')
                  setSlash(false)
                }}
              >
                <span className="slash-cmd">{c.cmd}</span>
                <span className="slash-desc">{t(lang, c.zh, c.en)}</span>
              </button>
            ))}
          </div>
        )}

        <textarea
          value={input}
          placeholder={
            disabled ? t(lang, '会话不可用', 'unavailable') : t(lang, '给智能体发消息', 'Message the agent')
          }
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
            if (e.key === 'Escape') setSlash(false)
          }}
          rows={2}
        />

        <div className="composer-row">
          <button className="composer-icon" title={t(lang, '命令', 'Commands')} onClick={() => onInputChange('/')}>
            /
          </button>
          <button className="composer-icon" title={t(lang, '设置', 'Settings')} onClick={onOpenSettings}>
            ⚙
          </button>

          {ctxPct > 0 && (
            <span className="ctx-chip" title={ctxBreakdown || t(lang, '上下文已用', 'context used')}>
              {t(lang, `上下文已用 ${ctxPct.toFixed(1)}%`, `context ${ctxPct.toFixed(1)}%`)}
            </span>
          )}

          <span className="cs-spacer" />
          {streamingId ? (
            <button
              className="btn btn-danger btn-round"
              onClick={onCancel}
              title={t(lang, '停止生成', 'Stop generating')}
            >
              ■
            </button>
          ) : (
            <button
              className="btn btn-primary btn-round"
              onClick={submit}
              disabled={disabled}
              title={t(lang, '发送消息', 'Send message')}
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
