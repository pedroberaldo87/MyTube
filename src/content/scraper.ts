/**
 * scraper.ts — MyTube content script
 *
 * Listens for SCRAPE_SUBSCRIPTIONS and SCRAPE_PLAYLISTS messages from the
 * background/sidebar, scrapes the current YouTube feed page, and sends the
 * results back via SYNC_SUBSCRIPTIONS / SYNC_PLAYLISTS.
 *
 * This script is injected on all youtube.com pages; it only does real work
 * when the correct feed URL is active.
 */

import { sendMessage } from '../shared/messages'
import { $$, YT } from '../shared/selectors'
import type { Organizable } from '../shared/types'

// ---------------------------------------------------------------------------
// Types for inbound scrape requests (not in MessageType — handled directly)
// ---------------------------------------------------------------------------

interface ScrapeRequest {
  type: 'SCRAPE_SUBSCRIPTIONS' | 'SCRAPE_PLAYLISTS'
}

interface ScrapeResponse {
  ok: boolean
  count?: number
  error?: string
}

// ---------------------------------------------------------------------------
// Wait for DOM items to appear
// ---------------------------------------------------------------------------

async function waitForItems(selector: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (document.querySelectorAll(selector).length > 0) return true
    await new Promise<void>(r => setTimeout(r, 500))
  }
  return false
}

// ---------------------------------------------------------------------------
// Auto-scroll helper
// ---------------------------------------------------------------------------

async function autoScroll(itemSelector: string): Promise<void> {
  const MAX_ITERATIONS = 50
  const WAIT_MS = 1500

  let previousCount = 0
  let stableRounds = 0

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })

    await new Promise<void>(resolve => setTimeout(resolve, WAIT_MS))

    const currentCount = document.querySelectorAll(itemSelector).length

    if (currentCount === previousCount) {
      stableRounds++
      // Two consecutive stable rounds means we've loaded everything
      if (stableRounds >= 2) break
    } else {
      stableRounds = 0
    }

    previousCount = currentCount
  }
}

// ---------------------------------------------------------------------------
// Subscription scraping
// ---------------------------------------------------------------------------

function extractYoutubeIdFromChannelHref(href: string): string {
  // Handles /channel/UCxxx and /@handle forms
  const channelMatch = href.match(/\/channel\/(UC[\w-]+)/)
  if (channelMatch) return channelMatch[1]

  const handleMatch = href.match(/\/@([\w.-]+)/)
  if (handleMatch) return `@${handleMatch[1]}`

  return href
}

function extractHandleFromUrl(url: string): string | undefined {
  const match = url.match(/\/@([\w.-]+)/)
  return match ? match[1].toLowerCase() : undefined
}

interface YtChannelData {
  channelId: string
  title: string
  thumbnailUrl: string
  url: string
  handle?: string
}

function deepFindChannels(obj: unknown, results: YtChannelData[], depth = 0): void {
  if (depth > 20 || !obj || typeof obj !== 'object') return

  const record = obj as Record<string, unknown>

  for (const key of ['gridChannelRenderer', 'channelRenderer', 'lockupViewModel']) {
    if (record[key] && typeof record[key] === 'object') {
      const renderer = record[key] as Record<string, unknown>
      const extracted = extractChannelFromRenderer(renderer, key)
      if (extracted) {
        results.push(extracted)
        return
      }
    }
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFindChannels(item, results, depth + 1)
    }
  } else {
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        deepFindChannels(value, results, depth + 1)
      }
    }
  }
}

