import { useEffect, useRef, useState } from 'react'
import { normLang, t } from '../i18n.js'

/**
 * 应用菜单栏（文件 / 编辑 / 视图 / 帮助）。
 * 标题与条目都随界面语言切换；动作走 preload 暴露的 window.zenith.app*。
 */
export default function MenuBar({ lang: langProp, onNewSession, onSettings, onAbout }) {
  const lang = normLang(langProp)
  const [open, setOpen] = useState(null)
  const bar = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (bar.current && !bar.current.contains(e.target)) setOpen(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const act = (fn) => () => {
    setOpen(null)
    fn?.()
  }

  const menus = [
    {
      id: 'file',
      label: t(lang, '文件', 'File'),
      items: [
        { label: t(lang, '新会话', 'New Session'), accel: 'Ctrl+N', run: onNewSession },
        { label: t(lang, '设置…', 'Settings…'), accel: 'Ctrl+,', run: onSettings },
        { sep: true },
        { label: t(lang, '退出', 'Quit'), accel: 'Ctrl+Q', run: () => window.zenith?.appQuit?.() },
      ],
    },
    {
      id: 'edit',
      label: t(lang, '编辑', 'Edit'),
      items: [
        { label: t(lang, '撤销', 'Undo'), accel: 'Ctrl+Z', run: () => document.execCommand('undo') },
        { label: t(lang, '重做', 'Redo'), accel: 'Ctrl+Y', run: () => document.execCommand('redo') },
        { sep: true },
        { label: t(lang, '剪切', 'Cut'), accel: 'Ctrl+X', run: () => document.execCommand('cut') },
        { label: t(lang, '复制', 'Copy'), accel: 'Ctrl+C', run: () => document.execCommand('copy') },
        { label: t(lang, '粘贴', 'Paste'), accel: 'Ctrl+V', run: () => document.execCommand('paste') },
        { label: t(lang, '全选', 'Select All'), accel: 'Ctrl+A', run: () => document.execCommand('selectAll') },
      ],
    },
    {
      id: 'view',
      label: t(lang, '视图', 'View'),
      items: [
        { label: t(lang, '重新加载', 'Reload'), accel: 'Ctrl+R', run: () => window.zenith?.appReload?.() },
        { label: t(lang, '开发者工具', 'Toggle DevTools'), accel: 'Ctrl+Shift+I', run: () => window.zenith?.appDevTools?.() },
        { sep: true },
        { label: t(lang, '放大', 'Zoom In'), run: () => window.zenith?.appZoom?.(1) },
        { label: t(lang, '缩小', 'Zoom Out'), run: () => window.zenith?.appZoom?.(-1) },
        { label: t(lang, '实际大小', 'Actual Size'), run: () => window.zenith?.appZoom?.(0) },
        { sep: true },
        { label: t(lang, '全屏', 'Toggle Full Screen'), accel: 'F11', run: () => window.zenith?.appFullscreen?.() },
      ],
    },
    {
      id: 'help',
      label: t(lang, '帮助', 'Help'),
      items: [{ label: t(lang, '关于 ZenithDesk', 'About ZenithDesk'), run: onAbout }],
    },
  ]

  return (
    <div className="menubar" ref={bar}>
      {menus.map((m) => (
        <div key={m.id} className="menubar-item">
          <button
            className={`menubar-title ${open === m.id ? 'open' : ''}`}
            onClick={() => setOpen(open === m.id ? null : m.id)}
            onMouseEnter={() => open && setOpen(m.id)}
          >
            {m.label}
          </button>
          {open === m.id && (
            <div className="menubar-drop">
              {m.items.map((it, i) =>
                it.sep ? (
                  <div key={`s${i}`} className="menubar-sep" />
                ) : (
                  <button key={it.label} className="menubar-entry" onClick={act(it.run)}>
                    <span>{it.label}</span>
                    {it.accel && <span className="menubar-accel">{it.accel}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
