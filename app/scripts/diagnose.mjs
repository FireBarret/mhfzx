// Diagnostic-only script (not part of the app). Launches real Chromium via
// Playwright, loads the dev server, uploads the real data folder, runs a
// search, and reports console errors + a screenshot. Run with:
//   node scripts/diagnose.mjs
import { chromium } from 'playwright'

const DATA_DIR = '/Users/dariush/Downloads/MHFZ Set Searcher for GX and Zeniths'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

const consoleMessages = []
page.on('console', (msg) => consoleMessages.push(`[console.${msg.type()}] ${msg.text()}`))
page.on('pageerror', (err) => consoleMessages.push(`[pageerror] ${err.message}\n${err.stack}`))
page.on('requestfailed', (req) => consoleMessages.push(`[requestfailed] ${req.url()} - ${req.failure()?.errorText}`))

await page.goto('http://localhost:5173/')
await page.waitForTimeout(1000)
console.log('--- status after initial load ---')
console.log(await page.locator('#status').textContent())

await page.screenshot({ path: '/tmp/screenshot-1-initial.png' })

console.log('--- uploading data folder ---')
await page.locator('#folder-input').setInputFiles(DATA_DIR)
await page.waitForTimeout(3000)
console.log('--- status after folder upload ---')
console.log(await page.locator('#status').textContent())
await page.screenshot({ path: '/tmp/screenshot-2-loaded.png' })

console.log('--- adding a skill target (Attack) ---')
await page.locator('#add-skill-select').selectOption('Attack')
await page.locator('#add-skill-btn').click()
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/screenshot-3-target-added.png' })

console.log('--- clicking Search ---')
await page.locator('#run-search-btn').click()
await page.waitForTimeout(1000)
console.log('--- results summary ---')
console.log(await page.locator('#results-summary').textContent())
const resultRows = await page.locator('#results-body tr').count()
console.log('--- result row count ---', resultRows)
await page.screenshot({ path: '/tmp/screenshot-4-results.png' })

console.log('--- clicking a result row to test master-detail ---')
await page.locator('#results-body tr').first().click()
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/screenshot-4b-detail.png' })

console.log('--- switching to Data Browser tab ---')
await page.locator('.tab-button[data-tab="browser"]').click()
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/screenshot-5-browser.png' })

console.log('\n=== CONSOLE / PAGE ERRORS ===')
if (consoleMessages.length === 0) {
  console.log('(none)')
} else {
  for (const m of consoleMessages) console.log(m)
}

await browser.close()
