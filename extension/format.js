// Чистые форматтеры (без vscode/I/O) — тестируются в обычном node.
// Источник полей — формат statusLine Claude Code: context_window / model / effort / rate_limits.

function fmtK(n) {
  return Math.round((Number(n) || 0) / 1000) + 'k'
}

// claude-opus-4-8 → "Opus 4.8"; claude-fable-5 → "Fable 5" (минор опционален);
// иначе берём display_name как есть.
function modelName(model) {
  const id = (model && model.id) || ''
  const disp = (model && model.display_name) || ''
  const m = id.match(/(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/i)
  if (m) return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '')
  return disp || id || '?'
}

// effort.level: low/medium/high/xhigh/max → L/MD/H/EH/MAX.
function effortAbbr(effort) {
  const lvl = effort && effort.level
  switch (lvl) {
    case 'low': return 'L'
    case 'medium': return 'MD'
    case 'high': return 'H'
    case 'xhigh': return 'EH'
    case 'max': return 'MAX'
    default: return lvl ? String(lvl).toUpperCase() : ''
  }
}

// unix epoch seconds → "5d3h" (для 7d) / "2h12" / "45m". Дни — когда до сброса > суток.
function timeLeft(resetsAt) {
  if (!resetsAt) return ''
  const diff = Number(resetsAt) - Math.floor(Date.now() / 1000)
  if (diff <= 0) return '0m'
  const d = Math.floor(diff / 86400)
  const h = Math.floor((diff % 86400) / 3600)
  const m = Math.floor((diff % 3600) / 60)
  if (d > 0) return d + 'd' + (h > 0 ? h + 'h' : '')
  return h > 0 ? h + 'h' + String(m).padStart(2, '0') : m + 'm'
}

// Распарсенный statusLine-JSON → строка индикатора. opts (из настроек расширения):
// { showLimits, showWorkflow } — оба по умолчанию true (поведение как без opts).
function buildLine(d, opts) {
  d = d || {}
  opts = opts || {}
  const showLimits = opts.showLimits !== false
  const showWorkflow = opts.showWorkflow !== false
  const cw = d.context_window || {}
  const rl = d.rate_limits || {}
  const fh = rl.five_hour || {}
  const sd = rl.seven_day || {}

  const parts = [
    fmtK(cw.total_input_tokens) + ' ' + Math.round(cw.used_percentage || 0) + '%',
    modelName(d.model),
    effortAbbr(d.effort),
  ]
  // Workflow/Task-активность: ⚙N свежих суб-агентов (N≥2 — параллельная оркестрация).
  const sub = Number(d.subagents) || 0
  if (showWorkflow && sub > 0) parts.push('⚙' + sub)
  if (showLimits && fh.used_percentage != null) {
    const reset = timeLeft(fh.resets_at)
    parts.push('5h ' + Math.round(fh.used_percentage) + '%' + (reset ? ' ' + reset : ''))
  }
  if (showLimits && sd.used_percentage != null) {
    const reset = timeLeft(sd.resets_at)
    parts.push('7d ' + Math.round(sd.used_percentage) + '%' + (reset ? ' ' + reset : ''))
  }
  return parts.filter(Boolean).join(' | ')
}

module.exports = { fmtK, modelName, effortAbbr, timeLeft, buildLine }
