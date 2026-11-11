import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { AppState } from '../../shared/types'
import { sendMessage } from '../../shared/messages'
import { exportWatchHistory, importWatchHistory, replaceWatchHistory } from '../../shared/db'
import { TagManager } from '../components/TagManager'
import { sanitizeBackupCollections, type SanitizedBackup } from '../../shared/backup-validate'
import type { WatchEntry } from '../../shared/types'
import { normalizeHistoryField, planHistoryReplace, restoreReplace } from '../../shared/restore'
import { addTag, deleteTag, setState, updateState, updateTag } from '../../shared/storage'

interface SettingsProps {
  appState: AppState
  onRefresh: () => Promise<void>
}

// O arquivo passa por UM validador por elemento (shared/backup-validate.ts) antes
// de virar `importData`; nada cru chega ao storage nem ao IndexedDB.
type ImportPayload = SanitizedBackup & {
  /** O que "Replace" grava no lugar do histórico; `null` = histórico atual intacto. */
  historyReplacement: WatchEntry[] | null
}

function parseImportPayload(obj: unknown): ImportPayload | null {
  const rec = typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>) : null
  const clean = sanitizeBackupCollections(rec ? { ...rec, watchHistory: normalizeHistoryField(rec['watchHistory']) } : obj)
  if (!clean || !rec) return null
  return { ...clean, historyReplacement: planHistoryReplace(rec['watchHistory'], clean.watchHistory) }
}

