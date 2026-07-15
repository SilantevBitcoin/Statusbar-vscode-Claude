const { resolve, normLabel } = require('../resolve')

// Мини-реестр как Map — формат loadRegistry
const regEntry = (sid, tp, cwd, title, prompts, ts) => [sid, { sid, tp, cwd, title, model: null, prompts, lastPromptTs: ts, lastTs: ts }]
const REG1 = new Map([
  regEntry('A', 'tA.jsonl', 'd:\\AI\\p', 'Изучить статусбар и починить', ['первый', 'изучи статус бар, он ломается'], 100),
  regEntry('B', 'tB.jsonl', 'd:\\AI\\p', null, ['совсем другой промпт'], 50),
])
const SESSIONS = [
  { fp: 's1.jsonl', aiTitle: 'Старая сессия про глаза', lastPrompt: 'глаза доделай' },
  { fp: 's2.jsonl', aiTitle: null, lastPrompt: 'привет' },
]

test('REG: точный матч промпта из реестра', () => {
  const r = resolve({ label: 'изучи статус бар, он ломается', registry: REG1, sessions: SESSIONS, tabCache: new Map(), ws: 'd:\\AI\\p' })
  assertEq(r, { fp: 'tA.jsonl', via: 'REG' })
})

test('REG: префиксный матч усечённого label по title', () => {
  const r = resolve({ label: 'Изучить статусбар и по…', registry: REG1, sessions: SESSIONS, tabCache: new Map(), ws: 'd:\\AI\\p' })
  assertEq(r, { fp: 'tA.jsonl', via: 'REG' })
})

test('REG: нормализация пробелов (двойной пробел в промпте, одинарный на вкладке)', () => {
  const reg = new Map([regEntry('C', 'tC.jsonl', 'd:\\p', null, ['у нас  есть проект'], 10)])
  const r = resolve({ label: 'у нас есть проект', registry: reg, sessions: [], tabCache: new Map(), ws: 'd:\\p' })
  assertEq(r, { fp: 'tC.jsonl', via: 'REG' })
})

test('JSONL: реестр не знает — матч по aiTitle транскрипта', () => {
  const r = resolve({ label: 'Старая сессия про глаза', registry: new Map(), sessions: SESSIONS, tabCache: new Map(), ws: 'd:\\AI\\p' })
  assertEq(r, { fp: 's1.jsonl', via: 'JSONL' })
})

test('CACHED: матч слетел, но вкладку раньше привязывали и сессия жива', () => {
  const cache = new Map([[normLabel('переименованная вкладка'), 's2.jsonl']])
  const r = resolve({ label: 'переименованная вкладка', registry: new Map(), sessions: SESSIONS, tabCache: cache, ws: 'd:\\AI\\p' })
  assertEq(r, { fp: 's2.jsonl', via: 'CACHED' })
})

test('LAST-ACTIVE: ничего не сматчилось → сессия последнего промпта проекта', () => {
  const r = resolve({ label: 'вообще неизвестное имя', registry: REG1, sessions: SESSIONS, tabCache: new Map(), ws: 'd:\\AI\\p' })
  assertEq(r, { fp: 'tA.jsonl', via: 'LAST-ACTIVE' })
})

test('MRU: реестра нет → свежайшая по mtime', () => {
  const r = resolve({ label: 'неизвестное', registry: new Map(), sessions: SESSIONS, tabCache: new Map(), ws: 'd:\\AI\\p' })
  assertEq(r, { fp: 's1.jsonl', via: 'MRU' })
})

test('new-tab: дефолтное имя новой вкладки → честное «нет сессии»', () => {
  const r = resolve({ label: 'Claude Code', registry: REG1, sessions: SESSIONS, tabCache: new Map(), ws: 'd:\\AI\\p' })
  assertEq(r, { fp: null, via: 'new-tab' })
})

test('none: пусто везде', () => {
  const r = resolve({ label: null, registry: new Map(), sessions: [], tabCache: new Map(), ws: 'd:\\AI\\p' })
  assertEq(r, { fp: null, via: 'none' })
})

test('REG приоритетнее JSONL при конфликте', () => {
  const reg = new Map([regEntry('D', 'tD.jsonl', 'd:\\AI\\p', null, ['общее имя'], 10)])
  const ss = [{ fp: 'sX.jsonl', aiTitle: 'общее имя', lastPrompt: null }]
  const r = resolve({ label: 'общее имя', registry: reg, sessions: ss, tabCache: new Map(), ws: 'd:\\AI\\p' })
  assertEq(r.via, 'REG')
})
