# Claude Context HUD v0.2 «хук-реестр» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Привязка вкладка↔сессия через официальный hooks-контракт CC (реестр от SessionStart/UserPromptSubmit) с 5-ступенчатым видимым фолбэком — вместо тихо ломающегося реверс-инжиниринга jsonl.

**Architecture:** Хук-скрипт (async) пишет append-only реестр `~/.claude/ctx-hud/registry.jsonl`; расширение резолвит вкладку цепочкой REG→JSONL→CACHED→LAST-ACTIVE→MRU (чистая функция `resolve.js`), помечает неуверенные ступени маркером `≈`, диагностируется командой Diagnose и офлайн-selftest. Спека: `docs/superpowers/specs/2026-07-16-hook-registry-design.md`.

**Tech Stack:** чистый Node (zero npm-deps), vscode API только в `extension.js`. Тесты — самодельный мини-раннер `node extension/test/run.js`.

## Global Constraints

- Никаких npm-зависимостей; движок VS Code ≥ 1.98 (манифест).
- Секреты/токены не хардкодить (usage.js читает `~/.claude/.credentials.json` — не менять).
- `~/.claude/settings.json` менять ТОЛЬКО в Task 9 через `install.js --hooks` (разрешение Egor получено на ровно эту правку: 2 хук-группы). Другие файлы `~/.claude/**` вне `~/.claude/ctx-hud/` не трогать.
- Хук никогда не мешает CC: любой сбой → молча, exit 0.
- Атомарная запись любых перезаписываемых файлов: tmp + rename (урок нулевого settings.json).
- Все новые модули без vscode — тестируемы в голом node.
- Комментарии в коде — по-русски, в стиле существующих файлов.
- Рабочая папка команд: `d:/AI/personal/statusbar`.

---

### Task 1: Закоммитить висящие фиксы ремонта 2026-07-10

В архиве незакоммичены рабочие фиксы (проверены в бою): кэш валидного settings, lastPrompt-кандидат в readUsage/listProjectSessions, двухкандидатный `sessionForLabel` в extension.js.

**Files:**
- Commit as-is: `extension/data.js`, `extension/extension.js`

**Interfaces:**
- Produces: чистое дерево git; `readUsage(file)` → `{tokens, modelId, cwd, title, lastPrompt}`; сессии `listProjectSessions` несут `{fp, mtime, tokens, modelId, title, aiTitle, lastPrompt}` — на это опираются все следующие задачи.

- [ ] **Step 1: Проверить, что diff — именно фиксы 07-10 (settings-кэш, lastPrompt), без постороннего**

Run: `git diff --stat` и `git diff`
Expected: 2 файла, ~42 insertions (settings-кэш, lastPrompt-охота, multi-candidate matcher).

- [ ] **Step 2: Commit**

```bash
git add extension/data.js extension/extension.js
git commit -m "fix: session matching for CC 2.1.206+ (lastPrompt candidate, valid-settings cache)"
```

---

### Task 2: Тест-инфраструктура + материализация тестов data/format

Тесты прошлых ремонтов жили одноразовыми `node -e` в истории сессий — их нет в репо. Создаём мини-раннер и файлы тестов. Для тестируемости data.js добавляем env-override путей.

**Files:**
- Create: `extension/test/run.js`, `extension/test/format.test.js`, `extension/test/data.test.js`
- Modify: `extension/data.js:8-10` (env-override путей)

**Interfaces:**
- Produces: раннер `node extension/test/run.js` (глобальные `test(name, fn)`, `assertEq(actual, expected, msg?)`); env-переменные `CLAUDE_PROJECTS_DIR`, `CLAUDE_SETTINGS_FILE` для подмены путей в тестах. Все последующие задачи добавляют `*.test.js` в `extension/test/`.

- [ ] **Step 1: Написать раннер `extension/test/run.js`**

```js
// Мини-раннер тестов: node extension/test/run.js — гоняет все *.test.js этой папки.
// Без npm: глобальные test()/assertEq() достаточно для наших чистых модулей.
const fs = require('fs')
const path = require('path')
let pass = 0
let fail = 0
global.test = (name, fn) => {
  try {
    fn()
    pass++
    console.log('  ok', name)
  } catch (e) {
    fail++
    console.error('  FAIL', name, '\n    ', e.message)
  }
}
global.assertEq = (actual, expected, msg) => {
  const ja = JSON.stringify(actual)
  const je = JSON.stringify(expected)
  if (ja !== je) throw new Error((msg || 'assertEq') + ': expected ' + je + ' got ' + ja)
}
for (const f of fs.readdirSync(__dirname).sort()) {
  if (!f.endsWith('.test.js')) continue
  console.log(f)
  require(path.join(__dirname, f))
}
console.log('\n' + pass + ' ok, ' + fail + ' fail')
process.exit(fail ? 1 : 0)
```

- [ ] **Step 2: env-override путей в `extension/data.js`**

