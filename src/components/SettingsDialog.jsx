import { useState } from 'react'
import { LANGS, normLang, t } from '../i18n.js'
import ModelView from './ModelView.jsx'

/**
 * 设置：把"服务端/引擎"这类东西全收进来，主界面只留聊天。
 * 顾客视角看不到这些；运维/调试时点齿轮进来。
 */
export default function SettingsDialog({ settings, onSave, onClose, onStarted, connected, connError }) {
  const lang = normLang(settings?.termLang)
  const [urlDraft, setUrlDraft] = useState(settings?.baseUrl || '')
  const [section, setSection] = useState('engine') // engine | connection | ui

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <span className="modal-title">{t(lang, '设置', 'Settings')}</span>
          <div className="modal-tabs">
            <button
              className={`dsh-tab ${section === 'engine' ? 'active' : ''}`}
              onClick={() => setSection('engine')}
            >
              {t(lang, '引擎', 'Engine')}
            </button>
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
          {section === 'engine' && (
            <ModelView settings={settings} onSave={onSave} onStarted={onStarted} />
          )}

          {section === 'connection' && (
            <div className="settings-block">
              <div className="dsh-section">{t(lang, '网关地址', 'Gateway URL')}</div>
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
                  {t(lang, '连接', 'Connect')}
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
                  '顾客界面不显示这些；只有需要换后端时才进来。',
                  'Customers never see this — only for switching backends.',
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
                    className={`btn ${normLang(settings?.termLang) === l.v ? 'btn-primary btn-on' : ''}`}
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
