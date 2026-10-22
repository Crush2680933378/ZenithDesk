import { fmtMs, fmtNum, pick } from '../metrics.js'

function Row({ label, value, mono = true, hint }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className={mono ? 'row-value mono' : 'row-value'} title={hint || ''}>
        {value}
      </span>
    </div>
  )
}

export default function StatusPanel({ status, metrics, models, connected }) {
  const engine = status?.engine
  const decode = pick(metrics, 'zenith_ai_decode_tps')
  const prefill = pick(metrics, 'zenith_ai_prefill_tps')

  return (
    <div className="panel">
      <div className="panel-title">
        引擎状态
        <span className={`dot ${connected ? 'dot-ok' : 'dot-bad'}`} />
      </div>

      <Row label="后端" value={status?.backend ?? '—'} mono={false} />
      <Row
        label="模型"
        value={status?.models?.length ? status.models.join(', ') : '—'}
        mono={false}
      />
      <Row
        label="引擎"
        value={
          engine?.supervised
            ? engine.running
              ? `进程内/托管 · pid ${engine.pid || '-'}`
              : '未运行'
            : engine?.running
              ? '进程内'
              : '无（网关内嵌）'
        }
        mono={false}
      />

      <div className="panel-sub">吞吐（最近一次）</div>
      <Row label="预填" value={prefill ? fmtNum(prefill) + ' tok/s' : '—'} />
      <Row label="解码" value={decode ? fmtNum(decode) + ' tok/s' : '—'} />
      <Row label="TTFT" value={fmtMs(pick(metrics, 'zenith_ai_ttft_ms'))} />

      <div className="panel-sub">累计</div>
      <Row label="请求数" value={fmtNum(pick(metrics, 'zenith_ai_requests_total'))} />
      <Row label="输入 token" value={fmtNum(pick(metrics, 'zenith_ai_prompt_tokens_total'))} />
      <Row label="输出 token" value={fmtNum(pick(metrics, 'zenith_ai_completion_tokens_total'))} />
      <Row
        label="投机接受"
        value={
          engine?.draft_total
            ? `${engine.draft_accepted}/${engine.draft_total}（${Math.round(
                (engine.draft_accepted / engine.draft_total) * 100,
              )}%）`
            : '—'
        }
      />

      <div className="panel-sub">HTTP</div>
      <Row label="总请求" value={fmtNum(pick(metrics, 'zenith_http_requests_total'))} />
      <Row label="错误" value={fmtNum(pick(metrics, 'zenith_http_errors_total'))} />

      <div className="models">
        <div className="panel-sub">可用模型</div>
        {models.length === 0 && <div className="muted">未连接或没有模型</div>}
        {models.map((m) => (
          <div key={m.id} className="model-chip" title={m.zenith_meta?.backend || ''}>
            {m.id}
          </div>
        ))}
      </div>
    </div>
  )
}
