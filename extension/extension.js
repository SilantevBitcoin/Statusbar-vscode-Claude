// Claude Context HUD — живой индикатор в нижней полосе VS Code: контекст активной
// вкладки-чата Claude, модель, effort, workflow-активность (⚙) и лимиты 5h/7d.
// Данные: data (jsonl + settings.json) + usage (api/oauth/usage) -> format.buildLine().
const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildLine } = require('./format')
const { listProjectSessions, composeLine } = require('./data')
const { fetchUsage } = require('./usage')

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

  // Сессия по (возможно усечённому) заголовку вкладки: точное совпадение, иначе
  // префиксный матч до многоточия. При коллизии — свежайшая (sessions отсортирован).
  function sessionForLabel(sessions, label) {
    if (!label) return null
    const exact = sessions.find((s) => s.title === label)
    if (exact) return exact
    const pref = label.replace(/[…\s]+$/, '')
    if (pref && pref !== label) return sessions.find((s) => s.title && s.title.startsWith(pref)) || null
    return null
  }

  function update() {
    try {
      const cfg = vscode.workspace.getConfiguration('claudeCtxHud')
      const pad = cfg.get('padLeft', 0)
      const showLimits = cfg.get('showLimits', true)
      const showWorkflow = cfg.get('showWorkflow', true)
      const lead = NBSP.repeat(Math.max(0, pad))

      const t = claudeTabTitle()
      if (t) activeTitle = t // запоминаем активный чат; не сбрасываем на не-Claude вкладке

      const sessions = listProjectSessions(workspacePath)
      // сессия активной вкладки по её заголовку (точн./префикс); нет совпадения → свежайшая
      let chosen = activeTitle ? sessionForLabel(sessions, activeTitle) : null
      if (!chosen) chosen = sessions[0] || null

      const d = composeLine(chosen)
      if (!d.hasSession) {
        item.text = lead + '—'
        item.tooltip = 'Claude HUD: нет активной сессии'
        return
      }
      if (lastUsage) d.rate_limits = lastUsage
      item.text = lead + buildLine(d, { showLimits, showWorkflow })
      item.tooltip = (chosen.title || 'сессия') + '\n(контекст активной вкладки Claude)'
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