function extractChannelFromRenderer(renderer: Record<string, unknown>, type: string): YtChannelData | null {
  let channelId = ''
  let title = ''
  let thumbnailUrl = ''
  let url = ''
  let handle: string | undefined

  if (type === 'lockupViewModel') {
    const contentId = renderer.contentId as string | undefined
    if (contentId) {
      channelId = contentId
      if (contentId.startsWith('@')) {
        handle = contentId.slice(1).toLowerCase()
      }
    }

    const metadata = renderer.metadata as Record<string, unknown> | undefined
    if (metadata) {
      const lockupMetadata = metadata.lockupMetadataViewModel as Record<string, unknown> | undefined
      if (lockupMetadata) {
        const titleObj = lockupMetadata.title as Record<string, unknown> | undefined
        if (titleObj) title = (titleObj.content as string) ?? ''
      }
    }

    const rendererContext = renderer.rendererContext as Record<string, unknown> | undefined
    if (rendererContext) {
      const commandContext = rendererContext.commandContext as Record<string, unknown> | undefined
      if (commandContext) {
        const onTap = commandContext.onTap as Record<string, unknown> | undefined
        if (onTap) {
          const innertubeCommand = onTap.innertubeCommand as Record<string, unknown> | undefined
          if (innertubeCommand) {
            const browseEndpoint = innertubeCommand.browseEndpoint as Record<string, unknown> | undefined
            if (browseEndpoint) {
              const browseId = browseEndpoint.browseId as string | undefined
              if (browseId) channelId = browseId
              const canonicalBaseUrl = browseEndpoint.canonicalBaseUrl as string | undefined
              if (canonicalBaseUrl) {
                url = `https://www.youtube.com${canonicalBaseUrl}`
                const h = extractHandleFromUrl(canonicalBaseUrl)
                if (h) handle = h
              }
            }
          }
        }
      }
    }
  } else {
    channelId = (renderer.channelId as string) ?? ''

    const titleObj = renderer.title as Record<string, unknown> | undefined
    if (titleObj) {
      const runs = titleObj.runs as Array<Record<string, unknown>> | undefined
      if (runs && runs.length > 0) title = (runs[0].text as string) ?? ''
      if (!title) title = (titleObj.simpleText as string) ?? ''
    }

    const thumbObj = renderer.thumbnail as Record<string, unknown> | undefined
    if (thumbObj) {
      const thumbnails = thumbObj.thumbnails as Array<Record<string, unknown>> | undefined
      if (thumbnails && thumbnails.length > 0) {
        thumbnailUrl = (thumbnails[thumbnails.length - 1].url as string) ?? ''
      }
    }

    const navEndpoint = renderer.navigationEndpoint as Record<string, unknown> | undefined
    if (navEndpoint) {
      const cmdMeta = navEndpoint.commandMetadata as Record<string, unknown> | undefined
      if (cmdMeta) {
        const webCmd = cmdMeta.webCommandMetadata as Record<string, unknown> | undefined
        if (webCmd) {
          const webUrl = webCmd.url as string | undefined
          if (webUrl) url = `https://www.youtube.com${webUrl}`
        }
      }
      if (!url) {
        const browseEndpoint = navEndpoint.browseEndpoint as Record<string, unknown> | undefined
        if (browseEndpoint) {
          const canonicalBaseUrl = browseEndpoint.canonicalBaseUrl as string | undefined
          if (canonicalBaseUrl) url = `https://www.youtube.com${canonicalBaseUrl}`
        }
      }
    }
  }

  if (!channelId || !title) return null
  if (!url) url = `https://www.youtube.com/channel/${channelId}`
  if (!handle) handle = extractHandleFromUrl(url)

  return { channelId, title, thumbnailUrl, url, handle }
}

