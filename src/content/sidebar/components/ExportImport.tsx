import { h } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { sendMessage } from '../../../shared/messages'
import type { AppState, WatchEntry } from '../../../shared/types'
import { useT } from '../../../shared/i18n'
import { sanitizeBackupCollections } from '../../../shared/backup-validate'
import { normalizeHistoryField, planHistoryReplace, restoreReplace } from '../../../shared/restore'

export interface ExportImportProps {
  onStateChange: () => void
}

interface BackupFile {
  version: number
  exportedAt: string
  state: AppState
  watchHistory: WatchEntry[]
}

type ImportMode = 'merge' | 'replace'
type Status = { kind: 'success' | 'error'; text: string } | null

interface PendingBackup extends BackupFile {
  /** Elementos que o validador descartou (URL fora do YouTube, tipo errado, null...). */
  dropped: number
  /**
   * O que "Substituir" grava no lugar do histórico atual; `null` = deixar o
   * histórico como está (backup sem `watchHistory`, ou sem nenhuma entrada válida).
   */
  historyReplacement: WatchEntry[] | null
}

/**
 * Valida o envelope do arquivo e CADA elemento (ver shared/backup-validate.ts).
 * Devolve só dados limpos; `null` rejeita o arquivo inteiro sem tocar o storage.
 */
function parseBackup(data: unknown): PendingBackup | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (typeof d['version'] !== 'number') return null
  if (typeof d['exportedAt'] !== 'string') return null
  const state = d['state']
  if (typeof state !== 'object' || state === null) return null
  const s = state as Record<string, unknown>
  const clean = sanitizeBackupCollections({
    organizables: s['organizables'],
    folders: s['folders'],
    tags: s['tags'],
    deletedYoutubeIds: s['deletedYoutubeIds'],
    watchHistory: normalizeHistoryField(d['watchHistory']),
  })
  if (!clean) return null
  const { watchHistory, dropped, ...cleanState } = clean
  return {
    version: d['version'],
    exportedAt: d['exportedAt'],
    state: cleanState,
    watchHistory,
    dropped: dropped.organizables + dropped.folders + dropped.tags + dropped.watchHistory,
    historyReplacement: planHistoryReplace(d['watchHistory'], watchHistory),
  }
}

async function importWatchHistoryViaWorker(mode: ImportMode, entries: WatchEntry[]): Promise<void> {
  const res = await sendMessage({ type: 'WATCH_IMPORT', payload: { mode, entries } })
  if (!res?.ok) throw new Error('watch history import failed')
}

function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

