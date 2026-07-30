export interface RawFeedEntry {
  videoId: string
  title: string
  publishedAt: number
  thumbnailUrl: string
  channelName: string
  channelId: string
  viewCount?: string
  duration?: string
}

const videoCache = new Map<string, { entries: RawFeedEntry[]; fetchedAt: number }>()
const CACHE_TTL = 10 * 60 * 1000

/**
 * Exportados para teste. O caminho HTML -> ytInitialData -> lockup -> vídeo é a
 * parte do projeto que quebra primeiro quando o YouTube muda a página, e era a
 * única sem nenhuma cobertura: `fetchChannelVideos` faz rede e não dá para rodar
 * em CI, mas o parser sozinho é pura transformação de dado.
 */
export function extractYtInitialData(html: string): unknown | null {
  const markers = ['var ytInitialData = ', 'window["ytInitialData"] = ', "window['ytInitialData'] = "]
  for (const marker of markers) {
    const idx = html.indexOf(marker)
    if (idx === -1) continue

    const jsonStart = idx + marker.length
    let depth = 0
    let end = -1
    for (let i = jsonStart; i < html.length; i++) {
      if (html[i] === '{') depth++
      else if (html[i] === '}') {
        depth--
        if (depth === 0) { end = i + 1; break }
      }
    }
    if (end <= jsonStart) continue

    try {
      return JSON.parse(html.substring(jsonStart, end))
    } catch {
      continue
    }
  }
  return null
}

export function parseRelativeDate(text: string): number {
  const enMatch = text.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i)
  if (enMatch) {
    const n = parseInt(enMatch[1])
    const multipliers: Record<string, number> = {
      second: 1_000, minute: 60_000, hour: 3_600_000,
      day: 86_400_000, week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000,
    }
    return Date.now() - n * (multipliers[enMatch[2].toLowerCase()] ?? 0)
  }

  const ptMatch = text.match(/(?:há\s+)?(\d+)\s*(segundo|minuto|hora|dia|semana|m[eê]s|meses|ano)s?\s*(?:atrás)?/i)
  if (ptMatch) {
    const n = parseInt(ptMatch[1])
    const unit = ptMatch[2].toLowerCase()
    const ptMultipliers: Record<string, number> = {
      segundo: 1_000, minuto: 60_000, hora: 3_600_000,
      dia: 86_400_000, semana: 604_800_000, mês: 2_592_000_000,
      mes: 2_592_000_000, meses: 2_592_000_000, ano: 31_536_000_000,
    }
    return Date.now() - n * (ptMultipliers[unit] ?? 0)
  }

  return 0
}

export interface VideoEntry {
  videoId: string
  title: string
  publishedText: string
  thumbnailUrl: string
  viewCount?: string
  duration?: string
}

