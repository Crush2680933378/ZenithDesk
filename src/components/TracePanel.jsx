import { useMemo, useState } from 'react'
import { normLang, t } from '../i18n.js'

/**
 * 轨迹（对齐 DSH ui-trajectory 的工具栏与结构）：
 * 工具栏 = 搜索 / 实际时间 / 轮次折叠 / 调用折叠；每轮一组，每组内是调用行。
 */
export default function TracePanel({ messages, lang: langProp }) {
  const lang = normLang(langProp)
  const [query, setQuery] = useState('')
  const [actual, setActual] = useState(true)
  const [turnsOpen, setTurnsOpen] = useState(true)
  const [callsOpen, setCallsOpen] = useState(true)

  // 一轮 = 用户消息 + 其后的助手回复
  const turns = useMemo(() => {
    const out = []
    let cur = null
    for (const m of messages) {
      if (m.role === 'user') {
        cur = { id: m.id, prompt: m.content || '', images: m.images || [], replies: [] }
        out.push(cur)
      } else if (cur) {
        cur.replies.push(m)
      }
    }
    return out
  }, [messages])

  const q = query.trim().toLowerCase()
  const visible = turns.filter(
    (tr) =>
      !q ||
      (tr.prompt || '').toLowerCase().includes(q) ||
      tr.replies.some((r) => (r.content || '').toLowerCase().includes(q)),
  )

  const totalCalls = visible.reduce((n, tr) => n + tr.replies.length, 0)

  if (turns.length === 0) {
    return (
      <div className="trace-empty muted">
        {t(lang, '本轮还没有可展示的轨迹。发一条消息后再看。', 'No trace yet — send a message first.')}
      </div>
    )
  }

  return (
    <div className="trace-wrap">
      <div className="trace-toolbar">
        <input
          className="ws-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, '搜索…', 'Search…')}
          aria-label={t(lang, '搜索轨迹', 'search trace')}
        />
        <button
          className={`trace-tool ${actual ? 'on' : ''}`}
          title={t(lang, '实际时间', 'actual time')}
          onClick={() => setActual((v) => !v)}
        >
          {t(lang, '实际时间', 'Duration')}
        </button>
        <button
          className={`trace-tool ${turnsOpen ? 'on' : ''}`}
          title={turnsOpen ? t(lang, '收起轮次', 'collapse turns') : t(lang, '展开轮次', 'expand turns')}
          onClick={() => setTurnsOpen((v) => !v)}
        >
          {t(lang, '轮次', 'Turns')} {visible.length}
        </button>
        <button
          className={`trace-tool ${callsOpen ? 'on' : ''}`}
          title={callsOpen ? t(lang, '收起调用', 'collapse calls') : t(lang, '展开调用', 'expand calls')}
          onClick={() => setCallsOpen((v) => !v)}
        >
          {t(lang, '调用', 'Calls')} {totalCalls}
        </button>
      </div>

      <div className="trace-list">
        {visible.length === 0 && (
          <div className="trace-empty muted">{t(lang, '无匹配结果', 'no matches')}</div>
        )}

        {visible.map((tr, ti) => (
          <div key={tr.id} className="trace-turn">
            <div className="trace-turn-head" onClick={() => setTurnsOpen((v) => !v)}>
              <span className="trace-idx">{String(ti + 1).padStart(2, '0')}</span>
              <span className="trace-turn-prompt">{tr.prompt || t(lang, '（空消息）', '(empty)')}</span>
              {tr.images?.length > 0 && (
                <span className="trace-badge">
                  {tr.images.length} {t(lang, '图', 'img')}
                </span>
              )}
            </div>

            {turnsOpen &&
              (callsOpen ? (
                tr.replies.map((r, ri) => (
                  <div key={r.id || ri} className="trace-row">
                    <span className="trace-idx">↳</span>
                    <span className="trace-model">{r.meta?.model || '—'}</span>
                    <span className="trace-sep">·</span>
                    <span>
                      {t(lang, '输入', 'in')} {r.meta?.prompt ?? '—'}
                    </span>
                    <span className="trace-sep">/</span>
                    <span>
                      {t(lang, '输出', 'out')} {r.meta?.completion ?? '—'}
                    </span>
                    {actual && r.meta?.elapsed ? (
                      <>
                        <span className="trace-sep">·</span>
                        <span>{(r.meta.elapsed / 1000).toFixed(2)} s</span>
                      </>
                    ) : null}
                    {r.meta?.tps ? (
                      <>
                        <span className="trace-sep">·</span>
                        <span>{Math.round(r.meta.tps)} tok/s</span>
                      </>
                    ) : null}
                    {r.meta?.finish ? (
                      <>
                        <span className="trace-sep">·</span>
                        <span className={r.meta.finish === 'length' ? 'trace-warn' : ''}>{r.meta.finish}</span>
                      </>
                    ) : null}
                    {r.reasoning ? (
                      <>
                        <span className="trace-sep">·</span>
                        <span className="trace-muted">
                          {t(lang, '思考', 'reasoning')} {r.reasoning.length} {t(lang, '字', 'chars')}
                        </span>
                      </>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="trace-collapsed">
                  {tr.replies.length} {t(lang, '次调用已折叠', 'calls collapsed')}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