async function scrapeSubscriptions(): Promise<ScrapeResponse> {
  if (!location.pathname.includes('/feed/channels')) {
    return {
      ok: false,
      error: 'Navigate to youtube.com/feed/channels first',
    }
  }

  console.log('[MyTube] scrapeSubscriptions() started on', location.href)

  const channels: Omit<Organizable, 'id' | 'addedAt' | 'lastSyncedAt'>[] = []

  // Strategy 1: ytInitialData (via page-bridge or inline script parsing)
  let ytData: unknown | null = null
  const dataStart = Date.now()
  while (Date.now() - dataStart < 20000) {
    ytData = getYtInitialData()
    if (ytData) break
    await new Promise<void>(r => setTimeout(r, 500))
  }

  if (ytData) {
    console.log('[MyTube] Found ytInitialData after', Date.now() - dataStart, 'ms')
    const found: YtChannelData[] = []
    deepFindChannels(ytData, found)
    console.log(`[MyTube] ytInitialData extraction found ${found.length} channels`)

    const seenIds = new Set<string>()
    for (const item of found) {
      if (seenIds.has(item.channelId)) continue
      seenIds.add(item.channelId)

      channels.push({
        type: 'channel',
        youtubeId: item.channelId,
        name: item.title,
        thumbnailUrl: item.thumbnailUrl,
        url: item.url,
        handle: item.handle,
        folderId: null,
        tagIds: [],
        isSubscribed: true,
      })
    }
  }

  // Strategy 2: DOM fallback
  if (channels.length === 0) {
    console.log('[MyTube] ytInitialData: no channels found (data was', ytData ? 'present but empty' : 'null', '), trying DOM…')
    const found = await waitForItems(YT.subscriptionItem, 20000)
    if (found) {
      await autoScroll(YT.subscriptionItem)
      const items = $$(YT.subscriptionItem)
      console.log(`[MyTube] DOM found ${items.length} subscription items`)
      for (const item of items) {
        const nameEl = item.querySelector(YT.subscriptionItemName)
        const linkEl = item.querySelector(YT.subscriptionItemLink)
        const avatarEl = item.querySelector(YT.subscriptionItemAvatar)

        const name = nameEl?.textContent?.trim() ?? ''
        const href = (linkEl as HTMLAnchorElement | null)?.href ?? ''
        const thumbnailUrl = (avatarEl as HTMLImageElement | null)?.src ?? ''

        if (!name || !href) continue
        const youtubeId = extractYoutubeIdFromChannelHref(href)

        channels.push({
          type: 'channel',
          youtubeId,
          name,
          thumbnailUrl,
          url: href,
          handle: extractHandleFromUrl(href),
          folderId: null,
          tagIds: [],
          isSubscribed: true,
        })
      }
    }
  }

  console.log(`[MyTube] Total channels extracted: ${channels.length}`)

  if (channels.length === 0) {
    console.warn('[MyTube] Could not extract any channels from the page')
    return { ok: false, error: 'No channels found' }
  }

  await sendMessage({ type: 'SYNC_SUBSCRIPTIONS', payload: channels as Organizable[] })
  document.dispatchEvent(new CustomEvent('mytube:state-updated'))
  return { ok: true, count: channels.length }
}

// ---------------------------------------------------------------------------
// Playlist scraping
// ---------------------------------------------------------------------------

function extractPlaylistId(href: string): string {
  try {
    const url = new URL(href)
    return url.searchParams.get('list') ?? href
  } catch {
    const match = href.match(/[?&]list=([\w-]+)/)
    return match ? match[1] : href
  }
}

// ---------------------------------------------------------------------------
// ytInitialData extraction — reliable, DOM-independent
// ---------------------------------------------------------------------------

interface YtPlaylistData {
  playlistId: string
  title: string
  thumbnailUrl: string
}

function getYtInitialData(): unknown | null {
  // Method 1: read from page-bridge (MAIN world script stores data in DOM)
  const bridge = document.getElementById('__mytube-yt-data')
  if (bridge?.textContent) {
    try { return JSON.parse(bridge.textContent) } catch { /* continue */ }
  }

  // Method 2: parse from inline script tags (works from isolated world)
  const markers = ['var ytInitialData = ', 'window["ytInitialData"] = ']
  const scripts = document.querySelectorAll('script:not([src])')
  for (const script of scripts) {
    const text = script.textContent ?? ''
    for (const marker of markers) {
      const idx = text.indexOf(marker)
      if (idx === -1) continue
      const jsonStart = idx + marker.length
      let depth = 0
      let end = -1
      for (let i = jsonStart; i < text.length; i++) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') {
          depth--
          if (depth === 0) { end = i + 1; break }
        }
      }
      if (end > jsonStart) {
        try { return JSON.parse(text.substring(jsonStart, end)) } catch { /* continue */ }
      }
    }
  }

  return null
}

function deepFindPlaylists(obj: unknown, results: YtPlaylistData[], depth = 0): void {
  if (depth > 20 || !obj || typeof obj !== 'object') return

  const record = obj as Record<string, unknown>

  // Look for gridPlaylistRenderer or playlistRenderer
  for (const key of ['gridPlaylistRenderer', 'playlistRenderer', 'lockupViewModel']) {
    if (record[key] && typeof record[key] === 'object') {
      const renderer = record[key] as Record<string, unknown>
      const extracted = extractFromRenderer(renderer, key)
      if (extracted) {
        results.push(extracted)
        return
      }
    }
  }

  // Recurse into arrays and objects
  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFindPlaylists(item, results, depth + 1)
    }
  } else {
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        deepFindPlaylists(value, results, depth + 1)
      }
    }
  }
}

