import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { openDB } from 'idb'

// INVARIANT: replacing the watch history is ONE atomic step on the shared database
// (src/shared/db.ts, the single source of truth for its name and version).
//
//  1. It works on a database that is already at the current version. The sidebar
//     used to open 'mytube' at a hard-coded version 1, which throws VersionError
//     once db.ts has created version 2.
//  2. All-or-nothing: if an entry cannot be stored, the old history is still
//     there afterwards (a clear that commits before the import loses the backup).
//  3. An empty backup clears the history.

const { exportWatchHistory, importWatchHistory, replaceWatchHistory } = await import('../src/shared/db.ts')

const entry = (videoId, watchedAt) => ({ videoId, channelId: 'chan-1', title: `Title ${videoId}`, watchedAt })
const ids = async () => (await exportWatchHistory()).map(e => e.videoId).sort()

// opening the DB through db.ts creates version 2
await importWatchHistory([entry('old-1', 1), entry('old-2', 2)])
const probe = await openDB('mytube')
assert.equal(probe.version, 2, 'precondition: the shared DB is at version 2')
probe.close()

// 1. replace on a v2 database
await replaceWatchHistory([entry('new-1', 3)])
assert.deepEqual(await ids(), ['new-1'], 'replace did not swap the history')

// 2. a failing entry leaves the previous history intact
await assert.rejects(
  replaceWatchHistory([entry('new-2', 4), { videoId: 'bad', run() {} }]),
  'a non-storable entry did not fail the replace',
)
assert.deepEqual(await ids(), ['new-1'], 'a failed replace lost or changed the previous history')

// 3. empty backup
await replaceWatchHistory([])
assert.deepEqual(await ids(), [], 'replace with an empty backup left old rows')

console.log('✓ watch-history-replace: atomic, version-agnostic')
