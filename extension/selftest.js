#!/usr/bin/env node
// Селф-тест на ЖИВЫХ данных: «CC обновился — что сломалось?» за 30 секунд без vscode.
// Использование: node extension/selftest.js [путь-workspace] (дефолт — текущая папка).
const { loadRegistry, candidatesFor, REG } = require('./registry')
const { resolve } = require('./resolve')
const { listProjectSessions } = require('./data')

const ws = process.argv[2] || process.cwd()
const registry = loadRegistry()
const sessions = listProjectSessions(ws)

let lastReg = 0
for (const s of registry.values()) lastReg = Math.max(lastReg, s.lastTs)
console.log('реестр:', REG)
console.log('  сессий в реестре:', registry.size, '| последняя запись:', lastReg ? new Date(lastReg).toISOString() : 'НЕТ (хук не писал!)')
console.log('workspace:', ws, '| сессий в скане проекта:', sessions.length)

// Симуляция вкладок: label = усечённый до 25 симв. последний кандидат каждой свежей
// сессии реестра (как VS Code усекает имя вкладки многоточием).
const entries = [...registry.values()].filter((s) => s.tp && s.lastPromptTs).sort((a, b) => b.lastPromptTs - a.lastPromptTs).slice(0, 5)
if (!entries.length) console.log('\n(в реестре нет сессий с промптами — хук ещё не установлен или молчит)')
for (const e of entries) {
  const cand = candidatesFor(e)[0] || ''
  const label = cand.length > 25 ? cand.slice(0, 25) + '…' : cand
  const r = resolve({ label, registry, sessions, tabCache: new Map(), ws })
  const ok = r.fp === e.tp ? 'ok ' : 'MISS'
  console.log(`${ok} via=${(r.via + '      ').slice(0, 11)} label=${JSON.stringify(label)}`)
}

console.log('\nсвежие сессии проекта (скан jsonl):')
for (const s of sessions.slice(0, 5))
  console.log(`  ...${s.fp.slice(-20)} tok=${s.tokens} aiTitle=${s.aiTitle ? 'да' : 'НЕТ'} lastPrompt=${s.lastPrompt ? 'да' : 'НЕТ'}`)
