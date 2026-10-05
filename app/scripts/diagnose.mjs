// Diagnostic-only script (not part of the app). Launches real Chromium via
// Playwright, loads the dev server, and exercises: default-data auto-load,
// the skill category tree (double-click to add, favorite toggling, skill
// set save/restore), and a search + master-detail click-through. Run with:
//   node scripts/diagnose.mjs
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

const consoleMessages = []
page.on('console', (msg) => consoleMessages.push(`[console.${msg.type()}] ${msg.text()}`))
page.on('pageerror', (err) => consoleMessages.push(`[pageerror] ${err.message}\n${err.stack}`))
page.on('requestfailed', (req) => consoleMessages.push(`[requestfailed] ${req.url()} - ${req.failure()?.errorText}`))

await page.goto('http://localhost:5173/')
await page.waitForTimeout(2500) // init() + default-data fetch + parse
console.log('--- status after initial load (should show default-data auto-load) ---')
console.log(await page.locator('#status').textContent())
await page.screenshot({ path: '/tmp/screenshot-1-autoload.png' })

console.log('--- expanding the "Offense and Adren" category ---')
const offenseHeader = page.locator('.skill-group-header', { hasText: 'Offense and Adren' })
await offenseHeader.click()
await page.waitForTimeout(200)
await page.screenshot({ path: '/tmp/screenshot-2-category-open.png' })

console.log('--- double-clicking "Attack" to add it, and starring it as a favorite ---')
const attackLeaf = page.locator('.skill-leaf', { hasText: 'Attack' }).first()
await attackLeaf.dblclick()
await page.locator('.fav-toggle').first().click()
await page.waitForTimeout(200)
await page.screenshot({ path: '/tmp/screenshot-3-added-and-favorited.png' })

console.log('--- expanding Favorites to confirm it shows up there ---')
await page.locator('.skill-group-header', { hasText: 'Favorites' }).click()
await page.waitForTimeout(200)
await page.screenshot({ path: '/tmp/screenshot-4-favorites.png' })

console.log('--- saving the current target list as a Skill Set ---')
page.once('dialog', async (dialog) => {
  await dialog.accept('My Test Set')
})
await page.locator('#save-skillset-btn').click()
await page.waitForTimeout(200)
await page.locator('.skill-group-header', { hasText: 'Skill Sets' }).click()
await page.waitForTimeout(200)
await page.screenshot({ path: '/tmp/screenshot-5-skillset-saved.png' })

console.log('--- running the search ---')
await page.locator('#run-search-btn').click()
await page.waitForTimeout(1000)
console.log(await page.locator('#results-summary').textContent())
await page.screenshot({ path: '/tmp/screenshot-6-results.png' })

console.log('\n=== CONSOLE / PAGE ERRORS ===')
console.log(consoleMessages.length === 0 ? '(none)' : consoleMessages.join('\n'))

await browser.close()