Заменить:
```js
const PROJECTS = path.join(HOME, '.claude', 'projects')
const SETTINGS = path.join(HOME, '.claude', 'settings.json')
```
на:
```js
// env-override — только для тестов (подмена на фикстуры), в бою пусто
const PROJECTS = process.env.CLAUDE_PROJECTS_DIR || path.join(HOME, '.claude', 'projects')
const SETTINGS = process.env.CLAUDE_SETTINGS_FILE || path.join(HOME, '.claude', 'settings.json')
```

- [ ] **Step 3: Написать `extension/test/format.test.js`**

```js
const { fmtK, modelName, effortAbbr, timeLeft, buildLine } = require('../format')

test('fmtK округляет к тысячам', () => {
  assertEq(fmtK(516489), '516k')
  assertEq(fmtK(0), '0k')
})

test('modelName парсит id с минором и без', () => {
  assertEq(modelName({ id: 'claude-opus-4-8' }), 'Opus 4.8')
  assertEq(modelName({ id: 'claude-fable-5' }), 'Fable 5')
  assertEq(modelName({ id: 'claude-sonnet-5' }), 'Sonnet 5')
  assertEq(modelName({ id: '', display_name: 'X' }), 'X')
})

test('effortAbbr маппинг', () => {
  assertEq(effortAbbr({ level: 'max' }), 'MAX')
  assertEq(effortAbbr({ level: 'xhigh' }), 'EH')
  assertEq(effortAbbr({ level: 'medium' }), 'MD')
  assertEq(effortAbbr(null), '')
})

test('timeLeft: дни при >суток, иначе часы/минуты', () => {
  const now = Math.floor(Date.now() / 1000)
  assertEq(timeLeft(now + 86400 + 3 * 3600 + 60), '1d3h')
  assertEq(timeLeft(now + 2 * 3600 + 12 * 60 + 30), '2h12')
  assertEq(timeLeft(now + 14 * 60 + 30), '14m')
  assertEq(timeLeft(0), '')
})

test('buildLine собирает сегменты и уважает opts', () => {
  const d = {
    context_window: { total_input_tokens: 516000, used_percentage: 52 },
    model: { id: 'claude-opus-4-8' },
    effort: { level: 'max' },
    subagents: 2,
    rate_limits: { five_hour: { used_percentage: 54 }, seven_day: { used_percentage: 62 } },
  }
  assertEq(buildLine(d), '516k 52% | Opus 4.8 | MAX | ⚙2 | 5h 54% | 7d 62%')
  assertEq(buildLine(d, { showLimits: false, showWorkflow: false }), '516k 52% | Opus 4.8 | MAX')
})
```

- [ ] **Step 4: Написать `extension/test/data.test.js`** (фикстуры во временной папке)

```js
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

test('listProjectSessions: munge-папка, belongs-фильтр, сортировка по mtime', () => {
  const pdir = path.join(process.env.CLAUDE_PROJECTS_DIR, 'd--AI-proj')
  fs.mkdirSync(pdir, { recursive: true })
  fs.writeFileSync(path.join(pdir, 'a.jsonl'), usageRec(10, 'claude-opus-4-8', 'd:\\AI\\proj'))
  fs.writeFileSync(path.join(pdir, 'b.jsonl'), usageRec(20, 'claude-opus-4-8', 'd:\\AI\\proj\\sub'))
  const ss = listProjectSessions('d:\\AI\\proj')
  assertEq(ss.length, 2)
  assertEq(ss.map((s) => s.tokens).sort((a, b) => a - b), [10, 20])
})
```

- [ ] **Step 5: Прогнать**

Run: `node extension/test/run.js`
Expected: все ok, `exit 0`. (`listProjectSessions`-тест дополнительно валидирует, что env-override работает.)

- [ ] **Step 6: Commit**

```bash
git add extension/test/ extension/data.js
git commit -m "test: materialize node test suite (runner + data/format coverage)"
```

---

### Task 3: Портировать два фикса из рабочей копии в архив (TDD)

Рабочая копия (`~/.vscode/extensions/SilantevBitcoin.claude-ctx-hud-0.1.0/`) содержит фиксы эпохи CC 2.1.209, которых нет в архиве: (а) новый чат без ответа ассистента → `tokens=0`, а не выпадение; (б) принадлежность по имени munge-папки без belongs-фильтра для корня (cwd в записях дрейфует за bash).

**Files:**
- Modify: `extension/data.js` (readUsage конец цикла TAIL_SPANS; listProjectSessions фильтр)
- Test: `extension/test/data.test.js` (дописать 2 теста)

**Interfaces:**
- Consumes: раннер и фикстуры из Task 2.
- Produces: `readUsage` возвращает `{tokens:0, modelId:'', cwd:'', title, lastPrompt}` для файла с промптом без usage; `listProjectSessions` включает сессию, чей runtime-cwd уехал из проекта, если папка = munge(ws).

- [ ] **Step 1: Дописать 2 падающих теста в `extension/test/data.test.js`**

