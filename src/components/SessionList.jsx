import { useEffect, useRef, useState } from 'react'
import { normLang, t } from '../i18n.js'

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / MM-DD */
function relTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} 小时前`
  if (hours < 48) return '昨天'
  const d = new Date(t)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SessionList({ sessions, activeId, onSelect, onCreate, onDelete, onRename, lang: langProp }) {
  const lang = normLang(langProp)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.select()
  }, [editing])

  const commit = (id) => {
    const title = draft.trim()
    if (title) onRename(id, title)
    setEditing(null)
  }

  return (
    <div className="sessions">
      <button className="btn btn-block" onClick={onCreate}>
        ＋ {t(lang, '新会话', 'new session')}
      </button>

      <div className="session-items">
        {sessions.length === 0 && <div className="muted">{t(lang, '还没有会话', 'no sessions yet')}</div>}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(s.id)}
            onDoubleClick={() => {
              setEditing(s.id)
              setDraft(s.title)
            }}
            title="双击重命名"
          >
            {editing === s.id ? (
              <input
                ref={inputRef}
                className="session-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit(s.id)
                  if (e.key === 'Escape') setEditing(null)
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="session-title">{s.title || '未命名'}</div>
            )}
            <div className="session-meta">
              {relTime(s.updatedAt)}
              {s.messageCount ? ` · ${Math.ceil(s.messageCount / 2)} ${t(lang, '轮', 'turns')}` : ''}
            </div>
            <button
              className="session-del"
              title="删除会话"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(s.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
