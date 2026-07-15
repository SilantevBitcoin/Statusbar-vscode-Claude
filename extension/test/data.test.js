const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxhud-data-'))
process.env.CLAUDE_PROJECTS_DIR = path.join(TMP, 'projects')
process.env.CLAUDE_SETTINGS_FILE = path.join(TMP, 'settings.json')
fs.mkdirSync(process.env.CLAUDE_PROJECTS_DIR, { recursive: true })

const { ctxWindow, normPath, belongs, munge, readUsage, readTitleHead, readSettings, listProjectSessions } = require('../data')

const J = (o) => JSON.stringify(o) + '\n'
const usageRec = (tokens, model, cwd) =>
  J({ cwd, message: { model, usage: { input_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } })

test('ctxWindow: fable→1M всегда; [1m] только для своей модели; иначе 200К', () => {
  assertEq(ctxWindow('claude-opus-4-8[1m]', 'claude-fable-5'), 1000000)
  assertEq(ctxWindow('claude-opus-4-8[1m]', 'claude-opus-4-8'), 1000000)
  assertEq(ctxWindow('claude-opus-4-8[1m]', 'claude-sonnet-5'), 200000)
  assertEq(ctxWindow('claude-opus-4-8', 'claude-opus-4-8'), 200000)
})

test('normPath/belongs/munge', () => {
  assertEq(normPath('D:/AI/Base/'), 'd:\\ai\\base')
  assertEq(belongs('d:\\AI\\personal\\sub', normPath('d:\\AI\\personal')), true)
  assertEq(belongs('d:\\AI\\personal-2', normPath('d:\\AI\\personal')), false)
  assertEq(munge('d:\\AI\\personal'), 'd--AI-personal')
})

test('readUsage: последний реальный usage, synthetic пропущен, lastPrompt из хвоста', () => {
  const fp = path.join(TMP, 's1.jsonl')
  fs.writeFileSync(
    fp,
    usageRec(100, 'claude-opus-4-8', 'd:\\p') +
      J({ type: 'last-prompt', lastPrompt: 'мой вопрос' }) +
      usageRec(200, 'claude-opus-4-8', 'd:\\p') +
      J({ cwd: 'd:\\p', message: { model: '<synthetic>', usage: { input_tokens: 0 } } }),
  )
  const r = readUsage(fp)
  assertEq(r.tokens, 200)
  assertEq(r.modelId, 'claude-opus-4-8')
  assertEq(r.lastPrompt, 'мой вопрос')
})

test('readTitleHead: последняя ai-title запись головы', () => {
  const fp = path.join(TMP, 's2.jsonl')
  fs.writeFileSync(fp, J({ type: 'ai-title', aiTitle: 'Старый' }) + J({ type: 'ai-title', aiTitle: 'Новый заголовок' }))
  assertEq(readTitleHead(fp), 'Новый заголовок')
})

test('readSettings: битый файл не затирает последнее валидное', () => {
  fs.writeFileSync(process.env.CLAUDE_SETTINGS_FILE, JSON.stringify({ model: 'claude-fable-5[1m]', effortLevel: 'max' }))
  assertEq(readSettings(), { model: 'claude-fable-5[1m]', effortLevel: 'max' })
  fs.writeFileSync(process.env.CLAUDE_SETTINGS_FILE, '')
  assertEq(readSettings(), { model: 'claude-fable-5[1m]', effortLevel: 'max' })
})

test('readUsage: новый чат (промпт есть, usage нет) → tokens=0, не null', () => {
  const fp = path.join(TMP, 's3.jsonl')
  fs.writeFileSync(fp, J({ type: 'last-prompt', lastPrompt: 'привет' }))
  const r = readUsage(fp)
  assertEq(r && r.tokens, 0)
  assertEq(r && r.lastPrompt, 'привет')
})

test('listProjectSessions: дрейф cwd не выкидывает сессию своей munge-папки', () => {
  const pdir = path.join(process.env.CLAUDE_PROJECTS_DIR, 'd--AI-proj2')
  fs.mkdirSync(pdir, { recursive: true })
  // cwd уехал в совсем другую папку (CC 2.1.209 пишет текущую bash-директорию)
  fs.writeFileSync(path.join(pdir, 'a.jsonl'), usageRec(30, 'claude-opus-4-8', 'c:\\somewhere\\else'))
  const ss = listProjectSessions('d:\\AI\\proj2')
  assertEq(ss.length, 1)
})

test('sessionByPath: сессия по прямому пути (без сканов папок)', () => {
  const { sessionByPath } = require('../data')
  const fp = path.join(TMP, 's4.jsonl')
  fs.writeFileSync(fp, usageRec(70, 'claude-fable-5', 'd:\\anywhere') + J({ type: 'last-prompt', lastPrompt: 'q' }))
  const s = sessionByPath(fp)
  assertEq(s.tokens, 70)
  assertEq(s.modelId, 'claude-fable-5')
  assertEq(sessionByPath(path.join(TMP, 'нет.jsonl')), null)
})

test('listProjectSessions: munge-папка, belongs-фильтр, сортировка по mtime', () => {
  const pdir = path.join(process.env.CLAUDE_PROJECTS_DIR, 'd--AI-proj')
  fs.mkdirSync(pdir, { recursive: true })
  fs.writeFileSync(path.join(pdir, 'a.jsonl'), usageRec(10, 'claude-opus-4-8', 'd:\\AI\\proj'))
  fs.writeFileSync(path.join(pdir, 'b.jsonl'), usageRec(20, 'claude-opus-4-8', 'd:\\AI\\proj\\sub'))
  const ss = listProjectSessions('d:\\AI\\proj')
  assertEq(ss.length, 2)
  assertEq(ss.map((s) => s.tokens).sort((a, b) => a - b), [10, 20])
})
