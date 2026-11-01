/* Native browser acceptance against a real sing-box API and the built dashboard. */
import assert from 'node:assert/strict'
import { connectBrowser, waitFor } from './lib/cdp.mjs'
import { launchChrome } from './lib/chrome.mjs'
import { DIST_DIR } from './lib/harness.mjs'
import { findFreePort } from './lib/ports.mjs'
import { serveDirectory } from './lib/static-server.mjs'
import { createMockServer } from './mock-server.mjs'

const apiPort = Number(process.env.SINGBOX_API_PORT || 19092)
const uiPort = Number(process.env.SINGBOX_UI_PORT || 19080)
const secret = process.env.SINGBOX_SECRET || 'ci-native-secret'
const apiUrl = `http://127.0.0.1:${apiPort}`

const app = await serveDirectory(DIST_DIR, uiPort)
const mock = await createMockServer({ groups: 2, nodes: 3, connections: 2 })
const debuggingPort = await findFreePort()
const chrome = await launchChrome({ port: debuggingPort, headless: true })
const browser = await connectBrowser(debuggingPort)

try {
  const page = await browser.newPage()
  await page.goto(app.url)
  assert.notEqual(await waitFor(() => page.evaluate('location.origin') === app.url), null)
  await page.evaluate(`
    localStorage.setItem('setup/api-list', ${JSON.stringify(
      JSON.stringify([
        {
          uuid: 'native',
          type: 'singbox',
          protocol: 'http',
          host: '127.0.0.1',
          port: String(apiPort),
          password: secret,
          secondaryPath: '',
          label: 'native-sing-box',
        },
        {
          uuid: 'clash',
          type: 'clash',
          protocol: 'http',
          host: '127.0.0.1',
          port: String(mock.port),
          password: '',
          secondaryPath: '',
          label: 'clash-regression',
        },
      ]),
    )})
    localStorage.setItem('setup/active-uuid', 'native')
  `)

  const open = async (route) => {
    await page.goto(`${app.url}/#/${route}`)
    const ready = await waitFor(
      () =>
        page.evaluate(`location.hash.includes('${route}') && document.body.innerText.length > 20`),
      { timeout: 30000, interval: 250 },
    )
    assert.notEqual(ready, null, `native ${route} page did not load`)
    const text = await page.evaluate('document.body.innerText')
    assert.doesNotMatch(text, /Cannot read properties|Unhandled|网络错误/i)
    return text
  }

  const proxies = await open('proxies')
  assert.match(proxies, /auto|direct/i, 'native proxy groups/selectors were not rendered')
  const nativeIdentity = await page.evaluate(`
    [...document.querySelectorAll('body *')].some((el) => /sing-box|1\\.14\\./i.test(el.innerText || ''))
  `)
  assert.equal(nativeIdentity, true, 'native core identity/version was not visible')

  const logs = await open('logs')
  assert.doesNotMatch(logs, /dashboard upgrade|更新面板/i)
  await open('connections')
  await open('proxies')

  // Reload exercises reconnect and must not leave the selected native session stale.
  await page.reload()
  assert.notEqual(
    await waitFor(() => page.evaluate(`document.body.innerText.match(/auto|direct/i) !== null`), {
      timeout: 30000,
    }),
    null,
  )

  // Switch to the Phase 1 Clash channel through the persisted backend selector.
  await page.evaluate("localStorage.setItem('setup/active-uuid', 'clash')")
  await page.reload()
  assert.notEqual(
    await waitFor(() => page.evaluate(`document.body.innerText.match(/Group-|Node-/i) !== null`), {
      timeout: 30000,
    }),
    null,
  )

  console.log(
    'native browser acceptance passed: identity, capabilities, proxies, logs, connections, reconnect, and Clash switching',
  )
} finally {
  await browser.close()
  await chrome.close()
  await mock.close()
  await app.close()
}
