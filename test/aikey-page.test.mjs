import assert from 'node:assert/strict'
import esbuild from 'esbuild'
import { chromium } from 'playwright'

// INVARIANT: the extension-origin key window is where an API key is entered, and
// it stores it through the worker.
//
//  1. Add: name, address and key; Save asks Chrome for the host permission FIRST
//     (before any await: the user gesture), then sends AI_SAVE_PROVIDER with the
//     key and closes. Nothing is sent without the permission.
//  2. A public http:// address is refused with its own message, before any
//     permission prompt and before any message.
//  3. Edit: fields prefilled WITHOUT the key; a blank key sends no apiKey and no
//     model (the worker keeps the stored ones); changing the address without a key
//     shows the warning that the saved key will be dropped.
//  4. Orphan: editing a provider that no longer exists (removed from the sidebar
//     while this window was open) shows an error and offers no Save: saving would
//     send a dead id and the worker would re-create the provider without a key.

const ROOT = new URL('..', import.meta.url).pathname
const { t } = await import('../src/shared/i18n.ts')
// Secure origin, like chrome-extension:// (crypto.randomUUID needs a secure context).
const ORIGIN = 'https://aikey.test'

const bundle = await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: ['src/aikey/main.ts'],
  bundle: true, write: false, format: 'iife', logLevel: 'silent',
  loader: { '.css': 'empty' },
})
const code = bundle.outputFiles[0].text

const P1 = { id: 'p1', label: 'Example gateway', kind: 'api-key', baseUrl: 'https://llm.example.com/v1', model: 'model-a', hasCredential: true }
const KEY = 'KEY-SECRET-PAGE-7777'

