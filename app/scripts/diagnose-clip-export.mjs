// Diagnostic-only script. Verifies the equipment-clip export (copy as
// text/image, save as PNG) and the preset-picker tag filter work in a real
// browser. Run with:
//   node scripts/diagnose-clip-export.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch()
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
const page = await context.newPage()

const problems = []
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`))
page.on('requestfailed', (req) => problems.push(`[requestfailed] ${req.url()} - ${req.failure()?.errorText}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`[console.error] ${msg.text()}`)
})

await page.goto('http://localhost:5173/')
await page.waitForTimeout(2500)
console.log('status:', await page.locator('#status').textContent())

console.log('\n--- running a quick search so a result is selectable ---')
await page.locator('.skill-group-header', { hasText: 'Offense and Adren' }).click()
await page.waitForTimeout(150)
await page.locator('.skill-leaf', { hasText: 'Attack' }).first().dblclick()
await page.locator('#run-search-btn').click()
await page.waitForTimeout(1000)
console.log('results summary:', await page.locator('#results-summary').textContent())

console.log('\n--- selecting the first result row ---')
await page.locator('#results-body tr').first().click()
await page.waitForTimeout(200)

console.log('\n--- Copy as Text ---')
await page.locator('#clip-copy-text-btn').click()
await page.waitForTimeout(200)
console.log('clip status:', await page.locator('#clip-status').textContent())
const clipText = await page.evaluate(() => navigator.clipboard.readText())
console.log('clipboard text (first 400 chars):\n' + clipText.slice(0, 400))

console.log('\n--- Copy as Image ---')
await page.locator('#clip-copy-image-btn').click()
await page.waitForTimeout(200)
console.log('clip status:', await page.locator('#clip-status').textContent())
const hasImage = await page.evaluate(async () => {
  const items = await navigator.clipboard.read()
  return items.some((i) => i.types.includes('image/png'))
})
console.log('clipboard has image/png:', hasImage)

console.log('\n--- preset tag filter: tag a head piece, check the filter UI ---')
await page.locator('.tab-button', { hasText: 'Data Browser' }).click()
await page.waitForTimeout(200)
const headName = await page.locator('#table-body tr').first().locator('td').first().textContent()
await page.locator('#table-body tr').first().locator('.tags-input').fill('ClipTest')
await page.locator('#table-body tr').first().locator('.tags-input').press('Tab')
await page.waitForTimeout(150)
await page.locator('.tab-button', { hasText: 'Search' }).click()
await page.waitForTimeout(200)
console.log('preset tag filter checkboxes:', await page.locator('.preset-tag-checkbox').count())
await page.locator('.equip-type-option', { hasText: 'ClipTest' }).locator('.preset-tag-checkbox').check()
await page.waitForTimeout(150)
const headOptions = await page.locator(`#preset-piece-list-head option`).evaluateAll((els) => els.map((e) => e.getAttribute('value')))
console.log('head datalist options after filtering to ClipTest tag:', headOptions)
console.log('expected only:', headName)

console.log('\n--- problems observed ---')
console.log(problems.length === 0 ? 'none' : problems.join('\n'))

await browser.close()
