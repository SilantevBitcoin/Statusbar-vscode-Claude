const { fmtK, modelName, effortAbbr, timeLeft, buildLine } = require('../format')

test('fmtK округляет к тысячам', () => {
  assertEq(fmtK(516489), '516k')
  assertEq(fmtK(0), '0k')
})

test('modelName парсит id с минором и без', () => {
  assertEq(modelName({ id: 'claude-opus-4-8' }), 'Opus 4.8')
  assertEq(modelName({ id: 'claude-fable-5' }), 'Fable 5')
  assertEq(modelName({ id: 'claude-sonnet-5' }), 'Sonnet 5')
  assertEq(modelName({ id: '', display_name: 'X' }), 'X')
})

test('effortAbbr маппинг', () => {
  assertEq(effortAbbr({ level: 'max' }), 'MAX')
  assertEq(effortAbbr({ level: 'xhigh' }), 'EH')
  assertEq(effortAbbr({ level: 'medium' }), 'MD')
  assertEq(effortAbbr(null), '')
})

test('timeLeft: дни при >суток, иначе часы/минуты', () => {
  const now = Math.floor(Date.now() / 1000)
  assertEq(timeLeft(now + 86400 + 3 * 3600 + 60), '1d3h')
  assertEq(timeLeft(now + 2 * 3600 + 12 * 60 + 30), '2h12')
  assertEq(timeLeft(now + 14 * 60 + 30), '14m')
  assertEq(timeLeft(0), '')
})

test('buildLine собирает сегменты и уважает opts', () => {
  const d = {
    context_window: { total_input_tokens: 516000, used_percentage: 52 },
    model: { id: 'claude-opus-4-8' },
    effort: { level: 'max' },
    subagents: 2,
    rate_limits: { five_hour: { used_percentage: 54 }, seven_day: { used_percentage: 62 } },
  }
  assertEq(buildLine(d), '516k 52% | Opus 4.8 | MAX | ⚙2 | 5h 54% | 7d 62%')
  assertEq(buildLine(d, { showLimits: false, showWorkflow: false }), '516k 52% | Opus 4.8 | MAX')
})
