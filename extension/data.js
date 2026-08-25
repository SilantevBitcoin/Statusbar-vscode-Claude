// Сбор живых данных для HUD из локальных файлов Claude Code (без vscode/сети).
// Контекст + модель — из свежего jsonl-транскрипта ТЕКУЩЕГО проекта (по cwd);
// effort — из settings.json. rate_limits (5h/7d) в локальных файлах отсутствуют.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { diagLog } = require('./diag')

const HOME = os.homedir()
// env-override — только для тестов (подмена на фикстуры), в бою пусто
const PROJECTS = process.env.CLAUDE_PROJECTS_DIR || path.join(HOME, '.claude', 'projects')
const SETTINGS = process.env.CLAUDE_SETTINGS_FILE || path.join(HOME, '.claude', 'settings.json')

// Кэш последнего ВАЛИДНОГО settings: Claude Code переписывает settings.json не атомарно
// (бывает 0 байт при truncate до записи, наблюдалось 2026-07-10) — при пустом/битом файле
// держим последнее известное model/effort, иначе окно контекста ложно падало на 200К и в
// строке пропадал effort. Пустой валидный (нет полей) не затирает кэш нулём.
let _lastSettings = { model: '', effortLevel: '' }
function readSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
    if (s.model || s.effortLevel) _lastSettings = { model: s.model || '', effortLevel: s.effortLevel || '' }
    diagLog('settings', 'ok', null)
  } catch (e) {
    // битый/пустой JSON (транзиент перезаписи) — возвращаем последнее валидное.
    // Размер обязателен: 0 байт = окно truncate, иное = битый JSON. Это единственное
    // место, где обнуление конфига вообще наблюдаемо — раньше catch глотал молча.
    let size = -1
    try { size = fs.statSync(SETTINGS).size } catch (_) {}
    diagLog('settings', 'bad:' + size, 'settings.json НЕЧИТАЕМ: size=' + size + ' байт | ' + e.message)
  }
  // ANTHROPIC_MODEL перекрывает settings.model — та же иерархия, что у самого Claude Code
  // (проверено 2026-07-20: при model=fable в settings и env=haiku отвечал haiku). Без этого HUD
  // терял флаг [1m]: дефолт модели прибит переменной, а ключ model из settings исчезает при
  // первом же переключении на «default» (CC делает delete ключа) — окно считалось 200К вместо
  // 1M, проценты контекста врали впятеро (267951 токенов показывались как 134% вместо 27%).
  // В транскрипте суффикс [1m] не пишется вообще, так что settings/env — единственный источник.
  // env читаем на каждый вызов, а не в константу при импорте: так им управляют тесты.
  const envModel = process.env.ANTHROPIC_MODEL || ''
  return envModel ? { model: envModel, effortLevel: _lastSettings.effortLevel } : _lastSettings
}

// Окно контекста ДЛЯ СЕССИИ. Флаг [1m] в settings.model относится только к своей
// модели: сессия может идти на другой (выбор /model session-only, в settings не
// пишется) — тогда чужой флаг не применяем. Fable/Mythos: 1M всегда (дефолт API).
function ctxWindow(settingsModel, sessionModelId) {
  const m = String(settingsModel || '')
  const id = String(sessionModelId || '')
  if (/fable|mythos/i.test(id)) return 1000000
  const has1m = /1m|\[1m\]/i.test(m)
  if (!id) return has1m ? 1000000 : 200000 // модель сессии неизвестна → по settings
  const base = m.replace(/\[1m\]/gi, '').trim().toLowerCase()
  if (has1m && base && id.toLowerCase().includes(base)) return 1000000
  return 200000
}

// Нормализация пути для сравнения cwd: нижний регистр, слеши → бэкслеши.
function normPath(p) {
  return String(p || '').toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '')
}

// Принадлежит ли cwd сессии этому workspace. НЕ точное равенство: cwd дрейфует в
// подпапки (claude запущен/работает из подпапки проекта) — такая сессия всё равно
// «эта». Разделитель в префиксе обязателен, иначе `personal` поймает `personal-2`.
// want — уже normPath'нутый workspace.
function belongs(cwd, want) {
  const c = normPath(cwd)
  return c === want || c.startsWith(want + '\\')
}

