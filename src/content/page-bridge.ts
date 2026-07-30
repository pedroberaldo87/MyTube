const BRIDGE_ID = '__mytube-yt-data'

function getPageData(): unknown | null {
  const win = window as unknown as Record<string, unknown>
  return win.ytInitialData
    ?? ((document.querySelector('ytd-browse') as unknown as { data?: unknown } | null)?.data)
    ?? null
}

function storeYtData(): boolean {
  const data = getPageData()
  if (!data) return false

  let el = document.getElementById(BRIDGE_ID)
  if (!el) {
    el = document.createElement('div')
    el.id = BRIDGE_ID
    el.style.display = 'none'
    document.documentElement.appendChild(el)
  }
  try {
    el.textContent = JSON.stringify(data)
    document.dispatchEvent(new CustomEvent('mytube:yt-data-ready'))
    return true
  } catch {
    return false
  }
}

function pollForData(maxAttempts = 30): void {
  let attempts = 0
  function tryStore(): void {
    if (storeYtData()) return
    attempts++
    if (attempts < maxAttempts) {
      setTimeout(tryStore, 500)
    }
  }
  tryStore()
}

pollForData()

document.addEventListener('yt-navigate-finish', () => {
  const old = document.getElementById(BRIDGE_ID)
  if (old) old.remove()
  pollForData()
})

// ───────────────────────────────────────────────────────────────────────────
// Watch Later — add a video to the account's "WL" playlist via InnerTube.
//
// Runs in the MAIN world so it can read window.ytcfg (InnerTube API key +
// context) and sign the request with SAPISIDHASH, which YouTube requires for
// account mutations. The Home overlay (isolated world) talks to us over
// window.postMessage (event.detail does NOT cross the world boundary).
// ───────────────────────────────────────────────────────────────────────────

const YT_ORIGIN = 'https://www.youtube.com'

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

async function sha1Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// SAPISIDHASH recipe used by YouTube's own frontend: sha1("<ts> <SAPISID> <origin>").
async function buildSapisidHash(): Promise<string | null> {
  const sapisid =
    readCookie('SAPISID') ?? readCookie('__Secure-3PAPISID') ?? readCookie('__Secure-1PAPISID')
  if (!sapisid) return null
  const ts = Math.floor(Date.now() / 1000)
  const hash = await sha1Hex(`${ts} ${sapisid} ${YT_ORIGIN}`)
  return `SAPISIDHASH ${ts}_${hash}`
}

function ytcfgGet(key: string): unknown {
  const w = window as unknown as {
    ytcfg?: { get?: (k: string) => unknown; data_?: Record<string, unknown> }
  }
  if (w.ytcfg?.get) {
    try { return w.ytcfg.get(key) } catch { /* fall through */ }
  }
  return w.ytcfg?.data_?.[key]
}

async function addToWatchLater(videoId: string): Promise<boolean> {
  const apiKey = ytcfgGet('INNERTUBE_API_KEY') as string | undefined
  const context = ytcfgGet('INNERTUBE_CONTEXT') as Record<string, unknown> | undefined
  if (!apiKey || !context) {
    console.warn('[MyTube] Watch Later: missing InnerTube config (not logged in?)')
    return false
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Origin': YT_ORIGIN,
    'X-Goog-AuthUser': '0',
  }
  const auth = await buildSapisidHash()
  if (auth) headers['Authorization'] = auth

  try {
    const res = await fetch(
      `${YT_ORIGIN}/youtubei/v1/browse/edit_playlist?key=${apiKey}&prettyPrint=false`,
      {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          context,
          playlistId: 'WL',
          actions: [{ addedVideoId: videoId, action: 'ACTION_ADD_VIDEO' }],
        }),
      },
    )
    if (!res.ok) {
      console.warn('[MyTube] Watch Later: HTTP', res.status)
      return false
    }
    const data = (await res.json()) as { status?: string }
    return data.status === 'STATUS_SUCCEEDED'
  } catch (err) {
    console.warn('[MyTube] Watch Later: request failed', err)
    return false
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return
  const data = event.data as { __mytube?: string; videoId?: string } | null
  if (!data || data.__mytube !== 'add-to-watch-later' || typeof data.videoId !== 'string') return
  const videoId = data.videoId
  void addToWatchLater(videoId).then(ok => {
    window.postMessage({ __mytube: 'watch-later-result', videoId, ok }, YT_ORIGIN)
  })
})
