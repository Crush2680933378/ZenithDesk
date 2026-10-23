import { normLang, t } from '../i18n.js'

/** 插件：顾客侧只看到"装了哪些能力、开没开"，不涉及模型参数 */
export default function PluginsPage({ plugins, onToggle, lang: langProp }) {
  const lang = normLang(langProp)
  return (
    <div className="page">
      <div className="page-head">
        <h2>{t(lang, '插件', 'Plugins')}</h2>
        <span className="page-sub">
          {t(lang, `${plugins.filter((p) => p.enabled).length} 个已启用`, `${plugins.filter((p) => p.enabled).length} enabled`)}
        </span>
      </div>

      <div className="page-list">
        {plugins.map((p) => (
          <div key={p.id} className="card">
            <div className="card-main">
              <div className="card-title">
                {p.name}
                <span className="card-ver">v{p.version}</span>
              </div>
              <div className="card-desc">{p.desc}</div>
            </div>
            <button
              className={`switch-pill ${p.enabled ? 'on' : ''}`}
              onClick={() => onToggle(p.id, !p.enabled)}
              title={p.enabled ? t(lang, '点击停用', 'disable') : t(lang, '点击启用', 'enable')}
            >
              {p.enabled ? t(lang, '已启用', 'on') : t(lang, '已停用', 'off')}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
