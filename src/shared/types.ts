import type {
  AIConfigPublic,
  AIProvider,
  CategorizeFolder,
  CategorizeItem,
  CategorizeSuggestion,
  CategorizeTag,
} from './ai/types'
import type { DeviceAuthCode, DeviceAuthStart } from './ai/device-auth'
// `import type` de propósito: importar valor daqui fecharia um ciclo em runtime
// (messages.ts → types.ts → host-permission.ts).
import type { PermissionOutcome } from './ai/host-permission'

export interface Organizable {
  id: string
  type: 'channel' | 'playlist' | 'video'
  youtubeId: string
  name: string
  thumbnailUrl: string
  url: string
  folderId: string | null
  tagIds: string[]
  isSubscribed: boolean
  addedAt: number
  lastSyncedAt: number
  channelName?: string
  handle?: string
  muted?: boolean
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  color: string
  order: number
}

export interface Tag {
  id: string
  name: string
  color: string
}

export interface WatchEntry {
  videoId: string
  channelId: string
  title: string
  watchedAt: number
}

export interface NewVideoCheck {
  channelId: string
  lastKnownVideoId: string
  lastCheckedAt: number
  newCount: number
  // Watermark: a video counts as "new" only if publishedAt > seenUpToAt.
  // "Mark read" advances this so cleared videos never resurface.
  seenUpToAt: number
}

export interface FeedVideo {
  videoId: string
  title: string
  channelId: string
  channelName: string
  thumbnailUrl: string
  publishedAt: number
  url: string
  watched: boolean
  isNew?: boolean
  viewCount?: string
  duration?: string
}

export interface HomeFeedChannel {
  channelId: string
  channelName: string
  newCount: number
  videos: FeedVideo[]
}

export interface HomeFeedFolder {
  folderId: string
  folderName: string
  folderColor: string
  channels: HomeFeedChannel[]
}

export interface HomeNudgeData {
  total: number
  folders: { name: string; color: string; count: number }[]
}

export interface AppState {
  organizables: Organizable[]
  folders: Folder[]
  tags: Tag[]
  deletedYoutubeIds?: string[]
  newVideoCounts?: Record<string, number>
}

export type MessageType =
  | { type: 'ADD_WATCH_ENTRY'; payload: WatchEntry }
  | { type: 'ADD_ORGANIZABLE'; payload: Organizable }
  | { type: 'UPDATE_ORGANIZABLE'; payload: Organizable }
  | { type: 'DELETE_ORGANIZABLE'; payload: { id: string } }
  | { type: 'GET_STATE'; payload?: undefined }
  | { type: 'SYNC_SUBSCRIPTIONS'; payload: Organizable[] }
  | { type: 'SYNC_PLAYLISTS'; payload: Organizable[] }
  | { type: 'RESET_BADGE'; payload?: undefined }
  | { type: 'GET_CHANNEL_INFO'; payload: { channelId: string } }
  | { type: 'GET_NEW_VIDEO_COUNTS'; payload?: undefined }
  | { type: 'MARK_CHANNEL_READ'; payload: { channelId: string } }
  | { type: 'MARK_ALL_READ'; payload?: undefined }
  | { type: 'MARK_FOLDER_READ'; payload: { folderId: string } }
  | { type: 'MUTE_ALL_CHANNELS'; payload?: undefined }
  | { type: 'GET_FOLDER_FEED'; payload: { folderId: string } }
  | { type: 'GET_HOME_FEED'; payload: { mode: 'new-only' | 'latest'; latestCount?: number } }
  | { type: 'GET_HOME_NUDGE_DATA'; payload?: undefined }
  | { type: 'REMOVE_WATCH_ENTRY'; payload: { videoId: string } }
  | { type: 'AI_LIST_PROVIDERS'; payload?: undefined }
  | { type: 'AI_SAVE_PROVIDER'; payload: AIProvider }
  | { type: 'AI_DELETE_PROVIDER'; payload: { id: string } }
  | { type: 'AI_SET_ACTIVE_PROVIDER'; payload: { id: string | null } }
  | { type: 'AI_TEST_PROVIDER'; payload: { id: string } }
  | { type: 'AI_LIST_MODELS'; payload: { id: string } }
  | { type: 'AI_OAUTH_BEGIN'; payload?: undefined }
  | { type: 'AI_OAUTH_COMPLETE'; payload: { label: string; code: DeviceAuthCode } }
  // UM lote por mensagem. Quem fatia a biblioteca em lotes é a sidebar: o
  // service worker do MV3 não sobrevive a uma fila longa de inferências.
  | { type: 'AI_CATEGORIZE'; payload: { items: CategorizeItem[]; folders: CategorizeFolder[]; tags?: CategorizeTag[] } }
  // Pedido da sidebar: abrir a janelinha de permissão de host. A resposta só
  // chega quando o usuário decide — é o desfecho, não um "recebi".
  | { type: 'AI_REQUEST_HOST_PERMISSION'; payload: { url: string } }
  // Desfecho vindo da janelinha, que sabe o requestId por estar na sua URL.
  | { type: 'AI_HOST_PERMISSION_RESULT'; payload: { requestId: string; outcome: PermissionOutcome } }
  | { type: 'OPEN_OPTIONS_PAGE'; payload?: undefined }

/**
 * Começar o device flow pode falhar (rede, HTTP da OpenAI). O sucesso continua
 * DeviceAuthStart; a falha vem com um código de erro que a UI traduz.
 */
export type AIOAuthBeginResponse = DeviceAuthStart | { ok: false; error: string }

export type MessageResponse<T extends MessageType['type']> =
  T extends 'GET_STATE' ? AppState :
  T extends 'GET_CHANNEL_INFO' ? Organizable | null :
  T extends 'GET_NEW_VIDEO_COUNTS' ? Record<string, number> :
  T extends 'GET_FOLDER_FEED' ? FeedVideo[] :
  T extends 'GET_HOME_FEED' ? HomeFeedFolder[] :
  T extends 'GET_HOME_NUDGE_DATA' ? HomeNudgeData :
  T extends 'AI_LIST_PROVIDERS' ? AIConfigPublic :
  T extends 'AI_TEST_PROVIDER' ? { ok: boolean; error?: string; latencyMs?: number; modelCount?: number } :
  T extends 'AI_LIST_MODELS' ? string[] :
  T extends 'AI_OAUTH_BEGIN' ? AIOAuthBeginResponse :
  T extends 'AI_OAUTH_COMPLETE' ? { ok: boolean; error?: string } :
  // `provider`/`model` voltam para a UI PODER DIZER quem opinou. Sugestão sem
  // autoria é palpite anônimo: o usuário troca de provedor e de modelo e não tem
  // como saber qual deles produziu o que está na tela.
  T extends 'AI_CATEGORIZE' ? { ok: boolean; suggestions?: CategorizeSuggestion[]; error?: string; provider?: string; model?: string } :
  T extends 'AI_REQUEST_HOST_PERMISSION' ? { outcome: PermissionOutcome } :
  { ok: boolean }
