import { useMemo, useState } from 'react'
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
 * 工作区浏览器（对齐 DSH ui-workspace 的最新版）：搜索、分组方式、排序、
 * 工作区/会话两个段落、展开其余会话。
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
  onReorder,
  lang: langProp,
}) {
  const lang = normLang(langProp)
  const [collapsedWs, setCollapsedWs] = useState({})
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState('')
  const [movingId, setMovingId] = useState(null)
  const [newWs, setNewWs] = useState(false)
  const [wsName, setWsName] = useState('')
  const [query, setQuery] = useState('')
  const [groupBy, setGroupBy] = useState('workspace') // workspace | flat
  const [orderBy, setOrderBy] = useState('updated') // updated | manual
  const [opts, setOpts] = useState(false)
  const [expanded, setExpanded] = useState({})
  const [dragId, setDragId] = useState(null)

  const COMMON = 5 // 每个工作区先显示条数

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = sessions
    if (q) {
      list = list.filter(
        (s) =>
          (s.title || '').toLowerCase().includes(q) ||
          (s.preview || '').toLowerCase().includes(q),
      )
    }
    if (orderBy === 'updated') {
      list = [...list].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    } else {
      list = [...list].sort((a, b) => (a.order || 0) - (b.order || 0))
    }
    return list
  }, [sessions, query, orderBy])

  const toggle = (id) => setCollapsedWs((m) => ({ ...m, [id]: !m[id] }))

  const commitRename = (id) => {
    const title = draft.trim()
    if (title) onRename(id, title)
    setEditing(null)
  }

  const renderRow = (s) => (
    <div
      key={s.id}
      className={`dsh-session ${s.id === activeId ? 'active' : ''} ${orderBy === 'manual' ? 'draggable' : ''}`}
      draggable={orderBy === 'manual'}
      onDragStart={() => setDragId(s.id)}
      onDragOver={(e) => {
        if (orderBy === 'manual') e.preventDefault()
      }}
      onDrop={(e) => {
        if (orderBy !== 'manual' || !dragId || dragId === s.id) return
        e.preventDefault()
        e.stopPropagation()
        const wsItems = filtered.filter((x) => (x.workspaceId || 'default') === (s.workspaceId || 'default'))
        const ids = wsItems.map((x) => x.id)
        const from = ids.indexOf(dragId)
        const to = ids.indexOf(s.id)
        if (from < 0 || to < 0) return
        ids.splice(to, 0, ids.splice(from, 1)[0])
        onReorder?.(ids)
        setDragId(null)
      }}
      onDragEnd={() => setDragId(null)}
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
        {s.messageCount ? ` · ${Math.ceil(s.messageCount / 2)} ${t(lang, '轮', 'turns')}` : ''}
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
  )

  return (
    <div className="ws-browser">
      {/* 搜索 + 视图选项 */}
      <div className="ws-tools">
        <input
          className="ws-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, '搜索会话…', 'Search sessions…')}
          aria-label={t(lang, '搜索会话', 'Search sessions')}
        />
        {query && (
          <button className="ws-clear" title={t(lang, '清除搜索', 'clear search')} onClick={() => setQuery('')}>
            ×
          </button>
        )}
        <button
          className="ws-opt"
          title={t(lang, '视图选项', 'view options')}
          onClick={() => setOpts((v) => !v)}
        >
          ⋯
        </button>
      </div>

      {opts && (
        <div className="ws-options">
          <div className="ws-options-label">{t(lang, '分组方式', 'Group by')}</div>
          <div className="seg">
            <button
              className={`seg-btn ${groupBy === 'workspace' ? 'active' : ''}`}
              onClick={() => setGroupBy('workspace')}
            >
              {t(lang, '按工作区', 'Workspace')}
            </button>
            <button
              className={`seg-btn ${groupBy === 'flat' ? 'active' : ''}`}
              onClick={() => setGroupBy('flat')}
            >
              {t(lang, '单列表', 'Flat')}
            </button>
          </div>
          <div className="ws-options-label">{t(lang, '排序方式', 'Order by')}</div>
          <div className="seg">
            <button
              className={`seg-btn ${orderBy === 'updated' ? 'active' : ''}`}
              onClick={() => setOrderBy('updated')}
            >
              {t(lang, '最近更新', 'Updated')}
            </button>
            <button
              className={`seg-btn ${orderBy === 'manual' ? 'active' : ''}`}
              onClick={() => setOrderBy('manual')}
            >
              {t(lang, '手动排序', 'Manual')}
            </button>
          </div>
        </div>
      )}

      {query && (
        <div className="dsh-section">
          {t(lang, '搜索结果', 'Results')} · {filtered.length}
        </div>
      )}

      {groupBy === 'flat' ? (
        <div className="ws-items">
          {filtered.length === 0 && (
            <div className="ws-empty">{query ? t(lang, '无匹配结果', 'no matches') : t(lang, '暂无会话', 'no sessions')}</div>
          )}
          {filtered.map(renderRow)}
        </div>
      ) : (
        <>
          {workspaces.map((w) => {
            const items = filtered.filter((s) => (s.workspaceId || 'default') === w.id)
            if (query && items.length === 0) return null
            const isCollapsed = !!collapsedWs[w.id]
            const isActive = w.id === activeWorkspace
            const open = !!expanded[w.id]
            const shown = open ? items : items.slice(0, COMMON)
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
                    {items.length === 0 && <div className="ws-empty">{t(lang, '暂无会话', 'no sessions')}</div>}
                    {shown.map(renderRow)}
                    {items.length > COMMON && (
                      <button
                        className="ws-more"
                        onClick={(e) => {
                          e.stopPropagation()
                          setExpanded((m) => ({ ...m, [w.id]: !open }))
                        }}
                      >
                        {open
                          ? t(lang, '收起', 'collapse')
                          : t(lang, `展开其余 ${items.length - COMMON} 个会话`, `show ${items.length - COMMON} more`)}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

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
            ＋ {t(lang, '添加工作区', 'Add workspace')}
          </button>
        )}
      </div>
    </div>
  )
}
