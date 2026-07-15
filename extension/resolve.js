// Привязка активной вкладки-чата к сессии: единая 5-ступенчатая цепочка (см. спеку
// docs/superpowers/specs/2026-07-16-hook-registry-design.md). Чистая функция без
// vscode/fs — тестируется в голом node. via говорит UI, насколько привязке верить:
// REG/JSONL/CACHED — уверенная; LAST-ACTIVE/MRU — фолбэк (маркер ≈); new-tab/none — '—'.
const { candidatesFor, latestForProject } = require('./registry')

// Имя вкладки схлопывает повторные пробелы и усечено многоточием — нормализуем так же.
const normLabel = (x) => String(x || '').replace(/\s+/g, ' ').trim()

// exact → prefix (label усечён '…') матч против списка кандидатов имени.
function labelMatches(label, cands) {
  const nl = normLabel(label)
  if (!nl) return false
  for (const c of cands) if (c && normLabel(c) === nl) return true
  const pref = normLabel(String(label).replace(/[…\s]+$/, ''))
  if (pref && pref !== nl) {
    for (const c of cands) if (c && normLabel(c).startsWith(pref)) return true
  }
  return false
}

function resolve({ label, registry, sessions, tabCache, ws }) {
  const nl = normLabel(label)
  // Дефолтное имя новой вкладки: сессии ещё нет — честное '—' вместо чужой свежайшей.
  if (nl === 'Claude Code') return { fp: null, via: 'new-tab' }

  if (nl) {
    // 1) REG — официальные кандидаты (title из SessionStart, промпты из UserPromptSubmit).
    // От свежей активности к старой: при коллизии одинаковых имён побеждает свежайшая.
    if (registry && registry.size) {
      const entries = [...registry.values()].filter((s) => s.tp).sort((a, b) => b.lastTs - a.lastTs)
      for (const s of entries) if (labelMatches(label, candidatesFor(s))) return { fp: s.tp, via: 'REG' }
    }
    // 2) JSONL — кандидаты из транскриптов (aiTitle/lastPrompt), как в 0.1.x.
    for (const s of sessions) if (labelMatches(label, [s.aiTitle, s.lastPrompt])) return { fp: s.fp, via: 'JSONL' }
    // 3) CACHED — вкладку уже успешно привязывали; держим, пока сессия жива
    // (переживает рассинхрон имени вкладки и lastPrompt в момент нового сообщения).
    if (tabCache) {
      const fp = tabCache.get(nl)
      if (fp && sessions.some((s) => s.fp === fp)) return { fp, via: 'CACHED' }
    }
  }
  // 4) LAST-ACTIVE — сессия последнего промпта пользователя в проекте (из реестра).
  if (registry && ws) {
    const s = latestForProject(registry, ws)
    if (s) return { fp: s.tp, via: 'LAST-ACTIVE' }
  }
  // 5) MRU — свежайшая по mtime (как раньше). Дальше только '—'.
  if (sessions && sessions[0]) return { fp: sessions[0].fp, via: 'MRU' }
  return { fp: null, via: 'none' }
}

module.exports = { resolve, normLabel, labelMatches }
