import { fmtMs, fmtNum, pick } from '../metrics.js'
import { normLang, t } from '../i18n.js'

function Row({ label, code, value, mono = true, lang }) {
  return (
    <div className="row">
      <span className="row-label" title={code || ''}>
        {t(lang, label, code || label)}
      </span>
      <span className={mono ? 'row-value mono' : 'row-value'}>{value}</span>
    </div>
  )
}

export default function StatusPanel({ status, metrics, models, connected, lang: langProp }) {
  const lang = normLang(langProp)
  const engine = status?.engine
  const decode = pick(metrics, 'zenith_ai_decode_tps')
  const prefill = pick(metrics, 'zenith_ai_prefill_tps')

  return (
    <div className="panel">
      <div className="panel-title">
        {t(lang, '引擎状态', 'engine status')}
        <span className={`dot ${connected ? 'dot-ok' : 'dot-bad'}`} />
      </div>

      <Row lang={lang} label="后端" code="backend" value={status?.backend ?? '—'} mono={false} />
      <Row
        lang={lang}
        label="模型"
        code="model"
        value={status?.models?.length ? status.models.join(', ') : '—'}
        mono={false}
      />
      <Row
        lang={lang}
        label="引擎"
        code="engine"
        value={
          engine?.supervised
            ? engine.running
              ? `${t(lang, '托管进程', 'supervised')} · pid ${engine.pid || '-'}`
              : t(lang, '未运行', 'stopped')
            : engine?.running
              ? t(lang, '进程内', 'in-process')
              : t(lang, '无（网关内嵌）', 'embedded')
        }
        mono={false}
      />

      <div className="panel-sub">{t(lang, '吞吐（最近一次）', 'throughput (last)')}</div>
      <Row lang={lang} label="预填" code="prefill tps" value={prefill ? fmtNum(prefill) + ' tok/s' : '—'} />
      <Row lang={lang} label="解码" code="decode tps" value={decode ? fmtNum(decode) + ' tok/s' : '—'} />
      <Row lang={lang} label="首 token" code="ttft" value={fmtMs(pick(metrics, 'zenith_ai_ttft_ms'))} />

      <div className="panel-sub">{t(lang, '累计', 'totals')}</div>
      <Row lang={lang} label="请求数" code="requests" value={fmtNum(pick(metrics, 'zenith_ai_requests_total'))} />
      <Row
        lang={lang}
        label="输入 token"
        code="prompt tokens"
        value={fmtNum(pick(metrics, 'zenith_ai_prompt_tokens_total'))}
      />
      <Row
        lang={lang}
        label="输出 token"
        code="completion tokens"
        value={fmtNum(pick(metrics, 'zenith_ai_completion_tokens_total'))}
      />
      <Row
        lang={lang}
        label="投机接受"
        code="draft accept"
        value={
          engine?.draft_total
            ? `${engine.draft_accepted}/${engine.draft_total}（${Math.round(
                (engine.draft_accepted / engine.draft_total) * 100,
              )}%）`
            : '—'
        }
      />

      <div className="panel-sub">HTTP</div>
      <Row lang={lang} label="总请求" code="requests" value={fmtNum(pick(metrics, 'zenith_http_requests_total'))} />
      <Row lang={lang} label="错误" code="errors" value={fmtNum(pick(metrics, 'zenith_http_errors_total'))} />

      <div className="models">
        <div className="panel-sub">{t(lang, '可用模型', 'models')}</div>
        {models.length === 0 && (
          <div className="muted">{t(lang, '未连接或没有模型', 'not connected / no models')}</div>
        )}
        {models.map((m) => (
          <div key={m.id} className="model-chip" title={m.zenith_meta?.backend || ''}>
            {m.id}
          </div>
        ))}
      </div>
    </div>
  )
}
