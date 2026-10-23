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

/**
 * 纯顾客视角的对话界面（照 DSH）：
 * 扁平转录；输入盒只有「设置 / 发送」两个动作，模型与参数不在这里出现。
 */
export default function ChatPanel({
  messages,
  streamingId,
  onSend,
  onCancel,
  disabled,
  lang: langProp,
  onOpenSettings,
}) {
  const lang = normLang(langProp)
  const [input, setInput] = useState('')
  const scroller = useRef(null)

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
              {t(lang, '开始一段对话吧。', 'Start a conversation.')}
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
            </div>
          </div>
        ))}
      </div>

      <div className="composer">
        <textarea
          value={input}
          placeholder={
            disabled
              ? t(lang, '未连接…', 'not connected…')
              : t(lang, '给 Zenith 发消息…', 'Message Zenith…')
          }
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
        />
        <div className="composer-row">
          <button className="composer-icon" title={t(lang, '设置', 'Settings')} onClick={onOpenSettings}>
            ⚙
          </button>
          <span className="cs-spacer" />
          {streamingId ? (
            <button className="btn btn-danger btn-round" onClick={onCancel} title={t(lang, '停止', 'Stop')}>
              ■
            </button>
          ) : (
            <button
              className="btn btn-primary btn-round"
              onClick={submit}
              disabled={disabled}
              title={t(lang, '发送（Enter）', 'send (Enter)')}
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
