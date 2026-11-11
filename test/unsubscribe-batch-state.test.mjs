import assert from 'node:assert/strict'

// INVARIANT: the batch state kept in sessionStorage (mytube-unsub-batch /
// mytube-unsub-return) cannot outlive the run that created it, and a finished
// unsubscribe only advances the batch when it was the batch's current channel.
//
// Reproduced defect: a channel that could not be processed (not subscribed,
// button or dialog missing) returned without touching the batch, so the next
// successful unsubscribe in the same tab consumed the stale batch and walked
// on to unsubscribe the remaining channels.

const memory = new Map()
globalThis.sessionStorage = {
  getItem: k => memory.get(k) ?? null,
  setItem: (k, v) => { memory.set(k, String(v)) },
  removeItem: k => { memory.delete(k) },
}
const START = 'https://www.youtube.com/feed/channels'
const CHAN_A = 'https://www.youtube.com/@alpha'
const CHAN_B = 'https://www.youtube.com/@beta'
const CHAN_C = 'https://www.youtube.com/@gamma'
const CHAN_X = 'https://www.youtube.com/@other'

globalThis.window = { location: { href: START, pathname: '/feed/channels' } }
let backs = 0
globalThis.history = { back() { backs++ } }

// Scenario for the fake YouTube channel page.
let page = { container: true, button: true, subscribed: true, dialog: true }
let clicks = 0
const confirmBtn = { click() { clicks++ } }
const dialog = { querySelector: () => confirmBtn }
const btn = {
  hasAttribute: n => n === 'subscribed' && page.subscribed,
  getAttribute: () => null,
  click() { clicks++ },
}
const container = {
  querySelector: () => (page.button ? btn : null),
  hasAttribute: () => false,
}
const handlers = {}
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.document = {
  readyState: 'loading',
  body: {},
  addEventListener(name, fn) { handlers[name] = fn },
  querySelector(sel) {
    if (sel.startsWith('ytd-subscribe-button-renderer')) return page.container ? container : null
    if (sel.includes('yt-confirm-dialog-renderer')) return page.dialog ? dialog : null
    return null
  },
  querySelectorAll: () => [],
}

// Timers fire right away, so the 800 ms / 1.5 s / 5 s waits do not slow the test.
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn) => realSetTimeout(fn, 0)
// Poll for the expected state instead of sleeping a fixed time: the async chain
// (checkPending -> executeUnsubscribe -> waitFor -> afterUnsubscribe) takes a
// variable number of event-loop turns, longer on a loaded machine.
async function until(cond, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) assert.fail(`timed out after ${timeoutMs} ms waiting for: ${label}`)
    await new Promise(r => realSetTimeout(r, 5))
  }
}
// Lets any stray follow-up action fire before a "nothing else happened" assertion.
const quiet = () => new Promise(r => realSetTimeout(r, 30))

const { triggerUnsubscribe, triggerBatchUnsubscribe } = await import('../src/content/unsubscribe.ts')

function reset(scenario) {
  memory.clear(); clicks = 0; backs = 0
  window.location.href = START; window.location.pathname = '/feed/channels'
  page = { container: true, button: true, subscribed: true, dialog: true, ...scenario }
}
// Simulates the browser landing on `url` (what yt-navigate-finish + checkPending do).
// The caller then waits (`until`) for the state it expects.
function land(url) {
  window.location.pathname = new URL(url).pathname
  handlers['yt-navigate-finish']()
}

// 1. Normal batch still runs to completion and returns to the original page.
reset()
triggerBatchUnsubscribe([CHAN_A, CHAN_B])
assert.equal(window.location.href, CHAN_A)
land(CHAN_A)
await until(() => window.location.href === CHAN_B, 'moves on to the second channel')
land(CHAN_B)
await until(() => window.location.href === START, 'returns to where the batch started')
assert.equal(memory.has('mytube-unsub-batch'), false)
assert.equal(memory.has('mytube-unsub-return'), false)

