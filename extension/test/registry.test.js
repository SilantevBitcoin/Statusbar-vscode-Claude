const fs = require('fs')
const os = require('os')
const path = require('path')
const { loadRegistry, candidatesFor, latestForProject } = require('../registry')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxhud-reg-'))
const L = (o) => JSON.stringify(o) + '\n'

test('loadRegistry: агрегация по sid, title/model из start, промпты копятся', () => {
  const fp = path.join(tmp, 'r1.jsonl')
  fs.writeFileSync(
    fp,
    L({ ts: 1, ev: 'start', sid: 'A', tp: 'tA', cwd: 'd:\\AI\\p', title: 'Заголовок', model: 'claude-fable-5', source: 'startup' }) +
      'битая строка\n' +
      L({ ts: 2, ev: 'prompt', sid: 'A', tp: 'tA', cwd: 'd:\\AI\\p\\sub', prompt: 'первый вопрос' }) +
      L({ ts: 3, ev: 'prompt', sid: 'A', tp: 'tA', cwd: 'd:\\AI\\p', prompt: 'второй вопрос' }),
  )
  const m = loadRegistry(fp)
  const a = m.get('A')
  assertEq(a.title, 'Заголовок')
  assertEq(a.model, 'claude-fable-5')
  assertEq(a.prompts, ['первый вопрос', 'второй вопрос'])
  assertEq(a.lastPromptTs, 3)
  assertEq(a.cwd, 'd:\\AI\\p', 'cwd — стартовый, промпты его не перетирают')
})

test('candidatesFor: title первым, промпты от свежего к старому', () => {
  assertEq(candidatesFor({ title: 'T', prompts: ['p1', 'p2'] }), ['T', 'p2', 'p1'])
  assertEq(candidatesFor({ title: null, prompts: ['p1'] }), ['p1'])
})

test('latestForProject: фильтр belongs + max lastPromptTs', () => {
  const fp = path.join(tmp, 'r2.jsonl')
  fs.writeFileSync(
    fp,
    L({ ts: 1, ev: 'prompt', sid: 'A', tp: 'tA', cwd: 'd:\\AI\\p', prompt: 'a' }) +
      L({ ts: 5, ev: 'prompt', sid: 'B', tp: 'tB', cwd: 'd:\\AI\\p\\sub', prompt: 'b' }) +
      L({ ts: 9, ev: 'prompt', sid: 'C', tp: 'tC', cwd: 'd:\\OTHER', prompt: 'c' }),
  )
  const m = loadRegistry(fp)
  assertEq(latestForProject(m, 'd:\\AI\\p').sid, 'B')
  assertEq(latestForProject(m, 'd:\\nope'), null)
})

test('prompts ограничены последними 8', () => {
  const fp = path.join(tmp, 'r3.jsonl')
  let txt = ''
  for (let i = 1; i <= 12; i++) txt += L({ ts: i, ev: 'prompt', sid: 'A', tp: 't', cwd: 'c', prompt: 'p' + i })
  fs.writeFileSync(fp, txt)
  const a = loadRegistry(fp).get('A')
  assertEq(a.prompts.length, 8)
  assertEq(a.prompts[7], 'p12')
})
