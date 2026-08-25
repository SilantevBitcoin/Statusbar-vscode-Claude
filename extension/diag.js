// Диагностический лог РЕДКИХ аномалий (не вечный tab-diag: тот шумел и был убран).
// Пишем только СМЕНУ состояния, а не каждый тик: update() зовётся раз в 5с, без дедупа
// это 720 строк/час. Ловим два события, которые иначе проходят молча:
//   settings — settings.json нечитаем/пуст (catch в data.readSettings глотал тихо);
//   fallback — привязка вкладки ушла на LAST-ACTIVE/MRU, т.е. HUD показывает чужую сессию.
const fs = require('fs')
const os = require('os')
const path = require('path')

const DIAG = path.join(process.env.CTX_HUD_DIR || path.join(os.homedir(), '.claude', 'ctx-hud'), 'diag.log')
const MAX_BYTES = 512 * 1024

const _last = new Map() // kind -> последняя сигнатура состояния

// Сторож .credentials.json. Зачем: CC 2.1.211 читает его так —
//   read(){ try{ return parse(readFileSync(path)) } catch { return null } }
// без ретрая и без лога. Любой сбой чтения → null → "No authentication found" →
// экран логина на новой вкладке (симптом Egor 17.07; флаг tengu_windows_credman=false,
// т.е. путь именно plaintext, Credential Manager не задействован). Файл перезаписывается
// при refresh токена — в это окно чужое чтение и попадает. Сами читаем так же, как CC:
// если у НАС не читается — значит и у CC в этот момент не читалось.
function credentialsProbe() {
  const p = path.join(os.homedir(), '.claude', '.credentials.json')
  try {
    const raw = fs.readFileSync(p, 'utf8')
    const ok = !!JSON.parse(raw).claudeAiOauth
    diagLog('credentials', ok ? 'ok' : 'no-oauth', ok ? null : 'credentials.json прочитан, но claudeAiOauth ПУСТ — CC покажет экран логина')
  } catch (e) {
    let size = -1
    try { size = fs.statSync(p).size } catch (_) {}
    diagLog('credentials', 'bad:' + size, '.credentials.json НЕЧИТАЕМ: size=' + size + ' байт | ' + e.message + ' → CC в этот момент показал бы логин')
  }
}

// kind: класс события; sig: сигнатура состояния (равна прошлой -> молчим);
// detail: строка в лог, либо null = состояние вернулось в норму (только сбросить дедуп).
function diagLog(kind, sig, detail) {
  try {
    if (_last.get(kind) === sig) return
    _last.set(kind, sig)
    if (detail === null) return
    try {
      if (fs.statSync(DIAG).size > MAX_BYTES) fs.renameSync(DIAG, DIAG + '.1')
    } catch (_) {}
    fs.appendFileSync(DIAG, new Date().toISOString() + ' ' + kind + ' | ' + detail + '\n')
  } catch (_) {} // диагностика НИКОГДА не ломает HUD
}

function resetDedup() {
  _last.clear()
}

module.exports = { diagLog, resetDedup, credentialsProbe, DIAG }