```js
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
```

- [ ] **Step 2: Прогнать — оба падают**

Run: `node extension/test/run.js`
Expected: 2 FAIL (readUsage → null; listProjectSessions → 0).

- [ ] **Step 3: Портировать фиксы в `extension/data.js`**

В `readUsage`, строка `if (size <= span) return null` →
```js
    // Прочитали весь файл, usage нет. Если промпт ЕСТЬ (чат создан, но ассистент ещё не
    // ответил → нет message.usage) — это новый чат, контекст 0: возвращаем с tokens=0,
    // чтобы сессия попала в список и её вкладка сматчилась (иначе выпадала → FALLBACK на чужую).
    if (size <= span) return lastPrompt ? { tokens: 0, modelId: '', cwd: '', title, lastPrompt } : null
```

В `listProjectSessions`, строка `if (r && belongs(r.cwd, want)) {` →
```js
      // Принадлежность проекту: папка хранения === munge(workspace) → сессия ТОЧНО этого
      // проекта (Claude кладёт jsonl по cwd ЗАПУСКА, папка не меняется всю сессию). belongs
      // по runtime-cwd для корня НЕ проверяем: cwd ДРЕЙФУЕТ (CC 2.1.209 пишет в поле cwd
      // текущую bash-директорию — ложно отсекало активную сессию). Для подпапок (pdir=tag-*)
      // belongs по cwd остаётся — иначе не различить personal-2.
      if (r && (pl === tag || belongs(r.cwd, want))) {
```

- [ ] **Step 4: Прогнать — все зелёные**

Run: `node extension/test/run.js`
Expected: все ok.

- [ ] **Step 5: Commit**

```bash
git add extension/data.js extension/test/data.test.js
git commit -m "fix: port working-copy fixes (new-chat tokens=0, cwd-drift belongs)"
```

---

### Task 4: hook.js — хук-логгер реестра (TDD)

**Files:**
- Create: `extension/hook.js`
- Test: `extension/test/hook.test.js`

**Interfaces:**
- Consumes: stdin-JSON хуков CC: common `{session_id, transcript_path, cwd, hook_event_name}`; UserPromptSubmit добавляет `prompt_text`; SessionStart — `source`, опц. `session_title`, `model`.
- Produces: файл `$CTX_HUD_DIR/registry.jsonl` (env-override; боевой путь `~/.claude/ctx-hud/`), строки:
  `{"ts":<ms>,"ev":"prompt","sid","tp","cwd","prompt"(≤200)}` и
  `{"ts":<ms>,"ev":"start","sid","tp","cwd","title":str|null,"model":str|null,"source"}`.
  Task 5 парсит ровно этот формат.

- [ ] **Step 1: Написать `extension/test/hook.test.js` (spawnSync, падает — hook.js нет)**

```js
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
```

- [ ] **Step 2: Прогнать — тесты падают (hook.js отсутствует)**

Run: `node extension/test/run.js`
Expected: FAIL'ы hook.test.js.

- [ ] **Step 3: Написать `extension/hook.js`**

```js
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
    // dока называет поле prompt_text; берём и prompt на случай переименования
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
```

- [ ] **Step 4: Прогнать — все зелёные**

Run: `node extension/test/run.js`
Expected: все ok.

- [ ] **Step 5: Commit**

```bash
git add extension/hook.js extension/test/hook.test.js
git commit -m "feat: hook.js — registry logger on SessionStart/UserPromptSubmit"
```

---

### Task 5: registry.js — чтение реестра (TDD)

**Files:**
- Create: `extension/registry.js`
- Test: `extension/test/registry.test.js`

**Interfaces:**
- Consumes: формат registry.jsonl из Task 4; `normPath`, `belongs` из `./data`.
- Produces (для Task 6/7):
  - `loadRegistry(file?)` → `Map<sid, {sid, tp, cwd, title, model, prompts: string[], lastPromptTs, lastTs}>` (кэш по fp+mtime; битые строки пропускаются; `cwd` — из ПЕРВОЙ записи сессии, т.е. стартовый, не дрейфующий; prompts — последние 8, старые первыми).
  - `candidatesFor(entry)` → `string[]` (title первым, затем промпты от свежего к старому).
  - `latestForProject(map, ws)` → entry | null (max lastPromptTs среди belongs(cwd, ws)).
  - `REG` — боевой путь реестра.

- [ ] **Step 1: Написать `extension/test/registry.test.js`**

```js
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
```

- [ ] **Step 2: Прогнать — падает (registry.js нет)**

Run: `node extension/test/run.js`
Expected: FAIL'ы registry.test.js.

- [ ] **Step 3: Написать `extension/registry.js`**

```js
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
```

- [ ] **Step 4: Прогнать — все зелёные**

Run: `node extension/test/run.js`
Expected: все ok.

- [ ] **Step 5: Commit**

