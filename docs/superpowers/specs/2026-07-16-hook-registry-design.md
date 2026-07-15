# Claude Context HUD v0.2 — хук-реестр (design)

Дата: 2026-07-16. Статус: одобрен Egor (вариант A из трёх).

## Проблема

HUD ломается при апдейтах Claude Code, потому что целиком стоит на недокументированных
внутренностях: формат jsonl-транскриптов, способ именования вкладок, поведение cwd.
За месяц (см. MEMORY.md): ai-title убрали (2.1.206) → вернули (2.1.210); имя вкладки
aiTitle → lastPrompt → aiTitle; cwd в записях стал дрейфовать за bash (2.1.209);
settings.json перезаписывается неатомарно (пойман 0 байт). Anthropic официально:
формат транскриптов «is internal … can break on any release» (docs/sessions).
Отказы тихие: при разрыве моста вкладка↔сессия HUD молча показывает чужую сессию.
Плюс дрейф копий: фиксы попадали в рабочую копию (~/.vscode/extensions/…), минуя архив.

Проверено экспериментально 2026-07-16 (CC 2.1.210):

- statusLine в GUI-панели НЕ вызывается (status.json месяц не обновлялся при живой
  GUI-сессии) — официальный statusLine-контракт для GUI недоступен, issue жив.
- Хуки в GUI РАБОТАЮТ (SessionStart этой сессии отработал). Дают документированные
  session_id, transcript_path, cwd, prompt_text (UserPromptSubmit), session_title/
  model/source (SessionStart). Есть `async: true` — не блокирует CC.
- Токенов контекста в хуках НЕТ → чтение message.usage из jsonl остаётся
  единственным источником токенов в GUI.

## Решение — принцип

У каждого элемента HUD ≥1 официальный источник + фолбэк; деградация ступенчатая и
видимая (маркер, tooltip, Diagnose), а не тихая подмена. Ремонт после breaking
change — локализация слоя за минуты (selftest), а не день.

## Архитектура

```
Слой 1 REG   — хук-реестр (официальный контракт hooks)
Слой 2 JSONL — текущий матчинг aiTitle/lastPrompt по транскриптам
Слой 3 CACHED — последняя успешная привязка вкладки (_tabCache)
Слой 4 LAST-ACTIVE — сессия последнего промпта проекта (из реестра)
Слой 5 MRU   — свежайшая по mtime (как сейчас)
```

Ступени 4–5 → маркер `≈` в строке (настройка `claudeCtxHud.markFallback`, default true).

## Компоненты

### 1. `~/.claude/ctx-hud/hook.js` (новый, zero-deps node, ~60 строк)

Вешается на SessionStart и UserPromptSubmit (`async: true`). Читает stdin-JSON,
append одной строки в `~/.claude/ctx-hud/registry.jsonl`:

```json
{"ts":1752616800000,"ev":"prompt","sid":"<session_id>","tp":"<transcript_path>","cwd":"<cwd>","prompt":"<первые 200 симв. prompt_text>"}
{"ts":…,"ev":"start","sid":"…","tp":"…","cwd":"…","title":"<session_title|null>","model":"<model|null>","source":"startup|resume|clear|compact"}
```

- Ротация: файл > 512 КБ → оставить последние 300 строк, переписать через tmp+rename
  (атомарно — урок нулевого settings.json).
- Всё в try/catch, exit 0 всегда: хук никогда не мешает Claude.
- prompt обрезается до 200 символов: для матчинга хватает (label вкладки ~25 симв.),
  реестр компактный, лишнего не храним.

### 2. Правка `~/.claude/settings.json` (разрешена выбором варианта A)

Перед правкой — бэкап `settings.json.bak-ctxhud`. Добавить в существующие массивы
`hooks.SessionStart` и `hooks.UserPromptSubmit` по группе:

```json
{"hooks":[{"type":"command","command":"node \"C:/Users/silan/.claude/ctx-hud/hook.js\"","async":true,"timeout":15}]}
```

Больше в системе ничего не трогается.

### 3. `extension/registry.js` (новый, ~80 строк, без vscode)

- `loadRegistry()` — чтение registry.jsonl с кэшем по mtime → Map
  `sid → {tp, cwd, title, model, prompts[последние 8], lastPromptTs}`.
  Битые строки пропускаются (append-гонки).
- `candidatesFor(entry)` → `[title, ...prompts]` — кандидаты имени вкладки.
- `latestForProject(reg, ws)` → запись с max lastPromptTs среди `belongs(cwd, ws)`.

### 4. `extension/resolve.js` (новый, чистый, тестируемый)

Вся цепочка привязки одной функцией:
`resolve({label, registry, sessions, tabCache, ws})` → `{fp, via}` где
`via ∈ REG|JSONL|CACHED|LAST-ACTIVE|MRU|none`. Использует существующую
normLabel/exact→prefix логику для REG и JSONL одинаково.
`extension.js` только собирает входы и рисует.

