const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const HOOK = path.join(__dirname, '..', 'hook.js')
const runHook = (dir, obj) =>
  spawnSync(process.execPath, [HOOK], {
    input: typeof obj === 'string' ? obj : JSON.stringify(obj),
    env: { ...process.env, CTX_HUD_DIR: dir },
    encoding: 'utf8',
  })
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ctxhud-hook-'))
const regOf = (dir) => fs.readFileSync(path.join(dir, 'registry.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)

test('UserPromptSubmit → запись ev=prompt, промпт обрезан до 200', () => {
  const dir = tmp()
  const r = runHook(dir, {
    hook_event_name: 'UserPromptSubmit', session_id: 'S1',
    transcript_path: 'C:\\t\\S1.jsonl', cwd: 'd:\\AI\\proj', prompt_text: 'x'.repeat(500),
  })
  assertEq(r.status, 0)
  const recs = regOf(dir)
  assertEq(recs.length, 1)
  assertEq(recs[0].ev, 'prompt')
  assertEq(recs[0].sid, 'S1')
  assertEq(recs[0].tp, 'C:\\t\\S1.jsonl')
  assertEq(recs[0].prompt.length, 200)
})

test('SessionStart → запись ev=start c title/model/source', () => {
  const dir = tmp()
  runHook(dir, {
    hook_event_name: 'SessionStart', session_id: 'S2', transcript_path: 't2',
    cwd: 'd:\\p', source: 'resume', session_title: 'Мой чат', model: 'claude-fable-5',
  })
  const recs = regOf(dir)
  assertEq(recs[0].ev, 'start')
  assertEq(recs[0].title, 'Мой чат')
  assertEq(recs[0].model, 'claude-fable-5')
  assertEq(recs[0].source, 'resume')
})

test('битый stdin / чужое событие / без session_id → exit 0, файла нет', () => {
  const dir = tmp()
  assertEq(runHook(dir, 'не json').status, 0)
  assertEq(runHook(dir, { hook_event_name: 'Stop', session_id: 'S3' }).status, 0)
  assertEq(runHook(dir, { hook_event_name: 'UserPromptSubmit' }).status, 0)
  assertEq(fs.existsSync(path.join(dir, 'registry.jsonl')), false)
})

test('ротация: >512КБ → остаются последние 300 строк, свежая в конце', () => {
  const dir = tmp()
  fs.mkdirSync(dir, { recursive: true })
  const fat = { ts: 1, ev: 'prompt', sid: 'OLD', tp: 't', cwd: 'c', prompt: 'y'.repeat(180) }
  const line = JSON.stringify(fat) + '\n'
  fs.writeFileSync(path.join(dir, 'registry.jsonl'), line.repeat(Math.ceil(600000 / line.length)))
  runHook(dir, { hook_event_name: 'UserPromptSubmit', session_id: 'NEW', transcript_path: 't', cwd: 'c', prompt_text: 'fresh' })
  const recs = regOf(dir)
  assertEq(recs.length <= 300, true, 'после ротации ≤300 строк')
  assertEq(recs[recs.length - 1].sid, 'NEW')
})
