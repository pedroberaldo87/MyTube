import assert from 'node:assert/strict'
import esbuild from 'esbuild'
import { chromium } from 'playwright'

// INVARIANT: an action error in the sidebar AI section does not outlive its cause.
//
// `actionError` is set when the key window fails to open. It is a statement about
// THAT click. Once the user does anything else (Test, Remove, pick the active
// provider, open the key window again) the error is stale and must be gone, or the
// red line keeps accusing an action that is no longer the one on screen.
//
// The reverse also holds: the error must survive until the user acts. Nothing that
// happens by itself (the window regaining focus, a re-render) may clear it, or a
// failure disappears before it is read.
//
// This replaces the lifetime rule the deleted ai-form-error-lifetime test held for
// the old in-sidebar form. Measured in real Chromium, on the real component.

const ROOT = new URL('..', import.meta.url).pathname
const { t } = await import('../src/shared/i18n.ts')
const OPEN_FAILED = t('ai.errCannotOpenKeyPage', 'en')

const P1 = { id: 'p1', label: 'Example gateway', kind: 'api-key', baseUrl: 'https://llm.example.com/v1', model: 'model-a', hasCredential: true }
const P2 = { id: 'p2', label: 'Bare server', kind: 'api-key', baseUrl: 'http://192.0.2.5:8000/v1', model: null, hasCredential: false }

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
    window.__providers = providers
    window.__openFails = true
    window.chrome = {
      runtime: {
        async sendMessage(msg) {
          if (msg.type === 'AI_LIST_PROVIDERS') {
            return { providers: window.__providers.map(p => ({ ...p })), activeProviderId: 'p1' }
          }
          if (msg.type === 'AI_OPEN_KEY_PAGE') return window.__openFails ? { ok: false, error: 'cannot-open' } : { ok: true }
          if (msg.type === 'AI_DELETE_PROVIDER') {
            window.__providers = window.__providers.filter(p => p.id !== msg.payload.id)
            return { ok: true }
          }
          if (msg.type === 'AI_TEST_PROVIDER') return { ok: true, latencyMs: 12 }
          if (msg.type === 'AI_LIST_MODELS') return ['model-a']
          return { ok: true }
        },
      },
      storage: { local: { async get() { return {} }, async set() {} } },
    }
  }, { providers: [P1, P2] })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.evaluate(() => window.__mount(document.getElementById('app')))
  await page.waitForFunction(() => document.querySelectorAll('strong').length >= 2)

  const screen = () => page.evaluate(() => document.getElementById('app').innerText)
  const settle = () => page.waitForTimeout(150)
  const clickInRow = (label, text) => page.evaluate(({ label, text }) => {
    const strong = [...document.querySelectorAll('strong')].find(s => s.textContent === label)
    if (!strong) throw new Error(`row "${label}" is not on screen`)
    const btn = [...strong.parentElement.parentElement.querySelectorAll('button')].find(b => b.textContent.trim() === text)
    if (!btn) throw new Error(`button "${text}" is not in row "${label}"`)
    btn.click()
  }, { label, text })
  const failOpen = async () => {
    await page.evaluate(() => { window.__openFails = true })
    await clickInRow('Bare server', t('ai.edit', 'en'))
    await settle()
    assert.ok((await screen()).includes(OPEN_FAILED), 'the failed open did not show its error')
  }
  const gone = async what => {
    await settle()
    assert.equal((await screen()).includes(OPEN_FAILED), false, `the key-window error outlived its cause: it is still on screen after ${what}`)
  }

  // the error is shown, and nothing that happens by itself clears it
  await failOpen()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await settle()
  assert.ok((await screen()).includes(OPEN_FAILED), 'the error vanished on its own (window focus) before the user acted')

  // each later action ends the previous action's error
  await clickInRow('Example gateway', t('ai.test', 'en'))
  await gone('Test connection')

  await failOpen()
  await page.evaluate(() => document.querySelectorAll('input[aria-label]')[1].click())
  await gone('choosing the active provider')

  await failOpen()
  await page.evaluate(() => { window.__openFails = false })
  await clickInRow('Bare server', t('ai.edit', 'en'))
  await gone('a successful open of the key window')

  await failOpen()
  await clickInRow('Bare server', t('ai.remove', 'en'))
  await gone('Remove')
} finally {
  await browser.close()
}
assert.deepEqual(problems, [], `Chromium page errors: ${problems.join(' | ')}`)

console.log('✓ ai-action-error-lifetime: the key-window error lives until the next action, no longer, no shorter')
