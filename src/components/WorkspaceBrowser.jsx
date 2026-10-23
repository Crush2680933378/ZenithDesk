import { useState } from 'react'
import { normLang, t } from '../i18n.js'

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

/**
 * 工作区浏览器（对齐 DSH 的 ui-workspace）：侧栏直接按工作区分组列出会话，
 * 组可折叠；会话可重命名 / 删除 / 移入其它工作区。
 */
export default function WorkspaceBrowser({
  workspaces,
  sessions,
  activeWorkspace,
  activeId,
  onSwitchWorkspace,
  onCreateWorkspace,
  onSelect,
  onDelete,
  onRename,
  onMove,
  lang: langProp,
}) {
  const lang = normLang(langProp)
  const [collapsedWs, setCollapsedWs] = useState({})
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')
  const [movingId, setMovingId] = useState(null)
  const [newWs, setNewWs] = useState(false)
  const [wsName, setWsName] = useState('')

  const toggle = (id) => setCollapsedWs((m) => ({ ...m, [id]: !m[id] }))

  const commitRename = (id) => {
    const title = draft.trim()
    if (title) onRename(id, title)
    setEditing(null)
  }

  return (
    <div className="ws-browser">
      {workspaces.map((w) => {
        const items = sessions.filter((s) => (s.workspaceId || 'default') === w.id)
        const isCollapsed = !!collapsedWs[w.id]
        const isActive = w.id === activeWorkspace
        return (
          <div key={w.id} className={`ws-group ${isActive ? 'active' : ''}`}>
            <div
              className="ws-head"
              onClick={() => onSwitchWorkspace(w.id)}
              title={t(lang, '切换到此工作区', 'switch to this workspace')}
            >
              <button
                className="ws-caret"
                onClick={(e) => {
                  e.stopPropagation()
                  toggle(w.id)
                }}
              >
                {isCollapsed ? '▸' : '▾'}
              </button>
              <span className="ws-name">{w.name}</span>
              <span className="ws-count">{items.length}</span>
            </div>

            {!isCollapsed && (
              <div className="ws-items">
                {items.length === 0 && (
                  <div className="ws-empty">{t(lang, '暂无会话', 'no sessions')}</div>
                )}
                {items.map((s) => (
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
                        className="session-input"
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => commitRename(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(s.id)
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

                    {workspaces.length > 1 && (
                      <button
                        className="session-del"
                        style={{ right: 26 }}
                        title={t(lang, '移入工作区', 'move to workspace')}
                        onClick={(e) => {
                          e.stopPropagation()
                          setMovingId(movingId === s.id ? null : s.id)
                        }}
                      >
                        ⇄
                      </button>
                    )}
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

                    {movingId === s.id && (
                      <div className="ws-move-menu">
                        {workspaces
                          .filter((x) => x.id !== (s.workspaceId || 'default'))
                          .map((x) => (
                            <button
                              key={x.id}
                              className="dsh-ws-item"
                              onClick={(e) => {
                                e.stopPropagation()
                                onMove(s.id, x.id)
                                setMovingId(null)
                              }}
                            >
                              {x.name}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <div className="ws-new">
        {newWs ? (
          <input
            className="input"
            autoFocus
            style={{ fontSize: 11.5, padding: '4px 8px' }}
            placeholder={t(lang, '工作区名称', 'workspace name')}
            value={wsName}
            onChange={(e) => setWsName(e.target.value)}
            onBlur={() => {
              if (wsName.trim()) onCreateWorkspace(wsName.trim())
              setWsName('')
              setNewWs(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && wsName.trim()) {
                onCreateWorkspace(wsName.trim())
                setWsName('')
                setNewWs(false)
              }
              if (e.key === 'Escape') {
                setWsName('')
                setNewWs(false)
              }
            }}
          />
        ) : (
          <button className="dsh-nav-item" onClick={() => setNewWs(true)}>
            ＋ {t(lang, '新工作区', 'New workspace')}
          </button>
        )}
      </div>
    </div>
  )
}
