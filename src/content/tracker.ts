import type { WatchEntry } from '../shared/types'
import { sendMessage } from '../shared/messages'
import { YT, $ } from '../shared/selectors'

// Dynamically mount the sidebar (Shadow DOM) so it doesn't block tracker init
import('./sidebar/mount').catch(err =>
  console.warn('[MyTube] Failed to load sidebar:', err)
)

// Guard against tracking the same video twice in a single SPA session
let lastTrackedVideoId: string | null = null

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  // Handles both /watch?v=ID and /watch/ID (Shorts-style)
  const searchParams = new URL(url).searchParams
  const fromQuery = searchParams.get('v')
  if (fromQuery) return fromQuery

  const match = url.match(/\/watch\/([^/?&]+)/)
  return match ? match[1] : null
}

/**
 * Extracts the canonical channel ID or handle from the channel link href.
 * - /channel/UCxxxxxxx  → returns UCxxxxxxx
 * - /@handle           → returns @handle
 * - /c/CustomName      → returns CustomName
 */
function extractChannelId(href: string): string | null {
  const channelMatch = href.match(/\/channel\/(UC[^/?&]+)/)
  if (channelMatch) return channelMatch[1]

  const handleMatch = href.match(/\/@([^/?&]+)/)
  if (handleMatch) return `@${handleMatch[1]}`

  const customMatch = href.match(/\/c\/([^/?&]+)/)
  if (customMatch) return customMatch[1]

  return null
}

function extractChannelIdFromMeta(): string | null {
  // YouTube embeds the channel ID in a <meta itemprop="channelId"> or similar
  const itemprop = document.querySelector('meta[itemprop="channelId"]')
  if (itemprop) {
    const content = itemprop.getAttribute('content')
    if (content) return content
  }

  // Fallback: look for ytInitialData in page scripts
  try {
    const scripts = Array.from(document.querySelectorAll('script'))
    for (const script of scripts) {
      const text = script.textContent ?? ''
      const match = text.match(/"externalChannelId"\s*:\s*"(UC[^"]+)"/)
      if (match) return match[1]
    }
  } catch {
    // Ignore parse errors
  }

  return null
}

function getCurrentChannelId(): string | null {
  // 1. Try the channel link in the watch page owner section
  const linkEl = $(YT.channelLink)
  if (linkEl) {
    const href = linkEl.getAttribute('href')
    if (href) {
      const id = extractChannelId(href)
      if (id) return id
    }
  }

  // 2. Fallback to meta / ytInitialData
  return extractChannelIdFromMeta()
}

function getCurrentTitle(): string {
  const titleEl = $(YT.videoTitle)
  return titleEl?.textContent?.trim() ?? document.title
}

// ── Core tracking logic ───────────────────────────────────────────────────────

async function trackCurrentPage(): Promise<void> {
  const url = window.location.href
  const videoId = extractVideoId(url)

  if (!videoId) return
  if (videoId === lastTrackedVideoId) return

  // Wait a short tick for the DOM to finish rendering after SPA navigation
  await new Promise<void>(resolve => setTimeout(resolve, 500))

  const channelId = getCurrentChannelId()
  if (!channelId) {
    console.warn('[MyTube] Could not determine channelId for video', videoId)
    return
  }

  const title = getCurrentTitle()

  const entry: WatchEntry = {
    videoId,
    channelId,
    title,
    watchedAt: Date.now(),
  }

  try {
    await sendMessage({ type: 'ADD_WATCH_ENTRY', payload: entry })
    lastTrackedVideoId = videoId
  } catch (err) {
    console.warn('[MyTube] Failed to send ADD_WATCH_ENTRY:', err)
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

// YouTube SPA navigation events
document.addEventListener('yt-navigate-finish', () => {
  trackCurrentPage().catch(err =>
    console.warn('[MyTube] trackCurrentPage error:', err)
  )
})

// Handle the initial page load (extension may be injected into an already-loaded tab)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    trackCurrentPage().catch(err =>
      console.warn('[MyTube] trackCurrentPage (initial) error:', err)
    )
  })
} else {
  // DOM already ready
  trackCurrentPage().catch(err =>
    console.warn('[MyTube] trackCurrentPage (initial) error:', err)
  )
}
