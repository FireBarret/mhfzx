// One-off diagnostic for search-session persistence (localStorage). Run
// with the dev server already up: node scripts/diagnose-persist.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (err) => errors.push(err.message))
page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()))

await page.goto('http://localhost:5173/')
await page.waitForTimeout(2500)

console.log('--- adding a skill, changing job filter and max results ---')
await page.locator('.skill-group-header', { hasText: 'Offense and Adren' }).click()
await page.waitForTimeout(200)
await page.locator('.skill-leaf', { hasText: 'Attack' }).first().dblclick()
await page.locator('#job-filter').selectOption('Blademaster')
await page.locator('#max-results').fill('7')
await page.locator('#max-results').dispatchEvent('change')
await page.waitForTimeout(200)
await page.screenshot({ path: '/tmp/screenshot-persist-1-before-reload.png' })

console.log('--- reloading the page (simulates closing/reopening the browser) ---')
await page.reload()
await page.waitForTimeout(2500)
await page.screenshot({ path: '/tmp/screenshot-persist-2-after-reload.png' })

const targetRows = await page.locator('#target-table-body tr').count()
const job = await page.locator('#job-filter').inputValue()
const maxResults = await page.locator('#max-results').inputValue()
console.log('--- after reload ---')
console.log('target rows:', targetRows, '| job:', job, '| maxResults:', maxResults)

console.log('\n=== ERRORS ===')
console.log(errors.length === 0 ? '(none)' : errors.join('\n'))

await browser.close()
