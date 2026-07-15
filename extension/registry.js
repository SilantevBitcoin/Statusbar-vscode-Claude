// Чтение hook-реестра (~/.claude/ctx-hud/registry.jsonl — пишет hook.js): официальный
// мост вкладка↔сессия. Без vscode — тестируется в голом node.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { normPath, belongs } = require('./data')

const REG = path.join(process.env.CTX_HUD_DIR || path.join(os.homedir(), '.claude', 'ctx-hud'), 'registry.jsonl')
const PROMPTS_KEEP = 8 // кандидатов имени вкладки больше не нужно

// Кэш по (файл, mtime): реестр читается каждый тик (5с), но меняется только на промптах.
let _cache = { fp: '', mtime: -1, map: new Map() }
function loadRegistry(file) {
  const fp = file || REG
  let mtime
  try { mtime = fs.statSync(fp).mtimeMs } catch (_) { return new Map() }
  if (_cache.fp === fp && _cache.mtime === mtime) return _cache.map
  const map = new Map()
  let txt
  try { txt = fs.readFileSync(fp, 'utf8') } catch (_) { return new Map() }
  for (const ln of txt.split('\n')) {
    if (!ln) continue
    let r
    try { r = JSON.parse(ln) } catch (_) { continue } // битая строка (гонка append) — пропуск
    if (!r || !r.sid) continue
    let s = map.get(r.sid)
    if (!s) { s = { sid: r.sid, tp: '', cwd: '', title: null, model: null, prompts: [], lastPromptTs: 0, lastTs: 0 }; map.set(r.sid, s) }
    if (r.tp) s.tp = r.tp
    // cwd — из ПЕРВОЙ записи сессии (стартовый; runtime-cwd в промптах дрейфует за bash)
    if (r.cwd && !s.cwd) s.cwd = r.cwd
    s.lastTs = Math.max(s.lastTs, r.ts || 0)
    if (r.ev === 'start') {
      if (r.title) s.title = r.title
      if (r.model) s.model = r.model
    } else if (r.ev === 'prompt' && r.prompt) {
      s.prompts.push(r.prompt)
      if (s.prompts.length > PROMPTS_KEEP) s.prompts.shift()
      s.lastPromptTs = Math.max(s.lastPromptTs, r.ts || 0)
    }
  }
  _cache = { fp, mtime, map }
  return map
}

// Кандидаты имени вкладки: title (официальный заголовок) первым, затем промпты
// от свежего к старому (имя вкладки CC 2.1.206+ = последний промпт пользователя).
function candidatesFor(entry) {
  const out = []
  if (entry.title) out.push(entry.title)
  for (let i = entry.prompts.length - 1; i >= 0; i--) out.push(entry.prompts[i])
  return out
}

// Сессия последнего промпта ПОЛЬЗОВАТЕЛЯ в проекте — фолбэк точнее mtime-свежайшей
// (mtime растёт и от фоновых агентов/автокомпакций, а промпт — только от человека).
function latestForProject(map, ws) {
  const want = normPath(ws)
  if (!want) return null
  let best = null
  for (const s of map.values()) {
    if (!s.tp || !s.lastPromptTs) continue
    if (!belongs(s.cwd, want)) continue
    if (!best || s.lastPromptTs > best.lastPromptTs) best = s
  }
  return best
}

module.exports = { loadRegistry, candidatesFor, latestForProject, REG }
