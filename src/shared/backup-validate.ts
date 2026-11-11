import type { AppState, Folder, Organizable, Tag, WatchEntry } from './types'

/**
 * Validação por elemento de tudo que entra no estado do MyTube vindo de fora do
 * código: backup importado (dashboard e sidebar). O que volta do
 * `chrome.storage.local` em `getState` só tem a FORMA consertada
 * (`repairState`), sem apagar nem esvaziar nada por causa de `url`/host; quem
 * USA uma URL guardada (fetch do service worker, navegação, `href`, `src`) a
 * valida no ponto de uso.
 *
 * Módulo puro de propósito: sem `chrome`, sem DOM, sem IndexedDB. Roda no
 * service worker, na sidebar, no dashboard e nos testes.
 *
 * Política do IMPORT (`sanitize*`):
 *  - `url` do organizable: só `https://youtube.com` ou `https://www.youtube.com`
 *    (sem credenciais, sem porta). Elemento com `url` inválida é DESCARTADO;
 *  - `thumbnailUrl`: só https em host de imagem do YouTube. Inválida vira `''`
 *    (o item continua, sem figura);
 *  - tipos errados ou campos faltando recebem default; sem `id`/`type`/
 *    `youtubeId` (ou `videoId`) não há como usar o elemento, então ele cai;
 *  - campos desconhecidos não passam.
 */

const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com'])

// Hosts de imagem do YouTube: capas de vídeo e playlist (i.ytimg.com, i1…i9,
// s.ytimg.com) e avatares de canal (yt3/yt4.ggpht.com, yt3.googleusercontent.com,
// lh3.googleusercontent.com), mais img.youtube.com. Por sufixo de domínio ou
// padrão estreito, sempre em https, para um CDN novo do próprio YouTube não
// apagar a figura. `googleusercontent.com` inteiro NÃO é aceito (hospeda
// conteúdo de terceiros); só os nós de imagem lhN/ytN. `evilytimg.com` e
// `ytimg.com.evil.example` não casam.
const YOUTUBE_IMAGE_HOST_SUFFIXES = ['.ytimg.com', '.ggpht.com']
const YOUTUBE_IMAGE_HOSTS = new Set(['img.youtube.com'])
const GOOGLE_IMAGE_HOST = /^(?:lh|yt)\d+\.googleusercontent\.com$/

function isYouTubeImageHost(hostname: string): boolean {
  return YOUTUBE_IMAGE_HOSTS.has(hostname)
    || GOOGLE_IMAGE_HOST.test(hostname)
    || YOUTUBE_IMAGE_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
}

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
  return url !== null && isYouTubeImageHost(url.hostname)
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
 * Estado lido do storage, SEM PERDA. Só conserta a forma (arrays e campos
 * faltando ganham default; entrada que não é objeto é pulada). Nunca descarta
 * nem esvazia um item por causa de `url` ou host de `thumbnailUrl`: quem lê e
 * regrava (`getState` → `setState`) apagaria dado legado em silêncio. Os
 * pontos de uso validam (`safeYouTubeHref`, `safeImageSrc`, guardas do worker).
 *
 * Custo O(n), sem `new URL`. Item já bem formado é devolvido como está (mesma
 * referência do que veio do storage); só o que precisa de conserto é copiado.
 * Sempre devolve um objeto de estado NOVO (quem chama muta e regrava).
 */
function repairList<T extends object>(raw: unknown, fix: (r: Rec) => T): T[] {
  if (!Array.isArray(raw)) return []
  const out: T[] = []
  for (const element of raw) {
    const r = asRecord(element)
    if (r) out.push(fix(r))
  }
  return out
}

function stringsOnly(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : []
}

function repairOrganizable(r: Rec): Organizable {
  const tagIds = r['tagIds']
  const wellFormed = typeof r['name'] === 'string' && typeof r['url'] === 'string'
    && typeof r['thumbnailUrl'] === 'string'
    && (r['folderId'] === null || typeof r['folderId'] === 'string')
    && Array.isArray(tagIds) && tagIds.every(t => typeof t === 'string')
    && typeof r['isSubscribed'] === 'boolean'
    && typeof r['addedAt'] === 'number' && Number.isFinite(r['addedAt'])
    && typeof r['lastSyncedAt'] === 'number' && Number.isFinite(r['lastSyncedAt'])
  if (wellFormed) return r as unknown as Organizable
  return {
    ...r,
    name: str(r['name']),
    url: str(r['url']),
    thumbnailUrl: str(r['thumbnailUrl']),
    folderId: strOrNull(r['folderId']),
    tagIds: stringsOnly(tagIds),
    isSubscribed: r['isSubscribed'] === true,
    addedAt: num(r['addedAt'], 0),
    lastSyncedAt: num(r['lastSyncedAt'], 0),
  } as unknown as Organizable
}

function repairFolder(r: Rec): Folder {
  if (typeof r['name'] === 'string' && (r['parentId'] === null || typeof r['parentId'] === 'string')
    && typeof r['color'] === 'string' && typeof r['order'] === 'number' && Number.isFinite(r['order'])) {
    return r as unknown as Folder
  }
  return {
    ...r,
    name: str(r['name']),
    parentId: strOrNull(r['parentId']),
    color: str(r['color'], DEFAULT_COLOR),
    order: num(r['order'], 0),
  } as unknown as Folder
}

function repairTag(r: Rec): Tag {
  if (typeof r['name'] === 'string' && typeof r['color'] === 'string') return r as unknown as Tag
  return { ...r, name: str(r['name']), color: str(r['color'], DEFAULT_COLOR) } as unknown as Tag
}

export function repairState(raw: unknown): AppState {
  const r = asRecord(raw) ?? {}
  return {
    organizables: repairList(r['organizables'], repairOrganizable),
    folders: repairList(r['folders'], repairFolder),
    tags: repairList(r['tags'], repairTag),
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
