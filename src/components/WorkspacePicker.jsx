import { useEffect, useRef, useState } from 'react'
import { normLang, t } from '../i18n.js'

/** 工作区选择器：切换 / 新建（DSH 的 workspace 浏览器最小版） */
export default function WorkspacePicker({ workspaces, activeId, onSelect, onCreate, lang: langProp }) {
  const lang = normLang(langProp)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current = workspaces.find((w) => w.id === activeId)

  return (
    <div className="wide-only" ref={box} style={{ position: 'relative' }}>
      <button className="dsh-ws-select" onClick={() => setOpen((v) => !v)}>
        <span>▣</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current?.name || t(lang, '工作区', 'Workspace')}
        </span>
        <span style={{ opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div className="dsh-ws-menu">
          {workspaces.map((w) => (
            <button
              key={w.id}
              className={`dsh-ws-item ${w.id === activeId ? 'active' : ''}`}
              onClick={() => {
                onSelect(w.id)
                setOpen(false)
              }}
            >
              {w.name}
            </button>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input
              className="input"
              style={{ flex: 1, fontSize: 11.5, padding: '4px 8px' }}
              placeholder={t(lang, '新工作区名称', 'new workspace')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) {
                  onCreate(draft.trim())
                  setDraft('')
                  setOpen(false)
                }
              }}
            />
            <button
              className="btn btn-mini"
              onClick={() => {
                if (draft.trim()) {
                  onCreate(draft.trim())
                  setDraft('')
                  setOpen(false)
                }
              }}
            >
              ＋
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
