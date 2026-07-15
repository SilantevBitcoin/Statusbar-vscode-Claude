// Claude Context HUD — живой индикатор в нижней полосе VS Code: контекст активной
// вкладки-чата Claude, модель, effort, workflow-активность (⚙) и лимиты 5h/7d.
// Данные: data (jsonl + settings.json) + usage (api/oauth/usage) -> format.buildLine().
const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildLine } = require('./format')
const { listProjectSessions, composeLine, sessionByPath } = require('./data')
const { fetchUsage } = require('./usage')
const { loadRegistry } = require('./registry')
const { resolve, normLabel } = require('./resolve')

const DIR = path.join(os.homedir(), '.claude', 'ctx-hud')
const LOG_FILE = path.join(DIR, 'ext-active.log')
const NBSP = String.fromCharCode(160) // неразрывный пробел: не схлопывается в полосе
const USAGE_POLL_MS = 300000 // api/oauth/usage не чаще раза в 5 мин. source: cc-statusbar quota.minPollSeconds=300

function activate(context) {
  try {
    fs.mkdirSync(DIR, { recursive: true })
    fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' activated\n')
  } catch (_) {}

  // VS Code не умеет выравнивать по центру (только Left/Right). Центр имитируем
  // ведущими отступами (claudeCtxHud.padLeft) в группе Left.
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -1000)
  item.tooltip = 'Claude Code: контекст · модель · effort'
  item.text = 'ctx …'
  item.show()
  context.subscriptions.push(item)

  // Привязка к текущему проекту: берём только сессию с этим cwd (иначе индикатор
  // прыгает на свежий лог другого окна / sub-agent).
  const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]
  const workspacePath = ws ? ws.uri.fsPath : ''

  // Активная вкладка → её сессия. Имя вкладки Claude (tab.label) == aiTitle сессии
  // (поле в jsonl). По активной вкладке находим её jsonl и показываем ЕЁ контекст —
  // меняется при переключении вкладок. activeTitle держим последним известным, чтобы
  // при переходе на НЕ-Claude вкладку (файл/настройки) не терять привязку.
  let activeTitle = null
  let lastUsage = null // последние известные rate_limits (api/oauth/usage), null = ещё нет

  // Заголовок активной вкладки, если это webview-чат Claude. viewType реально приходит
  // как 'mainThreadWebview-claudeVSCodePanel' (с префиксом) — матчим по includes.
  // tab.label == aiTitle, НО усечён ('Изучить контекст програм…'); полное имя в сессии.
  function claudeTabTitle() {
    try {
      const g = vscode.window.tabGroups
      const tab = g && g.activeTabGroup && g.activeTabGroup.activeTab
      const vt = tab && tab.input && tab.input.viewType
      if (vt && String(vt).includes('claudeVSCodePanel')) return tab.label || null
    } catch (_) {}
    return null
  }

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
      if (t) activeTitle = t // запоминаем активный чат; не сбрасываем на не-Claude вкладке

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

  // Опрос лимитов (изолирован в usage.js). При неудаче lastUsage НЕ трём — пусть
  // висит последнее известное, а не мигает пропаданием.
  async function refreshUsage() {
    try {
      const r = await fetchUsage()
      if (r.state === 'ok') lastUsage = r.rate_limits
      update()
    } catch (_) {}
  }

  update()
  refreshUsage()
  const timer = setInterval(update, 5000)
  const usageTimer = setInterval(refreshUsage, USAGE_POLL_MS)
  context.subscriptions.push({
    dispose: () => {
      clearInterval(timer)
      clearInterval(usageTimer)
    },
  })
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
  // мгновенно реагируем на переключение вкладки (смена активного чата) и настройки
  if (vscode.window.tabGroups && vscode.window.tabGroups.onDidChangeTabs) {
    context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(() => update()))
  }
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeCtxHud')) update()
    }),
  )
}

function deactivate() {}

module.exports = { activate, deactivate }
