import assert from 'node:assert/strict'

// INVARIANT: syncOrganizables never merges two different channels just because
// they share a display name. YouTube display names are not unique, so the name
// fallback may only rescue LEGACY entries whose id is not UC-prefixed, and a UC
// id is never overwritten with a different UC id.

const store = {}
globalThis.chrome = {
  storage: {
    local: {
      get: async key => (typeof key === 'string'
        ? { [key]: structuredClone(store[key]) }
        : structuredClone(store)),
      set: async obj => { Object.assign(store, structuredClone(obj)) },
    },
  },
}
globalThis.crypto ??= (await import('node:crypto')).webcrypto

const { syncOrganizables, getState } = await import('../src/shared/storage.ts')

const scraped = (youtubeId, handle, name = 'Same Name') => ({
  youtubeId, type: 'channel', name, handle,
  url: `https://www.youtube.com/@${handle}`,
  thumbnailUrl: `https://yt3.ggpht.com/${handle}`, isSubscribed: true,
})
const stored = (over) => ({
  id: 'x1', type: 'channel', folderId: 'f1', tagIds: [], muted: true, addedAt: 1, lastSyncedAt: 1,
  thumbnailUrl: '', isSubscribed: true, ...over,
})
const seed = (organizables) => { store['mytube_state'] = { folders: [], organizables, tags: [] } }

// 1. Two scraped channels with the same name, different UC ids, in ONE sync.
seed([])
await syncOrganizables([scraped('UCaaaa', 'alpha'), scraped('UCbbbb', 'beta')])
let s = await getState()
assert.deepEqual(s.organizables.map(o => o.youtubeId).sort(), ['UCaaaa', 'UCbbbb'],
  `two channels with the same name must stay distinct: ${JSON.stringify(s.organizables.map(o => [o.youtubeId, o.handle]))}`)

// 2. A saved entry (in a folder) for channel A survives a later sync that
//    also scrapes a same-named channel B: it keeps A's id, URL and handle.
seed([stored({ youtubeId: 'UCaaaa', name: 'Same Name', url: 'https://www.youtube.com/@alpha', handle: 'alpha' })])
await syncOrganizables([scraped('UCbbbb', 'beta')])
s = await getState()
assert.equal(s.organizables.length, 2, 'the new same-named channel is a new entry')
const a = s.organizables.find(o => o.youtubeId === 'UCaaaa')
assert.ok(a, 'channel A kept its UC id')
assert.equal(a.url, 'https://www.youtube.com/@alpha')
assert.equal(a.handle, 'alpha')
assert.equal(a.folderId, 'f1')
assert.ok(s.organizables.find(o => o.youtubeId === 'UCbbbb' && o.handle === 'beta'))

// 3. A UC id is never replaced by a different UC id. The incoming channel
//    (same @alpha URL, other UC id) matches nothing and becomes its own entry;
//    the saved one keeps its id and identity.
seed([stored({ youtubeId: 'UCaaaa', name: 'Old', url: 'https://www.youtube.com/@alpha', handle: 'alpha' })])
await syncOrganizables([scraped('UCzzzz', 'alpha', 'Reassigned')])
s = await getState()
assert.deepEqual(s.organizables.map(o => o.youtubeId).sort(), ['UCaaaa', 'UCzzzz'], 'both channels are kept, none rewritten')
const kept = s.organizables.find(o => o.youtubeId === 'UCaaaa')
assert.equal(kept.name, 'Old', 'saved entry keeps its own name (URL match)')
assert.equal(kept.folderId, 'f1')

// 3b. Same, matched through the HANDLE branch (stored URL is the /channel/ form,
//     so only the handle ties them): the saved UC entry is not given the other
//     channel's name, url or thumbnail.
seed([stored({ youtubeId: 'UCaaaa', name: 'Old', url: 'https://www.youtube.com/channel/UCaaaa', thumbnailUrl: 'https://yt3.ggpht.com/old', handle: 'alpha' })])
await syncOrganizables([scraped('UCzzzz', 'alpha', 'Reassigned')])
s = await getState()
assert.deepEqual(s.organizables.map(o => o.youtubeId).sort(), ['UCaaaa', 'UCzzzz'])
const kept2 = s.organizables.find(o => o.youtubeId === 'UCaaaa')
assert.equal(kept2.name, 'Old', 'name not overwritten with the other channel')
assert.equal(kept2.url, 'https://www.youtube.com/channel/UCaaaa', 'url not overwritten')
assert.equal(kept2.thumbnailUrl, 'https://yt3.ggpht.com/old', 'thumbnail not overwritten')
assert.equal(kept2.folderId, 'f1')
const other = s.organizables.find(o => o.youtubeId === 'UCzzzz')
assert.equal(other.name, 'Reassigned')
assert.notEqual(other.folderId, 'f1', 'the new channel does not inherit the old one\'s folder')

// 3c. A legacy entry (non-UC id) matched by handle is still migrated.
seed([stored({ youtubeId: 'legacy-id', name: 'Old', url: 'https://www.youtube.com/channel/legacy-id', handle: 'alpha' })])
await syncOrganizables([scraped('UCzzzz', 'alpha', 'New')])
s = await getState()
assert.deepEqual(s.organizables.map(o => o.youtubeId), ['UCzzzz'], 'legacy id is migrated through the handle match')
assert.equal(s.organizables[0].folderId, 'f1')

// 4. Legacy (non-UC id, no handle, no URL match) is still migrated by name.
seed([stored({ youtubeId: 'legacy-id', name: 'Same Name', url: 'https://www.youtube.com/channel/legacy-id' })])
await syncOrganizables([scraped('UCaaaa', 'alpha')])
s = await getState()
assert.equal(s.organizables.length, 1, 'legacy entry is reused, not duplicated')
assert.equal(s.organizables[0].youtubeId, 'UCaaaa', 'legacy id migrated to the UC id')
assert.equal(s.organizables[0].folderId, 'f1', 'folder kept')
