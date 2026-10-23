import { useState } from 'react'
import { LANGS, normLang, t } from '../i18n.js'

/**
 * 设置：顾客侧只需要两件事 —— 连哪个后端、界面用什么语言。
 * 引擎启动 / 模型参数一律不在前端（那是后端的事）。
 */
export default function SettingsDialog({ settings, onSave, onClose, connected, connError }) {
  const lang = normLang(settings?.termLang)
  const [urlDraft, setUrlDraft] = useState(settings?.baseUrl || '')
  const [section, setSection] = useState('connection') // connection | ui

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <span className="modal-title">{t(lang, '设置', 'Settings')}</span>
          <div className="modal-tabs">
            <button
              className={`dsh-tab ${section === 'connection' ? 'active' : ''}`}
              onClick={() => setSection('connection')}
            >
              {t(lang, '连接', 'Connection')}
            </button>
            <button
              className={`dsh-tab ${section === 'ui' ? 'active' : ''}`}
              onClick={() => setSection('ui')}
            >
              {t(lang, '界面', 'Interface')}
            </button>
          </div>
          <button className="modal-close" onClick={onClose} title={t(lang, '关闭', 'close')}>
            ×
          </button>
        </header>

        <div className="modal-body">
          {section === 'connection' && (
            <div className="settings-block">
              <div className="dsh-section">{t(lang, '服务地址', 'Service URL')}</div>
              <div className="composer-row">
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
                <span className={`dsh-pill ${connected ? 'dsh-pill-ok' : ''}`}>
                  {connected
                    ? t(lang, '已连接', 'online')
                    : connError
                      ? t(lang, '连接失败', 'offline')
                      : t(lang, '未连接', 'not connected')}
                </span>
              </div>
              <p className="muted" style={{ marginTop: 10 }}>
                {t(
                  lang,
                  '服务由后台运维部署；顾客只需填地址（通常保持默认）。',
                  'The service is deployed by ops; usually keep the default.',
                )}
              </p>
            </div>
          )}

          {section === 'ui' && (
            <div className="settings-block">
              <div className="dsh-section">{t(lang, '术语语言', 'Terminology language')}</div>
              <div className="composer-row">
                {LANGS.map((l) => (
                  <button
                    key={l.v}
                    className={`btn ${normLang(settings?.termLang) === l.v ? 'btn-on' : ''}`}
                    onClick={() => onSave({ termLang: l.v })}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
