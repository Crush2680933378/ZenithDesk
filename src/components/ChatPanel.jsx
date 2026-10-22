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

export default function ChatPanel({ messages, streamingId, onSend, onCancel, disabled, lang: langProp }) {
  const lang = normLang(langProp)
  const [input, setInput] = useState('')
  const scroller = useRef(null)

  // 新内容到达时贴底（用户手动上翻时不打扰）
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  const submit = () => {
    const text = input.trim()
    if (!text || disabled) return
    onSend(text)
    setInput('')
  }

  return (
    <div className="chat">
      <div className="messages" ref={scroller}>
        {messages.length === 0 && (
          <div className="empty">
            <h2>天顶，顶点，万物之巅</h2>
            <p>
              {t(lang, '连上 Zenith 网关后即可对话。', 'Connect a Zenith gateway to start chatting.')}
              <br />
              <kbd>Enter</kbd> {t(lang, '发送', 'sends')} · <kbd>Shift</kbd>+<kbd>Enter</kbd>{' '}
              {t(lang, '换行', 'new line')}
            </p>
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
                  // 正文为空但有思考内容 → 默认展开，否则用户只看到空气泡
                  defaultOpen={!m.pending && !m.content && !!m.reasoning}
                />
              )}
              <div className="msg-text">{m.content || (m.pending ? '…' : '')}</div>
              {!m.content && !m.pending && (
                <div className="msg-warn">
                  {t(
                    lang,
                    `⚠ 模型把 ${m.meta?.completion ?? '?'} 个 token 全用在思考上，正文本轮没有产出（finish=${m.meta?.finish || 'length'}）。把 tokens 调大，或把顶栏「思考」设为关。`,
                    `⚠ All ${m.meta?.completion ?? '?'} tokens went into reasoning, so no answer text was produced (finish=${m.meta?.finish || 'length'}). Raise tokens or switch thinking off.`,
                  )}
                </div>
              )}
              {m.error && <div className="msg-error">{m.error}</div>}
              {m.meta && (
                <div className="msg-meta">
                  {m.meta.model} · {t(lang, '输入', 'in')} {m.meta.prompt} / {t(lang, '输出', 'out')}{' '}
                  {m.meta.completion} token
                  {m.meta.finish ? ` · ${m.meta.finish}` : ''}
                  {m.meta.elapsed ? ` · ${(m.meta.elapsed / 1000).toFixed(2)} s` : ''}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="composer">
        <textarea
          value={input}
          placeholder={
            disabled
              ? t(lang, '未连接网关…', 'not connected…')
              : t(lang, '发消息给 Zenith（Enter 发送）', 'Message Zenith (Enter to send)')
          }
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={3}
        />
        <div className="composer-actions">
          {streamingId ? (
            <button className="btn btn-danger" onClick={onCancel}>
              {t(lang, '停止', 'Stop')}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={submit} disabled={disabled}>
              {t(lang, '发送', 'Send')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
