import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// INVARIANT: every write to `mytube_state` is one read-modify-write that
// (a) reads through the shared repair path (`getState`) and (b) re-reads INSIDE a
// serialised critical section, so two concurrent updates never lose each other.
// The dashboard pages (Settings, Folders) must not touch `chrome.storage.local`
// for that key; they go through the storage helpers.

// The mock clones on get and set (what chrome.storage.local does) and yields on
// each call, so an interleaved read-modify-write really loses the other update.
const store = {}
const tick = () => new Promise(r => setTimeout(r, Math.random() * 3))
globalThis.chrome = {
  storage: {
    local: {
      get: async key => { await tick(); return { [key]: structuredClone(store[key]) } },
      set: async obj => { await tick(); Object.assign(store, structuredClone(obj)) },
    },
  },
}
globalThis.crypto ??= (await import('node:crypto')).webcrypto

const storage = await import('../src/shared/storage.ts')
const { updateState, addTag, updateTag, deleteTag, addFolder, updateFolder, deleteFolder, getState } = storage
assert.equal(typeof updateState, 'function', 'storage.updateState is the single read-modify-write entry point')

const reset = seed => { for (const k of Object.keys(store)) delete store[k]; if (seed) store['mytube_state'] = seed }
const folder = (id, parentId = null, order = 0) => ({ id, name: id, parentId, color: '#fff', order })
const channel = (id, folderId = null, tagIds = []) => ({
  id, youtubeId: `UC${id}`, type: 'channel', name: id, url: `https://www.youtube.com/@${id}`,
  folderId, tagIds, isSubscribed: true, muted: true, addedAt: 1, lastSyncedAt: 1,
})

// 1. N concurrent addTag: all N survive.
reset()
await Promise.all(Array.from({ length: 25 }, (_, i) => addTag(`t${i}`, '#000')))
assert.equal((await getState()).tags.length, 25, 'concurrent addTag lost updates')

// 2. Mixed concurrent writers on different collections keep each other's data.
reset({ folders: [folder('f0')], organizables: [channel('a'), channel('b')], tags: [{ id: 'tg', name: 'tg', color: '#111' }] })
await Promise.all([
  addFolder('n1', null, '#1'), addFolder('n2', 'f0', '#2'), addFolder('n3', null, '#3'),
  addTag('x', '#4'), addTag('y', '#5'),
  updateTag({ id: 'tg', name: 'renamed', color: '#111' }),
  updateState(s => { s.organizables.find(o => o.id === 'a').name = 'A!' }),
])
let s = await getState()
assert.equal(s.folders.length, 4)
assert.equal(s.tags.length, 3)
assert.equal(s.tags.find(t => t.id === 'tg').name, 'renamed')
assert.equal(s.organizables.find(o => o.id === 'a').name, 'A!')
assert.equal(new Set(s.folders.map(f => f.id)).size, 4)
const orders = s.folders.filter(f => f.parentId === null).map(f => f.order)
assert.equal(new Set(orders).size, orders.length, 'root folders got duplicate order (stale read of maxOrder)')

// 3. deleteTag racing addTag: the new tag stays, the deleted one is gone from tags and items.
reset({ folders: [], organizables: [channel('a', null, ['d'])], tags: [{ id: 'd', name: 'd', color: '#0' }] })
await Promise.all([deleteTag('d'), addTag('new', '#1')])
s = await getState()
assert.deepEqual(s.tags.map(t => t.name), ['new'])
assert.deepEqual(s.organizables[0].tagIds, [])

// 4. updateState re-reads inside: a second update sees the first one's result.
reset({ folders: [], organizables: [], tags: [] })
const seen = []
await Promise.all([
  updateState(async st => { seen.push(st.tags.length); await tick(); st.tags.push({ id: '1', name: '1', color: '#0' }) }),
  updateState(async st => { seen.push(st.tags.length); await tick(); st.tags.push({ id: '2', name: '2', color: '#0' }) }),
])
assert.deepEqual(seen, [0, 1], 'second update did not see the first')
assert.equal((await getState()).tags.length, 2)

// 5. It returns what fn returns, and a throwing fn neither writes nor poisons the queue.
reset({ folders: [], organizables: [], tags: [] })
assert.equal(await updateState(st => { st.tags.push({ id: 'k', name: 'k', color: '#0' }); return 'done' }), 'done')
await assert.rejects(updateState(st => { st.tags.push({ id: 'boom', name: 'b', color: '#0' }); throw new Error('boom') }), /boom/)
assert.deepEqual((await getState()).tags.map(t => t.id), ['k'], 'a failed update must not be written')
await addTag('after', '#0')
assert.equal((await getState()).tags.length, 2, 'queue stalled after a failed update')

// 6. UNCHANGED skips the write entirely.
reset({ folders: [folder('f')], organizables: [], tags: [] })
let writes = 0
const realSet = chrome.storage.local.set
chrome.storage.local.set = async o => { writes++; return realSet(o) }
await updateFolder({ ...folder('nope'), name: 'x' })
assert.equal(writes, 0, 'updateFolder on an unknown id must not write')
chrome.storage.local.set = realSet

// 7. Garbage in storage goes through the repair path (no TypeError on missing arrays,
//    bad rows are skipped, good rows survive) — this is what the raw dashboard code skipped.
reset({ organizables: [channel('a'), 42, null, 'x'], folders: 'nope' })
await addTag('t', '#0')
s = await getState()
assert.equal(s.tags.length, 1)
assert.deepEqual(s.folders, [])
assert.deepEqual(s.organizables.map(o => o.id), ['a'])
await addFolder('root', null, '#0')
assert.equal((await getState()).folders.length, 1)

// 8. Folder subtree delete still lands inside the lock and races cleanly with addFolder.
reset({ folders: [folder('r'), folder('c', 'r')], organizables: [channel('a', 'c')], tags: [] })
await Promise.all([deleteFolder('r'), addFolder('keep', null, '#0')])
s = await getState()
assert.deepEqual(s.folders.map(f => f.name), ['keep'])
assert.equal(s.organizables[0].folderId, null)

// 9. Static guard: the dashboard pages never read or write mytube_state directly.
for (const file of ['src/dashboard/pages/Settings.tsx', 'src/dashboard/pages/Folders.tsx']) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.ok(!/chrome\.storage\.local|['"]mytube_state['"]/.test(src), `${file} still reads or writes mytube_state directly`)
}

console.log('state-update-serial: ok')