function extractFromRenderer(renderer: Record<string, unknown>, type: string): YtPlaylistData | null {
  let playlistId = ''
  let title = ''
  let thumbnailUrl = ''

  if (type === 'lockupViewModel') {
    // New YouTube lockup format
    const contentId = renderer.contentId as string | undefined
    if (contentId) playlistId = contentId

    const metadata = renderer.metadata as Record<string, unknown> | undefined
    if (metadata) {
      const lockupMetadata = metadata.lockupMetadataViewModel as Record<string, unknown> | undefined
      if (lockupMetadata) {
        const titleObj = lockupMetadata.title as Record<string, unknown> | undefined
        if (titleObj) {
          title = (titleObj.content as string) ?? ''
        }
      }
    }

    const contentImage = renderer.contentImage as Record<string, unknown> | undefined
    if (contentImage) {
      const collectionThumbnail = contentImage.collectionThumbnailViewModel as Record<string, unknown> | undefined
      if (collectionThumbnail) {
        const primaryThumbnail = collectionThumbnail.primaryThumbnail as Record<string, unknown> | undefined
        if (primaryThumbnail) {
          const thumbnailViewModel = primaryThumbnail.thumbnailViewModel as Record<string, unknown> | undefined
          if (thumbnailViewModel) {
            const image = thumbnailViewModel.image as Record<string, unknown> | undefined
            if (image) {
              const sources = image.sources as Array<Record<string, unknown>> | undefined
              if (sources && sources.length > 0) {
                thumbnailUrl = (sources[0].url as string) ?? ''
              }
            }
          }
        }
      }
    }
  } else {
    // Classic gridPlaylistRenderer / playlistRenderer
    playlistId = (renderer.playlistId as string) ?? ''

    const titleObj = renderer.title as Record<string, unknown> | undefined
    if (titleObj) {
      const runs = titleObj.runs as Array<Record<string, unknown>> | undefined
      if (runs && runs.length > 0) {
        title = (runs[0].text as string) ?? ''
      }
      if (!title) {
        title = (titleObj.simpleText as string) ?? ''
      }
    }

    const thumbObj = renderer.thumbnail as Record<string, unknown> | undefined
    if (thumbObj) {
      const thumbnails = thumbObj.thumbnails as Array<Record<string, unknown>> | undefined
      if (thumbnails && thumbnails.length > 0) {
        thumbnailUrl = (thumbnails[thumbnails.length - 1].url as string) ?? ''
      }
    }

    if (!thumbnailUrl) {
      const thumbsArr = renderer.thumbnails as Array<Record<string, unknown>> | undefined
      if (thumbsArr && thumbsArr.length > 0) {
        const firstThumb = thumbsArr[0]
        const innerThumbs = firstThumb.thumbnails as Array<Record<string, unknown>> | undefined
        if (innerThumbs && innerThumbs.length > 0) {
          thumbnailUrl = (innerThumbs[innerThumbs.length - 1].url as string) ?? ''
        }
      }
    }
  }

  if (!playlistId || !title) return null
  // Skip Watch Later and Liked Videos
  if (playlistId === 'WL' || playlistId === 'LL') return null

  return { playlistId, title, thumbnailUrl }
}