const browser = await chromium.launch()
const problems = []
try {
  async function open(query, { providers = [P1], grant = true } = {}) {
    const page = await browser.newPage()
    page.on('pageerror', e => problems.push(`PAGE ERROR: ${e.message}`))
    await page.route(`${ORIGIN}/**`, route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><html><body><div id="app"></div></body></html>',
    }))
    await page.addInitScript(({ providers, grant }) => {
      window.__events = []
      window.__closed = false
      window.close = () => { window.__closed = true }
      window.chrome = {
        runtime: {
          async sendMessage(msg) {
            window.__events.push({ kind: 'message', msg })
            if (msg.type === 'AI_LIST_PROVIDERS') return { providers, activeProviderId: null }
            if (msg.type === 'AI_SAVE_PROVIDER') return window.__saveResult ?? { ok: true }
            return { ok: true }
          },
        },
        permissions: {
          request(req) {
            window.__events.push({ kind: 'permission', req })
            return Promise.resolve(grant)
          },
        },
        storage: { local: { async get() { return {} }, async set() {} } },
      }
    }, { providers, grant })
    await page.goto(`${ORIGIN}/index.html${query}`)
    await page.addScriptTag({ content: code })
    await page.waitForSelector('#app h1')
    return page
  }
  const events = page => page.evaluate(() => window.__events)
  const fill = async (page, values) => {
    const inputs = page.locator('input')
    for (const [i, v] of Object.entries(values)) await inputs.nth(Number(i)).fill(v)
  }
  const clickSave = page => page.evaluate(label => {
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label).click()
  }, t('ai.save', 'en'))
  const alertText = page => page.evaluate(() => document.querySelector('[role=alert]')?.textContent ?? '')

  // 1. add
  let page = await open('')
  assert.equal(await page.locator('input[type=password]').count(), 1, 'the key window has no password field')
  await fill(page, { 0: 'My server', 1: 'api.example.org/v1', 2: KEY })
  await clickSave(page)
  await page.waitForFunction(() => window.__closed)
  let ev = await events(page)
  const kinds = ev.map(e => e.kind + (e.msg ? `:${e.msg.type}` : ''))
  assert.deepEqual(kinds, ['permission', 'message:AI_SAVE_PROVIDER'], `wrong order: permission must come first, then the save: ${kinds}`)
  assert.deepEqual(ev[0].req, { origins: ['https://api.example.org/*'] })
  const payload = ev[1].msg.payload
  assert.equal(payload.apiKey, KEY)
  assert.equal(payload.baseUrl, 'https://api.example.org/v1')
  assert.equal(payload.kind, 'api-key')
  assert.equal(payload.label, 'My server')
  assert.ok(payload.id, 'a new provider got no id')
  assert.equal('model' in payload, false, 'the key window must not send a model snapshot')
  assert.equal(payload.intent, 'create', 'Add must say it is an explicit create (the worker rejects unknown ids otherwise)')
  await page.close()

  // 1b. permission declined: nothing is saved
  page = await open('', { grant: false })
  await fill(page, { 1: 'api.example.org/v1', 2: KEY })
  await clickSave(page)
  await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent)
  assert.equal(await alertText(page), t('ai.errPermissionDenied', 'en'))
  assert.equal((await events(page)).some(e => e.msg?.type === 'AI_SAVE_PROVIDER'), false, 'saved without the permission')
  await page.close()

  // 2. cleartext to a public host
  page = await open('')
  await fill(page, { 1: 'http://public.example.com/v1', 2: KEY })
  await clickSave(page)
  assert.equal(await alertText(page), t('ai.errInsecureHttp', 'en'))
  assert.deepEqual(await events(page), [], 'asked for permission or saved for a cleartext public endpoint')
  assert.equal(await page.evaluate(() => window.__closed), false)
  await fill(page, { 1: 'http://192.168.1.5:8000/v1', 2: KEY })
  await clickSave(page)
  await page.waitForFunction(() => window.__closed)
  await page.close()

  // 2b. the worker refusing (defence in depth) is shown, and the window stays open
  page = await open('')
  await page.evaluate(() => { window.__saveResult = { ok: false, error: 'insecure-http' } })
  await fill(page, { 1: 'api.example.org/v1', 2: KEY })
  await clickSave(page)
  await page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent)
  assert.equal(await alertText(page), t('ai.errInsecureHttp', 'en'))
  assert.equal(await page.evaluate(() => window.__closed), false)
  await page.close()

  // 3. edit
  page = await open('?provider=p1')
  const values = await page.locator('input').evaluateAll(els => els.map(e => e.value))
  assert.deepEqual(values, ['Example gateway', 'https://llm.example.com/v1', ''], 'edit must prefill name and address, never a key')
  const warning = t('aikey.rebindWarning', 'en')
  const warned = () => page.evaluate(w => [...document.querySelectorAll('p')].some(p => p.textContent === w && p.style.display !== 'none'), warning)
  assert.equal(await warned(), false)
  await fill(page, { 0: 'Renamed' })
  await clickSave(page)
  await page.waitForFunction(() => window.__closed)
  ev = await events(page)
  const save = ev.find(e => e.msg?.type === 'AI_SAVE_PROVIDER').msg.payload
  assert.equal(save.id, 'p1')
  assert.equal('intent' in save, false, 'an edit must not claim to be a create')
  assert.equal(save.label, 'Renamed')
  assert.equal('apiKey' in save, false, 'a blank key must send no apiKey (keep the stored one)')
  assert.equal('model' in save, false)
  await page.close()

  page = await open('?provider=p1')
  await fill(page, { 1: 'https://llm2.example.com/v1' })
  assert.equal(await warned(), true, 'changing the address without a key does not warn that the saved key will be dropped')
  await fill(page, { 2: KEY })
  assert.equal(await warned(), false)
  await page.close()

  // 4. orphan
  page = await open('?provider=gone')
  assert.equal(await alertText(page), t('ai.errProviderNotFound', 'en'))
  assert.equal(await page.locator('button').count(), 0, 'an orphaned edit window still offers Save')
  assert.equal((await events(page)).some(e => e.msg?.type === 'AI_SAVE_PROVIDER'), false)
  await page.close()
} finally {
  await browser.close()
}
assert.deepEqual(problems, [], `Chromium page errors: ${problems.join(' | ')}`)
console.log('✓ aikey-page: add/edit/orphan, permission first, cleartext refused, no model snapshot')
