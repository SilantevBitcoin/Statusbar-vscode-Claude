// Мини-раннер тестов: node extension/test/run.js — гоняет все *.test.js этой папки.
// Без npm: глобальные test()/assertEq() достаточно для наших чистых модулей.
const fs = require('fs')
const path = require('path')
let pass = 0
let fail = 0
global.test = (name, fn) => {
  try {
    fn()
    pass++
    console.log('  ok', name)
  } catch (e) {
    fail++
    console.error('  FAIL', name, '\n    ', e.message)
  }
}
global.assertEq = (actual, expected, msg) => {
  const ja = JSON.stringify(actual)
  const je = JSON.stringify(expected)
  if (ja !== je) throw new Error((msg || 'assertEq') + ': expected ' + je + ' got ' + ja)
}
for (const f of fs.readdirSync(__dirname).sort()) {
  if (!f.endsWith('.test.js')) continue
  console.log(f)
  require(path.join(__dirname, f))
}
console.log('\n' + pass + ' ok, ' + fail + ' fail')
process.exit(fail ? 1 : 0)