### 5. `extension/extension.js` (правки)

- Вызов resolve.js вместо встроенного sessionForLabel; `_tabCache` (из рабочей
  копии) переезжает в resolve-входы.
- Выбранная через REG сессия читается по `tp` напрямую (`readUsageCached`) — без
  сканов папок projects (munge/регистр-грабли уходят с основного пути; скан остаётся
  для JSONL/MRU).
- Маркер `≈` при via LAST-ACTIVE/MRU; tooltip: `via + заголовок сессии + health`.
- Команда `Claude HUD: Diagnose` → OutputChannel: все Claude-вкладки, их кандидаты,
  via каждой, свежесть реестра, версии CC свежих сессий. Вечный tab-diag.log удалить.
- Health-check: в проекте есть jsonl с mtime < 10 мин, а в реестре нет записей
  свежее 24 ч → warning в tooltip («hook-реестр молчит — Diagnose»). В строку не орать.

### 6. `extension/data.js` (минимальные правки)

- Портировать фиксы, живущие только в рабочей копии: `tokens=0` для нового чата без
  ответа ассистента; принадлежность `pl === tag || belongs(...)` (дрейф cwd 2.1.209).
- Охота за aiTitle/lastPrompt остаётся — это слой JSONL.

### 7. `install.js --dev` (дрейф копий)

`node install.js --dev` копирует `extension/*` из архива в рабочую копию
(`~/.vscode/extensions/SilantevBitcoin.claude-ctx-hud-0.1.0/`). Ручной `cp` уходит.
Правило: правки ТОЛЬКО в архиве → `--dev` → Reload Window.

### 8. `extension/selftest.js` (новый)

Офлайн-прогон на живых данных без vscode: для 5 свежих сессий проекта — sid,
кандидаты, via; свежесть реестра; вывод «что сломано, какой слой». Инструмент
«CC обновился — проверить за 30 сек».

## Что НЕ трогаем

- `usage.js` — лимиты 5h/7d через api/oauth/usage: работает, изолирован,
  официальной альтернативы в GUI нет (statusLine мёртв — проверено).
- `format.js` — чистый и стабильный.
- ⚙ workflow — mtime-эвристика `subagents/` работает; хуки SubagentStart/Stop
  не подключаем (YAGNI).

## Граничные случаи

- Сессии, начатые до установки хука: нет в реестре → ловит JSONL; активные чаты
  войдут в реестр с первым же промптом.
- resume / `/clear` / compact: SessionStart пишет запись с source → реестр свежий.
- Гонка append из параллельных сессий: O_APPEND, строки < 1 КБ; битые строки
  пропускаются парсером; ротация чистит.
- Несколько окон VS Code: реестр глобальный, фильтр `belongs(cwd, ws)` на чтении.
- Приватность: 200 символов промпта в `~/.claude/ctx-hud/` — рядом с транскриптами,
  где промпты и так целиком; наружу не уходит.
- Хук отвалился (CC перестал звать / конфиг снесли): health-check подсветит,
  слои JSONL/CACHED/MRU продолжают работать.

## Тест-план

- Тесты МАТЕРИАЛИЗОВАТЬ в `extension/test/` (запуск `node extension/test/run.js`):
  «9 тестов» прошлых ремонтов жили одноразовыми скриптами в истории сессий и в
  репо отсутствуют — воспроизвести покрытие data/format (readUsage: synthetic,
  адаптивный хвост, tokens=0; ctxWindow; matcher-кандидаты) как файлы.
- Новые node-тесты: registry (парс, битые строки, ротация, candidatesFor,
  latestForProject), resolve (все 5 ступеней, приоритет, маркер-условие),
  hook.js (обрезка промпта, ротация, невалидный stdin → exit 0).
- selftest.js на живых данных: активные вкладки после первого промпта — via=REG.
- Ручная проверка: переключение вкладок меняет строку ≤ 1 тика (5 с); пустой
  реестр → поведение как сейчас (JSONL); маркер ≈ только на ступенях 4–5.

## Критерии успеха

1. Привязка вкладка↔сессия работает через официальный hooks-контракт (via=REG в
   обычной работе), jsonl-матчинг — только фолбэк.
2. Ни одного тихого показа чужой сессии: фолбэк всегда помечен.
3. Следующий breaking change CC локализуется selftest/Diagnose за минуты.
4. Копии не дрейфуют (install.js --dev — единственный путь доставки).

## Объём и версия

~400 строк: hook.js ~60, registry.js ~80, resolve.js ~60, правки extension.js ~60,
data.js ~20, install.js ~20, selftest ~40, тесты ~150.

Релиз: **0.2.0** (сейчас архив 0.1.1, рабочая копия 0.1.0 с ручными патчами —
дрейф закрывается этим релизом).
