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

/** 访问模式（对齐 DSH 的 access mode 胶囊） */
export const ACCESS_MODES = [
  { id: 'ask', zh: '标准模式', en: 'Standard', zhDesc: '敏感操作前询问', enDesc: 'asks before sensitive actions' },
  { id: 'full', zh: '完全访问', en: 'Full access', zhDesc: '减少确认，直接执行', enDesc: 'fewer confirmations' },
  { id: 'read', zh: '只读', en: 'Read-only', zhDesc: '只看不改', enDesc: 'read only' },
]

const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

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
  settings,
  onSave,
  vision = false,
  queue,
  onFlushQueue,
  onDropQueue,
}) {
  const lang = normLang(langProp)
  const [input, setInput] = useState('')
  const [slash, setSlash] = useState(false)
  const [images, setImages] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const [imageError, setImageError] = useState('')
  const [access, setAccess] = useState(settings?.accessMode || 'ask')
  const [accessConfirm, setAccessConfirm] = useState(false)
  const scroller = useRef(null)
  const fileInput = useRef(null)

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
    { cmd: '/clear', zh: '清空输入', en: 'Clear input', run: () => { setInput(''); setImages([]) } },
  ]

  const addFiles = (files) => {
    setImageError('')
    const list = [...files]
    for (const f of list) {
      if (!OK_TYPES.includes(f.type)) {
        setImageError(t(lang, '仅支持 PNG、JPG、WebP、GIF 格式的图片', 'Only PNG, JPG, WebP and GIF are supported'))
        continue
      }
      if (f.size > MAX_IMAGE_BYTES) {
        setImageError(t(lang, '单张图片不能超过 10 MB', 'Each image must be under 10 MB'))
        continue
      }
      if (images.length >= MAX_IMAGES) {
        setImageError(t(lang, `一条消息最多添加 ${MAX_IMAGES} 张图片`, `At most ${MAX_IMAGES} images per message`))
        break
      }
      const reader = new FileReader()
      reader.onload = () =>
        setImages((prev) =>
          prev.length >= MAX_IMAGES
            ? prev
            : [...prev, { id: crypto.randomUUID(), name: f.name, url: reader.result, size: f.size }],
        )
      reader.readAsDataURL(f)
    }
  }

  const submit = () => {
    const text = input.trim()
    if ((!text && images.length === 0) || disabled) return
    if (text.startsWith('/')) {
      const hit = commands.find((c) => c.cmd === text.split(' ')[0])
      if (hit) {
        hit.run()
        setInput('')
        setSlash(false)
        return
      }
    }
    onSend(text, images)
    setInput('')
    setImages([])
    setSlash(false)
  }

  const onInputChange = (v) => {
    setInput(v)
    setSlash(v.startsWith('/') && !v.includes(' '))
  }

  const matchCmd = slash ? commands.filter((c) => c.cmd.startsWith(input.split(' ')[0])) : []
  const ctxPct = context.percent || 0
  const ctxLines = context.lines || []
  const mode = ACCESS_MODES.find((m) => m.id === access) || ACCESS_MODES[0]

  const setMode = (id) => {
    if (id === 'full' && !settings?.accessFullAck) {
      setAccessConfirm(true)
      return
    }
    setAccess(id)
    onSave?.({ accessMode: id })
  }

  return (
    <div
      className="chat"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
      }}
    >
      {dragOver && (
        <div className="img-drop">
          <div className="img-drop-title">{t(lang, '图片拖动到此处即可添加', 'Drop images here')}</div>
          <div className="img-drop-desc">
            {t(lang, `最多 ${MAX_IMAGES} 张，每张 10 MB`, `up to ${MAX_IMAGES}, 10 MB each`)}
          </div>
        </div>
      )}

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
              {m.images?.length > 0 && (
                <div className="msg-images">
                  {m.images.map((img) => (
                    <img key={img.id} src={img.url} alt={img.name} title={img.name} />
                  ))}
                </div>
              )}
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
                      if (prevUser) onSend(prevUser.content, prevUser.images || [])
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
        {queue?.length > 0 && (
          <div className="queue-bar">
            <span>
              {t(lang, `${queue.length} 条排队中（繁忙时按 Enter 排队）`, `${queue.length} queued`)}
            </span>
            <button className="msg-action" onClick={onFlushQueue}>
              {t(lang, '立即发送', 'Send now')}
            </button>
            <button className="msg-action" onClick={onDropQueue}>
              {t(lang, '取消排队', 'Cancel')}
            </button>
          </div>
        )}

        {(images.length > 0 || imageError) && (
          <div className="img-strip">
            {images.map((img) => (
              <div key={img.id} className="img-thumb" title={img.name}>
                <img src={img.url} alt={img.name} />
                <button
                  className="img-remove"
                  title={t(lang, `移除图片 ${img.name}`, `remove ${img.name}`)}
                  onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
                >
                  ×
                </button>
              </div>
            ))}
            {imageError && <div className="img-error">{imageError}</div>}
          </div>
        )}

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
          onPaste={(e) => {
            const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'))
            if (files.length) {
              e.preventDefault()
              addFiles(files)
            }
          }}
          onKeyDown={(e) => {
            const steer = e.metaKey || e.ctrlKey
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              // 繁忙时：默认按设置排队；Cmd/Ctrl+Enter 走另一种行为
              if (streamingId) {
                const queueMode = (settings?.enterBehavior || 'queue') === 'queue'
                if (steer ? queueMode : !queueMode) {
                  onSend(input, images, { steer: true })
                  setInput('')
                  setImages([])
                } else {
                  // 排队：交给上游处理
                  onSend(input, images, { queue: true })
                  setInput('')
                  setImages([])
                }
                return
              }
              submit()
            }
            if (e.key === 'Escape') setSlash(false)
          }}
          rows={2}
        />

        <div className="composer-row">
          <button
            className="composer-icon"
            title={t(lang, '添加图片', 'Add image')}
            onClick={() => (vision ? fileInput.current?.click() : setImageError(t(lang, '当前模型不支持图片，请切换支持图片的模型', 'This model does not support images')))}
          >
            ＋
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={OK_TYPES.join(',')}
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />

          <button className="composer-icon" title={t(lang, '命令', 'Commands')} onClick={() => onInputChange('/')}>
            /
          </button>
          <button className="composer-icon" title={t(lang, '设置', 'Settings')} onClick={onOpenSettings}>
            ⚙
          </button>

          <button
            className={`mode-chip ${access === 'full' ? 'mode-full' : ''}`}
            title={t(lang, `访问模式，当前：${mode.zh}`, `access mode: ${mode.en}`)}
            onClick={() => setMode(access === 'ask' ? 'full' : access === 'full' ? 'read' : 'ask')}
          >
            {t(lang, mode.zh, mode.en)}
          </button>

          {ctxPct > 0 && (
            <span className="ctx-chip" title={ctxLines.join('\n') || t(lang, '上下文已用', 'context used')}>
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

      {accessConfirm && (
        <div className="modal-mask" onClick={() => setAccessConfirm(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <span className="modal-title">{t(lang, '确认启用 Full access？', 'Enable Full access?')}</span>
              <button className="modal-close" onClick={() => setAccessConfirm(false)}>
                ×
              </button>
            </header>
            <div className="settings-block">
              <p className="muted">
                {t(
                  lang,
                  '启用 Full access 后，agent 将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
                  'Full access reduces confirmations and lets the agent perform more actions directly, including sensitive ones. Use it only when you trust the task.',
                )}
              </p>
              <label className="ack-line">
                <input
                  type="checkbox"
                  onChange={(e) => {
                    if (e.target.checked) {
                      setAccess('full')
                      onSave?.({ accessMode: 'full', accessFullAck: true })
                      setAccessConfirm(false)
                    }
                  }}
                />
                {t(lang, '我已了解风险，并愿意继续', 'I understand the risks and want to continue')}
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
