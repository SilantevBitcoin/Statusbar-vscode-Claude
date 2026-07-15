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
