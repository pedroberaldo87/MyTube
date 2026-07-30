import { h } from 'preact'
import { useState, useEffect, useCallback } from 'preact/hooks'
import type { AppState, FeedVideo, Folder } from '../../shared/types'
import { sendMessage } from '../../shared/messages'

interface FoldersProps {
  appState: AppState
  onRefresh: () => Promise<void>
}

const FOLDER_COLORS = [
  '#f44336', '#e91e63', '#9c27b0', '#3f51b5',
  '#2196f3', '#03a9f4', '#009688', '#4caf50',
  '#ff9800', '#ff5722', '#795548', '#9e9e9e',
]

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function FolderVideoFeed({ folderId }: { folderId: string }) {
  const [videos, setVideos] = useState<FeedVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadFeed = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const feed = await sendMessage({ type: 'GET_FOLDER_FEED', payload: { folderId } })
      setVideos(feed)
    } catch (err) {
      console.error('[Dashboard] Feed load error:', err)
      setError('Failed to load videos')
    } finally {
      setLoading(false)
    }
  }, [folderId])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

  if (loading) {
    return (
      <div style={feedStyles.loading}>
        <span style={feedStyles.spinner} />
        Loading videos...
      </div>
    )
  }

  if (error) {
    return (
      <div style={feedStyles.error}>
        {error}
        <button style={{ ...styles.btn, ...styles.btnGhost, marginLeft: 8 }} onClick={() => void loadFeed()}>
          Retry
        </button>
      </div>
    )
  }

  if (videos.length === 0) {
    return (
      <div style={feedStyles.empty}>
        No videos found. Add channels to this folder first.
      </div>
    )
  }

  return (
    <div style={feedStyles.grid}>
      {videos.map(video => (
        <a
          key={video.videoId}
          href={video.url}
          target="_blank"
          rel="noopener"
          style={{
            ...feedStyles.card,
            opacity: video.watched ? 0.6 : 1,
          }}
        >
          <div style={feedStyles.thumbWrap}>
            {video.thumbnailUrl ? (
              <img src={video.thumbnailUrl} alt="" style={feedStyles.thumb} />
            ) : (
              <div style={feedStyles.thumbPlaceholder}>▶</div>
            )}
            {video.watched && <span style={feedStyles.watchedTag}>Watched</span>}
          </div>
          <div style={feedStyles.cardInfo}>
            <span style={feedStyles.cardTitle}>{video.title}</span>
            <span style={feedStyles.cardMeta}>{video.channelName} · {timeAgo(video.publishedAt)}</span>
          </div>
        </a>
      ))}
    </div>
  )
}

interface FolderRowProps {
  folder: Folder
  allFolders: Folder[]
  itemCount: number
  depth: number
  onRefresh: () => Promise<void>
}

