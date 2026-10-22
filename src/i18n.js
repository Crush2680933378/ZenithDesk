// ============================================================================
//  术语语言：三态
//    zh   —— 中文为主，英文旗标作小字副标
//    en   —— 英文旗标为主，中文退到 tooltip
//    both —— 中英并排显示（"上下文 · --ctx"）
// ============================================================================

export const LANGS = [
  { v: 'zh', label: '中文' },
  { v: 'en', label: 'EN' },
  { v: 'both', label: '中+EN' },
]

export function normLang(v) {
  return v === 'en' || v === 'both' ? v : 'zh'
}

/// 循环切换：中文 → 英文 → 并排 → 中文
export function nextLang(v) {
  const cur = normLang(v)
  return cur === 'zh' ? 'en' : cur === 'en' ? 'both' : 'zh'
}

/// 单行文案：zh 中文 / en 英文 / both 并排
export function t(lang, zh, en) {
  if (lang === 'en') return en
  if (lang === 'both') return `${zh} · ${en}`
  return zh
}

/// 主/副两段式（用于参数行、指标卡）：
///   zh  → { main: 中文, sub: 英文旗标 }
///   en  → { main: 英文旗标, sub: '' }
///   both→ { main: "中文 · 英文旗标", sub: '' }
export function labelPair(lang, zh, en) {
  if (lang === 'en') return { main: en || zh, sub: '' }
  if (lang === 'both') return { main: en ? `${zh} · ${en}` : zh, sub: '' }
  return { main: zh, sub: en || '' }
}
