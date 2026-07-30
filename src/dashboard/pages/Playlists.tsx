import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { AppState, Folder, Organizable, Tag } from '../../shared/types'
import { sendMessage } from '../../shared/messages'

interface PlaylistsProps {
  appState: AppState
  onRefresh: () => Promise<void>
}

function TagChip({ tag }: { tag: Tag }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 12,
      backgroundColor: tag.color + '33',
      border: `1px solid ${tag.color}`,
      color: 'var(--mt-text-primary)',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: tag.color, flexShrink: 0 }} />
      {tag.name}
    </span>
  )
}

interface PlaylistCardProps {
  playlist: Organizable
  folders: Folder[]
  tags: Tag[]
  expanded: boolean
  onToggleExpand: () => void
  onRefresh: () => Promise<void>
}

function PlaylistCard({ playlist, folders, tags, expanded, onToggleExpand, onRefresh }: PlaylistCardProps) {
  const [saving, setSaving] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState(playlist.folderId ?? '')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(playlist.tagIds)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const assignedFolder = folders.find(f => f.id === playlist.folderId)

  const toggleTag = (tagId: string) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    )
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await sendMessage({
        type: 'UPDATE_ORGANIZABLE',
        payload: {
          ...playlist,
          folderId: selectedFolder !== '' ? selectedFolder : null,
          tagIds: selectedTagIds,
        },
      })
      await onRefresh()
      onToggleExpand()
    } catch (err) {
      console.error('[Dashboard] Failed to update playlist:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    try {
      await sendMessage({ type: 'DELETE_ORGANIZABLE', payload: { id: playlist.id } })
      await onRefresh()
    } catch (err) {
      console.error('[Dashboard] Failed to delete playlist:', err)
    }
  }

  return (
    <div style={cardStyles.card}>
      <div style={cardStyles.cardHeader} onClick={onToggleExpand}>
        <img
          src={playlist.thumbnailUrl}
          alt={playlist.name}
          style={cardStyles.thumbnail}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <div style={cardStyles.cardInfo}>
          <a
            href={playlist.url}
            target="_blank"
            rel="noopener noreferrer"
            style={cardStyles.playlistName}
            onClick={e => e.stopPropagation()}
          >
            {playlist.name}
          </a>
          <div style={cardStyles.metaRow}>
            {assignedFolder && (
              <span style={{ ...cardStyles.folderBadge, borderColor: assignedFolder.color }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: assignedFolder.color, flexShrink: 0 }} />
                {assignedFolder.name}
              </span>
            )}
          </div>
          <div style={cardStyles.tagsRow}>
            {playlist.tagIds.map(id => {
              const tag = tags.find(t => t.id === id)
              return tag ? <TagChip key={id} tag={tag} /> : null
            })}
          </div>
        </div>
        <span style={{ color: 'var(--mt-text-secondary)', fontSize: 18, marginLeft: 'auto', flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {expanded && (
        <div style={cardStyles.editPanel}>
          <div style={cardStyles.fieldRow}>
            <label style={cardStyles.fieldLabel}>Folder</label>
            <select
              style={cardStyles.select}
              value={selectedFolder}
              onChange={e => setSelectedFolder((e.target as HTMLSelectElement).value)}
            >
              <option value="">— None —</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          <div style={cardStyles.fieldRow}>
            <label style={cardStyles.fieldLabel}>Tags</label>
            <div style={cardStyles.tagToggleRow}>
              {tags.length === 0 && <span style={{ color: 'var(--mt-text-secondary)', fontSize: 13 }}>No tags available</span>}
              {tags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  style={{
                    ...cardStyles.tagToggleBtn,
                    backgroundColor: selectedTagIds.includes(tag.id) ? tag.color + '44' : 'var(--mt-bg-secondary)',
                    borderColor: selectedTagIds.includes(tag.id) ? tag.color : 'var(--mt-border)',
                    color: 'var(--mt-text-primary)',
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: tag.color, flexShrink: 0 }} />
                  {tag.name}
                </button>
              ))}
            </div>
          </div>

          <div style={cardStyles.editActions}>
            <button
              style={{ ...cardStyles.actionBtn, ...cardStyles.btnPrimary }}
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              style={{ ...cardStyles.actionBtn, ...cardStyles.btnGhost }}
              onClick={() => {
                setSelectedFolder(playlist.folderId ?? '')
                setSelectedTagIds(playlist.tagIds)
                onToggleExpand()
              }}
            >
              Cancel
            </button>
            <button
              style={{
                ...cardStyles.actionBtn,
                ...(confirmDelete ? cardStyles.btnDanger : cardStyles.btnGhost),
                marginLeft: 'auto',
              }}
              onClick={() => void handleDelete()}
            >
              {confirmDelete ? 'Confirm Delete?' : 'Delete'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Playlists({ appState, onRefresh }: PlaylistsProps) {
  const { organizables, folders, tags } = appState
  const playlists = organizables.filter(o => o.type === 'playlist')

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterFolder, setFilterFolder] = useState('')
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  const handleSync = () => {
    setSyncMessage('Navigate to youtube.com/feed/playlists, wait for it to load, then click Sync Playlists again.')
  }

  const toggleFilterTag = (id: string) => {
    setFilterTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  const filtered = playlists.filter(pl => {
    if (filterFolder !== '' && pl.folderId !== filterFolder) return false
    if (filterTags.length > 0 && !filterTags.every(t => pl.tagIds.includes(t))) return false
    return true
  })

  return (
    <div>
      <div style={pageStyles.pageHeader}>
        <h2 style={pageStyles.pageTitle}>
          Playlists <span style={{ color: 'var(--mt-text-secondary)', fontSize: 16 }}>({playlists.length})</span>
        </h2>
        <button style={pageStyles.syncBtn} onClick={handleSync}>Sync Playlists</button>
      </div>

      {syncMessage && (
        <div style={pageStyles.infoBanner}>{syncMessage}</div>
      )}

      <div style={pageStyles.filters}>
        <select
          style={pageStyles.select}
          value={filterFolder}
          onChange={e => setFilterFolder((e.target as HTMLSelectElement).value)}
        >
          <option value="">All Folders</option>
          {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>

        <div style={pageStyles.tagFilterRow}>
          {tags.map(tag => (
            <button
              key={tag.id}
              onClick={() => toggleFilterTag(tag.id)}
              style={{
                ...pageStyles.tagToggleBtn,
                backgroundColor: filterTags.includes(tag.id) ? tag.color + '44' : 'var(--mt-bg-secondary)',
                borderColor: filterTags.includes(tag.id) ? tag.color : 'var(--mt-border)',
                color: 'var(--mt-text-primary)',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: tag.color }} />
              {tag.name}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <p style={{ color: 'var(--mt-text-secondary)', textAlign: 'center', marginTop: 40 }}>
          {playlists.length === 0
            ? 'No playlists yet. Sync your playlists to get started.'
            : 'No playlists match the current filters.'}
        </p>
      )}

      <div style={pageStyles.list}>
        {filtered.map(pl => (
          <PlaylistCard
            key={pl.id}
            playlist={pl}
            folders={folders}
            tags={tags}
            expanded={expandedId === pl.id}
            onToggleExpand={() => setExpandedId(expandedId === pl.id ? null : pl.id)}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </div>
  )
}

const cardStyles: Record<string, h.JSX.CSSProperties> = {
  card: {
    backgroundColor: 'var(--mt-bg-secondary)',
    border: '1px solid var(--mt-border)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '12px 16px',
    cursor: 'pointer',
  },
  thumbnail: {
    width: 44,
    height: 44,
    borderRadius: 6,
    objectFit: 'cover',
    flexShrink: 0,
    backgroundColor: 'var(--mt-border)',
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  playlistName: {
    fontSize: 15,
    fontWeight: 500,
    color: 'var(--mt-text-primary)',
    textDecoration: 'none',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metaRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  folderBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    color: 'var(--mt-text-secondary)',
    border: '1px solid',
    borderRadius: 10,
    padding: '1px 8px',
  },
  tagsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  editPanel: {
    borderTop: '1px solid var(--mt-border)',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    backgroundColor: 'var(--mt-bg-primary)',
  },
  fieldRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--mt-text-secondary)',
    width: 56,
    flexShrink: 0,
    paddingTop: 8,
  },
  select: {
    backgroundColor: 'var(--mt-bg-secondary)',
    border: '1px solid var(--mt-border)',
    borderRadius: 6,
    padding: '7px 12px',
    color: 'var(--mt-text-primary)',
    fontSize: 14,
    cursor: 'pointer',
  },
  tagToggleRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagToggleBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    border: '1px solid',
    borderRadius: 14,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
  },
  editActions: {
    display: 'flex',
    gap: 10,
    paddingTop: 4,
  },
  actionBtn: {
    border: 'none',
    borderRadius: 6,
    padding: '7px 16px',
    fontSize: 13,
    cursor: 'pointer',
  },
  btnPrimary: {
    backgroundColor: 'var(--mt-accent-soft)',
    border: '2px solid var(--mt-accent)',
    color: 'var(--mt-text-primary)',
    fontWeight: 600,
  },
  btnGhost: {
    backgroundColor: 'var(--mt-bg-secondary)',
    color: 'var(--mt-text-primary)',
    border: '1px solid var(--mt-border)',
  },
  btnDanger: {
    backgroundColor: 'var(--mt-btn-bg)',
    border: '1px solid var(--mt-error)',
    color: 'var(--mt-error)',
  },
}

const pageStyles: Record<string, h.JSX.CSSProperties> = {
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
  syncBtn: {
    backgroundColor: 'var(--mt-accent-soft)',
    border: '2px solid var(--mt-accent)',
    color: 'var(--mt-text-primary)',
    fontWeight: 600,
    borderRadius: 20,
    padding: '8px 20px',
    fontSize: 14,
    cursor: 'pointer',
  },
  infoBanner: {
    backgroundColor: 'var(--mt-accent-soft)',
    border: '1px solid var(--mt-accent)',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 14,
    color: 'var(--mt-text-primary)',
    marginBottom: 16,
  },
  filters: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
    alignItems: 'center',
  },
  select: {
    backgroundColor: 'var(--mt-bg-secondary)',
    border: '1px solid var(--mt-border)',
    borderRadius: 6,
    padding: '7px 12px',
    color: 'var(--mt-text-primary)',
    fontSize: 14,
    cursor: 'pointer',
  },
  tagFilterRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagToggleBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    border: '1px solid',
    borderRadius: 14,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
}