```bash
git add extension/registry.js extension/test/registry.test.js
git commit -m "feat: registry.js — hook-registry reader (mtime cache, start-cwd, candidates)"
```

---

### Task 6: resolve.js — 5-ступенчатая привязка (TDD)

Вся логика выбора сессии для вкладки — одной чистой функцией. `sessionForLabel`/normLabel переезжают сюда из extension.js.

**Files:**
- Create: `extension/resolve.js`
- Test: `extension/test/resolve.test.js`

**Interfaces:**
- Consumes: `candidatesFor`, `latestForProject` из `./registry` (Task 5); сессии `{fp, aiTitle, lastPrompt}` (Task 1/3).
- Produces (для Task 7):
  - `resolve({label, registry, sessions, tabCache, ws})` → `{fp: string|null, via: 'REG'|'JSONL'|'CACHED'|'LAST-ACTIVE'|'MRU'|'new-tab'|'none'}`.
  - `normLabel(x)` → string (схлопывание пробелов, trim).
  - Правило маркера для UI: `via ∈ {LAST-ACTIVE, MRU}` = «не уверен».

- [ ] **Step 1: Написать `extension/test/resolve.test.js`**

```js
const { resolve, normLabel } = require('../resolve')

// Мини-реестр как Map — формат loadRegistry (Task 5)
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
```

- [ ] **Step 2: Прогнать — падает (resolve.js нет)**

Run: `node extension/test/run.js`
Expected: FAIL'ы resolve.test.js.

- [ ] **Step 3: Написать `extension/resolve.js`**

```js
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
```

- [ ] **Step 4: Прогнать — все зелёные**

Run: `node extension/test/run.js`
Expected: все ok.

- [ ] **Step 5: Commit**

```bash
git add extension/resolve.js extension/test/resolve.test.js
git commit -m "feat: resolve.js — 5-step tab→session chain (REG/JSONL/CACHED/LAST-ACTIVE/MRU)"
```

---

### Task 7: extension.js интеграция + package.json (маркер ≈, Diagnose, health)

extension.js становится тонким: собирает входы, зовёт resolve, рисует. Диагностика — командой, не вечным логом.

**Files:**
- Modify: `extension/extension.js` (замена sessionForLabel-блока на resolve; маркер; tooltip; Diagnose; health)
- Modify: `extension/data.js` (добавить `sessionByPath`)
- Modify: `extension/package.json` (version 0.2.0, команда, настройка markFallback)
- Test: `extension/test/data.test.js` (тест sessionByPath)

**Interfaces:**
- Consumes: `resolve`/`normLabel` (Task 6), `loadRegistry` (Task 5), `sessionByPath` (этот Task).
- Produces: `sessionByPath(fp)` → сессия `{fp, mtime, tokens, modelId, title, aiTitle, lastPrompt}` | null (реестр даёт путь напрямую — сессия может быть вне скана `listProjectSessions`); команда `claudeCtxHud.diagnose`; настройка `claudeCtxHud.markFallback` (bool, default true).

- [ ] **Step 1: Тест `sessionByPath` в `extension/test/data.test.js`**

```js
test('sessionByPath: сессия по прямому пути (без сканов папок)', () => {
  const { sessionByPath } = require('../data')
  const fp = path.join(TMP, 's4.jsonl')
  fs.writeFileSync(fp, usageRec(70, 'claude-fable-5', 'd:\\anywhere') + J({ type: 'last-prompt', lastPrompt: 'q' }))
  const s = sessionByPath(fp)
  assertEq(s.tokens, 70)
  assertEq(s.modelId, 'claude-fable-5')
  assertEq(sessionByPath(path.join(TMP, 'нет.jsonl')), null)
})
```

Run: `node extension/test/run.js` → FAIL (sessionByPath не экспортирован).

- [ ] **Step 2: Добавить `sessionByPath` в `extension/data.js`** (после `listProjectSessions`, в exports тоже)

```js
// Сессия по известному пути транскрипта: реестр (registry.js) даёт tp напрямую —
// не нужны сканы папок projects (munge/регистр/дрейф cwd мимо). Кэш тот же (mtime).
function sessionByPath(fp) {
  let mtime
  try { mtime = fs.statSync(fp).mtimeMs } catch (_) { return null }
  const r = readUsageCached(fp, mtime)
  if (!r) return null
  const aiTitle = r.title || readTitleHead(fp)
  return { fp, mtime, tokens: r.tokens, modelId: r.modelId, title: aiTitle || r.lastPrompt, aiTitle, lastPrompt: r.lastPrompt }
}
```
И в `module.exports` добавить `sessionByPath`.

Run: `node extension/test/run.js` → все ok.

- [ ] **Step 3: Переписать привязку в `extension/extension.js`**

Заменить импорты и блок `sessionForLabel`/`normLabel` (строки 8-9, 56-79) и тело `update()` (81-109) на:

