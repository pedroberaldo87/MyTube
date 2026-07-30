import { h } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { exportWatchHistory, importWatchHistory } from '../../../shared/db'
import { sendMessage } from '../../../shared/messages'
import type { AppState, WatchEntry } from '../../../shared/types'
import { useT } from '../../../shared/i18n'

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

function isValidBackup(data: unknown): data is BackupFile {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  if (typeof d['version'] !== 'number') return false
  if (typeof d['exportedAt'] !== 'string') return false
  const state = d['state']
  if (typeof state !== 'object' || state === null) return false
  const s = state as Record<string, unknown>
  if (!Array.isArray(s['organizables'])) return false
  if (!Array.isArray(s['folders'])) return false
  if (!Array.isArray(s['tags'])) return false
  if (!Array.isArray(d['watchHistory'])) return false
  return true
}

function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

export function ExportImport({ onStateChange }: ExportImportProps) {
  const t = useT()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [exportStatus, setExportStatus] = useState<Status>(null)
  const [importStatus, setImportStatus] = useState<Status>(null)
  const [pendingBackup, setPendingBackup] = useState<BackupFile | null>(null)
  const [importing, setImporting] = useState(false)

  // --- Export ---
  async function handleExport() {
    setExportStatus(null)
    try {
      const state = await sendMessage({ type: 'GET_STATE' })
      const watchHistory = await exportWatchHistory()
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
      if (!isValidBackup(parsed)) {
        setImportStatus({ kind: 'error', text: t('data.invalidFile') })
        return
      }
      setPendingBackup(parsed)
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
      const { state, watchHistory } = pendingBackup

      if (mode === 'replace') {
        // Overwrite state entirely
        await chrome.storage.local.set({ mytube_state: state })
        // Clear existing watch history then import
        const db = await import('../../../shared/db')
        // importWatchHistory only adds; clear store first by reading existing and using a fresh db call
        // We use a workaround: clear via indexedDB directly via idb
        const { openDB } = await import('idb')
        const rawDb = await openDB('mytube', 1)
        const tx = rawDb.transaction('watchHistory', 'readwrite')
        await tx.store.clear()
        await tx.done
        rawDb.close()
        await db.importWatchHistory(watchHistory)
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
        await importWatchHistory(watchHistory)
      }

      setPendingBackup(null)
      onStateChange()
      setImportStatus({ kind: 'success', text: t('data.imported') })
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
