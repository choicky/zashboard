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
  assert.notEqual(
    await waitFor(async () => (await page.evaluate('location.origin')) === app.url),
    null,
  )
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
  // The store is initialized before this script writes the isolated backend
  // list. Reload once to make those saved records the application's state;
  // all backend switching assertions below remain without a full-page reload.
  await page.reload()

  const open = async (route) => {
    await page.goto(`${app.url}/#/${route}`)
    const ready = await waitFor(
      () =>
        page.evaluate(`
        location.hash.includes('${route}') &&
        document.body.innerText.length > 20 &&
        ('${route}' !== 'proxies' || document.querySelector('[data-group-name]') !== null)
      `),
      { timeout: 30000, interval: 250 },
    )
    assert.notEqual(
      ready,
      null,
      `native ${route} page did not load: ${await page.evaluate("document.body?.innerText?.slice(0, 1000) || document.documentElement?.outerHTML?.slice(0, 1000) || '<empty document>'")}`,
    )
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

  const pageTimeOrigin = await page.evaluate('performance.timeOrigin')
  const selectNativeNode = await page.evaluate(`(() => {
    const node = [...document.querySelectorAll('*')].find((el) =>
      el.textContent?.trim() === 'direct' && el.closest('[data-group-name]')
    )
    if (!node) return false
    node.click()
    return true
  })()`)
  assert.equal(selectNativeNode, true, 'native node selection control was not found')
  await new Promise((resolve) => setTimeout(resolve, 500))

  const latencyControl = await page.evaluate(`(() => {
    const node = [...document.querySelectorAll('*')].find((el) =>
      el.textContent?.trim() === 'direct' && el.closest('[data-group-name]')
    )
    if (!node) return false
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }))
    return true
  })()`)
  assert.equal(latencyControl, true, 'native latency test target was not found')
  await new Promise((resolve) => setTimeout(resolve, 1200))

  const modeControl = await page.evaluate(`(() => {
    const control = [...document.querySelectorAll('[role="combobox"]')].find((el) =>
      /rule|direct|global/i.test(el.textContent || '')
    )
    if (!control) return false
    control.click()
    const option = [...document.querySelectorAll('[role="option"],option,button')].find((el) =>
      /^direct$/i.test(el.textContent?.trim() || '')
    )
    option?.click()
    return Boolean(option)
  })()`)
  assert.equal(modeControl, true, 'native mode control was not found')

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

  // Switch to the Phase 1 Clash channel through the visible backend selector,
  // without a full-page reload. This also exercises native stream disposal.
  await page.evaluate(`(() => {
    const trigger = [...document.querySelectorAll('button')].find((el) =>
      /native-sing-box/.test(el.textContent || '')
    )
    if (!trigger) throw new Error('backend switch trigger not found')
    trigger.click()
  })()`)
  await waitFor(() => page.evaluate(`document.body.innerText.includes('clash-regression')`), {
    timeout: 10000,
  })
  await page.evaluate(`(() => {
    const target = [...document.querySelectorAll('button')].find((el) =>
      el.textContent?.trim() === 'clash-regression'
    )
    if (!target) throw new Error('Clash backend option not found')
    target.click()
  })()`)
  assert.notEqual(
    await waitFor(
      () =>
        page.evaluate(
          `localStorage.getItem('setup/active-uuid') === 'clash' && document.body.innerText.match(/Group-|Node-/i) !== null`,
        ),
      {
        timeout: 30000,
      },
    ),
    null,
  )
  assert.equal(
    await page.evaluate('performance.timeOrigin'),
    pageTimeOrigin,
    'backend switching unexpectedly performed a full-page reload',
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