```js
const { buildLine } = require('./format')
const { listProjectSessions, composeLine, sessionByPath } = require('./data')
const { fetchUsage } = require('./usage')
const { loadRegistry } = require('./registry')
const { resolve, normLabel } = require('./resolve')
```

Внутри `activate()` вместо старых `sessionForLabel`+`update`:

```js
  // Кэш успешных привязок вкладка→сессия: переживает рассинхрон имени вкладки и
  // lastPrompt в момент нового сообщения (иначе прыжок на чужую свежайшую).
  const _tabCache = new Map()
  let lastVia = 'none' // для tooltip и Diagnose

  // Все вкладки-чаты Claude всех групп (для Diagnose).
  function allClaudeTabs() {
    const out = []
    try {
      const groups = (vscode.window.tabGroups && vscode.window.tabGroups.all) || []
      for (const gr of groups) for (const tb of gr.tabs || []) {
        const vt = tb.input && tb.input.viewType
        if (vt && String(vt).includes('claudeVSCodePanel')) out.push((tb.isActive ? '*' : '') + String(tb.label || ''))
      }
    } catch (_) {}
    return out
  }

  // Хуки молчат? Свежие транскрипты есть, а реестр без записей сутки — CC перестал
  // звать хуки (или конфиг снесли). Тихо подсветить в tooltip, в строку не орать.
  function healthWarning(registry, sessions) {
    try {
      const freshJsonl = sessions[0] && Date.now() - sessions[0].mtime < 600000
      let lastReg = 0
      for (const s of registry.values()) lastReg = Math.max(lastReg, s.lastTs)
      if (freshJsonl && Date.now() - lastReg > 86400000)
        return '\n⚠ hook-реестр молчит >24ч — команда «Claude HUD: Diagnose»'
    } catch (_) {}
    return ''
  }

  function update() {
    try {
      const cfg = vscode.workspace.getConfiguration('claudeCtxHud')
      const pad = cfg.get('padLeft', 0)
      const showLimits = cfg.get('showLimits', true)
      const showWorkflow = cfg.get('showWorkflow', true)
      const markFallback = cfg.get('markFallback', true)
      const lead = NBSP.repeat(Math.max(0, pad))

      const t = claudeTabTitle()
      if (t) activeTitle = t // не сбрасываем на не-Claude вкладке

      const registry = loadRegistry()
      const sessions = listProjectSessions(workspacePath)
      const r = resolve({ label: activeTitle, registry, sessions, tabCache: _tabCache, ws: workspacePath })
      lastVia = r.via
      if (r.via === 'REG' || r.via === 'JSONL') _tabCache.set(normLabel(activeTitle), r.fp)

      // Сессия: из скана проекта либо напрямую по пути из реестра.
      const chosen = r.fp ? sessions.find((s) => s.fp === r.fp) || sessionByPath(r.fp) : null
      const d = composeLine(chosen)
      if (!d.hasSession) {
        item.text = lead + '—'
        item.tooltip = 'Claude HUD: нет активной сессии (via: ' + r.via + ')'
        return
      }
      if (lastUsage) d.rate_limits = lastUsage
      const uncertain = r.via === 'LAST-ACTIVE' || r.via === 'MRU' // фолбэк — честно помечаем
      item.text = lead + (markFallback && uncertain ? '≈ ' : '') + buildLine(d, { showLimits, showWorkflow })
      item.tooltip = 'via: ' + r.via + ' — ' + ((chosen && chosen.title) || 'сессия') + healthWarning(registry, sessions)
    } catch (_) {
      item.text = 'ctx —'
    }
  }
```

После таймеров добавить команду Diagnose:

```js
  // Диагностика по требованию (вместо вечного tab-diag.log): полная цепочка привязки.
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCtxHud.diagnose', () => {
      const ch = vscode.window.createOutputChannel('Claude HUD')
      try {
        const registry = loadRegistry()
        const sessions = listProjectSessions(workspacePath)
        let lastReg = 0
        for (const s of registry.values()) lastReg = Math.max(lastReg, s.lastTs)
        ch.appendLine('ws=' + workspacePath)
        ch.appendLine('activeTitle=' + JSON.stringify(activeTitle) + ' via=' + lastVia)
        ch.appendLine('registry: ' + registry.size + ' сессий, последняя запись ' + (lastReg ? new Date(lastReg).toISOString() : 'НЕТ'))
        for (const tab of allClaudeTabs()) {
          const r = resolve({ label: tab.replace(/^\*/, ''), registry, sessions, tabCache: _tabCache, ws: workspacePath })
          ch.appendLine('tab ' + JSON.stringify(tab) + ' → via=' + r.via + ' fp=...' + (r.fp ? r.fp.slice(-20) : '-'))
        }
        for (const s of sessions.slice(0, 8))
          ch.appendLine('sess ...' + s.fp.slice(-20) + ' tok=' + s.tokens + ' aiTitle=' + JSON.stringify(s.aiTitle) + ' lastPrompt=' + JSON.stringify((s.lastPrompt || '').slice(0, 40)))
      } catch (e) {
        ch.appendLine('diagnose error: ' + e.message)
      }
      ch.show()
    }),
  )
```