function FolderRow({ folder, allFolders, itemCount, depth, onRefresh }: FolderRowProps) {
  const [expanded, setExpanded] = useState(true)
  const [showFeed, setShowFeed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(folder.name)
  const [editColor, setEditColor] = useState(folder.color)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showAddChild, setShowAddChild] = useState(false)
  const [newChildName, setNewChildName] = useState('')
  const [newChildColor, setNewChildColor] = useState(FOLDER_COLORS[5] ?? '#ff5722')
  const [saving, setSaving] = useState(false)

  const children = allFolders
    .filter(f => f.parentId === folder.id)
    .sort((a, b) => a.order - b.order)

  const hasChildren = children.length > 0

  const handleSaveEdit = async () => {
    const trimmed = editName.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await sendMessage({
        type: 'UPDATE_ORGANIZABLE',
        payload: {
          // We can't update folders via UPDATE_ORGANIZABLE — use chrome.storage directly
          // via background message. For now we fall through to a workaround.
          id: folder.id,
        } as never,
      })
    } catch {
      // updateFolder is not exposed via messages — call storage directly from dashboard
      // since dashboard has same extension origin access to chrome.storage
    }
    // Direct storage update (dashboard runs in extension context)
    try {
      const result = await chrome.storage.local.get('mytube_state')
      type RawState = { organizables: unknown[]; folders: Folder[]; tags: unknown[] }
      const state = result['mytube_state'] as RawState | undefined
      if (state) {
        state.folders = state.folders.map((f: Folder) =>
          f.id === folder.id ? { ...f, name: trimmed, color: editColor } : f
        )
        await chrome.storage.local.set({ mytube_state: state })
      }
    } catch (err) {
      console.error('[Dashboard] Failed to update folder:', err)
    }
    setSaving(false)
    setEditing(false)
    setShowColorPicker(false)
    await onRefresh()
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    try {
      const result = await chrome.storage.local.get('mytube_state')
      type RawState = { organizables: Array<{ folderId: string | null }>; folders: Folder[]; tags: unknown[] }
      const state = result['mytube_state'] as RawState | undefined
      if (state) {
        const idsToDelete = collectDescendantIds(folder.id, state.folders)
        idsToDelete.add(folder.id)
        state.folders = state.folders.filter((f: Folder) => !idsToDelete.has(f.id))
        state.organizables = state.organizables.map(o =>
          o.folderId !== null && idsToDelete.has(o.folderId) ? { ...o, folderId: null } : o
        )
        await chrome.storage.local.set({ mytube_state: state })
      }
    } catch (err) {
      console.error('[Dashboard] Failed to delete folder:', err)
    }
    await onRefresh()
  }

  const handleAddChild = async () => {
    const trimmed = newChildName.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const result = await chrome.storage.local.get('mytube_state')
      type RawState = { organizables: unknown[]; folders: Folder[]; tags: unknown[] }
      const state = result['mytube_state'] as RawState | undefined
      if (state) {
        const siblings = state.folders.filter((f: Folder) => f.parentId === folder.id)
        const maxOrder = siblings.reduce((m: number, f: Folder) => Math.max(m, f.order), -1)
        const newFolder: Folder = {
          id: crypto.randomUUID(),
          name: trimmed,
          parentId: folder.id,
          color: newChildColor,
          order: maxOrder + 1,
        }
        state.folders.push(newFolder)
        await chrome.storage.local.set({ mytube_state: state })
      }
    } catch (err) {
      console.error('[Dashboard] Failed to create subfolder:', err)
    }
    setSaving(false)
    setShowAddChild(false)
    setNewChildName('')
    await onRefresh()
  }

  return (
    <div>
      <div style={{ paddingLeft: depth * 24 }}>
        {editing ? (
          <div style={{ ...styles.folderRow, gap: 8 }}>
            {/* Color picker inline */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                style={{ ...styles.colorDotBtn, backgroundColor: editColor }}
                onClick={() => setShowColorPicker(v => !v)}
              />
              {showColorPicker && (
                <div style={styles.colorPickerPopover}>
                  {FOLDER_COLORS.map(c => (
                    <button
                      key={c}
                      style={{
                        ...styles.colorSwatch,
                        backgroundColor: c,
                        outline: editColor === c ? '2px solid var(--mt-accent)' : 'none',
                        outlineOffset: 2,
                      }}
                      onClick={() => { setEditColor(c); setShowColorPicker(false) }}
                    />
                  ))}
                </div>
              )}
            </div>
            <input
              style={styles.nameInput}
              value={editName}
              onInput={e => setEditName((e.target as HTMLInputElement).value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleSaveEdit(); if (e.key === 'Escape') setEditing(false) }}
              autoFocus
            />
            <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={() => void handleSaveEdit()} disabled={saving}>
              {saving ? '...' : 'Save'}
            </button>
            <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={() => { setEditing(false); setEditName(folder.name); setEditColor(folder.color) }}>
              Cancel
            </button>
          </div>
        ) : (
          <div style={styles.folderRow}>
            {/* Expand toggle */}
            <button
              style={styles.toggleBtn}
              onClick={() => setExpanded(v => !v)}
            >
              {hasChildren ? (expanded ? '▾' : '▸') : <span style={{ display: 'inline-block', width: 12 }} />}
            </button>

            <span style={{ ...styles.colorDot, backgroundColor: folder.color }} />

            <span style={{ ...styles.folderName, flex: 1 }}>{folder.name}</span>

            <span style={styles.countBadge}>{itemCount}</span>

            <div style={styles.rowActions}>
              <button
                style={{
                  ...styles.iconBtn,
                  ...(showFeed ? { color: 'var(--mt-accent)', fontWeight: 700 } : {}),
                }}
                title="View videos"
                onClick={() => setShowFeed(v => !v)}
              >
                ▶
              </button>
              <button
                style={styles.iconBtn}
                title="Add subfolder"
                onClick={() => setShowAddChild(v => !v)}
              >
                +
              </button>
              <button
                style={styles.iconBtn}
                title="Rename"
                onClick={() => setEditing(true)}
              >
                ✎
              </button>
              <button
                style={{ ...styles.iconBtn, ...(confirmDelete ? { color: 'var(--mt-error)' } : {}) }}
                title="Delete"
                onClick={() => void handleDelete()}
              >
                {confirmDelete ? '✓?' : '✕'}
              </button>
            </div>
          </div>
        )}

        {/* Add child form */}
        {showAddChild && (
          <div style={{ ...styles.addChildRow, paddingLeft: 28 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                style={{ ...styles.colorDotBtn, backgroundColor: newChildColor }}
                onClick={() => setShowColorPicker(v => !v)}
              />
              {showColorPicker && (
                <div style={styles.colorPickerPopover}>
                  {FOLDER_COLORS.map(c => (
                    <button
                      key={c}
                      style={{
                        ...styles.colorSwatch,
                        backgroundColor: c,
                        outline: newChildColor === c ? '2px solid var(--mt-accent)' : 'none',
                        outlineOffset: 2,
                      }}
                      onClick={() => { setNewChildColor(c); setShowColorPicker(false) }}
                    />
                  ))}
                </div>
              )}
            </div>
            <input
              style={styles.nameInput}
              placeholder="Subfolder name..."
              value={newChildName}
              onInput={e => setNewChildName((e.target as HTMLInputElement).value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleAddChild(); if (e.key === 'Escape') setShowAddChild(false) }}
              autoFocus
            />
            <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={() => void handleAddChild()} disabled={saving}>
              {saving ? '...' : 'Add'}
            </button>
            <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={() => setShowAddChild(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Video feed */}
      {showFeed && (
        <div style={{ paddingLeft: depth * 24 + 28, paddingRight: 16, paddingBottom: 12 }}>
          <FolderVideoFeed folderId={folder.id} />
        </div>
      )}

      {/* Children */}
      {hasChildren && expanded && children.map(child => (
        <FolderRow
          key={child.id}
          folder={child}
          allFolders={allFolders}
          itemCount={0}
          depth={depth + 1}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  )
}

function collectDescendantIds(folderId: string, allFolders: Folder[]): Set<string> {
  const set = new Set<string>()
  const queue = [folderId]
  while (queue.length > 0) {
    const id = queue.shift()!
    allFolders.filter(f => f.parentId === id).forEach(f => {
      set.add(f.id)
      queue.push(f.id)
    })
  }
  return set
}

export function Folders({ appState, onRefresh }: FoldersProps) {
  const { folders, organizables } = appState

  const [showAddRoot, setShowAddRoot] = useState(false)
  const [newRootName, setNewRootName] = useState('')
  const [newRootColor, setNewRootColor] = useState(FOLDER_COLORS[2] ?? '#9c27b0')
  const [showRootColorPicker, setShowRootColorPicker] = useState(false)
  const [saving, setSaving] = useState(false)

  const rootFolders = folders
    .filter(f => f.parentId === null)
    .sort((a, b) => a.order - b.order)

  const uncategorizedCount = organizables.filter(o => o.folderId === null).length

  const getItemCount = (folderId: string) =>
    organizables.filter(o => o.folderId === folderId).length

  const handleAddRoot = async () => {
    const trimmed = newRootName.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const result = await chrome.storage.local.get('mytube_state')
      type RawState = { organizables: unknown[]; folders: Folder[]; tags: unknown[] }
      const state = result['mytube_state'] as RawState | undefined
      if (state) {
        const rootSiblings = state.folders.filter((f: Folder) => f.parentId === null)
        const maxOrder = rootSiblings.reduce((m: number, f: Folder) => Math.max(m, f.order), -1)
        const newFolder: Folder = {
          id: crypto.randomUUID(),
          name: trimmed,
          parentId: null,
          color: newRootColor,
          order: maxOrder + 1,
        }
        state.folders.push(newFolder)
        await chrome.storage.local.set({ mytube_state: state })
      }
    } catch (err) {
      console.error('[Dashboard] Failed to create folder:', err)
    }
    setSaving(false)
    setShowAddRoot(false)
    setNewRootName('')
    await onRefresh()
  }

  return (
    <div>
      <div style={styles.pageHeader}>
        <h2 style={styles.pageTitle}>
          Folders <span style={{ color: 'var(--mt-text-secondary)', fontSize: 16 }}>({folders.length})</span>
        </h2>
        <button style={styles.addBtn} onClick={() => setShowAddRoot(v => !v)}>
          + New Folder
        </button>
      </div>

      {showAddRoot && (
        <div style={styles.addRootRow}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              style={{ ...styles.colorDotBtn, backgroundColor: newRootColor }}
              onClick={() => setShowRootColorPicker(v => !v)}
            />
            {showRootColorPicker && (
              <div style={styles.colorPickerPopover}>
                {FOLDER_COLORS.map(c => (
                  <button
                    key={c}
                    style={{
                      ...styles.colorSwatch,
                      backgroundColor: c,
                      outline: newRootColor === c ? '2px solid var(--mt-accent)' : 'none',
                      outlineOffset: 2,
                    }}
                    onClick={() => { setNewRootColor(c); setShowRootColorPicker(false) }}
                  />
                ))}
              </div>
            )}
          </div>
          <input
            style={styles.nameInput}
            placeholder="Folder name..."
            value={newRootName}
            onInput={e => setNewRootName((e.target as HTMLInputElement).value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleAddRoot(); if (e.key === 'Escape') setShowAddRoot(false) }}
            autoFocus
          />
          <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={() => void handleAddRoot()} disabled={saving}>
            {saving ? '...' : 'Create'}
          </button>
          <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={() => setShowAddRoot(false)}>
            Cancel
          </button>
        </div>
      )}

      <div style={styles.treeContainer}>
        {folders.length === 0 && (
          <p style={{ color: 'var(--mt-text-secondary)', textAlign: 'center', paddingTop: 32, margin: 0 }}>
            No folders yet. Create one to start organizing.
          </p>
        )}

        {rootFolders.map(folder => (
          <FolderRow
            key={folder.id}
            folder={folder}
            allFolders={folders}
            itemCount={getItemCount(folder.id)}
            depth={0}
            onRefresh={onRefresh}
          />
        ))}

        {uncategorizedCount > 0 && (
          <div style={styles.uncategorizedRow}>
            <span style={styles.colorDot} />
            <span style={{ ...styles.folderName, color: 'var(--mt-text-secondary)', flex: 1 }}>Uncategorized</span>
            <span style={styles.countBadge}>{uncategorizedCount}</span>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, h.JSX.CSSProperties> = {
  pageHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  pageTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--mt-text-primary)',
  },
  addBtn: {
    backgroundColor: 'var(--mt-accent-soft)',
    border: '2px solid var(--mt-accent)',
    color: 'var(--mt-text-primary)',
    fontWeight: 600,
    borderRadius: 20,
    padding: '8px 20px',
    fontSize: 14,
    cursor: 'pointer',
  },
  addRootRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'var(--mt-bg-secondary)',
    border: '1px solid var(--mt-border)',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 16,
    position: 'relative',
  },
  treeContainer: {
    backgroundColor: 'var(--mt-bg-secondary)',
    border: '1px solid var(--mt-border)',
    borderRadius: 10,
    padding: '8px 0',
  },
  folderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    cursor: 'default',
  },
  addChildRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    position: 'relative',
  },
  uncategorizedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    opacity: 0.6,
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: 'var(--mt-text-secondary)',
    fontSize: 12,
    width: 14,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  colorDot: {
    display: 'inline-block',
    width: 10,
    height: 10,
    borderRadius: '50%',
    backgroundColor: '#888',
    flexShrink: 0,
  },
  colorDotBtn: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    border: '2px solid var(--mt-border)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  folderName: {
    fontSize: 14,
    color: 'var(--mt-text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  countBadge: {
    fontSize: 12,
    color: 'var(--mt-text-secondary)',
    backgroundColor: 'var(--mt-bg-primary)',
    border: '1px solid var(--mt-border)',
    borderRadius: 10,
    padding: '1px 7px',
    flexShrink: 0,
  },
  rowActions: {
    display: 'flex',
    gap: 2,
    flexShrink: 0,
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--mt-text-secondary)',
    fontSize: 14,
    padding: '2px 6px',
    borderRadius: 4,
  },
  nameInput: {
    flex: 1,
    backgroundColor: 'var(--mt-bg-primary)',
    border: '1px solid var(--mt-border)',
    borderRadius: 6,
    padding: '5px 10px',
    color: 'var(--mt-text-primary)',
    fontSize: 14,
    outline: 'none',
  },
  btn: {
    border: 'none',
    borderRadius: 6,
    padding: '5px 12px',
    fontSize: 13,
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
  colorPickerPopover: {
    position: 'absolute',
    top: 28,
    left: 0,
    zIndex: 200,
    backgroundColor: 'var(--mt-bg-secondary)',
    border: '1px solid var(--mt-border)',
    borderRadius: 8,
    padding: 10,
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 6,
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  },
  colorSwatch: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
  },
}

const feedStyles: Record<string, h.JSX.CSSProperties> = {
  loading: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '16px 0',
    color: 'var(--mt-text-secondary)',
    fontSize: 13,
  },
  spinner: {
    display: 'inline-block',
    width: 16,
    height: 16,
    border: '2px solid var(--mt-border)',
    borderTop: '2px solid var(--mt-accent)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  error: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 0',
    color: 'var(--mt-error)',
    fontSize: 13,
  },
  empty: {
    padding: '16px 0',
    color: 'var(--mt-text-secondary)',
    fontSize: 13,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 12,
    padding: '8px 0',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    textDecoration: 'none',
    color: 'inherit',
    borderRadius: 8,
    overflow: 'hidden',
    transition: 'transform 0.12s, box-shadow 0.12s',
    cursor: 'pointer',
  },
  thumbWrap: {
    position: 'relative',
    width: '100%',
    aspectRatio: '16/9',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'var(--mt-bg-primary)',
  },
  thumb: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  thumbPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--mt-text-secondary)',
    fontSize: 24,
  },
  watchedTag: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.75)',
    color: 'var(--mt-success)',
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 4,
  },
  cardInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '0 4px',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--mt-text-primary)',
    lineHeight: '1.3',
    display: '-webkit-box',
    WebkitLineClamp: '2',
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  cardMeta: {
    fontSize: 11,
    color: 'var(--mt-text-secondary)',
  },
}
