import { useEffect, useRef, useState } from 'react'
import { normLang, t } from '../i18n.js'

/** 相对时间：刚刚 / N 分钟前 / N 小时前 */
function relTime(iso, lang) {
  if (!iso) return ''
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ''
  const min = Math.floor((Date.now() - ts) / 60000)
  if (min < 1) return t(lang, '刚刚', 'just now')
  if (min < 60) return t(lang, `${min} 分钟前`, `${min}m ago`)
  const hours = Math.floor(min / 60)
  if (hours < 24) return t(lang, `${hours} 小时前`, `${hours}h ago`)
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SessionList({ sessions, activeId, onSelect, onDelete, onRename, lang: langProp }) {
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

  // 按"今天 / 昨天 / 更早"分组（DSH 的会话列表也是这么分的）
  const dayOf = (iso) => {
    const d = new Date(iso || 0)
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    if (day >= startOfToday) return t(lang, '今天', 'today')
    if (day >= startOfToday - 86400000) return t(lang, '昨天', 'yesterday')
    return t(lang, '更早', 'earlier')
  }

  const groups = []
  for (const s of sessions) {
    const name = dayOf(s.updatedAt)
    let bucket = groups.find((g) => g.name === name)
    if (!bucket) {
      bucket = { name, items: [] }
      groups.push(bucket)
    }
    bucket.items.push(s)
  }

  return (
    <div className="sessions">
      {sessions.length === 0 && (
        <div className="muted">{t(lang, '还没有会话', 'no sessions yet')}</div>
      )}
      {groups.map((g) => (
        <div key={g.name}>
          <div className="dsh-section">{g.name}</div>
          {g.items.map((s) => (
            <div
              key={s.id}
              className={`dsh-session ${s.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(s.id)}
              onDoubleClick={() => {
                setEditing(s.id)
                setDraft(s.title)
              }}
              title={t(lang, '双击重命名', 'double-click to rename')}
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
                <div className="dsh-session-title">{s.title || t(lang, '未命名', 'untitled')}</div>
              )}
              <div className="dsh-session-meta">
                {relTime(s.updatedAt, lang)}
                {s.messageCount
                  ? ` · ${Math.ceil(s.messageCount / 2)} ${t(lang, '轮', 'turns')}`
                  : ''}
              </div>
              <button
                className="session-del"
                title={t(lang, '删除会话', 'delete session')}
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
      ))}
    </div>
  )
}
