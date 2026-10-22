import { useEffect, useRef, useState } from 'react'

function Reasoning({ text }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  return (
    <details className="reasoning" open={open} onToggle={(e) => setOpen(e.target.open)}>
      <summary>
        思考过程 · {text.length} 字{open ? '' : '（点击展开）'}
      </summary>
      <pre>{text}</pre>
    </details>
  )
}

export default function ChatPanel({ messages, streamingId, onSend, onCancel, disabled }) {
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
              连上 Zenith 网关后即可对话。输入框里 <kbd>Enter</kbd> 发送、
              <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行。
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-role">{m.role === 'user' ? '我' : 'Zenith'}</div>
            <div className="msg-body">
              {m.role === 'assistant' && <Reasoning text={m.reasoning} />}
              <div className="msg-text">{m.content || (m.pending ? '…' : '')}</div>
              {m.error && <div className="msg-error">{m.error}</div>}
              {m.meta && (
                <div className="msg-meta">
                  {m.meta.model} · 输入 {m.meta.prompt} / 输出 {m.meta.completion} token
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
          placeholder={disabled ? '未连接网关…' : '发消息给 Zenith（Enter 发送）'}
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
              停止
            </button>
          ) : (
            <button className="btn btn-primary" onClick={submit} disabled={disabled}>
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
