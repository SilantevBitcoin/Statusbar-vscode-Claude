// Чистые форматтеры (без vscode/I/O) — тестируются в обычном node.
// Источник полей — формат statusLine Claude Code: context_window / model / effort / rate_limits.

function fmtK(n) {
  return Math.round((Number(n) || 0) / 1000) + 'k'
}

// claude-opus-4-8 → "Opus 4.8"; иначе берём display_name как есть.
function modelName(model) {
  const id = (model && model.id) || ''
  const disp = (model && model.display_name) || ''
  const m = id.match(/(opus|sonnet|haiku)-(\d+)-(\d+)/i)
  if (m) return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + '.' + m[3]
  return disp || id || '?'
}

// effort.level: low/medium/high/xhigh/max. ultracode (xhigh+workflows) из файлов НЕ отличим
// от обычного xhigh — флаг приходит вторым аргументом из ручной настройки claudeCtxHud.ultracode.
function effortAbbr(effort, ultracode) {
  const lvl = effort && effort.level
  switch (lvl) {
    case 'low': return 'L'
    case 'medium': return 'MD'
    case 'high': return 'H'
    case 'xhigh': return ultracode ? 'EH+W' : 'EH'
    case 'max': return 'MAX'
    default: return lvl ? String(lvl).toUpperCase() : ''
  }
}

// unix epoch seconds → "2h12" или "45m"
function timeLeft(resetsAt) {
  if (!resetsAt) return ''
  const diff = Number(resetsAt) - Math.floor(Date.now() / 1000)
  if (diff <= 0) return '0m'
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  return h > 0 ? h + 'h' + String(m).padStart(2, '0') : m + 'm'
}

// Распарсенный statusLine-JSON (+ флаг ultracode из настройки) → строка индикатора.
function buildLine(d, ultracode) {
  d = d || {}
  const cw = d.context_window || {}
  const rl = d.rate_limits || {}
  const fh = rl.five_hour || {}
  const sd = rl.seven_day || {}

  const parts = [
    fmtK(cw.total_input_tokens) + ' ' + Math.round(cw.used_percentage || 0) + '%',
    modelName(d.model),
    effortAbbr(d.effort, ultracode),
  ]
  // Workflow/Task-активность: ⚙N свежих суб-агентов (N≥2 — параллельная оркестрация).
  const sub = Number(d.subagents) || 0
  if (sub > 0) parts.push('⚙' + sub)
  if (fh.used_percentage != null) {
    const reset = timeLeft(fh.resets_at)
    parts.push('5h ' + Math.round(fh.used_percentage) + '%' + (reset ? ' ' + reset : ''))
  }
  if (sd.used_percentage != null) {
    parts.push('7d ' + Math.round(sd.used_percentage) + '%')
  }
  return parts.filter(Boolean).join(' | ')
}

module.exports = { fmtK, modelName, effortAbbr, timeLeft, buildLine }
