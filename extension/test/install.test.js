const { addHooks } = require('../../install')

const CMD = 'node "C:/Users/silan/.claude/ctx-hud/hook.js"'

test('addHooks: добавляет группы в оба события', () => {
  const s = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'python x.py' }] }] } }
  const r = addHooks(s, CMD)
  assertEq(r.changed, true)
  const flat = (ev) => s.hooks[ev].flatMap((g) => g.hooks.map((h) => h.command))
  assertEq(flat('UserPromptSubmit').includes(CMD), true)
  assertEq(flat('SessionStart').includes(CMD), true)
  const added = s.hooks.SessionStart.flatMap((g) => g.hooks).find((h) => h.command === CMD)
  assertEq(added.async, true)
  assertEq(added.timeout, 15)
})

test('addHooks: идемпотентен (повторный вызов ничего не дублирует)', () => {
  const s = { hooks: {} }
  addHooks(s, CMD)
  const r2 = addHooks(s, CMD)
  assertEq(r2.changed, false)
  assertEq(s.hooks.SessionStart.flatMap((g) => g.hooks).filter((h) => String(h.command).includes('ctx-hud')).length, 1)
})

test('addHooks: чужие хуки не тронуты', () => {
  const s = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'bash y.sh', async: true, timeout: 180 }] }] } }
  addHooks(s, CMD)
  assertEq(s.hooks.SessionStart[0].hooks[0].command, 'bash y.sh')
})