function extractVideoFromLockup(vm: Record<string, unknown>): VideoEntry | null {
  const videoId = vm.contentId as string | undefined
  if (!videoId || videoId.startsWith('UC') || videoId.startsWith('PL')) return null

  let title = ''
  let publishedText = ''
  let thumbnailUrl = ''
  let viewCount: string | undefined
  let duration: string | undefined

  const metadata = vm.metadata as Record<string, unknown> | undefined
  if (metadata) {
    const lockupMeta = metadata.lockupMetadataViewModel as Record<string, unknown> | undefined
    if (lockupMeta) {
      const titleObj = lockupMeta.title as Record<string, unknown> | undefined
      if (titleObj) title = (titleObj.content as string) ?? ''

      const metaBlock = lockupMeta.metadata as Record<string, unknown> | undefined
      if (metaBlock) {
        const contentMeta = metaBlock.contentMetadataViewModel as Record<string, unknown> | undefined
        if (contentMeta) {
          const rows = contentMeta.metadataRows as Array<Record<string, unknown>> | undefined
          if (rows) {
            for (const row of rows) {
              const parts = row.metadataParts as Array<Record<string, unknown>> | undefined
              if (!parts) continue
              for (const part of parts) {
                const textObj = part.text as Record<string, unknown> | undefined
                const content = textObj?.content as string | undefined
                if (!content) continue
                if (/ago|atrás|há\s*\d/i.test(content)) {
                  publishedText = content
                } else if (/views|visualiza/i.test(content)) {
                  viewCount = content
                }
              }
            }
          }
        }
      }
    }
  }

  const contentImage = vm.contentImage as Record<string, unknown> | undefined
  if (contentImage) {
    const thumbVm = contentImage.thumbnailViewModel as Record<string, unknown> | undefined
    if (thumbVm) {
      const image = thumbVm.image as Record<string, unknown> | undefined
      if (image) {
        const sources = image.sources as Array<Record<string, unknown>> | undefined
        if (sources && sources.length > 0) {
          thumbnailUrl = (sources[sources.length - 1].url as string) ?? ''
        }
      }
      const overlays = thumbVm.overlays as Array<Record<string, unknown>> | undefined
      if (overlays) {
        for (const overlay of overlays) {
          const badgeVm = overlay.thumbnailOverlayBadgeViewModel as Record<string, unknown> | undefined
          if (badgeVm) {
            const badges = badgeVm.thumbnailBadges as Array<Record<string, unknown>> | undefined
            if (badges) {
              for (const badge of badges) {
                const inner = badge.thumbnailBadgeViewModel as Record<string, unknown> | undefined
                const target = inner ?? badge
                const rawText = target.text
                const badgeText = typeof rawText === 'string'
                  ? rawText
                  : (rawText as Record<string, unknown> | undefined)?.content as string ?? ''
                if (/\d+:\d+/.test(badgeText)) duration = badgeText
              }
            }
          }
          const timeVm = overlay.thumbnailOverlayTimeStatusRenderer as Record<string, unknown> | undefined
          if (timeVm) {
            const textObj = timeVm.text as Record<string, unknown> | undefined
            const simpleText = (textObj?.simpleText as string) ?? (textObj?.content as string) ?? ''
            if (/\d+:\d+/.test(simpleText)) duration = simpleText
          }
        }
      }
      if (!duration) {
        const durationStr = JSON.stringify(contentImage).match(/"text"\s*:\s*"(\d+:\d[\d:]+)"/)?.[1]
        if (durationStr) duration = durationStr
      }
    }
  }

  if (!videoId || !title) return null
  return { videoId, title, publishedText, thumbnailUrl, viewCount, duration }
}

export function deepFindVideos(obj: unknown, results: VideoEntry[], depth = 0): void {
  if (depth > 25 || !obj || typeof obj !== 'object') return

  const record = obj as Record<string, unknown>

  if (record.lockupViewModel && typeof record.lockupViewModel === 'object') {
    const entry = extractVideoFromLockup(record.lockupViewModel as Record<string, unknown>)
    if (entry) {
      results.push(entry)
      return
    }
  }

  if (Array.isArray(obj)) {
    for (const item of obj) deepFindVideos(item, results, depth + 1)
  } else {
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') deepFindVideos(value, results, depth + 1)
    }
  }
}

export async function fetchChannelVideos(
  channelUrl: string,
  channelId: string,
  channelName: string,
): Promise<RawFeedEntry[]> {
  const cached = videoCache.get(channelId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.entries
  }

  try {
    const videosUrl = channelUrl.replace(/\/$/, '') + '/videos'
    console.log(`[MyTube] Fetching channel page: ${videosUrl}`)
    const res = await fetch(videosUrl, {
      headers: {
        'Accept-Language': 'en',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    if (!res.ok) {
      console.warn(`[MyTube] Channel fetch failed for ${channelId}: HTTP ${res.status}`)
      return cached?.entries ?? []
    }

    const html = await res.text()
    const ytData = extractYtInitialData(html)
    if (!ytData) {
      console.warn(`[MyTube] No ytInitialData found for ${channelId} (HTML length: ${html.length})`)
      return cached?.entries ?? []
    }

    const videoEntries: VideoEntry[] = []
    deepFindVideos(ytData, videoEntries)
    console.log(`[MyTube] Found ${videoEntries.length} videos for ${channelName} (${channelId})`)

    const entries: RawFeedEntry[] = videoEntries.map(v => ({
      videoId: v.videoId,
      title: v.title,
      publishedAt: parseRelativeDate(v.publishedText),
      thumbnailUrl: v.thumbnailUrl,
      channelName,
      channelId,
      viewCount: v.viewCount,
      duration: v.duration,
    }))

    videoCache.set(channelId, { entries, fetchedAt: Date.now() })
    return entries
  } catch (err) {
    console.warn(`[MyTube] Channel fetch error for ${channelId}:`, err)
    return cached?.entries ?? []
  }
}
