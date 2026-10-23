import { normLang, t } from '../i18n.js'

/** 轨迹：把本次会话每一步的模型侧信息列出来（对应 DSH 的「轨迹」页签） */
export default function TracePanel({ messages, lang: langProp }) {
  const lang = normLang(langProp)
  const steps = messages.filter((m) => m.role === 'assistant' && m.meta)

  if (steps.length === 0) {
    return (
      <div className="trace-empty muted">
        {t(lang, '本轮还没有可展示的轨迹。发一条消息后再看。', 'No trace yet — send a message first.')}
      </div>
    )
  }

  return (
    <div className="trace">
      {steps.map((m, i) => (
        <div key={m.id || i} className="trace-row">
          <span className="trace-idx">{String(i + 1).padStart(2, '0')}</span>
          <span className="trace-model">{m.meta.model || '—'}</span>
          <span className="trace-sep">·</span>
          <span>
            {t(lang, '输入', 'in')} {m.meta.prompt}
          </span>
          <span className="trace-sep">/</span>
          <span>
            {t(lang, '输出', 'out')} {m.meta.completion}
          </span>
          {m.meta.elapsed ? (
            <>
              <span className="trace-sep">·</span>
              <span>{(m.meta.elapsed / 1000).toFixed(2)} s</span>
            </>
          ) : null}
          {m.meta.finish ? (
            <>
              <span className="trace-sep">·</span>
              <span className={m.meta.finish === 'length' ? 'trace-warn' : ''}>{m.meta.finish}</span>
            </>
          ) : null}
          {m.reasoning ? (
            <>
              <span className="trace-sep">·</span>
              <span className="trace-muted">
                {t(lang, '思考', 'reasoning')} {m.reasoning.length} {t(lang, '字', 'chars')}
              </span>
            </>
          ) : null}
        </div>
      ))}
    </div>
  )
}
