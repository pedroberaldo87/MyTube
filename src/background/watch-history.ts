import { sanitizeWatchEntries } from '../shared/backup-validate'
import type { MessageResponse, MessageType, WatchEntry } from '../shared/types'

/**
 * Exportar, importar e limpar o histórico de exibição acontece AQUI, no service
 * worker: é o único contexto que abre o IndexedDB da extensão. A sidebar roda no
 * youtube.com, onde `openDB('mytube')` cairia no banco da origem da página.
 */
export interface WatchStore {
  exportWatchHistory(): Promise<WatchEntry[]>
  importWatchHistory(entries: WatchEntry[]): Promise<void>
  replaceWatchHistory(entries: WatchEntry[]): Promise<void>
  clearWatchHistory(): Promise<void>
}

type WatchMessage = Extract<MessageType, { type: 'WATCH_EXPORT' | 'WATCH_IMPORT' | 'WATCH_CLEAR' }>

export function isWatchMessage(message: MessageType): message is WatchMessage {
  return message.type === 'WATCH_EXPORT' || message.type === 'WATCH_IMPORT' || message.type === 'WATCH_CLEAR'
}

export async function handleWatchMessage(
  message: MessageType,
  store: WatchStore,
): Promise<MessageResponse<WatchMessage['type']> | undefined> {
  switch (message.type) {
    case 'WATCH_EXPORT':
      return store.exportWatchHistory()

    case 'WATCH_IMPORT': {
      const payload: unknown = message.payload
      const p = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null
      const mode = p?.['mode']
      const raw = p?.['entries']
      // Sem lista, "substituir" apagaria o histórico por nada: recusa antes de tocar o store.
      if ((mode !== 'merge' && mode !== 'replace') || !Array.isArray(raw)) return { ok: false }
      const { entries, dropped } = sanitizeWatchEntries(raw)
      if (mode === 'replace') await store.replaceWatchHistory(entries)
      else await store.importWatchHistory(entries)
      return { ok: true, imported: entries.length, dropped }
    }

    case 'WATCH_CLEAR':
      await store.clearWatchHistory()
      return { ok: true }

    default:
      return undefined
  }
}