function ExportSection() {
  const [exporting, setExporting] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleExport = async () => {
    setExporting(true)
    setStatus(null)
    try {
      const state = await sendMessage({ type: 'GET_STATE' })
      const watchHistory = await exportWatchHistory()
      const payload = { ...state, watchHistory }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const date = new Date().toISOString().slice(0, 10)
      const a = document.createElement('a')
      a.href = url
      a.download = `mytube-backup-${date}.json`
      a.click()
      URL.revokeObjectURL(url)
      setStatus({ type: 'success', message: 'Backup downloaded successfully.' })
    } catch (err) {
      console.error('[Dashboard] Export failed:', err)
      setStatus({ type: 'error', message: 'Export failed. Check console for details.' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={styles.subsection}>
      <h3 style={styles.subsectionTitle}>Export Data</h3>
      <p style={styles.subsectionDesc}>
        Download a full backup: channels, playlists, folders, tags and watch history as a single JSON file.
      </p>
      <button
        style={{ ...styles.btn, ...styles.btnPrimary }}
        onClick={() => void handleExport()}
        disabled={exporting}
      >
        {exporting ? 'Exporting...' : 'Download Backup'}
      </button>
      {status && (
        <div style={{
          ...styles.statusBanner,
          borderColor: status.type === 'success' ? 'var(--mt-success)' : 'var(--mt-error)',
          color: status.type === 'success' ? 'var(--mt-success)' : 'var(--mt-error)',
          marginTop: 12,
        }}>
          {status.message}
        </div>
      )}
    </div>
  )
}

function ImportSection({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [importData, setImportData] = useState<ImportPayload | null>(null)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const parseFile = (file: File) => {
    setStatus(null)
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const raw: unknown = JSON.parse((e.target as FileReader).result as string)
        const payload = parseImportPayload(raw)
        if (!payload) {
          setStatus({ type: 'error', message: 'Invalid backup file — missing required fields.' })
          return
        }
        setImportData(payload)
      } catch {
        setStatus({ type: 'error', message: 'Could not parse JSON file.' })
      }
    }
    reader.readAsText(file)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files[0]
    if (file) parseFile(file)
  }

  const handleFileChange = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) parseFile(file)
  }

  const handleImport = async () => {
    if (!importData) return
    setImporting(true)
    setStatus(null)
    try {
      if (importMode === 'replace') {
        // Rebuild state from scratch using chrome.storage directly. Histórico
        // PRIMEIRO (transação atômica): se falhar, o mytube_state do usuário
        // continua intacto. Backup sem histórico válido não toca no atual.
        const newState: AppState = {
          organizables: importData.organizables,
          folders: importData.folders,
          tags: importData.tags,
        }
        await restoreReplace(
          importData.historyReplacement,
          replaceWatchHistory,
          () => setState(newState),
        )
      } else {
        // Merge: add each organizable — background deduplicates by youtubeId
        for (const item of importData.organizables) {
          await sendMessage({ type: 'ADD_ORGANIZABLE', payload: item })
        }
        // Merge folders and tags in one read-modify-write that re-reads inside
        // the lock (no background message for those)
        await updateState(existing => {
          // Merge folders (deduplicate by id)
          const folderIds = new Set(existing.folders.map((f: AppState['folders'][number]) => f.id))
          for (const folder of importData.folders) {
            if (!folderIds.has(folder.id)) existing.folders.push(folder)
          }

          // Merge tags (deduplicate by id)
          const tagIds = new Set(existing.tags.map((t: AppState['tags'][number]) => t.id))
          for (const tag of importData.tags) {
            if (!tagIds.has(tag.id)) existing.tags.push(tag)
          }
        })
      }

      // Merge acrescenta o histórico; o "Replace" já trocou o dele acima.
      if (importMode === 'merge') await importWatchHistory(importData.watchHistory)

      const historyCount = importMode === 'replace'
        ? (importData.historyReplacement?.length ?? 0)
        : importData.watchHistory.length
      const skipped = importData.dropped.organizables + importData.dropped.folders
        + importData.dropped.tags + importData.dropped.watchHistory
      setStatus({
        type: 'success',
        message: `Import complete. ${importData.organizables.length} items, ${historyCount} watch history entries.`
          + (skipped > 0 ? ` ${skipped} invalid entries were skipped.` : ''),
      })
      setImportData(null)
      await onRefresh()
    } catch (err) {
      console.error('[Dashboard] Import failed:', err)
      setStatus({ type: 'error', message: 'Import failed. Check console for details.' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div style={styles.subsection}>
      <h3 style={styles.subsectionTitle}>Import Data</h3>
      <p style={styles.subsectionDesc}>
        Restore from a previously exported backup file (.json).
      </p>

      <div
        style={{
          ...styles.dropZone,
          borderColor: dragOver ? 'var(--mt-accent)' : 'var(--mt-border)',
          backgroundColor: dragOver ? 'var(--mt-accent-soft)' : 'var(--mt-bg-primary)',
        }}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => (document.getElementById('import-file-input') as HTMLInputElement | null)?.click()}
      >
        <p style={{ color: 'var(--mt-text-secondary)', margin: 0, fontSize: 14 }}>
          Drop a .json backup file here or <span style={{ color: 'var(--mt-accent)' }}>click to browse</span>
        </p>
        <input
          id="import-file-input"
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      {importData && (
        <div style={styles.importPreview}>
          <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 14, color: 'var(--mt-text-primary)' }}>Import preview:</p>
          <ul style={{ margin: '0 0 14px', paddingLeft: 20, color: 'var(--mt-text-primary)', fontSize: 13, lineHeight: 1.8 }}>
            <li>{importData.organizables.length} channels / playlists</li>
            <li>{importData.folders.length} folders</li>
            <li>{importData.tags.length} tags</li>
            <li>{importData.watchHistory.length} watch history entries</li>
          </ul>
          <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
            <label style={styles.radioLabel}>
              <input
                type="radio"
                name="importMode"
                value="merge"
                checked={importMode === 'merge'}
                onChange={() => setImportMode('merge')}
              />
              <span>
                <strong style={{ color: 'var(--mt-text-primary)' }}>Merge</strong>
                <span style={{ color: 'var(--mt-text-secondary)', fontSize: 12, marginLeft: 6 }}>add new, update existing</span>
              </span>
            </label>
            <label style={styles.radioLabel}>
              <input
                type="radio"
                name="importMode"
                value="replace"
                checked={importMode === 'replace'}
                onChange={() => setImportMode('replace')}
              />
              <span>
                <strong style={{ color: 'var(--mt-text-primary)' }}>Replace</strong>
                <span style={{ color: 'var(--mt-error)', fontSize: 12, marginLeft: 6 }}>clears all existing data</span>
              </span>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              style={{ ...styles.btn, ...styles.btnPrimary }}
              onClick={() => void handleImport()}
              disabled={importing}
            >
              {importing ? 'Importing...' : 'Confirm Import'}
            </button>
            <button
              style={{ ...styles.btn, ...styles.btnGhost }}
              onClick={() => { setImportData(null); setStatus(null) }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {status && (
        <div style={{
          ...styles.statusBanner,
          borderColor: status.type === 'success' ? 'var(--mt-success)' : 'var(--mt-error)',
          color: status.type === 'success' ? 'var(--mt-success)' : 'var(--mt-error)',
          marginTop: 12,
        }}>
          {status.message}
        </div>
      )}
    </div>
  )
}

export function Settings({ appState, onRefresh }: SettingsProps) {
  const { tags } = appState

  const handleAddTag = async (name: string, color: string) => {
    try {
      await addTag(name, color)
      await onRefresh()
    } catch (err) {
      console.error('[Dashboard] Failed to add tag:', err)
    }
  }

  const handleUpdateTag = async (updated: AppState['tags'][number]) => {
    try {
      await updateTag(updated)
      await onRefresh()
    } catch (err) {
      console.error('[Dashboard] Failed to update tag:', err)
    }
  }

  const handleDeleteTag = async (id: string) => {
    try {
      await deleteTag(id)
      await onRefresh()
    } catch (err) {
      console.error('[Dashboard] Failed to delete tag:', err)
    }
  }

  return (
    <div style={styles.page}>
      <h2 style={styles.pageTitle}>Settings</h2>

      {/* Tags section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Tags</h2>
        <p style={styles.sectionDesc}>
          Create and manage tags to label your channels and playlists.
        </p>
        <TagManager
          tags={tags}
          onAdd={(name, color) => void handleAddTag(name, color)}
          onUpdate={(tag) => void handleUpdateTag(tag)}
          onDelete={(id) => void handleDeleteTag(id)}
        />
      </section>

      {/* Backup section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Backup &amp; Restore</h2>
        <ExportSection />
        <div style={{ height: 1, backgroundColor: 'var(--mt-border)', margin: '24px 0' }} />
        <ImportSection onRefresh={onRefresh} />
      </section>

      {/* About section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>About</h2>
        <div style={styles.aboutGrid}>
          <div style={styles.aboutRow}>
            <span style={styles.aboutLabel}>Version</span>
            <span style={styles.aboutValue}>1.0.0</span>
          </div>
          <div style={styles.aboutRow}>
            <span style={styles.aboutLabel}>Extension</span>
            <span style={styles.aboutValue}>MyTube — YouTube Organizer</span>
          </div>
          <div style={styles.aboutRow}>
            <span style={styles.aboutLabel}>Description</span>
            <span style={styles.aboutValue}>
              Organize YouTube channels and playlists into folders with colored tags.
              Tracks new video notifications and watch history.
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}

const styles: Record<string, h.JSX.CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 32,
  },
  pageTitle: {
    margin: '0 0 8px',
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--mt-text-primary)',
  },
  section: {
    backgroundColor: 'var(--mt-bg-secondary)',
    border: '1px solid var(--mt-border)',
    borderRadius: 10,
    padding: '24px',
  },
  sectionTitle: {
    margin: '0 0 6px',
    fontSize: 17,
    fontWeight: 600,
    color: 'var(--mt-text-primary)',
  },
  sectionDesc: {
    margin: '0 0 20px',
    fontSize: 14,
    color: 'var(--mt-text-secondary)',
  },
  subsection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  subsectionTitle: {
    margin: '0 0 4px',
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--mt-text-primary)',
  },
  subsectionDesc: {
    margin: '0 0 14px',
    fontSize: 14,
    color: 'var(--mt-text-secondary)',
  },
  dropZone: {
    border: '2px dashed',
    borderRadius: 8,
    padding: '28px 24px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
  },
  importPreview: {
    marginTop: 14,
    backgroundColor: 'var(--mt-bg-primary)',
    border: '1px solid var(--mt-border)',
    borderRadius: 8,
    padding: '14px 16px',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    fontSize: 14,
  },
  btn: {
    border: 'none',
    borderRadius: 6,
    padding: '8px 18px',
    fontSize: 14,
    cursor: 'pointer',
    flexShrink: 0,
  },
  btnPrimary: {
    backgroundColor: 'var(--mt-accent-soft)',
    border: '2px solid var(--mt-accent)',
    color: 'var(--mt-text-primary)',
    fontWeight: 600,
  },
  btnGhost: {
    backgroundColor: 'var(--mt-bg-primary)',
    color: 'var(--mt-text-primary)',
    border: '1px solid var(--mt-border)',
  },
  statusBanner: {
    border: '1px solid',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
  },
  aboutGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  aboutRow: {
    display: 'flex',
    gap: 16,
    fontSize: 14,
  },
  aboutLabel: {
    color: 'var(--mt-text-secondary)',
    width: 90,
    flexShrink: 0,
  },
  aboutValue: {
    color: 'var(--mt-text-primary)',
  },
}
