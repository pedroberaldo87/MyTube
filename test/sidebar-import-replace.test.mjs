import assert from 'node:assert/strict'
import esbuild from 'esbuild'
import { chromium } from 'playwright'

// INVARIANT: the sidebar's "Replace" import works after the sidebar has used the
// shared database, and a failure of the database step can never leave a
// half-restore.
//
//  A. The realistic flow: the watch history exists (db.ts created 'mytube' at its
//     current version), the user exports a backup, then restores it with Replace.
//     Replace used to open 'mytube' at a hard-coded version 1 and died with
//     VersionError AFTER overwriting mytube_state.
//  B. If the database step fails, mytube_state is untouched and the user sees the
//     error. The state is only replaced once the history has been replaced.
//
// The real component and the real db.ts, bundled and run in Chromium (real
// IndexedDB, real VersionError).

const ROOT = new URL('..', import.meta.url).pathname
const { t } = await import('../src/shared/i18n.ts')

const OLD_STATE = { organizables: [], folders: [{ id: 'f-old', name: 'Old folder' }], tags: [] }
const NEW_STATE = { organizables: [], folders: [{ id: 'f-new', name: 'New folder' }], tags: [] }
const backup = {
  version: 1,
  exportedAt: '2026-01-02T00:00:00.000Z',
  state: NEW_STATE,
  watchHistory: [{ videoId: 'new-1', channelId: 'chan-1', title: 'Restored', watchedAt: 3 }],
}

const bundle = await esbuild.build({
  absWorkingDir: ROOT,
  stdin: {
    contents: `
      import { h, render } from 'preact'
      import { ExportImport } from './src/content/sidebar/components/ExportImport.tsx'
      import { exportWatchHistory, importWatchHistory } from './src/shared/db.ts'
      window.__db = { exportWatchHistory, importWatchHistory }
      window.__mount = el => render(h(ExportImport, { onStateChange() {} }), el)
    `,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', jsxImportSource: 'preact', logLevel: 'silent',
})

const ORIGIN = 'https://sidebar.test'
const browser = await chromium.launch()
const problems = []
try {
  async function open() {
    const page = await browser.newPage()
    page.on('pageerror', e => problems.push(`PAGE ERROR: ${e.message}`))
    await page.route(`${ORIGIN}/**`, route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><html><body><div id="app"></div></body></html>',
    }))
    await page.goto(`${ORIGIN}/index.html`)
    await page.evaluate(({ oldState }) => {
      window.__store = { mytube_state: oldState }
      window.chrome = {
        runtime: { async sendMessage(msg) { return msg.type === 'GET_STATE' ? window.__store.mytube_state : { ok: true } } },
        storage: { local: {
          async get(k) { return typeof k === 'string' ? { [k]: window.__store[k] } : { ...window.__store } },
          async set(o) { Object.assign(window.__store, structuredClone(o)) },
        } },
      }
    }, { oldState: OLD_STATE })
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.evaluate(() => window.__mount(document.getElementById('app')))
    return page
  }
  const screen = page => page.evaluate(() => document.getElementById('app').innerText)
  const clickText = (page, text) => page.evaluate(text => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
    if (!btn) throw new Error(`button "${text}" is not on screen`)
    btn.click()
  }, text)
  const pickBackup = async page => {
    await page.locator('input[type=file]').setInputFiles({
      name: 'mytube-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
    })
    await page.waitForFunction(label => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === label), t('data.replace', 'en'))
  }
  const history = page => page.evaluate(async () => (await window.__db.exportWatchHistory()).map(e => e.videoId).sort())

  // A. export, then Replace
  let page = await open()
  await page.evaluate(() => window.__db.importWatchHistory([
    { videoId: 'old-1', channelId: 'chan-1', title: 'Old 1', watchedAt: 1 },
    { videoId: 'old-2', channelId: 'chan-1', title: 'Old 2', watchedAt: 2 },
  ]))
  await clickText(page, t('data.export', 'en'))
  await page.waitForFunction(label => document.getElementById('app').innerText.includes(label), t('data.exported', 'en'))
  await pickBackup(page)
  await clickText(page, t('data.replace', 'en'))
  await page.waitForFunction(() => /✓|failed|Falha/i.test(document.getElementById('app').innerText))
  let text = await screen(page)
  assert.ok(text.includes(t('data.imported', 'en')), `Replace after an export did not succeed:\n${text}`)
  assert.deepEqual(await page.evaluate(() => window.__store.mytube_state), NEW_STATE, 'Replace did not restore the state')
  assert.deepEqual(await history(page), ['new-1'], 'Replace did not restore the watch history')
  await page.close()

  // B. the database step fails: nothing else changes
  page = await open()
  // a newer database already exists, so the shared open (version 2) throws VersionError
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('mytube', 3)
    req.onupgradeneeded = () => req.result.createObjectStore('future')
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  }))
  await pickBackup(page)
  await clickText(page, t('data.replace', 'en'))
  await page.waitForFunction(() => /failed|Falha/i.test(document.getElementById('app').innerText))
  text = await screen(page)
  assert.ok(text.includes(t('data.importFailed', 'en')), `a failed Replace did not say so:\n${text}`)
  assert.deepEqual(await page.evaluate(() => window.__store.mytube_state), OLD_STATE,
    'the database step failed but mytube_state was already overwritten: half-restore')
  await page.close()
} finally {
  await browser.close()
}
assert.deepEqual(problems, [], `Chromium page errors: ${problems.join(' | ')}`)

console.log('✓ sidebar-import-replace: Replace works on the current DB, and a DB failure cannot half-restore')
