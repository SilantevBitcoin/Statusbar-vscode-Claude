# Claude Context HUD

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
| Контекст | `516k 52%` | токенов в контексте активного чата и % от окна (200k или 1M для `[1m]`-моделей) |
| Модель | `Opus 4.8` | модель текущего ответа (`claude-opus-4-8` → `Opus 4.8`) |
| Effort | `MAX` | уровень reasoning: `L · MD · H · EH · MAX` (`EH+W` — ultracode, см. ниже) |
| Workflow | `⚙2` | активных суб-агентов прямо сейчас (есть только во время оркестрации) |
| Лимит 5ч | `5h 54% 14m` | израсходовано сессионного лимита + время до сброса |
| Лимит 7д | `7d 62%` | израсходовано недельного лимита |

`⚙` и сегменты лимитов появляются только когда есть данные: нет суб-агентов — нет `⚙`; не получены
лимиты — строка просто без них.

---

## Как это работает

- **Привязка к вкладке.** Claude Code открывает каждый чат как webview-вкладку. Имя вкладки (`tab.label`)
  совпадает с полем `aiTitle` в транскрипте сессии. По активной вкладке расширение находит её `*.jsonl`
  и показывает именно её контекст — поэтому при переключении вкладок индикатор меняется.
- **Контекст / модель.** Хвост (~128 КБ) свежего транскрипта
  `~/.claude/projects/<project>/<session>.jsonl`, поле `message.usage`. Служебные `<synthetic>`-записи
  пропускаются.
- **Effort.** `~/.claude/settings.json` → `effortLevel`.
- **Лимиты 5h/7d.** Один запрос `GET https://api.anthropic.com/api/oauth/usage` раз в 5 минут с OAuth-токеном
  подписки из `~/.claude/.credentials.json`. Это read-only метаданные — **токены модели не расходуются**.
- **Workflow.** Считает свежие `…/<session>/subagents/agent-*.jsonl` (изменённые за последние 45 секунд).

Никаких npm-зависимостей: чистый Node + VS Code API.

---

## Установка

### Быстро — через npx

```bash
npx github:SilantevBitcoin/Statusbar-vscode-Claude
```

Скрипт скопирует расширение в `~/.vscode/extensions/` и зарегистрирует его. После этого:
**`Ctrl/Cmd+Shift+P` → `Developer: Reload Window`**.

### Вручную

```bash
git clone https://github.com/SilantevBitcoin/Statusbar-vscode-Claude
cd claude-ctx-hud
node install.js
```

Затем `Developer: Reload Window`. Чтобы убедиться, что расширение активировалось, посмотри
`~/.claude/ctx-hud/ext-active.log` (туда пишется строка `activated`).

### Удаление

Удали папку `~/.vscode/extensions/local.claude-ctx-hud-0.0.1/` и запись `local.claude-ctx-hud` из
`~/.vscode/extensions/extensions.json`, затем перезагрузи окно.

---

## Настройки

В `settings.json` VS Code:

| Настройка | По умолчанию | Описание |
|---|---|---|
| `claudeCtxHud.padLeft` | `50` | ведущие неразрывные пробелы — сдвиг вправо для псевдо-центрирования (VS Code не умеет центр в статус-баре). Подбирается под ширину окна |
| `claudeCtxHud.ultracode` | `false` | если ты в ultracode-режиме (`xhigh` + workflows) — показывать `EH+W` вместо `EH`. Авто-детект невозможен (флаг session-only, в файлы не пишется) |

---

## Как менять

Структура (`extension/`):

- `data.js` — чтение jsonl и settings, сборка списка сессий проекта, контекст, заголовки, workflow. Без vscode.
- `format.js` — чистые форматтеры строки (модель, effort, лимиты, `⚙`). Без vscode → тестируется в node.
- `usage.js` — изолированный модуль лимитов (`api/oauth/usage`). Вся auth/сеть — здесь.
- `extension.js` — связка с VS Code: статус-бар, таймеры, привязка по активной вкладке.

Логику без VS Code можно гонять напрямую:

```bash
node -e 'const {buildLine}=require("./extension/format"); console.log(buildLine({context_window:{total_input_tokens:45000,used_percentage:23},model:{id:"claude-opus-4-8"},effort:{level:"xhigh"},subagents:2},false))'
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

## Благодарности

Идеи и подходы подсмотрены у terminal- и GUI-статуслайнов сообщества: `sirmalloc/ccstatusline`,
`Solux-dev/cc-statusbar`, `long-910/vscode-claude-status`, `leeguooooo/claude-code-usage-bar`,
`Owloops/claude-powerline`, `REPOZY/Claude-Session-Tracker`.

## Лицензия

MIT.