// Все *.jsonl среди всех проектов с временем модификации.
function listJsonl() {
  const out = []
  let projs
  try {
    projs = fs.readdirSync(PROJECTS)
  } catch (_) {
    return out
  }
  for (const p of projs) {
    const pdir = path.join(PROJECTS, p)
    let files
    try {
      if (!fs.statSync(pdir).isDirectory()) continue
      files = fs.readdirSync(pdir)
    } catch (_) {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const fp = path.join(pdir, f)
      try {
        out.push({ fp, t: fs.statSync(fp).mtimeMs })
      } catch (_) {}
    }
  }
  return out
}

// Из хвоста файла тянем последний реальный usage И заголовок чата (aiTitle).
// Окно адаптивное 128К → 512К → 2М: одна запись бывает >128К (tool result с
// картинкой/base64 до ~1.7 МБ в реальных сессиях) — тогда в базовом окне нет ни
// одного целого JSON и сессия «пропадала». Возвращает { tokens, modelId, cwd, title }.
const TAIL_SPANS = [131072, 524288, 2097152]
function readUsage(file) {
  for (const span of TAIL_SPANS) {
    let buf
    let size
    let fd = null
    try {
      fd = fs.openSync(file, 'r')
      size = fs.fstatSync(fd).size
      const len = Math.min(size, span)
      buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, size - len)
    } catch (_) {
      return null
    } finally {
      // closeSync именно в finally: раньше он стоял последней строкой try, и любое
      // исключение в fstat/read уводило в catch МИМО закрытия — дескриптор утекал.
      if (fd !== null) try { fs.closeSync(fd) } catch (_) {}
    }
    const lines = buf.toString('utf8').split('\n')
    let usage = null
    let title = null
    let lastPrompt = null
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(lines[i])
        if (!title && e.aiTitle) title = e.aiTitle
        // ПОСЛЕДНИЙ промпт из хвоста: в Claude Code 2.1.206 имя вкладки (tab.label) ==
        // последнему промпту пользователя (ai-title больше не пишется, обновляется на
        // каждое сообщение — см. Ремонт 2026-07-10). Берём ближайший к концу.
        if (!lastPrompt && e.type === 'last-prompt' && e.lastPrompt) lastPrompt = String(e.lastPrompt)
        if (!usage) {
          const u = e.message && e.message.usage
          // <synthetic> — служебные записи (model "<synthetic>", контекст 0): пропускаем.
          if (u && e.message.model !== '<synthetic>') {
            usage = {
              tokens:
                (u.input_tokens || 0) +
                (u.cache_creation_input_tokens || 0) +
                (u.cache_read_input_tokens || 0),
              modelId: e.message.model,
              cwd: e.cwd || '',
            }
          }
        }
        // Выходим, только собрав ВСЕ ТРИ. Раньше было `usage && lastPrompt` — «aiTitle
        // опционален, в 2.1.206 его не пишут». Но в 2.1.210 ai-title ВЕРНУЛИ, а usage и
        // last-prompt лежат у самого конца файла, тогда как ai-title — десятки КБ дальше:
        // цикл (идёт с конца назад) обрывался ДО него → title=null → вкладка не находила
        // свою сессию → FALLBACK на MRU/LAST-ACTIVE → HUD показывал ЧУЖИЕ цифры.
        // Доказано 2026-07-17 на 8b7679b9: ai-title в 29 КБ от конца, HUD читал null.
        // Цена полного прохода — один буфер хвоста (128К), он уже прочитан в память.
        if (usage && lastPrompt && title) break
      } catch (_) {}
    }
    if (usage) return { ...usage, title, lastPrompt }
    // Прочитали весь файл, usage нет. Если промпт ЕСТЬ (чат создан, но ассистент ещё не
    // ответил → нет message.usage) — это новый чат, контекст 0: возвращаем с tokens=0,
    // чтобы сессия попала в список и её вкладка сматчилась (иначе выпадала → FALLBACK на чужую).
    if (size <= span) return lastPrompt ? { tokens: 0, modelId: '', cwd: '', title, lastPrompt } : null
  }
  return null
}

