import { useState } from 'react'
import { normLang, t } from '../i18n.js'

/**
 * 设置（对齐 DSH 的设置窗口：左侧分区列表 + 右侧内容）。
 * 顾客只需要：通用（语言）/ 外观（主题）/ 连接（服务地址）/ 关于。
 */
export default function SettingsDialog({ settings, onSave, onClose, connected, connError, versions }) {
  const lang = normLang(settings?.uiLang || settings?.termLang)
  const [urlDraft, setUrlDraft] = useState(settings?.baseUrl || '')
  const [section, setSection] = useState('general')

  const sections = [
    { id: 'general', name: t(lang, '通用', 'General') },
    { id: 'appearance', name: t(lang, '外观', 'Appearance') },
    { id: 'connection', name: t(lang, '连接', 'Connection') },
    { id: 'about', name: t(lang, '关于', 'About') },
  ]

  const setLang = (v) => {
    onSave({ uiLang: v, termLang: v === 'en' ? 'en' : 'zh' })
    // 应用菜单标题也要跟着换
    window.zenith?.setAppLang?.(v)
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <span className="modal-title">{t(lang, '设置', 'Settings')}</span>
          <button className="modal-close" onClick={onClose} title={t(lang, '关闭', 'close')}>
            ×
          </button>
        </header>

        <div className="settings-split">
          <nav className="settings-nav">
            {sections.map((s) => (
              <button
                key={s.id}
                className={`settings-nav-item ${section === s.id ? 'active' : ''}`}
                onClick={() => setSection(s.id)}
              >
                {s.name}
              </button>
            ))}
          </nav>

          <div className="settings-pane">
            {section === 'general' && (
              <>
                <div className="settings-row">
                  <div>
                    <div className="settings-label">{t(lang, '界面语言', 'Interface language')}</div>
                    <div className="settings-hint">
                      {t(lang, '同时切换菜单栏（文件 / 编辑 / 视图 …）', 'Also switches the menu bar')}
                    </div>
                  </div>
                  <div className="seg">
                    <button
                      className={`seg-btn ${lang === 'zh' ? 'active' : ''}`}
                      onClick={() => setLang('zh')}
                    >
                      中文
                    </button>
                    <button
                      className={`seg-btn ${lang === 'en' ? 'active' : ''}`}
                      onClick={() => setLang('en')}
                    >
                      English
                    </button>
                  </div>
                </div>
              </>
            )}

            {section === 'appearance' && (
              <div className="settings-row">
                <div>
                  <div className="settings-label">{t(lang, '主题', 'Theme')}</div>
                  <div className="settings-hint">
                    {t(lang, '深色 / 浅色', 'Dark / Light')}
                  </div>
                </div>
                <div className="seg">
                  <button
                    className={`seg-btn ${(settings?.theme || 'dark') === 'dark' ? 'active' : ''}`}
                    onClick={() => onSave({ theme: 'dark' })}
                  >
                    {t(lang, '深色', 'Dark')}
                  </button>
                  <button
                    className={`seg-btn ${settings?.theme === 'light' ? 'active' : ''}`}
                    onClick={() => onSave({ theme: 'light' })}
                  >
                    {t(lang, '浅色', 'Light')}
                  </button>
                </div>
              </div>
            )}

            {section === 'connection' && (
              <>
                <div className="settings-row">
                  <div style={{ flex: 1 }}>
                    <div className="settings-label">{t(lang, '服务地址', 'Service URL')}</div>
                    <div className="settings-hint">
                      {t(lang, '由后台运维部署，通常保持默认', 'Deployed by ops; usually keep default')}
                    </div>
                  </div>
                  <span className={`dsh-pill ${connected ? 'dsh-pill-ok' : ''}`}>
                    {connected
                      ? t(lang, '已连接', 'online')
                      : connError
                        ? t(lang, '连接失败', 'offline')
                        : t(lang, '未连接', 'not connected')}
                  </span>
                </div>
                <div className="settings-row">
                  <input
                    className="input input-url"
                    value={urlDraft}
                    spellCheck={false}
                    onChange={(e) => setUrlDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onSave({ baseUrl: urlDraft })}
                    placeholder="http://127.0.0.1:8090"
                  />
                  <button className="btn" onClick={() => onSave({ baseUrl: urlDraft })}>
                    {t(lang, '保存并连接', 'Save & connect')}
                  </button>
                </div>
              </>
            )}

            {section === 'about' && (
              <>
                <div className="settings-row">
                  <span className="settings-label">ZenithDesk</span>
                  <span className="settings-hint">v0.1.1</span>
                </div>
                <div className="settings-row">
                  <span className="settings-label">Electron</span>
                  <span className="settings-hint">{versions?.electron || '—'}</span>
                </div>
                <div className="settings-row">
                  <span className="settings-label">Chromium</span>
                  <span className="settings-hint">{versions?.chrome || '—'}</span>
                </div>
                <div className="settings-row">
                  <span className="settings-label">Node</span>
                  <span className="settings-hint">{versions?.node || '—'}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
