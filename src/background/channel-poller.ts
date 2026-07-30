import * as storage from '../shared/storage'
import * as db from '../shared/db'
import { fetchChannelVideos, type RawFeedEntry } from './channel-scraper'
import type { FeedVideo, HomeFeedFolder } from '../shared/types'

interface PollableChannel {
  youtubeId: string
  url: string
  name: string
}

// Recency floor: a video only counts as "new" if published within this window.
// Guarantees old videos (e.g. a month ago) never resurface as new.
const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

async function pollSingleChannel(channel: PollableChannel, watchedIds: Set<string>): Promise<number> {
  try {
    const entries = await fetchChannelVideos(channel.url, channel.youtubeId, channel.name)
    if (entries.length === 0) return 0

    const latestVideoId = entries[0].videoId
    const existing = await db.getNewVideoCheck(channel.youtubeId)

    // Watermark: first sight → last week counts as new; an existing check missing
    // seenUpToAt (migrated from the old counter model) → clean slate from now.
    const seenUpToAt = existing
      ? existing.seenUpToAt ?? Date.now()
      : Date.now() - NEW_WINDOW_MS

    // A video is new only if past the watermark AND within the recency window.
    const floor = Math.max(seenUpToAt, Date.now() - NEW_WINDOW_MS)
    const newCount = entries.filter(
      e => e.publishedAt > floor && !watchedIds.has(e.videoId)
    ).length

    await db.setNewVideoCheck({
      channelId: channel.youtubeId,
      lastKnownVideoId: latestVideoId,
      lastCheckedAt: Date.now(),
      newCount,
      seenUpToAt,
    })

    return newCount
  } catch (err) {
    console.warn(`[MyTube] pollSingleChannel error for ${channel.youtubeId}:`, err)
    return 0
  }
}

const POLL_BATCH_SIZE = 3
const CHANNELS_PER_CYCLE = 200
const POLL_PROGRESS_KEY = 'mytube-poll-progress'

interface PollProgress {
  offset: number
  cycleStartedAt: number
  totalChannels: number
}

async function getPollProgress(): Promise<PollProgress | null> {
  const result = await chrome.storage.local.get(POLL_PROGRESS_KEY)
  return (result[POLL_PROGRESS_KEY] as PollProgress | undefined) ?? null
}

async function savePollProgress(progress: PollProgress | null): Promise<void> {
  if (progress) {
    await chrome.storage.local.set({ [POLL_PROGRESS_KEY]: progress })
  } else {
    await chrome.storage.local.remove(POLL_PROGRESS_KEY)
  }
}

export async function pollNewVideos(): Promise<void> {
  const state = await storage.getState()
  const channels: PollableChannel[] = state.organizables
    .filter(o => o.type === 'channel' && o.folderId && !o.muted)
    .map(o => ({ youtubeId: o.youtubeId, url: o.url, name: o.name }))

  if (channels.length === 0) return

  const validIds = new Set(state.organizables.filter(o => o.type === 'channel').map(o => o.youtubeId))
  const pruned = await db.pruneStaleVideoChecks(validIds)
  if (pruned > 0) console.log(`[MyTube] Pruned ${pruned} stale newVideoCheck entries`)

  let progress = await getPollProgress()
  const staleThreshold = 30 * 60 * 1000
  if (progress && Date.now() - progress.cycleStartedAt > staleThreshold) {
    progress = null
  }

  const offset = progress?.offset ?? 0
  const isResume = offset > 0

  const chunk = channels.slice(offset, offset + CHANNELS_PER_CYCLE)
  if (chunk.length === 0) {
    await savePollProgress(null)
    return
  }

  const totalBatches = Math.ceil(chunk.length / POLL_BATCH_SIZE)
  console.log(
    `[MyTube] Polling ${chunk.length} channels (offset ${offset}/${channels.length}, ${totalBatches} batches)` +
    (isResume ? ' [resumed]' : '')
  )

  const watchedIds = await db.getWatchedVideoIds()
  for (let i = 0; i < chunk.length; i += POLL_BATCH_SIZE) {
    const batch = chunk.slice(i, i + POLL_BATCH_SIZE)
    await Promise.all(batch.map(ch => pollSingleChannel(ch, watchedIds)))
  }

  const nextOffset = offset + chunk.length
  const cycleComplete = nextOffset >= channels.length

  if (cycleComplete) {
    await savePollProgress(null)
    console.log(`[MyTube] Poll cycle complete: ${channels.length} channels processed`)
  } else {
    await savePollProgress({
      offset: nextOffset,
      cycleStartedAt: progress?.cycleStartedAt ?? Date.now(),
      totalChannels: channels.length,
    })
    console.log(`[MyTube] Poll chunk done: ${nextOffset}/${channels.length}. Scheduling continuation…`)
    chrome.alarms.create('channel-poll-continue', { delayInMinutes: 0.1 })
  }

  const allCounts = await db.getNewVideoCountsMap()
  const totalNewCount = Object.values(allCounts).reduce((s, c) => s + c, 0)

  if (totalNewCount > 0) {
    chrome.action.setBadgeText({ text: String(totalNewCount) })
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' })
  } else {
    chrome.action.setBadgeText({ text: '' })
  }

  chrome.storage.local.set({ 'mytube-poll-seq': Date.now() })
}

