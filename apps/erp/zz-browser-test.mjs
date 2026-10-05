import { chromium } from 'playwright'

const TEST_EMAIL = 'zz-diag-employee@test.internal'
const TEST_PASS = 'DiagTest12345!'

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  page.on('console', msg => console.log('[console]', msg.type(), msg.text()))
  page.on('pageerror', err => console.log('[pageerror]', err.message))
  page.on('requestfailed', req => console.log('[requestfailed]', req.url(), req.failure()?.errorText))
  page.on('response', res => {
    if (res.status() >= 300 && res.status() < 400) console.log('[redirect]', res.status(), res.url(), '->', res.headers()['location'])
    if (res.status() >= 400) console.log('[http-error]', res.status(), res.url())
  })

  console.log('Navigating to login...')
  await page.goto('https://erp.digitalbluez.com/login', { waitUntil: 'networkidle' })

  await page.fill('input#userId, input[name="userId"], input[type="text"]', TEST_EMAIL)
  await page.fill('input[type="password"]', TEST_PASS)
  await page.click('button[type="submit"]')

  await page.waitForTimeout(6000)
  console.log('URL after login+wait:', page.url())
  console.log('Body text snippet:', (await page.textContent('body'))?.slice(0, 500))

  await page.waitForTimeout(5000)
  console.log('URL after extra wait:', page.url())
  console.log('Body text snippet 2:', (await page.textContent('body'))?.slice(0, 500))

  await browser.close()
}

main().catch(e => { console.error(e); process.exit(1) })
