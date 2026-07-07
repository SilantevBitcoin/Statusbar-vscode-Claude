# Claude Context HUD

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/SilantevBitcoin.claude-ctx-hud?label=VS%20Code%20Marketplace&color=1e1e1e)](https://marketplace.visualstudio.com/items?itemName=SilantevBitcoin.claude-ctx-hud)
[![Open VSX](https://img.shields.io/open-vsx/v/SilantevBitcoin/claude-ctx-hud?label=Open%20VSX&color=D97757)](https://open-vsx.org/extension/SilantevBitcoin/claude-ctx-hud)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Лёгкое VS Code-расширение, которое показывает в нижней статус-полосе живую сводку по **активной
вкладке-чату Claude Code**: сколько занято контекста, какая модель и effort, идёт ли сейчас
оркестрация суб-агентов и сколько осталось от лимитов подписки (5 часов / 7 дней).

```
516k 52% | Opus 4.8 | MAX | ⚙2 | 5h 54% 14m | 7d 62%
```

Без сервера и телеметрии — читает локальные файлы Claude Code, плюс один read-only запрос к Anthropic
за процентами лимитов. Переключаешь вкладку-чат — индикатор мгновенно показывает её контекст.

> Скриншот: _добавь сюда `docs/screenshot.png`_ — расширение рисует одну строку в самом низу окна VS Code.

---

## Что показывает

| Сегмент | Пример | Что значит |
|---|---|---|
| Контекст | `516k 52%` | токенов в контексте активного чата и % от окна **модели этой сессии** (200k; 1M для Fable/Mythos и `[1m]`-моделей Opus/Sonnet) |
| Модель | `Opus 4.8` | модель текущего ответа (`claude-opus-4-8` → `Opus 4.8`, `claude-fable-5` → `Fable 5`) |
| Effort | `MAX` | уровень reasoning: `L · MD · H · EH · MAX` |
| Workflow | `⚙2` | активных суб-агентов прямо сейчас (есть только во время оркестрации) |
| Лимит 5ч | `5h 54% 14m` | израсходовано сессионного лимита + время до сброса |
| Лимит 7д | `7d 62%` | израсходовано недельного лимита |

`⚙` и сегменты лимитов появляются только когда есть данные: нет суб-агентов — нет `⚙`; не получены
лимиты — строка просто без них. Сегменты `⚙` и лимитов можно отключить в настройках.

---

## Как это работает

- **Привязка к вкладке.** Claude Code открывает каждый чат как webview-вкладку. Имя вкладки (`tab.label`)
  совпадает с записью `aiTitle` в транскрипте сессии. По активной вкладке расширение находит её `*.jsonl`
  и показывает именно её контекст — поэтому при переключении вкладок индикатор меняется. Заголовок ищется
  в хвосте транскрипта, а если его там нет (у части сессий он записан один раз в начале файла) — в голове.
- **Контекст / модель.** Хвост свежего транскрипта
  `~/.claude/projects/<project>/<session>.jsonl` (адаптивное окно 128 КБ → 2 МБ — отдельные записи бывают
  крупнее базового окна), поле `message.usage`. Служебные `<synthetic>`-записи пропускаются.
- **Effort.** `~/.claude/settings.json` → `effortLevel`.
- **Лимиты 5h/7d.** Один запрос `GET https://api.anthropic.com/api/oauth/usage` раз в 5 минут с OAuth-токеном
  подписки из `~/.claude/.credentials.json`. Это read-only метаданные — **токены модели не расходуются**.
- **Workflow.** Считает свежие `…/<session>/subagents/agent-*.jsonl` (изменённые за последние 45 секунд).

Никаких npm-зависимостей: чистый Node + VS Code API.

---

## Установка

### Из магазина (рекомендуется)

**VS Code Marketplace** — в VS Code открой панель Extensions (`Ctrl/Cmd+Shift+X`), найди
**«Claude Context HUD»** и нажми Install. Или из терминала:

```bash
code --install-extension SilantevBitcoin.claude-ctx-hud
```

**Open VSX** (Cursor / VSCodium / Windsurf) — найди **«Claude Context HUD»** во встроенном менеджере
расширений, либо скачай `.vsix` со [страницы Open VSX](https://open-vsx.org/extension/SilantevBitcoin/claude-ctx-hud)
и поставь через `Extensions: Install from VSIX…`.

После установки индикатор появляется в нижней статус-полосе автоматически.

### Из исходников — через npx

```bash
npx github:SilantevBitcoin/Statusbar-vscode-Claude
```

Скрипт скопирует расширение в `~/.vscode/extensions/` и зарегистрирует его. После этого:
**`Ctrl/Cmd+Shift+P` → `Developer: Reload Window`**.

### Из исходников — вручную

```bash
git clone https://github.com/SilantevBitcoin/Statusbar-vscode-Claude
cd Statusbar-vscode-Claude
node install.js
```

Затем `Developer: Reload Window`. Чтобы убедиться, что расширение активировалось, посмотри
`~/.claude/ctx-hud/ext-active.log` (туда пишется строка `activated`).

### Удаление

Из магазина — обычным Uninstall в панели Extensions. При ручной установке удали папку
`~/.vscode/extensions/SilantevBitcoin.claude-ctx-hud-*/` (или `local.claude-ctx-hud-*/`) и соответствующую
запись из `~/.vscode/extensions/extensions.json`, затем перезагрузи окно.

---

## Настройки

В `settings.json` VS Code (или в UI: Settings → Extensions → Claude Context HUD):

| Настройка | По умолчанию | Описание |
|---|---|---|
| `claudeCtxHud.padLeft` | `50` | ведущие неразрывные пробелы — сдвиг вправо для псевдо-центрирования (VS Code не умеет центр в статус-баре). Подбирается под ширину окна |
| `claudeCtxHud.showLimits` | `true` | показывать сегменты лимитов подписки `5h` / `7d` |
| `claudeCtxHud.showWorkflow` | `true` | показывать индикатор активных суб-агентов `⚙N` |

---

## Как менять

Структура (`extension/`):

- `data.js` — чтение jsonl и settings, сборка списка сессий проекта, контекст, заголовки, workflow. Без vscode.
- `format.js` — чистые форматтеры строки (модель, effort, лимиты, `⚙`). Без vscode → тестируется в node.
- `usage.js` — изолированный модуль лимитов (`api/oauth/usage`). Вся auth/сеть — здесь.
- `extension.js` — связка с VS Code: статус-бар, таймеры, привязка по активной вкладке.

Логику без VS Code можно гонять напрямую:

```bash
node -e 'const {buildLine}=require("./extension/format"); console.log(buildLine({context_window:{total_input_tokens:45000,used_percentage:23},model:{id:"claude-opus-4-8"},effort:{level:"xhigh"},subagents:2}))'
```

Цикл правки: меняешь `extension/*` → переустанавливаешь (`node install.js`) или копируешь файлы в рабочую
копию → `Developer: Reload Window`.

---

## Ограничения

- **Чаты, переименованные вручную:** если имя вкладки не совпадает с авто-`aiTitle`, привязка по заголовку
  не сработает — индикатор покажет свежайшую сессию проекта.
- **Новые/совсем короткие чаты** (ещё без `aiTitle`): показывается свежайшая сессия, пока заголовок не сгенерится.
- **Лимиты 5h/7d** требуют подписки Claude (Pro/Max) с OAuth-логином Claude Code. Эндпоинт
  `api/oauth/usage` недокументирован и может измениться; при сбое строка просто остаётся без лимитов.
- **Центрирование** (`padLeft`) приблизительное и съезжает при изменении ширины окна.

---

## История версий

### 0.1.0

Первый публичный релиз в VS Code Marketplace и Open VSX.

- Иконка расширения.
- Убран рудиментарный ручной тумблер `ultracode` (`EH+W`): активность оркестрации и так видна
  автоматически через `⚙N`, отдельный флаг был не нужен.
- Новые настройки `claudeCtxHud.showLimits` и `claudeCtxHud.showWorkflow` — можно скрыть сегменты
  лимитов и индикатор `⚙`.

### 0.0.2

Починка привязки к вкладке и процента контекста (симптомы: «долго переключается между вкладками, иногда не показывает данные»):

- **Заголовок вне хвоста.** У части сессий `aiTitle` записан один-два раза в начале файла и в хвост
  не попадает — вкладка не находила свою сессию и HUD показывал чужой чат, пока в своём не наберётся
  свежий транскрипт. Добавлен фолбэк-поиск заголовка в голове файла (кэш — начало файла не меняется).
- **Крупные записи прятали сессию.** Отдельные строки транскрипта бывают до ~1.7 МБ (tool-result с
  картинкой); если такая строка последняя, в 128 КБ хвоста нет ни одного целого JSON и сессия временно
  «исчезала». Окно чтения хвоста стало адаптивным: 128 КБ → 512 КБ → 2 МБ.
- **Неверный процент контекста.** Флаг `[1m]` из `settings.json` применялся к любой сессии, хотя выбор
  модели через `/model` в settings не пишется. Теперь окно определяется по модели самой сессии:
  Fable/Mythos — всегда 1M, `[1m]` — только для своей модели, остальное — 200k. Плюс распознавание
  одноцифровых версий: `claude-fable-5` → «Fable 5», `claude-sonnet-5` → «Sonnet 5».

### 0.0.1

Первый релиз: контекст/модель/effort по активной вкладке-чату, workflow-активность `⚙`, лимиты 5h/7d.

---

## Благодарности

Идеи и подходы подсмотрены у terminal- и GUI-статуслайнов сообщества: `sirmalloc/ccstatusline`,
`Solux-dev/cc-statusbar`, `long-910/vscode-claude-status`, `leeguooooo/claude-code-usage-bar`,
`Owloops/claude-powerline`, `REPOZY/Claude-Session-Tracker`.

## Лицензия

MIT.
