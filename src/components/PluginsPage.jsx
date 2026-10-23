import { normLang, t } from '../i18n.js'

/**
 * 插件库存（对齐 DSH 的 ui-settings-plugin-inventory 布局）：
 * 按分组列出，每行显示 名称 / 版本 / 来源 / 状态开关。
 */
export default function PluginsPage({ plugins, onToggle, lang: langProp }) {
  const lang = normLang(langProp)

  const groups = [
    { key: 'infer', name: t(lang, '推理', 'Inference') },
    { key: 'media', name: t(lang, '媒体', 'Media') },
    { key: 'edge', name: t(lang, '边缘设备', 'Edge') },
  ]

  const enabledCount = plugins.filter((p) => p.enabled).length

  return (
    <div className="page">
      <div className="page-head">
        <h2>{t(lang, '插件', 'Plugins')}</h2>
        <span className="page-sub">
          {t(lang, `${enabledCount} / ${plugins.length} 已启用`, `${enabledCount} / ${plugins.length} enabled`)}
        </span>
      </div>

      {groups.map((g) => {
        const items = plugins.filter((p) => (p.group || 'infer') === g.key)
        if (items.length === 0) return null
        return (
          <div className="inv-group" key={g.key}>
            <div className="dsh-section">{g.name}</div>
            {items.map((p) => (
              <div key={p.id} className="inv-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="inv-name">{p.name}</div>
                  <div className="inv-meta">
                    v{p.version} · {p.source || t(lang, '内置', 'built-in')}
                    {p.desc ? ` · ${p.desc}` : ''}
                  </div>
                </div>
                <span className="inv-tag">{p.id}</span>
                <button
                  className={`switch-pill ${p.enabled ? 'on' : ''}`}
                  onClick={() => onToggle(p.id, !p.enabled)}
                >
                  {p.enabled ? t(lang, '已启用', 'on') : t(lang, '已停用', 'off')}
                </button>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
