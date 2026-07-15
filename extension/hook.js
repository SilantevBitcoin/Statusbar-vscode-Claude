#!/usr/bin/env node
// Хук-логгер Claude Context HUD: на SessionStart и UserPromptSubmit (async:true в
// settings.json) дописывает строку реестра в ~/.claude/ctx-hud/registry.jsonl.
// Реестр — ОФИЦИАЛЬНЫЙ мост вкладка↔сессия (session_id/transcript_path/промпты/title
// приходят из документированного hooks-контракта, а не из реверс-инжиниринга jsonl).
// ЖЕЛЕЗНОЕ ПРАВИЛО: хук никогда не мешает Claude — все ошибки глотаются, exit 0 всегда.
const fs = require('fs')
const os = require('os')
const path = require('path')

const DIR = process.env.CTX_HUD_DIR || path.join(os.homedir(), '.claude', 'ctx-hud')
const REG = path.join(DIR, 'registry.jsonl')
const MAX_BYTES = 524288 // дальше ротация: хвоста в 300 строк хватает всем живым вкладкам
const KEEP_LINES = 300
const PROMPT_MAX = 200 // для матча имени вкладки (~25 симв.) хватает; лишнего не храним

// Переписать реестр хвостом через tmp+rename (атомарно — не повторяем судьбу
// нулевого settings.json, который CC переписывает truncate'ом).
function rotateIfBig() {
  try {
    if (fs.statSync(REG).size <= MAX_BYTES) return
    const lines = fs.readFileSync(REG, 'utf8').split('\n').filter(Boolean)
    const tmp = REG + '.tmp'
    fs.writeFileSync(tmp, lines.slice(-KEEP_LINES).join('\n') + '\n')
    fs.renameSync(tmp, REG)
  } catch (_) {}
}

function main(raw) {
  let e
  try { e = JSON.parse(raw) } catch (_) { return }
  if (!e || !e.session_id) return
  const base = { ts: Date.now(), sid: e.session_id, tp: e.transcript_path || '', cwd: e.cwd || '' }
  let rec = null
  if (e.hook_event_name === 'UserPromptSubmit') {
    // дока называет поле prompt_text; берём и prompt на случай переименования
    const p = String(e.prompt_text || e.prompt || '').slice(0, PROMPT_MAX)
    rec = { ...base, ev: 'prompt', prompt: p }
  } else if (e.hook_event_name === 'SessionStart') {
    rec = { ...base, ev: 'start', title: e.session_title || null, model: e.model || null, source: e.source || '' }
  }
  if (!rec) return
  try {
    fs.mkdirSync(DIR, { recursive: true })
    fs.appendFileSync(REG, JSON.stringify(rec) + '\n') // O_APPEND: строки <1КБ — практически атомарно
    rotateIfBig()
  } catch (_) {}
}

let input = ''
process.stdin.on('data', (c) => (input += c))
process.stdin.on('end', () => {
  try { main(input) } catch (_) {}
  process.exit(0)
})
