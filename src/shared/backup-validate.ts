import type { AppState, Folder, Organizable, Tag, WatchEntry } from './types'

/**
 * Validação por elemento de tudo que entra no estado do MyTube vindo de fora do
 * código: backup importado (dashboard e sidebar) e o que volta do
 * `chrome.storage.local` em `getState`. Também guarda os pontos onde uma URL
 * guardada é USADA (fetch do service worker, navegação, `href`, `src`).
 *
 * Módulo puro de propósito: sem `chrome`, sem DOM, sem IndexedDB. Roda no
 * service worker, na sidebar, no dashboard e nos testes.
 *
 * Política:
 *  - `url` do organizable: só `https://youtube.com` ou `https://www.youtube.com`
 *    (sem credenciais, sem porta). Elemento com `url` inválida é DESCARTADO;
 *  - `thumbnailUrl`: só https em host de imagem do YouTube. Inválida vira `''`
 *    (o item continua, sem figura);
 *  - tipos errados ou campos faltando recebem default; sem `id`/`type`/
 *    `youtubeId` (ou `videoId`) não há como usar o elemento, então ele cai;
 *  - campos desconhecidos não passam.
 */

const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com'])

// Hosts de imagem que o próprio MyTube grava: i.ytimg.com (capas de vídeo e
// playlist, fixture do scraper), yt3.ggpht.com e yt3.googleusercontent.com
// (avatares de canal), i9.ytimg.com (capas em CDN alternativo).
const YOUTUBE_IMAGE_HOSTS = new Set([
  'i.ytimg.com',
  'i9.ytimg.com',
  'yt3.ggpht.com',
  'yt3.googleusercontent.com',
])

const MAX_URL_LENGTH = 4096
const ORGANIZABLE_TYPES = new Set<Organizable['type']>(['channel', 'playlist', 'video'])
const DEFAULT_COLOR = '#888888'

function parseHttpsUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return null
  // `new URL` ignora espaço e controle nas pontas; o navegador também. Recusa
  // aqui para o valor guardado ser exatamente o que foi validado.
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '' || url.port !== '') return null
  return url
}

/** `https://youtube.com/...` ou `https://www.youtube.com/...`, nada além. */
export function isYouTubeUrl(value: unknown): value is string {
  const url = parseHttpsUrl(value)
  return url !== null && YOUTUBE_HOSTS.has(url.hostname)
}

/** https em host de imagem do YouTube. */
export function isYouTubeImageUrl(value: unknown): value is string {
  const url = parseHttpsUrl(value)
  return url !== null && YOUTUBE_IMAGE_HOSTS.has(url.hostname)
}

/** Para `href`/navegação: a própria URL se for do YouTube, senão `undefined`. */
export function safeYouTubeHref(value: unknown): string | undefined {
  return isYouTubeUrl(value) ? value : undefined
}

/** Para `<img src>`: a própria URL se for de host de imagem do YouTube, senão `undefined`. */
export function safeImageSrc(value: unknown): string | undefined {
  return isYouTubeImageUrl(value) ? value : undefined
}

function normalizeThumbnail(value: unknown): string {
  // O YouTube às vezes entrega capas como `//yt3.ggpht.com/...`.
  const candidate = typeof value === 'string' && value.startsWith('//') ? `https:${value}` : value
  return isYouTubeImageUrl(candidate) ? candidate : ''
}

type Rec = Record<string, unknown>