- [ ] **Step 4: package.json — версия, команда, настройка**

В `extension/package.json`: `"version": "0.2.0"`; в `contributes` добавить:
```json
"commands": [
  { "command": "claudeCtxHud.diagnose", "title": "Claude HUD: Diagnose" }
]
```
и в `contributes.configuration.properties`:
```json
"claudeCtxHud.markFallback": {
  "type": "boolean",
  "default": true,
  "description": "Помечать строку маркером ≈, когда привязка к вкладке не точная (фолбэк LAST-ACTIVE/MRU)"
}
```

- [ ] **Step 5: Синтаксис-чек без vscode**

Run: `node -e "require('d:/AI/personal/statusbar/extension/resolve.js'); require('d:/AI/personal/statusbar/extension/registry.js'); new Function(require('fs').readFileSync('d:/AI/personal/statusbar/extension/extension.js','utf8')); console.log('syntax ok')"`
Expected: `syntax ok` (extension.js require'ит vscode — только парс через new Function).
Run: `node extension/test/run.js` → все ok.

- [ ] **Step 6: Commit**

```bash
git add extension/extension.js extension/data.js extension/package.json extension/test/data.test.js
git commit -m "feat: wire resolve chain into extension — ≈ marker, Diagnose command, hook health warning (v0.2.0)"
```

---

### Task 8: selftest.js — офлайн-проверка на живых данных

**Files:**
- Create: `extension/selftest.js`

**Interfaces:**
- Consumes: `loadRegistry`, `candidatesFor` (Task 5), `resolve` (Task 6), `listProjectSessions` (data.js).
- Produces: `node extension/selftest.js [workspacePath]` — человекочитаемый отчёт; exit 0 всегда (инструмент, не гейт).

- [ ] **Step 1: Написать `extension/selftest.js`**

```js
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
```

- [ ] **Step 2: Прогнать на живых данных**

Run: `node extension/selftest.js d:/AI/personal`
Expected (до установки хука): «сессий в реестре: 0 … хук ещё не установлен», скан проекта — сессии с aiTitle/lastPrompt. Не exit-ошибка.

- [ ] **Step 3: Commit**

```bash
git add extension/selftest.js
git commit -m "feat: selftest.js — offline resolve-chain check on live data"
```

---

### Task 9: install.js — версия из манифеста, чистка старых, --hooks (TDD для addHooks)

**Files:**
- Modify: `install.js`
- Test: `extension/test/install.test.js`

**Interfaces:**
- Consumes: `extension/hook.js` (Task 4), `extension/package.json` version (Task 7).
- Produces: `node install.js` — копия расширения версии из package.json + реестр + чистка старых `SilantevBitcoin.claude-ctx-hud-*`; `node install.js --hooks` — дополнительно: hook.js → `~/.claude/ctx-hud/hook.js`, правка `~/.claude/settings.json` (бэкап, идемпотентно, tmp+rename). Экспорт `addHooks(settingsObj, hookCmd)` → `{changed: bool}` для тестов.

- [ ] **Step 1: Написать `extension/test/install.test.js` (падает — addHooks нет)**

```js
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
```

- [ ] **Step 2: Прогнать — падает**

Run: `node extension/test/run.js`
Expected: FAIL'ы install.test.js (`addHooks` не экспортирован).

- [ ] **Step 3: Переписать `install.js`**

```js
#!/usr/bin/env node
// Установщик Claude Context HUD: копирует extension/ в ~/.vscode/extensions/ и
// регистрирует в extensions.json (VS Code грузит расширения ПО РЕЕСТРУ, не сканируя
// папки). После установки нужен Reload Window. Идемпотентно — можно запускать повторно.
//
//   node install.js          — установка/обновление расширения (dev-цикл: правка → это → Reload)
//   node install.js --hooks  — дополнительно: hook.js → ~/.claude/ctx-hud/ + 2 хук-группы
//                              в ~/.claude/settings.json (бэкап; идемпотентно; tmp+rename)
const fs = require('fs')
const os = require('os')
const path = require('path')

const EXT_ID = 'SilantevBitcoin.claude-ctx-hud'
const src = path.join(__dirname, 'extension')
const VERSION = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version
const DIRNAME = `${EXT_ID}-${VERSION}`
const extRoot = path.join(os.homedir(), '.vscode', 'extensions')
const dest = path.join(extRoot, DIRNAME)
const HUD_DIR = path.join(os.homedir(), '.claude', 'ctx-hud')
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json')

// Windows-путь → file-uri path: C:\Users\x → /c:/Users/x (drive в нижнем регистре).
function toFileUriPath(p) {
  let s = p.replace(/\\/g, '/')
  if (!s.startsWith('/')) s = '/' + s
  return s.replace(/^\/([A-Za-z]):/, (_, d) => '/' + d.toLowerCase() + ':')
}

// Дописать хук-группы HUD в settings-объект (мутирует). Идемпотентно: узнаём свои
// группы по подстроке 'ctx-hud' в command. Чужие группы не трогаем.
function addHooks(settings, hookCmd) {
  if (!settings.hooks) settings.hooks = {}
  let changed = false
  for (const ev of ['SessionStart', 'UserPromptSubmit']) {
    if (!Array.isArray(settings.hooks[ev])) settings.hooks[ev] = []
    const has = settings.hooks[ev].some((g) => (g.hooks || []).some((h) => String(h.command || '').includes('ctx-hud')))
    if (has) continue
    settings.hooks[ev].push({ hooks: [{ type: 'command', command: hookCmd, async: true, timeout: 15 }] })
    changed = true
  }
  return { changed }
}

function installExtension() {
  // 1. копия файлов (только файлы верхнего уровня; test/ не нужен в рабочей копии)
  fs.mkdirSync(dest, { recursive: true })
  let copied = 0
  for (const f of fs.readdirSync(src)) {
    if (fs.statSync(path.join(src, f)).isFile()) {
      fs.copyFileSync(path.join(src, f), path.join(dest, f))
      copied++
    }
  }
  // 2. чистка СТАРЫХ версий (папки EXT_ID-* кроме текущей) — иначе копятся после бампов
  for (const d of fs.readdirSync(extRoot)) {
    if (d.startsWith(EXT_ID + '-') && d !== DIRNAME) {
      try { fs.rmSync(path.join(extRoot, d), { recursive: true, force: true }) } catch (_) {}
    }
  }
  // 3. реестр extensions.json: заменяем прежнюю запись
  const regFile = path.join(extRoot, 'extensions.json')
  let reg = []
  try { reg = JSON.parse(fs.readFileSync(regFile, 'utf8')) } catch (_) {}
  if (!Array.isArray(reg)) reg = []
  reg = reg.filter((e) => !(e && e.identifier && e.identifier.id === EXT_ID))
  reg.push({
    identifier: { id: EXT_ID },
    version: VERSION,
    location: { $mid: 1, path: toFileUriPath(dest), scheme: 'file' },
    relativeLocation: DIRNAME,
    metadata: { installedTimestamp: Date.now(), source: 'vsix', private: false, isBuiltin: false },
  })
  fs.writeFileSync(regFile, JSON.stringify(reg))
  console.log(`✓ Claude Context HUD ${VERSION} установлен (${copied} файлов): ${dest}`)
}

function installHooks() {
  // hook.js → ~/.claude/ctx-hud/ (папка HUD, НЕ системная ~/.claude/scripts)
  fs.mkdirSync(HUD_DIR, { recursive: true })
  const hookDst = path.join(HUD_DIR, 'hook.js')
  fs.copyFileSync(path.join(src, 'hook.js'), hookDst)
  const hookCmd = 'node "' + hookDst.replace(/\\/g, '/') + '"'
  // settings.json: бэкап → правка → атомарная запись (tmp+rename)
  const settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
  const bak = SETTINGS + '.bak-ctxhud-' + Date.now()
  fs.copyFileSync(SETTINGS, bak)
  const { changed } = addHooks(settings, hookCmd)
  if (changed) {
    const tmp = SETTINGS + '.tmp-ctxhud'
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2))
    fs.renameSync(tmp, SETTINGS)
    console.log('✓ Хуки добавлены в settings.json (бэкап: ' + path.basename(bak) + ')')
  } else {
    fs.rmSync(bak)
    console.log('✓ Хуки уже стоят — settings.json не тронут')
  }
  console.log('  Реестр начнёт наполняться со следующего промпта в любом чате.')
}

if (require.main === module) {
  try {
    if (!fs.existsSync(src)) {
      console.error('✗ Не найдена папка extension/ рядом с install.js')
      process.exit(1)
    }
    installExtension()
    if (process.argv.includes('--hooks')) installHooks()
    console.log('\n→ Перезагрузи окно: Ctrl/Cmd+Shift+P → Developer: Reload Window')
  } catch (e) {
    console.error('✗ Ошибка установки:', e.message)
    process.exit(1)
  }
}

module.exports = { addHooks }
```

- [ ] **Step 4: Прогнать — все зелёные**

Run: `node extension/test/run.js`
Expected: все ok (install.test.js зелёный, остальные не задеты).

- [ ] **Step 5: Commit**

```bash
git add install.js extension/test/install.test.js
git commit -m "feat: install.js — version from manifest, old-version cleanup, --hooks mode"
```

---

### Task 10: Установка, живая проверка, документация

**Files:**
- Run: `node install.js --hooks`
- Modify: `MEMORY.md`, `CLAUDE.md` (проект statusbar)

**Interfaces:**
- Consumes: всё выше.
- Produces: рабочая система v0.2.0 + обновлённая память проекта.

- [ ] **Step 1: Полный прогон тестов перед установкой**

Run: `node extension/test/run.js`
Expected: все ok, 0 fail.

- [ ] **Step 2: Установить (расширение + хуки; правка settings.json РАЗРЕШЕНА — выбор варианта A)**

Run: `node install.js --hooks`
Expected: `✓ … 0.2.0 установлен`, `✓ Хуки добавлены в settings.json (бэкап: …)`.
Проверить: `node -e "const s=require(process.env.USERPROFILE+'/.claude/settings.json'); console.log(JSON.stringify(s.hooks.SessionStart.concat(s.hooks.UserPromptSubmit).flatMap(g=>g.hooks.map(h=>h.command)).filter(c=>c.includes('ctx-hud'))))"` → две команды с ctx-hud/hook.js.

- [ ] **Step 3: Попросить Egor перезагрузить окно VS Code** (`Ctrl+Shift+P → Developer: Reload Window`) — единственное действие, которое нельзя сделать за него. После reload и первого промпта в любом чате:

Run: `node extension/selftest.js d:/AI/personal`
Expected: «сессий в реестре: ≥1», симулированные вкладки — `ok via=REG`.

- [ ] **Step 4: Обновить память проекта**

В `statusbar/MEMORY.md` — новый раздел сверху (после шапки), старые «Ремонты» не трогать:

```markdown
## ⭐ Архитектура v0.2 (2026-07-16): хук-реестр — главный источник привязки
- **Мост вкладка↔сессия** = реестр `~/.claude/ctx-hud/registry.jsonl`, который пишет
  `hook.js` (копия из `extension/hook.js`) на официальных хуках SessionStart /
  UserPromptSubmit (`async:true`, в `~/.claude/settings.json`, ставится `node install.js --hooks`).
  Хуки — документированный контракт CC (session_id/transcript_path/prompt_text/session_title),
  в отличие от формата jsonl («can break on any release») и имени вкладки.
- **Цепочка resolve.js (5 ступеней):** REG → JSONL (старый матчинг aiTitle/lastPrompt) →
  CACHED (_tabCache) → LAST-ACTIVE (последний промпт проекта из реестра) → MRU (mtime).
  LAST-ACTIVE/MRU = «не уверен» → маркер `≈` в строке (`claudeCtxHud.markFallback`).
- **Диагностика:** команда «Claude HUD: Diagnose» (OutputChannel, вся цепочка) +
  `node extension/selftest.js <ws>` (офлайн, живые данные) + health-warning в tooltip,
  если реестр молчит >24ч при свежих jsonl. Вечный tab-diag.log убран.
- **Дрейф копий закрыт:** правки ТОЛЬКО в архиве → `node install.js` (версия из
  package.json, чистит старые папки) → Reload Window. Ручной cp запрещён.
- **Тесты:** `node extension/test/run.js` (data/format/hook/registry/resolve/install).
- statusLine в GUI по-прежнему НЕ вызывается (перепроверено 2026-07-16 на 2.1.210) —
  потому лимиты остаются на `usage.js` (api/oauth/usage), а токены — из jsonl (message.usage).
```

В `statusbar/CLAUDE.md` — в «Структура» добавить строки:
```markdown
- `extension/hook.js` — хук-логгер (SessionStart/UserPromptSubmit → registry.jsonl); ставится в `~/.claude/ctx-hud/` через `node install.js --hooks`.
- `extension/registry.js` — чтение хук-реестра (кэш mtime, кандидаты имён, последняя активность).
- `extension/resolve.js` — 5-ступенчатая привязка вкладка↔сессия (REG/JSONL/CACHED/LAST-ACTIVE/MRU).
- `extension/selftest.js` — офлайн-проверка цепочки на живых данных; `extension/test/run.js` — тесты.
```
И в «Как пользоваться / править» заменить cp-цикл на: `правка extension/* → node install.js → Reload Window`.

- [ ] **Step 5: Финальный коммит**

```bash
git add MEMORY.md CLAUDE.md
git commit -m "docs: v0.2 hook-registry architecture in project memory"
```

---

## Self-Review (прогнан)

1. **Spec coverage:** hook.js+settings (Task 4, 9), registry.js (5), resolve.js+5 ступеней+маркер (6, 7), Diagnose+health (7), data.js-порты+sessionByPath (3, 7), selftest (8), install --dev-цикл+чистка (9), тесты материализованы (2), версия 0.2.0 (7), MEMORY/CLAUDE (10). Гэпов нет.
2. **Placeholder scan:** чисто — весь код в шагах полный.
3. **Type consistency:** `resolve({label, registry, sessions, tabCache, ws})`→`{fp, via}`; via-строки согласованы (extension.js/selftest/тесты); формат записей hook.js = парсер registry.js (`ts/ev/sid/tp/cwd/prompt|title/model/source`); `sessionByPath` — единая сигнатура сессии; `addHooks(settings, hookCmd)`→`{changed}` совпадает в install.js и тесте.
