// Diagnostic-only script. Verifies the three new Search tab features
// (equip presets, equip-type filter, "already have" item tags) actually
// work in a real browser, not just the Rust unit tests. Run with:
//   node scripts/diagnose-newfeatures.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })

const problems = []
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`))
page.on('requestfailed', (req) => problems.push(`[requestfailed] ${req.url()} - ${req.failure()?.errorText}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`[console.error] ${msg.text()}`)
})

await page.goto('http://localhost:5175/')
await page.waitForTimeout(2500)
console.log('status:', await page.locator('#status').textContent())

console.log('\n--- equip-type filter: checking checkboxes rendered ---')
const typeCheckboxes = page.locator('.equip-type-checkbox')
console.log('equip-type checkbox count:', await typeCheckboxes.count())
const firstTypeLabel = await page.locator('.equip-type-option').first().textContent()
console.log('first type label:', firstTypeLabel?.trim())

console.log('\n--- presets panel: set a Head preset with a decoration ---')
await page.locator('.skill-group-header', { hasText: 'Offense and Adren' }).click()
await page.waitForTimeout(150)
await page.locator('.skill-leaf', { hasText: 'Attack' }).first().dblclick()
await page.waitForTimeout(150)

// Grab a real head piece name + a real jewel name from the data browser so
// the preset resolves against actual loaded data.
await page.locator('.tab-button', { hasText: 'Data Browser' }).click()
await page.waitForTimeout(200)
const headName = await page.locator('#table-body tr').first().locator('td').first().textContent()
console.log('picked head piece:', headName)
await page.locator('.category-tab', { hasText: 'Jewel' }).click()
await page.waitForTimeout(200)
const jewelName = await page.locator('#table-body tr').first().locator('td').first().textContent()
console.log('picked jewel:', jewelName)

console.log('\n--- tagging that jewel as "MyGear" in the Data Browser ---')
const jewelTagInput = page.locator('#table-body tr').first().locator('.tags-input')
await jewelTagInput.fill('MyGear')
await jewelTagInput.press('Tab')
await page.waitForTimeout(150)

await page.locator('.tab-button', { hasText: 'Search' }).click()
await page.waitForTimeout(200)

const headPresetInput = page.locator('.preset-piece-input[data-slot="head"]')
await headPresetInput.fill(headName ?? '')
await headPresetInput.press('Tab')
const headDecoInput = page.locator('.preset-deco-input[data-slot="head"]')
await headDecoInput.fill(jewelName ?? '')
await headDecoInput.press('Tab')
await page.waitForTimeout(150)
await page.screenshot({ path: '/tmp/screenshot-presets-filled.png' })

console.log('\n--- tag filter dropdown: confirm "MyGear" shows up ---')
const tagOptions = await page.locator('#tag-filter option').allTextContents()
console.log('tag filter options:', tagOptions)

console.log('\n--- running the search with the Head preset set ---')
await page.locator('#run-search-btn').click()
await page.waitForTimeout(1000)
const summary = await page.locator('#results-summary').textContent()
console.log('results summary:', summary)

const firstResultHead = await page.locator('#results-body tr').first().locator('td').nth(4).textContent()
console.log('first result Head column:', firstResultHead, '(expected to equal the preset:', headName, ')')

console.log('\n--- problems observed ---')
console.log(problems.length === 0 ? 'none' : problems.join('\n'))

await browser.close()
