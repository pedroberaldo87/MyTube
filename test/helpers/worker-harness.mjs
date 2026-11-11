// Shared harness for tests that drive the REAL service-worker message router.
//
// Boots src/background/index.ts against: a fake IndexedDB (the real db.ts code
// runs on top of it), an in-memory chrome.storage.local (the area content
// scripts on youtube.com can read, so tests can assert nothing secret lands in
// it), a recording fetch, and chrome.windows.create.
import 'fake-indexeddb/auto'

export const EXT_ID = 'test-extension-id'
export const EXT_SENDER = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/aikey/index.html` }
export const CONTENT_SENDER = { id: EXT_ID, url: 'https://www.youtube.com/watch?v=abc', tab: { id: 7 } }

/**
 * @param {object} [opts]
 * @param {Record<string, unknown>} [opts.storage] seed for chrome.storage.local
 * @param {string} [opts.instance] query suffix, to import a FRESH copy of the worker (a "restart")
 */
export async function bootWorker({ storage = {}, instance = '' } = {}) {
  const store = structuredClone(storage)
  const fetches = []
  const windows = []
  let listener = null

  const noopEvent = { addListener() {} }
  globalThis.chrome = {
    alarms: { get(_n, cb) { cb(undefined) }, create() {}, onAlarm: noopEvent },
    action: { onClicked: noopEvent, setBadgeText() {} },
    tabs: { async sendMessage() {} },
    windows: {
      onRemoved: noopEvent,
      async create(opts) { windows.push(opts); return { id: 99 } },
    },
    runtime: {
      id: EXT_ID,
      getURL: p => `chrome-extension://${EXT_ID}/${p}`,
      onInstalled: noopEvent,
      onStartup: noopEvent,
      onMessage: { addListener(fn) { listener = fn } },
      async openOptionsPage() {},
    },
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return key in store ? { [key]: structuredClone(store[key]) } : {}
          return structuredClone(store)
        },
        async set(obj) { for (const [k, v] of Object.entries(obj)) store[k] = structuredClone(v) },
        async remove(keys) { for (const k of [].concat(keys)) delete store[k] },
      },
    },
  }

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    fetches.push({ url: u, authorization: init.headers?.Authorization ?? null })
    return {
      ok: true,
      status: 200,
      async json() { return { data: [{ id: 'model-a' }] } },
      async text() { return '' },
    }
  }

  await import(`../../src/background/index.ts${instance}`)
  if (typeof listener !== 'function') throw new Error('router did not register chrome.runtime.onMessage')

  const send = (message, sender = EXT_SENDER) =>
    new Promise(resolve => { listener(message, sender, resolve) })

  return { send, store, fetches, windows }
}