/**
 * Busca vários canais em lotes, em vez de um a um.
 *
 * `pollChannels` já fazia isso (lotes de POLL_BATCH_SIZE com Promise.all), mas os
 * dois caminhos de feed buscavam sequencialmente — medido em 324 ms e 1,1 MB de
 * HTML por canal, o que colocava a Home em ~10 s com o estado real. O tamanho do
 * lote é o mesmo do polling de propósito: é o teto que já se sabe seguro contra
 * rate limiting do YouTube.
 *
 * O `fetcher` é injetável só para o teste poder medir concorrência sem rede.
 */
export async function fetchChannelsBatched(
  channels: PollableChannel[],
  fetcher: typeof fetchChannelVideos = fetchChannelVideos,
): Promise<Map<string, RawFeedEntry[]>> {
  const byChannel = new Map<string, RawFeedEntry[]>()
  for (let i = 0; i < channels.length; i += POLL_BATCH_SIZE) {
    const batch = channels.slice(i, i + POLL_BATCH_SIZE)
    const results = await Promise.all(
      batch.map(ch => fetcher(ch.url, ch.youtubeId, ch.name)),
    )
    batch.forEach((ch, k) => byChannel.set(ch.youtubeId, results[k] ?? []))
  }
  return byChannel
}

export async function fetchFolderFeed(folderId: string): Promise<FeedVideo[]> {
  const state = await storage.getState()

  const channels: PollableChannel[] = []
  const seen = new Set<string>()
  function collectChannels(parentId: string): void {
    for (const org of state.organizables) {
      if (org.type === 'channel' && org.folderId === parentId && !seen.has(org.youtubeId)) {
        seen.add(org.youtubeId)
        channels.push({ youtubeId: org.youtubeId, url: org.url, name: org.name })
      }
    }
    for (const folder of state.folders) {
      if (folder.parentId === parentId) {
        collectChannels(folder.id)
      }
    }
  }
  collectChannels(folderId)

  console.log(`[MyTube] fetchFolderFeed: folder=${folderId}, channels=${channels.length}`)
  if (channels.length === 0) return []

  const allEntries: RawFeedEntry[] = []
  let fetchErrors = 0

  const byChannel = await fetchChannelsBatched(channels)
  for (const ch of channels) {
    const entries = byChannel.get(ch.youtubeId) ?? []
    if (entries.length === 0) fetchErrors++
    allEntries.push(...entries)
  }

  console.log(`[MyTube] fetchFolderFeed: ${allEntries.length} entries from ${channels.length} channels (${fetchErrors} failed)`)

  const watchedIds = await db.getWatchedVideoIds()

  const videos: FeedVideo[] = allEntries
    .filter(e => !watchedIds.has(e.videoId))
    .map(e => ({
      videoId: e.videoId,
      title: e.title,
      channelId: e.channelId,
      channelName: e.channelName,
      thumbnailUrl: e.thumbnailUrl,
      publishedAt: e.publishedAt,
      url: `https://www.youtube.com/watch?v=${e.videoId}`,
      watched: false,
      viewCount: e.viewCount,
      duration: e.duration,
    }))

  videos.sort((a, b) => b.publishedAt - a.publishedAt)
  return videos
}

