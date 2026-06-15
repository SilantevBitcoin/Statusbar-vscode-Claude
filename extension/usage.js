// ISOLATED fragile module: лимиты подписки 5h/7d через OAuth-usage endpoint.
// Вся auth/сетевая логика — ЗДЕСЬ. Сменит Anthropic auth — патчим только этот файл,
// остальное расширение работает дальше (graceful: rate_limits=null → строка просто
// без сегментов лимитов). Способ A1: GET api/oauth/usage — read-only, 0 токенов модели.
// Формат ответа подтверждён живым запросом (200):
//   {"five_hour":{"utilization":50.0,"resets_at":"<ISO>"},"seven_day":{...}, ...}
const fs = require('fs')
const os = require('os')
const path = require('path')

const CRED = path.join(os.homedir(), '.claude', '.credentials.json')
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const TIMEOUT_MS = 12000

// OAuth-токен подписки (Max/Pro) из локального файла. Нет/битый → null.
function readToken() {
  try {
    const o = JSON.parse(fs.readFileSync(CRED, 'utf8'))
    const t = o && o.claudeAiOauth && o.claudeAiOauth.accessToken
    return typeof t === 'string' && t ? t : null
  } catch (_) {
    return null
  }
}

// ISO-8601 → unix seconds (timeLeft в format.js ждёт секунды). Невалидное → null.
function isoToSec(s) {
  const ms = Date.parse(s || '')
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

// Одно окно лимита из ответа → { used_percentage, resets_at(sec) } | null.
// Имя used_percentage — под существующий format.buildLine (он читает именно его).
function win(w) {
  if (!w || typeof w.utilization !== 'number') return null
  return { used_percentage: w.utilization, resets_at: isoToSec(w.resets_at) }
}

// Запрос лимитов. НИКОГДА не throw. → { rate_limits, state }.
// rate_limits = { five_hour?, seven_day? } (формат, понятный format.buildLine) или null.
// state: ok | no-credentials | error | rate-limited (для отладки/решений вызывающего).
async function fetchUsage() {
  const token = readToken()
  if (!token) return { rate_limits: null, state: 'no-credentials' }
  let resp
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      resp = await fetch(USAGE_URL, {
        headers: {
          Authorization: 'Bearer ' + token,
          'anthropic-beta': 'oauth-2025-04-20',
          'anthropic-version': '2023-06-01',
          'User-Agent': 'claude-ctx-hud',
        },
        signal: ctrl.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  } catch (_) {
    return { rate_limits: null, state: 'error' } // FAILS_ON: network down / connect timeout
  }
  if (resp.status === 429) return { rate_limits: null, state: 'rate-limited' }
  if (!resp.ok) return { rate_limits: null, state: 'error' }
  let j
  try {
    j = await resp.json()
  } catch (_) {
    return { rate_limits: null, state: 'error' }
  }
  const five = win(j.five_hour)
  const seven = win(j.seven_day)
  if (!five && !seven) return { rate_limits: null, state: 'error' }
  const rl = {}
  if (five) rl.five_hour = five
  if (seven) rl.seven_day = seven
  return { rate_limits: rl, state: 'ok' }
}

module.exports = { fetchUsage, readToken, isoToSec, win }