async function scrapePlaylists(): Promise<ScrapeResponse> {
  if (!location.pathname.includes('/feed/playlists')) {
    return {
      ok: false,
      error: 'Navigate to youtube.com/feed/playlists first',
    }
  }

  console.log('[MyTube] scrapePlaylists() started on', location.href)

  // Wait for YouTube to populate data (SPA or initial load)
  let ytData: unknown | null = null
  const dataStart = Date.now()
  while (Date.now() - dataStart < 15000) {
    ytData = getYtInitialData()
    if (ytData) break
    await new Promise<void>(r => setTimeout(r, 500))
  }

  const playlists: Omit<Organizable, 'id' | 'addedAt' | 'lastSyncedAt'>[] = []

  // Strategy 1: Extract from ytInitialData (most reliable)
  if (ytData) {
    console.log('[MyTube] Found ytInitialData, extracting playlists…')
    const found: YtPlaylistData[] = []
    deepFindPlaylists(ytData, found)
    console.log(`[MyTube] ytInitialData extraction found ${found.length} playlists`)

    const seenIds = new Set<string>()
    for (const item of found) {
      if (seenIds.has(item.playlistId)) continue
      seenIds.add(item.playlistId)

      playlists.push({
        type: 'playlist',
        youtubeId: item.playlistId,
        name: item.title,
        thumbnailUrl: item.thumbnailUrl,
        url: `https://www.youtube.com/playlist?list=${item.playlistId}`,
        folderId: null,
        tagIds: [],
        isSubscribed: false,
      })
    }
  }

  // Strategy 2: DOM fallback — scan all playlist links
  if (playlists.length === 0) {
    console.log('[MyTube] ytInitialData extraction failed or empty, trying DOM fallback…')

    // Wait for DOM content
    await waitForItems('a[href*="list="]', 10000)
    await autoScroll('a[href*="list="]')

    const seenIds = new Set<string>()
    const allLinks = $$('a[href*="list="]') as HTMLAnchorElement[]

    for (const link of allLinks) {
      const href = link.href
      if (!href || href.includes('list=WL') || href.includes('list=LL')) continue

      const youtubeId = extractPlaylistId(href)
      if (seenIds.has(youtubeId)) continue
      seenIds.add(youtubeId)

      const closest = link.closest('[class*="renderer"], [class*="lockup"]')
      let name = ''
      if (closest) {
        const titleEl = closest.querySelector('#video-title, h3 yt-formatted-string, h3 a, [id="video-title"]')
        name = titleEl?.textContent?.trim() ?? ''
      }
      if (!name) name = link.textContent?.trim() ?? ''
      if (!name) continue

      let thumbnailUrl = ''
      if (closest) {
        const img = closest.querySelector('img')
        thumbnailUrl = (img as HTMLImageElement | null)?.src ?? ''
      }

      playlists.push({
        type: 'playlist',
        youtubeId,
        name,
        thumbnailUrl,
        url: href,
        folderId: null,
        tagIds: [],
        isSubscribed: false,
      })
    }
  }

  console.log(`[MyTube] Total playlists extracted: ${playlists.length}`)

  if (playlists.length === 0) {
    console.warn('[MyTube] Could not extract any playlists from the page')
    return { ok: false, error: 'No playlists found' }
  }

  await sendMessage({ type: 'SYNC_PLAYLISTS', payload: playlists as Organizable[] })
  document.dispatchEvent(new CustomEvent('mytube:state-updated'))
  return { ok: true, count: playlists.length }
}

// ---------------------------------------------------------------------------
// Auto-detect feed pages and scrape on arrival
// ---------------------------------------------------------------------------

let scraping = false

async function autoDetectAndScrape(): Promise<void> {
  if (scraping) return

  const path = location.pathname

  if (path.includes('/feed/channels')) {
    scraping = true
    console.log('[MyTube] Detected /feed/channels — auto-scraping subscriptions…')
    try {
      const result = await scrapeSubscriptions()
      console.log(`[MyTube] Scraped ${result.count ?? 0} subscriptions`)
    } catch (err) {
      console.error('[MyTube] Auto-scrape subscriptions error:', err)
    } finally {
      scraping = false
    }
    return
  }

  if (path.includes('/feed/playlists')) {
    scraping = true
    console.log('[MyTube] Detected /feed/playlists — auto-scraping playlists…')
    try {
      const result = await scrapePlaylists()
      console.log(`[MyTube] Scraped ${result.count ?? 0} playlists`)
    } catch (err) {
      console.error('[MyTube] Auto-scrape playlists error:', err)
    } finally {
      scraping = false
    }
  }
}

document.addEventListener('yt-navigate-finish', () => {
  setTimeout(() => void autoDetectAndScrape(), 1000)
})

if (location.pathname.includes('/feed/channels') || location.pathname.includes('/feed/playlists')) {
  setTimeout(() => void autoDetectAndScrape(), 2000)
}

// ---------------------------------------------------------------------------
// Message listener (kept for programmatic triggers)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ScrapeResponse) => void
  ) => {
    const msg = message as ScrapeRequest

    if (msg.type === 'SCRAPE_SUBSCRIPTIONS') {
      scrapeSubscriptions()
        .then(sendResponse)
        .catch(err => {
          console.error('[MyTube] Scrape subscriptions error:', err)
          sendResponse({ ok: false, error: String(err) })
        })
      return true
    }

    if (msg.type === 'SCRAPE_PLAYLISTS') {
      scrapePlaylists()
        .then(sendResponse)
        .catch(err => {
          console.error('[MyTube] Scrape playlists error:', err)
          sendResponse({ ok: false, error: String(err) })
        })
      return true
    }

    return false
  }
)
