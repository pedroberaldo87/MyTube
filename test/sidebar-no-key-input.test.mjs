import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import esbuild from 'esbuild'
import { chromium } from 'playwright'

// INVARIANT: no API key is ever typed into a page the youtube.com page can reach.
// The sidebar (a content script UI inside youtube.com's DOM) shows STATUS only
// (credential saved or not, provider, model) and a button that asks the worker
// to open the extension-origin key window. It renders no password input and no
// key field, in any state of the component, and it never sends a credential.
//
//  A. source: nothing under src/content/ has a password input or sends apiKey.
//  B. the real component in a real Chromium: idle, after Add endpoint, after
//     Edit, with the ChatGPT device flow open: no <input type=password>, and no
//     text input at all (the URL/name moved to the key window with the key).
//  C. Add endpoint / Edit dispatch AI_OPEN_KEY_PAGE (id null / the provider id),
//     and never AI_SAVE_PROVIDER with a credential, never chrome.permissions.
//  D. the status the sidebar shows: credential saved vs not saved.

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')
const { t } = await import('../src/shared/i18n.ts')

/** No comments: a comment explaining the old defect must not trip the guard. */
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

async function files(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...await files(p))
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

// ── A. source ────────────────────────────────────────────────────────────────
const contentFiles = await files(join(SRC, 'content'))
assert.ok(contentFiles.length >= 15)
for (const f of contentFiles) {
  const src = stripComments(await readFile(f, 'utf8'))
  const rel = f.slice(SRC.length + 1)
  assert.equal(/type\s*=\s*["']password["']/.test(src), false, `${rel} renders a password input inside the youtube.com DOM`)
  // page-bridge.ts reads YouTube's OWN INNERTUBE_API_KEY; the sidebar must not touch ours.
  if (rel.startsWith('content/sidebar/')) {
    assert.equal(/\bapiKey\b/.test(src), false, `${rel} handles an apiKey: credentials must not exist in sidebar code`)
  }
  assert.equal(/ai\.keyField/.test(src), false, `${rel} renders the API key field`)
}

// ── B/C/D. the real component ────────────────────────────────────────────────
const P1 = { id: 'p1', label: 'Example gateway', kind: 'api-key', baseUrl: 'https://llm.example.com/v1', model: 'model-a', hasCredential: true }
const P2 = { id: 'p2', label: 'Bare server', kind: 'api-key', baseUrl: 'http://192.168.1.5:8000/v1', model: null, hasCredential: false }
const P3 = { id: 'p3', label: 'ChatGPT', kind: 'openai-oauth', baseUrl: 'https://chatgpt.com/backend-api/codex', model: null, hasCredential: true }

const bundle = await esbuild.build({
  absWorkingDir: ROOT,
  stdin: {
    contents: `
      import { h, render } from 'preact'
      import { AISection } from './src/content/sidebar/components/AISection.tsx'
      window.__mount = el => render(h(AISection, {}), el)
    `,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', jsxImportSource: 'preact', logLevel: 'silent',
})

const browser = await chromium.launch()
const problems = []
try {
  const page = await browser.newPage()
  page.on('pageerror', e => problems.push(`PAGE ERROR: ${e.message}`))
  await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>')
  await page.evaluate(({ providers }) => {
    window.__sent = []
    window.chrome = {
      runtime: {
        async sendMessage(msg) {
          window.__sent.push(msg)
          if (msg.type === 'AI_LIST_PROVIDERS') return { providers: providers.map(p => ({ ...p })), activeProviderId: 'p1' }
          if (msg.type === 'AI_OAUTH_BEGIN') {
            return { userCode: 'WXYZ-9999', deviceAuthId: 'dev-1', interval: 5, verificationUrl: 'https://auth.openai.com/codex/device' }
          }
          return { ok: true }
        },
      },
      storage: { local: { async get() { return {} }, async set() {} } },
    }
    window.fetch = async () => ({ ok: false, status: 403, async json() { return {} } })
  }, { providers: [P1, P2, P3] })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.evaluate(() => window.__mount(document.getElementById('app')))
  await page.waitForFunction(() => document.querySelectorAll('strong').length >= 3)

  const inputs = () => page.evaluate(() =>
    [...document.querySelectorAll('input')].map(i => i.type).filter(type => type !== 'radio'))
  const click = text => page.evaluate(text => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
    if (!btn) throw new Error(`button "${text}" is not on screen`)
    btn.click()
  }, text)
  const clickInRow = (label, text) => page.evaluate(({ label, text }) => {
    const strong = [...document.querySelectorAll('strong')].find(s => s.textContent === label)
    if (!strong) throw new Error(`row "${label}" is not on screen`)
    const btn = [...strong.parentElement.parentElement.querySelectorAll('button')].find(b => b.textContent.trim() === text)
    if (!btn) throw new Error(`button "${text}" is not in row "${label}"`)
    btn.click()
  }, { label, text })
  const sentOf = type => page.evaluate(type => window.__sent.filter(m => m.type === type), type)
  const settle = () => page.waitForTimeout(150)
  const screen = () => page.evaluate(() => document.getElementById('app').innerText)

  // B. idle: no text/password input
  assert.deepEqual(await inputs(), [], 'the sidebar renders an input at rest')

  // D. status
  const text = await screen()
  assert.ok(text.includes(t('ai.keyConfigured', 'en')), `a provider with a credential does not say so:\n${text}`)
  assert.ok(text.includes(t('ai.noCredential', 'en')), `a provider without a credential does not say so:\n${text}`)
  assert.ok(text.includes('https://llm.example.com/v1 · model-a'), 'provider address and model are not shown')

  // C. Add endpoint opens the key window; nothing appears in the sidebar
  await click(t('ai.addEndpoint', 'en'))
  await settle()
  assert.deepEqual(await inputs(), [], 'Add endpoint rendered an input inside the youtube.com DOM')
  assert.deepEqual(await sentOf('AI_OPEN_KEY_PAGE'), [{ type: 'AI_OPEN_KEY_PAGE', payload: { id: null } }])

  // C. Edit opens it for that provider
  await clickInRow('Example gateway', t('ai.edit', 'en'))
  await settle()
  assert.deepEqual(await inputs(), [], 'Edit rendered an input inside the youtube.com DOM')
  assert.deepEqual((await sentOf('AI_OPEN_KEY_PAGE')).at(-1), { type: 'AI_OPEN_KEY_PAGE', payload: { id: 'p1' } })

  // B. with the device-flow panel open: still no input
  await click(t('ai.connectChatGPT', 'en'))
  await page.waitForFunction(() => document.getElementById('app').innerText.includes('WXYZ-9999'))
  assert.deepEqual(await inputs(), [], 'the device-flow panel rendered an input')

  // C. nothing in the sidebar ever carries a credential or asks for a permission
  const saves = await sentOf('AI_SAVE_PROVIDER')
  assert.equal(saves.some(m => 'apiKey' in m.payload || 'tokens' in m.payload), false, 'the sidebar sent a credential')
  assert.equal(await page.evaluate(() => window.__sent.some(m => m.type === 'AI_REQUEST_HOST_PERMISSION')), false,
    'the sidebar still asks for host permission itself (that moved to the key window)')

  // the key window failing to open is shown, not swallowed
  await page.evaluate(() => {
    const original = window.chrome.runtime.sendMessage
    window.chrome.runtime.sendMessage = async msg =>
      msg.type === 'AI_OPEN_KEY_PAGE' ? { ok: false, error: 'cannot-open' } : original(msg)
  })
  await clickInRow('Bare server', t('ai.edit', 'en'))
  await settle()
  assert.ok((await screen()).includes(t('ai.errCannotOpenKeyPage', 'en')), 'a failure to open the key window is silent')
} finally {
  await browser.close()
}
assert.deepEqual(problems, [], `Chromium page errors: ${problems.join(' | ')}`)

for (const key of ['ai.keyConfigured', 'ai.errCannotOpenKeyPage', 'ai.errInsecureHttp', 'aikey.title', 'aikey.titleEdit', 'aikey.rebindWarning']) {
  for (const lang of ['en', 'pt-BR']) {
    const s = t(key, lang)
    assert.ok(typeof s === 'string' && s.length > 0 && s !== key, `${key} has no ${lang} translation`)
  }
}

console.log('✓ sidebar-no-key-input: no key field in any sidebar state; Add/Edit open the key window')