export function ExportImport({ onStateChange }: ExportImportProps) {
  const t = useT()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [exportStatus, setExportStatus] = useState<Status>(null)
  const [importStatus, setImportStatus] = useState<Status>(null)
  const [pendingBackup, setPendingBackup] = useState<PendingBackup | null>(null)
  const [importing, setImporting] = useState(false)

  // --- Export ---
  async function handleExport() {
    setExportStatus(null)
    try {
      const state = await sendMessage({ type: 'GET_STATE' })
      // O histórico mora no IndexedDB da extensão; a sidebar roda no youtube.com e
      // não o abre (abriria o banco da página). Pede ao service worker.
      const watchHistory = await sendMessage({ type: 'WATCH_EXPORT' })
      if (!Array.isArray(watchHistory)) throw new Error('watch history unavailable')
      const backup: BackupFile = {
        version: 1,
        exportedAt: new Date().toISOString(),
        state,
        watchHistory,
      }
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mytube-backup-${formatDate(backup.exportedAt)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setExportStatus({ kind: 'success', text: t('data.exported') })
    } catch (err) {
      setExportStatus({ kind: 'error', text: `${t('data.exportFailed')}: ${(err as Error).message}` })
    }
  }

  // --- Import: file selection ---
  async function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    input.value = ''

    setImportStatus(null)
    setPendingBackup(null)

    try {
      const text = await file.text()
      const parsed: unknown = JSON.parse(text)
      const backup = parseBackup(parsed)
      if (!backup) {
        setImportStatus({ kind: 'error', text: t('data.invalidFile') })
        return
      }
      setPendingBackup(backup)
    } catch {
      setImportStatus({ kind: 'error', text: t('data.parseError') })
    }
  }

  // --- Import: confirm ---
  async function handleConfirmImport(mode: ImportMode) {
    if (!pendingBackup) return
    setImporting(true)
    setImportStatus(null)

    try {
      const { state, watchHistory, dropped } = pendingBackup

      if (mode === 'replace') {
        // Histórico PRIMEIRO (no service worker, numa transação só): se falhar, o
        // mytube_state do usuário continua intacto. Sem histórico válido no
        // backup, o histórico atual não é tocado.
        await restoreReplace(
          pendingBackup.historyReplacement,
          (entries) => importWatchHistoryViaWorker('replace', entries),
          () => chrome.storage.local.set({ mytube_state: state }),
        )
      } else {
        // Merge: get current state, merge organizables by youtubeId
        const currentState = await sendMessage({ type: 'GET_STATE' })

        const existingYoutubeIds = new Set(currentState.organizables.map((o) => o.youtubeId))
        const newOrganizables = state.organizables.filter((o) => !existingYoutubeIds.has(o.youtubeId))

        const existingFolderIds = new Set(currentState.folders.map((f) => f.id))
        const newFolders = state.folders.filter((f) => !existingFolderIds.has(f.id))

        const existingTagIds = new Set(currentState.tags.map((t) => t.id))
        const newTags = state.tags.filter((t) => !existingTagIds.has(t.id))

        const mergedState: AppState = {
          organizables: [...currentState.organizables, ...newOrganizables],
          folders: [...currentState.folders, ...newFolders],
          tags: [...currentState.tags, ...newTags],
        }

        await chrome.storage.local.set({ mytube_state: mergedState })
        await importWatchHistoryViaWorker('merge', watchHistory)
      }

      setPendingBackup(null)
      onStateChange()
      setImportStatus({
        kind: 'success',
        text: dropped > 0 ? `${t('data.imported')} (${dropped} ${t('data.skipped')})` : t('data.imported'),
      })
    } catch (err) {
      setImportStatus({ kind: 'error', text: `${t('data.importFailed')}: ${(err as Error).message}` })
    } finally {
      setImporting(false)
    }
  }

  function handleCancelImport() {
    setPendingBackup(null)
    setImportStatus(null)
  }

  // --- Styles ---
  const colStyle: h.JSX.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  }

  function btnBase(variant: 'accent' | 'secondary'): h.JSX.CSSProperties {
    const isAccent = variant === 'accent'
    return {
      width: '100%',
      padding: '10px',
      minHeight: '32px',
      borderRadius: 'var(--mt-radius-pill)',
      border: isAccent ? 'none' : '1px solid var(--mt-btn-border)',
      background: isAccent
        ? 'linear-gradient(135deg, var(--mt-accent), var(--mt-accent-hover))'
        : undefined,
      backgroundColor: isAccent ? undefined : 'var(--mt-btn-bg)',
      boxShadow: isAccent ? 'var(--mt-shadow-sm)' : 'none',
      color: isAccent ? '#ffffff' : 'var(--mt-text-primary)',
      fontSize: 'var(--mt-font-size-sm)',
      fontFamily: 'var(--mt-font-body)',
      fontWeight: 600,
      cursor: 'pointer',
      textAlign: 'center' as const,
      transition: 'opacity 0.12s, transform 0.1s',
    }
  }

  const statusStyle = (kind: 'success' | 'error'): h.JSX.CSSProperties => ({
    fontSize: 'var(--mt-font-size-xs)',
    fontFamily: 'var(--mt-font-body)',
    color: kind === 'success' ? 'var(--mt-success)' : 'var(--mt-error)',
    marginTop: '2px',
  })

  const previewBoxStyle: h.JSX.CSSProperties = {
    backgroundColor: 'var(--mt-bg-elevated)',
    border: '1px solid var(--mt-btn-border)',
    borderRadius: 'var(--mt-radius-sm)',
    padding: '10px 12px',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    color: 'var(--mt-text-primary)',
    lineHeight: 1.6,
  }

  const modeRowStyle: h.JSX.CSSProperties = {
    display: 'flex',
    gap: '6px',
  }

  const modeBtnStyle = (disabled: boolean): h.JSX.CSSProperties => ({
    flex: 1,
    padding: '8px',
    minHeight: '32px',
    borderRadius: 'var(--mt-radius-pill)',
    border: '1px solid var(--mt-btn-border)',
    backgroundColor: 'var(--mt-btn-bg)',
    color: disabled ? 'var(--mt-text-secondary)' : 'var(--mt-text-primary)',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'opacity 0.12s, border-color 0.15s',
  })

  const cancelBtnStyle: h.JSX.CSSProperties = {
    backgroundColor: 'var(--mt-btn-bg)',
    border: '1px solid var(--mt-btn-border)',
    borderRadius: 'var(--mt-radius-pill)',
    color: 'var(--mt-text-primary)',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    cursor: 'pointer',
    padding: '6px 0',
    minHeight: '32px',
    textAlign: 'center' as const,
    width: '100%',
    transition: 'background-color 0.12s',
  }

  const { organizables, folders, tags } = pendingBackup?.state ?? {}
  const channels = organizables?.filter((o) => o.type === 'channel').length ?? 0
  const playlists = organizables?.filter((o) => o.type === 'playlist').length ?? 0
  const videos = organizables?.filter((o) => o.type === 'video').length ?? 0
  const watchCount = pendingBackup?.watchHistory.length ?? 0

  return (
    <div style={colStyle}>
      {/* Export */}
      <button
        type="button"
        style={btnBase('accent')}
        onClick={handleExport}
        onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)' }}
        onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
      >
        {t('data.export')}
      </button>
      {exportStatus && <span style={statusStyle(exportStatus.kind)}>{exportStatus.text}</span>}

      {/* Import trigger */}
      <button
        type="button"
        style={btnBase('secondary')}
        onClick={() => fileInputRef.current?.click()}
      >
        {t('data.import')}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Preview + mode selection */}
      {pendingBackup && (
        <div style={colStyle}>
          <div style={previewBoxStyle}>
            {t('data.found')} {channels} {channels !== 1 ? t('data.channels') : t('data.channel')},{' '}
            {playlists} {playlists !== 1 ? t('data.playlists') : t('data.playlist')},{' '}
            {videos} {videos !== 1 ? t('data.videos') : t('data.video')},{' '}
            {folders?.length ?? 0} {(folders?.length ?? 0) !== 1 ? t('data.folders') : t('data.folder')},{' '}
            {tags?.length ?? 0} {(tags?.length ?? 0) !== 1 ? t('data.tags') : t('data.tag')},{' '}
            {watchCount} {t('data.watch')} {watchCount !== 1 ? t('data.entries') : t('data.entry')}
          </div>
          <div style={modeRowStyle}>
            <button
              type="button"
              style={modeBtnStyle(importing)}
              disabled={importing}
              onClick={() => handleConfirmImport('merge')}
            >
              {t('data.merge')}
            </button>
            <button
              type="button"
              style={modeBtnStyle(importing)}
              disabled={importing}
              onClick={() => handleConfirmImport('replace')}
            >
              {t('data.replace')}
            </button>
          </div>
          <button type="button" style={cancelBtnStyle} onClick={handleCancelImport}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      {importStatus && <span style={statusStyle(importStatus.kind)}>{importStatus.text}</span>}
    </div>
  )
}