// 2. A stalled channel (button missing) abandons the batch: nothing left behind.
for (const [label, scenario] of [
  ['container missing', { container: false }],
  ['button missing', { button: false }],
  ['confirmation dialog missing', { dialog: false }],
]) {
  reset(scenario)
  triggerBatchUnsubscribe([CHAN_A, CHAN_B, CHAN_C])
  land(CHAN_A)
  await until(() => !memory.has('mytube-unsub-batch'), `${label}: batch abandoned`)
  assert.equal(memory.has('mytube-unsub-batch'), false, `${label}: BATCH_KEY must not be left behind`)
  assert.equal(memory.has('mytube-unsub-return'), false, `${label}: RETURN_KEY must not be left behind`)
}

// 3. After a stall, a later single unsubscribe must not navigate to the old batch URLs.
reset({ button: false })
triggerBatchUnsubscribe([CHAN_A, CHAN_B, CHAN_C])
land(CHAN_A)
await until(() => !memory.has('mytube-unsub-batch'), 'stalled batch abandoned')
page = { container: true, button: true, subscribed: true, dialog: true }
window.location.href = CHAN_X; window.location.pathname = '/@other'
triggerUnsubscribe(CHAN_X)
await until(() => backs >= 1, 'single unsubscribe goes back')
await quiet()
assert.equal(window.location.href, CHAN_X, `navigated on to a stale batch URL: ${window.location.href}`)
assert.equal(backs, 1, 'a single unsubscribe just goes back')

// 4. A channel that is already unsubscribed is skipped and the batch carries on.
reset({ subscribed: false })
triggerBatchUnsubscribe([CHAN_A, CHAN_B])
land(CHAN_A)
await until(() => window.location.href === CHAN_B, 'not-subscribed channel is skipped, batch continues')
page.subscribed = true
land(CHAN_B)
await until(() => window.location.href === START, 'batch returns to the start page')
assert.equal(memory.size, 0)

// 5. A finished unsubscribe that is NOT the batch's current channel does not advance it.
reset()
memory.set('mytube-unsub-batch', JSON.stringify({ urls: [CHAN_B, CHAN_C], total: 3, updatedAt: Date.now() }))
memory.set('mytube-unsub-return', START)
window.location.href = CHAN_X; window.location.pathname = '/@other'
triggerUnsubscribe(CHAN_X)
await until(() => backs >= 1 && !memory.has('mytube-unsub-batch'), 'stale batch cleared and single unsubscribe goes back')
assert.equal(window.location.href, CHAN_X, 'mismatched channel must not advance the batch')
assert.equal(memory.has('mytube-unsub-batch'), false, 'stale batch is cleared')
assert.equal(memory.has('mytube-unsub-return'), false)

// 6. A batch that stopped making progress long ago is not resumed, even if the
//    next unsubscribe happens to be the channel it stalled on.
reset()
memory.set('mytube-unsub-batch', JSON.stringify({ urls: [CHAN_B, CHAN_C], total: 3, updatedAt: Date.now() - 11 * 60 * 1000 }))
memory.set('mytube-unsub-return', START)
window.location.href = CHAN_B; window.location.pathname = '/@beta'
triggerUnsubscribe(CHAN_B)
await until(() => backs >= 1 && !memory.has('mytube-unsub-batch'), 'expired batch cleared and single unsubscribe goes back')
assert.equal(window.location.href, CHAN_B, `expired batch must not be resumed: ${window.location.href}`)
assert.equal(memory.has('mytube-unsub-return'), false)

// 7. A fresh batch for the same channel IS still resumed (the TTL only drops stale ones).
reset()
memory.set('mytube-unsub-batch', JSON.stringify({ urls: [CHAN_B, CHAN_C], total: 3, updatedAt: Date.now() - 60 * 1000 }))
memory.set('mytube-unsub-return', START)
window.location.href = CHAN_B; window.location.pathname = '/@beta'
triggerUnsubscribe(CHAN_B)
await until(() => window.location.href === CHAN_C, 'a recent batch continues to the next channel')

// 8. A batch with no timestamp (written by an older build or by the page) is treated as expired.
reset()
memory.set('mytube-unsub-batch', JSON.stringify({ urls: [CHAN_B, CHAN_C], total: 3 }))
window.location.href = CHAN_B; window.location.pathname = '/@beta'
triggerUnsubscribe(CHAN_B)
await until(() => backs >= 1 && !memory.has('mytube-unsub-batch'), 'untimed batch cleared')
assert.equal(window.location.href, CHAN_B)

console.log('ok unsubscribe-batch-state')
