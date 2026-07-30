import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { NewVideoCheck, WatchEntry } from './types'

interface MyTubeDB extends DBSchema {
  watchHistory: {
    key: number
    value: WatchEntry
    indexes: {
      'by-channel': string
      'by-date': number
    }
  }
  newVideoChecks: {
    key: string
    value: NewVideoCheck
  }
}

let dbInstance: IDBPDatabase<MyTubeDB> | null = null

async function getDB(): Promise<IDBPDatabase<MyTubeDB>> {
  if (dbInstance) return dbInstance

  dbInstance = await openDB<MyTubeDB>('mytube', 1, {
    upgrade(db) {
      const watchStore = db.createObjectStore('watchHistory', {
        autoIncrement: true,
      })
      watchStore.createIndex('by-channel', 'channelId')
      watchStore.createIndex('by-date', 'watchedAt')

      db.createObjectStore('newVideoChecks', { keyPath: 'channelId' })
    },
  })
  return dbInstance
}

export async function addWatchEntry(entry: WatchEntry): Promise<void> {
  const db = await getDB()
  await db.add('watchHistory', entry)
}

export async function removeWatchEntries(videoId: string): Promise<void> {
  const database = await getDB()
  const tx = database.transaction('watchHistory', 'readwrite')
  let cursor = await tx.store.openCursor()
  while (cursor) {
    if (cursor.value.videoId === videoId) {
      await cursor.delete()
    }
    cursor = await cursor.continue()
  }
  await tx.done
}

async function getWatchHistory(limit = 100): Promise<WatchEntry[]> {
  const db = await getDB()
  const tx = db.transaction('watchHistory', 'readonly')
  const index = tx.store.index('by-date')
  const entries: WatchEntry[] = []

  let cursor = await index.openCursor(null, 'prev')
  while (cursor && entries.length < limit) {
    entries.push(cursor.value)
    cursor = await cursor.continue()
  }
  return entries
}

async function getWatchHistoryByChannel(channelId: string): Promise<WatchEntry[]> {
  const db = await getDB()
  return db.getAllFromIndex('watchHistory', 'by-channel', channelId)
}

export async function getNewVideoCheck(channelId: string): Promise<NewVideoCheck | undefined> {
  const db = await getDB()
  return db.get('newVideoChecks', channelId)
}

export async function setNewVideoCheck(check: NewVideoCheck): Promise<void> {
  const db = await getDB()
  await db.put('newVideoChecks', check)
}

export async function getAllNewVideoChecks(): Promise<NewVideoCheck[]> {
  const db = await getDB()
  return db.getAll('newVideoChecks')
}

// Mark a channel as "seen up to now": clears the badge AND advances the
// watermark so the currently-shown videos never resurface on a later poll.
export async function markChannelSeen(channelId: string, ts: number): Promise<void> {
  const db = await getDB()
  const existing = await db.get('newVideoChecks', channelId)
  if (existing) {
    await db.put('newVideoChecks', { ...existing, newCount: 0, seenUpToAt: ts })
  } else {
    await db.put('newVideoChecks', {
      channelId,
      lastKnownVideoId: '',
      lastCheckedAt: ts,
      newCount: 0,
      seenUpToAt: ts,
    })
  }
}

export async function getNewVideoCountsMap(): Promise<Record<string, number>> {
  const db = await getDB()
  const all = await db.getAll('newVideoChecks')
  const map: Record<string, number> = {}
  for (const check of all) {
    if (check.newCount > 0) {
      map[check.channelId] = check.newCount
    }
  }
  return map
}

export async function markAllSeen(ts: number): Promise<void> {
  const db = await getDB()
  const all = await db.getAll('newVideoChecks')
  const tx = db.transaction('newVideoChecks', 'readwrite')
  for (const check of all) {
    await tx.store.put({ ...check, newCount: 0, seenUpToAt: ts })
  }
  await tx.done
}

export async function pruneStaleVideoChecks(validChannelIds: Set<string>): Promise<number> {
  const database = await getDB()
  const all = await database.getAll('newVideoChecks')
  const tx = database.transaction('newVideoChecks', 'readwrite')
  let pruned = 0
  for (const check of all) {
    if (!validChannelIds.has(check.channelId)) {
      await tx.store.delete(check.channelId)
      pruned++
    }
  }
  await tx.done
  return pruned
}

export async function getWatchedVideoIds(): Promise<Set<string>> {
  const db = await getDB()
  const all = await db.getAll('watchHistory')
  return new Set(all.map(e => e.videoId))
}

export async function exportWatchHistory(): Promise<WatchEntry[]> {
  const db = await getDB()
  return db.getAll('watchHistory')
}

export async function importWatchHistory(entries: WatchEntry[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('watchHistory', 'readwrite')
  for (const entry of entries) {
    await tx.store.add(entry)
  }
  await tx.done
}
