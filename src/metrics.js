// Prometheus 文本 → 扁平 map（只取样本行，忽略 # TYPE/# HELP）
export function parseMetrics(text) {
  const out = {}
  if (!text) return out
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([a-zA-Z_:][\w:]*)\{?[^}]*\}?\s+(-?[\d.eE+]+)$/)
    if (m) out[m[1]] = Number(m[2])
  }
  return out
}

export function pick(metrics, name) {
  const v = metrics?.[name]
  return typeof v === 'number' ? v : null
}

export function fmtNum(v, digits = 0) {
  if (v === null || v === undefined) return '—'
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1) + 'k'
  return v.toFixed(digits)
}

export function fmtMs(v) {
  if (v === null || v === undefined || v <= 0) return '—'
  return v >= 1000 ? (v / 1000).toFixed(2) + ' s' : Math.round(v) + ' ms'
}