// Заголовок из ГОЛОВЫ файла (первые 512К): у части сессий ai-title пишется один раз
// в начале (строки ~14-18) и в хвост никогда не попадает — без этого их вкладки не
// матчились. Берём ПОСЛЕДНЮЮ ai-title запись головы. Кэш: голова append-only файла
// не меняется → найденный title вечен; null перечитываем только пока файл дорастает
// до полного окна головы.
const HEAD_SPAN = 524288
const _titleCache = new Map()
function readTitleHead(file) {
  const c = _titleCache.get(file)
  if (c && (c.title !== null || c.scanned >= HEAD_SPAN)) return c.title
  // Размер берём statSync'ом, БЕЗ открытия файла: самая частая ветка ниже («не выросло»)
  // данных не читает, и дескриптор ей не нужен. Раньше здесь стоял openSync+fstatSync, а
  // ранний return уходил мимо closeSync — fd утекал на КАЖДОМ тике по каждой завершённой
  // сессии (≈6 за тик), окно упиралось в лимит ~8192 за 2-5 ч, и тогда у Claude Code
  // падало чтение settings.json → его catch писал поверх пустой конфиг. Это и была
  // причина обнулений конфига, которые ловились с 10.07.2026 (доказано 20.07 репро-тестом).
  let size
  try {
    size = fs.statSync(file).size
  } catch (_) {
    return null
  }
  if (c && c.title === null && size <= c.scanned) return null // не выросло — не перечитываем
  const scanned = Math.min(size, HEAD_SPAN)
  let buf
  let fd = null
  try {
    fd = fs.openSync(file, 'r')
    buf = Buffer.alloc(scanned)
    fs.readSync(fd, buf, 0, scanned, 0)
  } catch (_) {
    return null
  } finally {
    if (fd !== null) try { fs.closeSync(fd) } catch (_) {}
  }
  const lines = buf.toString('utf8').split('\n')
  let title = null
  for (const ln of lines) {
    if (!ln.includes('aiTitle')) continue
    try {
      const e = JSON.parse(ln)
      if (e.aiTitle) title = e.aiTitle // последняя в голове — самая свежая
    } catch (_) {}
  }
  _titleCache.set(file, { scanned, title })
  return title
}

// cwd → имя папки projects (как у Claude Code): не-буквенно-цифровое → '-'.
function munge(p) {
  return String(p || '').replace(/[^a-zA-Z0-9]/g, '-')
}

// Кэш usage по mtime: перечитываем хвост только если файл изменился (иначе из кэша).
// Обоснование глоб. mutable: пересборка строки идёт каждые 5с по N сессий проекта —
// без кэша это N×128КБ чтений/тик; инвалидация по mtime корректна. infra-уровень.
const _usageCache = new Map()
function readUsageCached(fp, mtime) {
  const c = _usageCache.get(fp)
  if (c && c.mtime === mtime) return c.data
  const data = readUsage(fp)
  _usageCache.set(fp, { mtime, data })
  return data
}