export async function fetchHomeFeed(
  mode: 'new-only' | 'latest',
  latestCount = 5,
): Promise<HomeFeedFolder[]> {
  const state = await storage.getState()
  const countsMap = await db.getNewVideoCountsMap()

  const candidates = state.organizables.filter(o => {
    if (o.type !== 'channel' || o.muted || !o.folderId) return false
    if (mode === 'new-only') return (countsMap[o.youtubeId] ?? 0) > 0
    return true
  })

  if (candidates.length === 0) return []

  const folderMap = new Map(state.folders.map(f => [f.id, f]))

  const grouped = new Map<string, { folder: typeof state.folders[0]; channels: typeof candidates }>()
  for (const ch of candidates) {
    const folder = folderMap.get(ch.folderId!)
    if (!folder) continue
    const existing = grouped.get(folder.id)
    if (existing) {
      existing.channels.push(ch)
    } else {
      grouped.set(folder.id, { folder, channels: [ch] })
    }
  }

  const watchedIds = await db.getWatchedVideoIds()
  const allChecks = await db.getAllNewVideoChecks()
  // Missing seenUpToAt = a record migrated from the old counter model: default
  // to now (clean slate) so old videos don't flood before the next poll fixes it.
  const watermarkMap = new Map(allChecks.map(c => [c.channelId, c.seenUpToAt ?? Date.now()]))
  const HOME_CHANNEL_CAP = 50
  const result: HomeFeedFolder[] = []

  // Busca TODOS os candidatos antes de agrupar: antes, canais de pastas diferentes
  // eram buscados em série um atrás do outro, então o custo era a soma de todos.
  const byChannel = await fetchChannelsBatched(
    candidates.map(c => ({ youtubeId: c.youtubeId, url: c.url, name: c.name })),
  )

  for (const [, { folder, channels }] of grouped) {
    const feedChannels: HomeFeedFolder['channels'] = []

    for (const ch of channels) {
      const entries = byChannel.get(ch.youtubeId) ?? []
      const seenUpToAt = watermarkMap.get(ch.youtubeId) ?? Date.now()
      const floor = Math.max(seenUpToAt, Date.now() - NEW_WINDOW_MS)
      const unwatched = entries
        .filter(e => !watchedIds.has(e.videoId))
        .map(e => ({
          videoId: e.videoId,
          title: e.title,
          channelId: e.channelId,
          channelName: e.channelName,
          thumbnailUrl: e.thumbnailUrl,
          publishedAt: e.publishedAt,
          url: `https://www.youtube.com/watch?v=${e.videoId}`,
          watched: false,
          viewCount: e.viewCount,
          duration: e.duration,
        }))
        .sort((a, b) => b.publishedAt - a.publishedAt)

      // new-only is an inbox: show exactly the videos past the watermark AND within
      // the recency window (no slice/backfill). latest is a browse mode: newest N.
      const visible = mode === 'new-only'
        ? unwatched.filter(v => v.publishedAt > floor).slice(0, HOME_CHANNEL_CAP)
        : unwatched.slice(0, latestCount)

      const videos: FeedVideo[] = visible.map(v => ({
        ...v,
        isNew: v.publishedAt > floor,
      }))
      const newCount = videos.filter(v => v.isNew).length

      if (videos.length > 0) {
        feedChannels.push({
          channelId: ch.youtubeId,
          channelName: ch.name,
          newCount,
          videos,
        })
      }
    }

    feedChannels.sort((a, b) => b.newCount - a.newCount)

    result.push({
      folderId: folder.id,
      folderName: folder.name,
      folderColor: folder.color,
      channels: feedChannels,
    })
  }

  result.sort((a, b) => {
    const fa = folderMap.get(a.folderId)
    const fb = folderMap.get(b.folderId)
    return (fa?.order ?? 0) - (fb?.order ?? 0)
  })

  return result
}