function asRecord(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nonEmptyStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function sanitizeOrganizable(raw: unknown): Organizable | null {
  const r = asRecord(raw)
  if (!r) return null
  const id = nonEmptyStr(r['id'])
  const youtubeId = nonEmptyStr(r['youtubeId'])
  const type = r['type']
  if (!id || !youtubeId) return null
  if (typeof type !== 'string' || !ORGANIZABLE_TYPES.has(type as Organizable['type'])) return null
  if (!isYouTubeUrl(r['url'])) return null

  const out: Organizable = {
    id,
    type: type as Organizable['type'],
    youtubeId,
    name: str(r['name']),
    thumbnailUrl: normalizeThumbnail(r['thumbnailUrl']),
    url: r['url'] as string,
    folderId: strOrNull(r['folderId']),
    tagIds: Array.isArray(r['tagIds']) ? r['tagIds'].filter((t): t is string => typeof t === 'string') : [],
    isSubscribed: r['isSubscribed'] === true,
    addedAt: num(r['addedAt'], 0),
    lastSyncedAt: num(r['lastSyncedAt'], 0),
  }
  if (typeof r['channelName'] === 'string') out.channelName = r['channelName']
  if (typeof r['handle'] === 'string') out.handle = r['handle']
  if (typeof r['muted'] === 'boolean') out.muted = r['muted']
  return out
}

export function sanitizeFolder(raw: unknown): Folder | null {
  const r = asRecord(raw)
  if (!r) return null
  const id = nonEmptyStr(r['id'])
  if (!id) return null
  return {
    id,
    name: str(r['name']),
    parentId: strOrNull(r['parentId']),
    color: str(r['color'], DEFAULT_COLOR),
    order: num(r['order'], 0),
  }
}

export function sanitizeTag(raw: unknown): Tag | null {
  const r = asRecord(raw)
  if (!r) return null
  const id = nonEmptyStr(r['id'])
  if (!id) return null
  return { id, name: str(r['name']), color: str(r['color'], DEFAULT_COLOR) }
}

export function sanitizeWatchEntry(raw: unknown): WatchEntry | null {
  const r = asRecord(raw)
  if (!r) return null
  const videoId = nonEmptyStr(r['videoId'])
  if (!videoId) return null
  if (typeof r['watchedAt'] !== 'number' || !Number.isFinite(r['watchedAt'])) return null
  return {
    videoId,
    channelId: str(r['channelId']),
    title: str(r['title']),
    watchedAt: r['watchedAt'],
  }
}

function sanitizeList<T>(raw: unknown, one: (item: unknown) => T | null): { items: T[]; dropped: number } {
  if (!Array.isArray(raw)) return { items: [], dropped: 0 }
  const items: T[] = []
  for (const element of raw) {
    const clean = one(element)
    if (clean) items.push(clean)
  }
  return { items, dropped: raw.length - items.length }
}

export function sanitizeWatchEntries(raw: unknown): { entries: WatchEntry[]; dropped: number } {
  const { items, dropped } = sanitizeList(raw, sanitizeWatchEntry)
  return { entries: items, dropped }
}

/**
 * Ids de vídeo já vistos. Um registro que não é objeto (um `null` importado de
 * um backup, por exemplo) é pulado em vez de derrubar o poller e os feeds.
 */
export function collectWatchedVideoIds(records: readonly unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const record of records) {
    const r = asRecord(record)
    if (r && typeof r['videoId'] === 'string') ids.add(r['videoId'])
  }
  return ids
}

function sanitizeOptionalState(r: Rec): Pick<AppState, 'deletedYoutubeIds' | 'newVideoCounts'> {
  const out: Pick<AppState, 'deletedYoutubeIds' | 'newVideoCounts'> = {}
  if (Array.isArray(r['deletedYoutubeIds'])) {
    out.deletedYoutubeIds = r['deletedYoutubeIds'].filter((k): k is string => typeof k === 'string')
  }
  const counts = asRecord(r['newVideoCounts'])
  if (counts) {
    const clean: Record<string, number> = {}
    for (const [key, value] of Object.entries(counts)) {
      if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value
    }
    out.newVideoCounts = clean
  }
  return out
}

/**
 * Estado lido do storage. Nunca lança e sempre devolve um objeto NOVO (quem
 * chama muta o resultado e regrava; um vazio compartilhado vazaria entre
 * chamadas).
 */
export function sanitizeState(raw: unknown): AppState {
  const r = asRecord(raw) ?? {}
  return {
    organizables: sanitizeList(r['organizables'], sanitizeOrganizable).items,
    folders: sanitizeList(r['folders'], sanitizeFolder).items,
    tags: sanitizeList(r['tags'], sanitizeTag).items,
    ...sanitizeOptionalState(r),
  }
}

export interface SanitizedBackup extends Pick<AppState, 'organizables' | 'folders' | 'tags' | 'deletedYoutubeIds' | 'newVideoCounts'> {
  watchHistory: WatchEntry[]
  /** Quantos elementos de cada coleção foram descartados. */
  dropped: { organizables: number; folders: number; tags: number; watchHistory: number }
}

/**
 * Valida as coleções de um backup importado. `raw` precisa ter `organizables`,
 * `folders`, `tags` e `watchHistory` como arrays (cada importador cuida do
 * próprio envelope antes de chamar). Devolve `null` se a forma de topo não
 * bate; senão devolve as coleções limpas e quanto foi descartado.
 */
export function sanitizeBackupCollections(raw: unknown): SanitizedBackup | null {
  const r = asRecord(raw)
  if (!r) return null
  if (!Array.isArray(r['organizables']) || !Array.isArray(r['folders'])
    || !Array.isArray(r['tags']) || !Array.isArray(r['watchHistory'])) return null

  const organizables = sanitizeList(r['organizables'], sanitizeOrganizable)
  const folders = sanitizeList(r['folders'], sanitizeFolder)
  const tags = sanitizeList(r['tags'], sanitizeTag)
  const watch = sanitizeWatchEntries(r['watchHistory'])
  return {
    organizables: organizables.items,
    folders: folders.items,
    tags: tags.items,
    ...sanitizeOptionalState(r),
    watchHistory: watch.entries,
    dropped: {
      organizables: organizables.dropped,
      folders: folders.dropped,
      tags: tags.dropped,
      watchHistory: watch.dropped,
    },
  }
}
