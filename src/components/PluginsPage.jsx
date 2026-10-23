import { normLang, t } from '../i18n.js'

/** 插件名 → 分组 */
function groupOf(id) {
  if (/ffmpeg|media|video|audio/i.test(id)) return 'media'
  if (/esp32|edge|device|rk3/i.test(id)) return 'edge'
  return 'infer'
}

/** 插件名 → 展示名（后端给的是 id，界面上给个人话名字） */
const PRETTY = {
  ai_inference: ['AI 推理网关', 'AI inference gateway'],
  ai_llama: ['llama.cpp 引擎', 'llama.cpp engine'],
  ai_ninfer: ['NInfer 引擎（子进程）', 'NInfer engine (subprocess)'],
  ai_ninfer_native: ['NInfer 引擎（进程内）', 'NInfer engine (in-process)'],
  ai_comfyui: ['ComfyUI 绘画', 'ComfyUI image'],
  media_ffmpeg: ['媒体处理', 'Media pipeline'],
  edge_esp32: ['边缘设备桥', 'Edge device bridge'],
}

/**
 * 插件库存（对齐 DSH 的 ui-settings-plugin-inventory）：
 * 数据来自网关 /zenith/plugins（真实已加载插件），启停开关存在本地 ui-state。
 */
export default function PluginsPage({ inventory, localPlugins, onToggle, connected, lang: langProp }) {
  const lang = normLang(langProp)

  // 后端清单为准；本地清单作为离线/未加载时的补充
  const byId = new Map()
  for (const p of localPlugins || []) byId.set(p.id, { ...p, source: 'local' })
  for (const p of inventory || []) {
    const prev = byId.get(p.name) || {}
    byId.set(p.name, {
      id: p.name,
      name: (PRETTY[p.name] || [p.name, p.name])[lang === 'en' ? 1 : 0],
      version: p.version || '—',
      desc: p.description || '',
      author: p.author || '',
      path: p.path || '',
      source: 'backend',
      group: groupOf(p.name),
      enabled: prev.enabled !== undefined ? prev.enabled : true,
    })
  }
  const plugins = [...byId.values()]

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
          {connected && inventory?.length
            ? ` · ${t(lang, '来自网关', 'from gateway')}`
            : ` · ${t(lang, '离线清单', 'offline list')}`}
        </span>
      </div>

      {groups.map((g) => {
        const items = plugins.filter((p) => (p.group || groupOf(p.id)) === g.key)
        if (items.length === 0) return null
        return (
          <div className="inv-group" key={g.key}>
            <div className="dsh-section">{g.name}</div>
            {items.map((p) => (
              <div key={p.id} className="inv-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="inv-name">
                    {p.name}
                    {p.source === 'backend' && (
                      <span className="inv-dot" title={t(lang, '来自网关', 'from gateway')} />
                    )}
                  </div>
                  <div className="inv-meta">
                    v{p.version}
                    {p.desc ? ` · ${p.desc}` : ''}
                    {p.author ? ` · ${p.author}` : ''}
                  </div>
                </div>
                <span className="inv-tag" title={p.path || ''}>
                  {p.id}
                </span>
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