// Сессии этого проекта (вкл. подпапки), от свежей к старой: [{ fp, mtime, tokens, modelId }].
// Двухступенчато: дёшево сужаем по имени папки projects (munge-префикс workspace),
// затем точно фильтруем по cwd (belongs — отсекает personal-2 и т.п.). Без ws → [].
function listProjectSessions(workspacePath) {
  const want = normPath(workspacePath)
  if (!want) return []
  const tag = munge(workspacePath).toLowerCase()
  const out = []
  let projs
  try {
    projs = fs.readdirSync(PROJECTS)
  } catch (_) {
    return out
  }
  for (const p of projs) {
    // Регистронезависимый отсев по имени папки: VS Code отдаёт путь как `d:\…`, а
    // Claude мог создать папку из `D:\…` (`D--AI-Base` vs тег `d--AI-Base`). Пути на
    // Windows регистронезависимы — сравниваем так же, как normPath/belongs (lowercase).
    const pl = p.toLowerCase()
    if (pl !== tag && !pl.startsWith(tag + '-')) continue // быстрый отсев по имени папки
    const pdir = path.join(PROJECTS, p)
    let files
    try {
      files = fs.readdirSync(pdir)
    } catch (_) {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const fp = path.join(pdir, f)
      let mtime
      try {
        mtime = fs.statSync(fp).mtimeMs
      } catch (_) {
        continue
      }
      const r = readUsageCached(fp, mtime)
      // Принадлежность проекту: папка хранения === munge(workspace) → сессия ТОЧНО этого
      // проекта (Claude кладёт jsonl по cwd ЗАПУСКА, папка не меняется всю сессию). belongs
      // по runtime-cwd для корня НЕ проверяем: cwd ДРЕЙФУЕТ (CC 2.1.209 пишет в поле cwd
      // текущую bash-директорию — ложно отсекало активную сессию). Для подпапок (pdir=tag-*)
      // belongs по cwd остаётся — иначе не различить personal-2.
      if (r && (pl === tag || belongs(r.cwd, want))) {
        // aiTitle: хвост (свежайший) → голова (у части сессий пишется раз в начале).
        // Имя вкладки == aiTitle (сессии ≤2.1.205) ЛИБО последний промпт (2.1.206+) —
        // оба кладём в сессию, матчер вкладки (sessionForLabel) проверяет их вместе.
        const aiTitle = r.title || readTitleHead(fp)
        out.push({
          fp, mtime, tokens: r.tokens, modelId: r.modelId,
          title: aiTitle || r.lastPrompt, aiTitle, lastPrompt: r.lastPrompt,
        })
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

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

// Workflow/Task-активность: число свежих subagents/agent-*.jsonl (mtime внутри окна).
// Сессия пишет суб-агентов в <stem>/subagents/agent-<id>.jsonl; Glob их не видит —
// читаем через readdirSync. >0 → идёт оркестрация (workflow = пачка параллельно,
// одиночный Task = 1). nowMs параметром — для тестируемости.
// source: путь подтверждён cc-statusbar/src/transcript.ts; окно 45с — эвристика
// «агент ещё активен» (агенты живут секунды-минуты, тик HUD = 5с).
const SUBAGENT_FRESH_MS = 45000
function subagentActivity(sessionFile, nowMs) {
  if (!sessionFile) return 0
  const now = typeof nowMs === 'number' ? nowMs : Date.now()
  const dir = path.join(sessionFile.replace(/\.jsonl$/i, ''), 'subagents')
  let names
  try {
    names = fs.readdirSync(dir)
  } catch (_) {
    return 0
  }
  let n = 0
  for (const name of names) {
    if (!name.startsWith('agent-') || !name.endsWith('.jsonl')) continue
    try {
      if (now - fs.statSync(path.join(dir, name)).mtimeMs <= SUBAGENT_FRESH_MS) n++
    } catch (_) {}
  }
  return n
}

// Собирает объект строки (формат format.buildLine) из ВЫБРАННОЙ сессии + settings.
// session = { fp, tokens, modelId } | null. Выбор сессии (привязка к окну по фокусу/
// росту) делает extension.js. null → hasSession:false (окно покажет '—').
// subagents считаем здесь (дёшево); rate_limits подмешивает extension (usage.js).
function composeLine(session) {
  const s = readSettings()
  const win = ctxWindow(s.model, session && session.modelId)
  if (!session) {
    return {
      sessionFile: null,
      hasSession: false,
      subagents: 0,
      context_window: { total_input_tokens: 0, used_percentage: 0 },
      model: { id: s.model },
      effort: { level: s.effortLevel },
    }
  }
  return {
    sessionFile: session.fp,
    hasSession: true,
    subagents: subagentActivity(session.fp),
    context_window: {
      total_input_tokens: session.tokens,
      used_percentage: win ? Math.round((session.tokens / win) * 100) : 0,
    },
    model: { id: session.modelId },
    effort: { level: s.effortLevel },
  }
}

module.exports = {
  readSettings, ctxWindow, normPath, belongs, munge, listJsonl, readUsage,
  readTitleHead, subagentActivity, listProjectSessions, sessionByPath, composeLine,
}
