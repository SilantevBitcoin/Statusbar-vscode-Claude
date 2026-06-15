// Сбор живых данных для HUD из локальных файлов Claude Code (без vscode/сети).
// Контекст + модель — из свежего jsonl-транскрипта ТЕКУЩЕГО проекта (по cwd);
// effort — из settings.json. rate_limits (5h/7d) в локальных файлах отсутствуют.
const fs = require('fs')
const os = require('os')
const path = require('path')

const HOME = os.homedir()
const PROJECTS = path.join(HOME, '.claude', 'projects')
const SETTINGS = path.join(HOME, '.claude', 'settings.json')

function readSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
    return { model: s.model || '', effortLevel: s.effortLevel || '' }
  } catch (_) {
    return { model: '', effortLevel: '' }
  }
}

// Окно контекста: модель с флагом 1m → 1M токенов, иначе 200k.
function ctxWindow(model) {
  return /1m|\[1m\]/i.test(model || '') ? 1000000 : 200000
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

// Из хвоста файла (~128 КБ) тянем последний реальный usage И заголовок чата (aiTitle).
// aiTitle = имя вкладки Claude (= tab.label) → связь вкладка↔сессия; оно дублируется
// почти в каждой записи, поэтому есть в хвосте даже у многомегабайтных файлов.
// Возвращает { tokens, modelId, cwd, title }.
function readUsage(file) {
  let buf
  try {
    const fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const len = Math.min(size, 131072)
    buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    fs.closeSync(fd)
  } catch (_) {
    return null
  }
  const lines = buf.toString('utf8').split('\n')
  let usage = null
  let title = null
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const e = JSON.parse(lines[i])
      if (!title && e.aiTitle) title = e.aiTitle
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
      if (usage && title) break
    } catch (_) {}
  }
  return usage ? { ...usage, title } : null
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
  const tag = munge(workspacePath)
  const out = []
  let projs
  try {
    projs = fs.readdirSync(PROJECTS)
  } catch (_) {
    return out
  }
  for (const p of projs) {
    if (p !== tag && !p.startsWith(tag + '-')) continue // быстрый отсев по имени папки
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
      if (r && belongs(r.cwd, want)) out.push({ fp, mtime, tokens: r.tokens, modelId: r.modelId, title: r.title })
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
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
  const win = ctxWindow(s.model)
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
  subagentActivity, listProjectSessions, composeLine,
}
