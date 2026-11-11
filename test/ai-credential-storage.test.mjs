import assert from 'node:assert/strict'
import { openDB } from 'idb'
import { bootWorker, EXT_SENDER } from './helpers/worker-harness.mjs'

// INVARIANT: AI credentials (API keys, ChatGPT OAuth tokens) never live in
// chrome.storage.local. Content scripts on youtube.com can read that area
// directly, bypassing sanitizeConfig. The credentials live in the
// extension-origin IndexedDB, which only the service worker and extension pages
// can open.
//
// Four halves:
//  A. migration: an install that still has the old chrome.storage.local record
//     is moved to IndexedDB on first run, the old key is deleted, and the
//     credential keeps working through the worker.
//  B. nothing credential-bearing is ever written back to chrome.storage.local,
//     whichever handler runs (save, OAuth complete, token refresh).
//  C. the migration is idempotent and one-way: a legacy record that shows up
//     AFTER the migration (e.g. written by a hostile content script) is deleted,
//     never imported.
//  D. responses to the UI never carry a credential.
//  E. an existing install (IndexedDB v1: watch history, new-video checks) upgrades
//     to v2 without losing a row.

const LEGACY_KEY = 'mytube-ai-providers'
const API_SECRET = 'KEY-SECRET-AAAA-0001'
const ACCESS_SECRET = 'ACCESS-SECRET-BBBB-0002'
const REFRESH_SECRET = 'REFRESH-SECRET-CCCC-0003'

const legacy = {
  providers: [
    {
      id: 'p-key', label: 'Example gateway', kind: 'api-key',
      baseUrl: 'https://llm.example.com/v1', model: 'model-a', apiKey: API_SECRET,
    },
    {
      id: 'p-oauth', label: 'ChatGPT', kind: 'openai-oauth',
      baseUrl: 'https://chatgpt.com/backend-api/codex', model: null,
      tokens: { accessToken: ACCESS_SECRET, refreshToken: REFRESH_SECRET, obtainedAt: Date.now() },
    },
  ],
  activeProviderId: 'p-key',
}

/** Everything a content script could read: every value in chrome.storage.local. */
const readable = store => JSON.stringify(store)
const SECRETS = [API_SECRET, ACCESS_SECRET, REFRESH_SECRET]
function assertNoSecret(store, where) {
  const dump = readable(store)
  for (const s of SECRETS) assert.equal(dump.includes(s), false, `credential found in chrome.storage.local (${where}): ${s}`)
}

// ── E. the v1 → v2 upgrade keeps existing data ───────────────────────────────
const v1 = await openDB('mytube', 1, {
  upgrade(db) {
    const watch = db.createObjectStore('watchHistory', { autoIncrement: true })
    watch.createIndex('by-channel', 'channelId')
    watch.createIndex('by-date', 'watchedAt')
    db.createObjectStore('newVideoChecks', { keyPath: 'channelId' })
  },
})
await v1.add('watchHistory', { videoId: 'v1', channelId: 'c1', watchedAt: 1 })
await v1.put('newVideoChecks', { channelId: 'c1', lastKnownVideoId: 'v1', lastCheckedAt: 1, newCount: 3, seenUpToAt: 0 })
v1.close()

// ── A. migration ─────────────────────────────────────────────────────────────
const w = await bootWorker({ storage: { [LEGACY_KEY]: legacy, 'mytube-theme': 'dark' } })

const listed = await w.send({ type: 'AI_LIST_PROVIDERS' }, { id: 'x', url: 'https://www.youtube.com/', tab: { id: 1 } })
assert.equal(listed.providers.length, 2, 'migration lost providers')
assert.equal(listed.activeProviderId, 'p-key')
assert.deepEqual(
  listed.providers.map(p => [p.id, p.hasCredential]),
  [['p-key', true], ['p-oauth', true]],
  'credentials did not survive the migration (hasCredential false)',
)

assert.equal(LEGACY_KEY in w.store, false, 'legacy chrome.storage.local key was not deleted after migration')
assertNoSecret(w.store, 'after migration')
assert.equal(w.store['mytube-theme'], 'dark', 'migration touched unrelated storage keys')

// The migrated credential is what the worker actually uses.
const test = await w.send({ type: 'AI_TEST_PROVIDER', payload: { id: 'p-key' } })
assert.equal(test.ok, true, `AI_TEST_PROVIDER failed after migration: ${test.error}`)
assert.equal(w.fetches.at(-1).authorization, `Bearer ${API_SECRET}`, 'migrated API key was not used')
assert.equal(w.fetches.at(-1).url, 'https://llm.example.com/v1/models')

// ── B. writes never go back to chrome.storage.local ───────────────────────────
await w.send({
  type: 'AI_SAVE_PROVIDER',
  payload: { id: 'p-new', label: 'New', kind: 'api-key', baseUrl: 'https://api.example.org/v1', model: null, apiKey: 'KEY-SECRET-DDDD-0004' },
})
await w.send({ type: 'AI_SET_ACTIVE_PROVIDER', payload: { id: 'p-new' } })
await w.send({ type: 'AI_SAVE_PROVIDER', payload: { id: 'p-new', label: 'Renamed', kind: 'api-key', baseUrl: 'https://api.example.org/v1', model: 'model-a' } })
assertNoSecret(w.store, 'after saves')
assert.equal(readable(w.store).includes('KEY-SECRET-DDDD-0004'), false, 'a newly typed key was written to chrome.storage.local')
assert.equal(Object.keys(w.store).includes(LEGACY_KEY), false, 'AI config was written back to chrome.storage.local')

// ── D. responses carry no credential ─────────────────────────────────────────
const again = await w.send({ type: 'AI_LIST_PROVIDERS' })
const wire = JSON.stringify(again)
for (const s of [...SECRETS, 'KEY-SECRET-DDDD-0004']) assert.equal(wire.includes(s), false, `credential leaked in AI_LIST_PROVIDERS: ${s}`)
assert.equal(again.providers.every(p => !('apiKey' in p) && !('tokens' in p)), true)

// E. (continued) the data written under v1 is still there after the upgrade
const counts = await w.send({ type: 'GET_NEW_VIDEO_COUNTS' })
assert.deepEqual(counts, { c1: 3 }, 'the v1 → v2 upgrade lost newVideoChecks rows')
const dbAfter = await openDB('mytube')
assert.equal(dbAfter.version, 2)
assert.equal((await dbAfter.getAll('watchHistory')).length, 1, 'the v1 → v2 upgrade lost watchHistory rows')
dbAfter.close()

// ── C. one-way: a legacy record that appears later is deleted, never imported ─
w.store[LEGACY_KEY] = {
  providers: [{ id: 'evil', label: 'Evil', kind: 'api-key', baseUrl: 'https://attacker.example.net/v1', model: 'm', apiKey: 'attacker-key' }],
  activeProviderId: 'evil',
}
const w2 = await bootWorker({ storage: w.store, instance: '?restart' })
const afterRestart = await w2.send({ type: 'AI_LIST_PROVIDERS' })
assert.equal(afterRestart.providers.some(p => p.id === 'evil'), false, 'a legacy record written after the migration was imported')
assert.notEqual(afterRestart.activeProviderId, 'evil')
assert.equal(LEGACY_KEY in w2.store, false, 'late legacy record was not deleted')
assert.equal(afterRestart.providers.some(p => p.id === 'p-key'), true, 'restart lost the migrated providers')

console.log('✓ ai-credential-storage: migration, no storage.local writes, one-way, no leak in responses')
void EXT_SENDER
