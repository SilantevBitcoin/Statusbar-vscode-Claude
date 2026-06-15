#!/usr/bin/env node
// Установщик Claude Context HUD: копирует extension/ в ~/.vscode/extensions/ и
// регистрирует в extensions.json (VS Code грузит расширения ПО РЕЕСТРУ, не сканируя
// папки). После установки нужен Reload Window. Идемпотентно — можно запускать повторно.
const fs = require('fs')
const os = require('os')
const path = require('path')

const EXT_ID = 'local.claude-ctx-hud'
const VERSION = '0.0.1'
const DIRNAME = `${EXT_ID}-${VERSION}`

const src = path.join(__dirname, 'extension')
const extRoot = path.join(os.homedir(), '.vscode', 'extensions')
const dest = path.join(extRoot, DIRNAME)

// Windows-путь → file-uri path: C:\Users\x → /c:/Users/x (drive в нижнем регистре).
function toFileUriPath(p) {
  let s = p.replace(/\\/g, '/')
  if (!s.startsWith('/')) s = '/' + s
  return s.replace(/^\/([A-Za-z]):/, (_, d) => '/' + d.toLowerCase() + ':')
}

try {
  if (!fs.existsSync(src)) {
    console.error('✗ Не найдена папка extension/ рядом с install.js')
    process.exit(1)
  }

  // 1. копируем файлы расширения
  fs.mkdirSync(dest, { recursive: true })
  let copied = 0
  for (const f of fs.readdirSync(src)) {
    if (fs.statSync(path.join(src, f)).isFile()) {
      fs.copyFileSync(path.join(src, f), path.join(dest, f))
      copied++
    }
  }

  // 2. регистрируем в extensions.json (заменяем прежнюю запись, если была)
  const regFile = path.join(extRoot, 'extensions.json')
  let reg = []
  try {
    reg = JSON.parse(fs.readFileSync(regFile, 'utf8'))
  } catch (_) {}
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

  console.log(`✓ Claude Context HUD установлен (${copied} файлов):`)
  console.log('  ' + dest)
  console.log('')
  console.log('→ Перезагрузи окно: Ctrl/Cmd+Shift+P → Developer: Reload Window')
} catch (e) {
  console.error('✗ Ошибка установки:', e.message)
  process.exit(1)
}
