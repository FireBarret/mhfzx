// One-off: verify the production build actually works when served under the
// GitHub Pages project-site subpath (/mhfzx/), not just at root. Serve a
// true subpath-rooted copy first (vite preview doesn't fully emulate this):
//   rm -rf /tmp/pages-sim && mkdir -p /tmp/pages-sim/mhfzx && \
//     cp -r dist/* /tmp/pages-sim/mhfzx/ && \
//     (cd /tmp/pages-sim && python3 -m http.server 4173 &)
// Then: node scripts/check-subpath.mjs
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('requestfailed', (req) => console.log('[requestfailed]', req.url(), req.failure()?.errorText))
page.on('response', (res) => {
  if (res.status() >= 400) console.log('[http error]', res.status(), res.url())
})
page.on('pageerror', (err) => console.log('[pageerror]', err.message))
page.on('console', (msg) => msg.type() === 'error' && console.log('[console.error]', msg.text()))

await page.goto('http://localhost:4173/mhfzx/', { waitUntil: 'load', timeout: 15000 })
await page.waitForTimeout(2000)
console.log('status:', await page.locator('#status').textContent({ timeout: 5000 }))

console.log('--- running a search under the subpath ---')
await page.locator('.skill-group-header', { hasText: 'Offense and Adren' }).click()
await page.waitForTimeout(200)
await page.locator('.skill-leaf', { hasText: 'Attack' }).first().dblclick()
await page.locator('#run-search-btn').click()
await page.waitForTimeout(1000)
console.log('results:', await page.locator('#results-summary').textContent())

await browser.close()
