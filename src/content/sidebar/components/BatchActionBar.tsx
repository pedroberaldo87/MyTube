import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { Folder, Tag } from '../../../shared/types'
import { addFolder } from '../../../shared/storage'
import { QuickTag } from '../QuickTag'
import { useT } from '../../../shared/i18n'
import { flattenFolders } from '../../../shared/folders'

interface BatchActionBarProps {
  selectedCount: number
  folders: Folder[]
  tags: Tag[]
  onAssignFolder: (folderId: string | null) => void
  onToggleTag: (tagId: string) => void
  onDelete: () => void
  onUnsubscribe?: () => void
  onClose: () => void
  onFolderCreated: () => void
}

export function BatchActionBar({
  selectedCount,
  folders,
  tags,
  onAssignFolder,
  onToggleTag,
  onDelete,
  onUnsubscribe,
  onClose,
  onFolderCreated,
}: BatchActionBarProps) {
  const t = useT()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmUnsub, setConfirmUnsub] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)

  async function handleCreateFolder() {
    const trimmed = newFolderName.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      const folder = await addFolder(trimmed, null, '#e8a838')
      onFolderCreated()
      onAssignFolder(folder.id)
      setShowNewFolder(false)
      setNewFolderName('')
    } finally {
      setCreating(false)
    }
  }

  // ── Styles ───────────────────────────────────────────────────────────────────

  const barStyle: h.JSX.CSSProperties = {
    position: 'sticky',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'var(--mt-glass-bg)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderTop: '2px solid var(--mt-accent)',
    borderRadius: 'var(--mt-radius-md) var(--mt-radius-md) 0 0',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginTop: '8px',
    zIndex: 10,
  }

  const headerStyle: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  }

  const headerTextStyle: h.JSX.CSSProperties = {
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-display)',
    fontWeight: 600,
    color: 'var(--mt-accent)',
  }

  const closeButtonStyle: h.JSX.CSSProperties = {
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    border: '1px solid var(--mt-btn-border)',
    background: 'var(--mt-btn-bg)',
    color: 'var(--mt-text-secondary)',
    fontSize: '14px',
    cursor: 'pointer',
    lineHeight: 1,
    padding: 0,
  }

  const labelStyle: h.JSX.CSSProperties = {
    fontSize: 'var(--mt-font-size-xs)',
    fontFamily: 'var(--mt-font-body)',
    color: 'var(--mt-text-secondary)',
    marginBottom: '2px',
    display: 'block',
  }

  const selectStyle: h.JSX.CSSProperties = {
    width: '100%',
    padding: '6px 28px 6px 10px',
    minHeight: '32px',
    borderRadius: 'var(--mt-radius-sm)',
    border: '1px solid var(--mt-btn-border)',
    backgroundColor: 'var(--mt-bg-primary)',
    color: 'var(--mt-text-primary)',
    fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-sm)',
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23aaa'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
    boxSizing: 'border-box',
  }

  const deleteButtonStyle: h.JSX.CSSProperties = {
    padding: '4px 12px',
    minHeight: '32px',
    borderRadius: 'var(--mt-radius-sm)',
    border: `1px solid var(--mt-error)`,
    backgroundColor: confirmDelete ? 'var(--mt-error)' : 'rgba(248, 113, 113, 0.1)',
    color: confirmDelete ? '#ffffff' : 'var(--mt-error)',
    fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-sm)',
    fontWeight: confirmDelete ? 600 : 400,
    cursor: 'pointer',
    transition: 'background-color 0.12s, color 0.12s',
  }

  const unsubButtonStyle: h.JSX.CSSProperties = {
    padding: '4px 12px',
    minHeight: '32px',
    borderRadius: 'var(--mt-radius-sm)',
    border: `1px solid var(--mt-warning, #e5a00d)`,
    backgroundColor: confirmUnsub ? 'var(--mt-warning, #e5a00d)' : 'rgba(229, 160, 13, 0.1)',
    color: confirmUnsub ? '#ffffff' : 'var(--mt-warning, #e5a00d)',
    fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-sm)',
    fontWeight: confirmUnsub ? 600 : 400,
    cursor: 'pointer',
    transition: 'background-color 0.12s, color 0.12s',
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={barStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={headerTextStyle}>{selectedCount} {t('batch.selected')}</span>
        <button
          style={closeButtonStyle}
          onClick={onClose}
          type="button"
          aria-label="Close batch actions"
        >
          ×
        </button>
      </div>

      {/* Folder dropdown + new folder */}
      <div>
        <span style={labelStyle}>{t('batch.assignFolder')}</span>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <select
            style={{ ...selectStyle, flex: 1 }}
            value=""
            onChange={(e) => {
              const val = (e.target as HTMLSelectElement).value
              if (val === '__none__') {
                onAssignFolder(null)
              } else if (val !== '') {
                onAssignFolder(val)
              }
              ;(e.target as HTMLSelectElement).value = ''
            }}
            aria-label="Assign folder to selected items"
          >
            <option value="" disabled>
              {t('batch.chooseFolder')}
            </option>
            <option value="__none__">{t('batch.noFolder')}</option>
            {flattenFolders(folders).map(({ folder: f, depth: d }) => (
              <option key={f.id} value={f.id}>
                {'　'.repeat(d)}{d > 0 ? '└ ' : ''}{f.name}
              </option>
            ))}
          </select>
          {!showNewFolder && (
            <button
              style={{
                minWidth: '32px',
                minHeight: '32px',
                borderRadius: 'var(--mt-radius-sm)',
                border: '1px solid var(--mt-btn-border)',
                backgroundColor: 'var(--mt-btn-bg)',
                color: 'var(--mt-accent)',
                fontSize: '18px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                lineHeight: 1,
                transition: 'var(--mt-transition-fast)',
              }}
              onClick={() => setShowNewFolder(true)}
              type="button"
              aria-label="Create new folder"
              title={t('batch.newFolder')}
            >
              +
            </button>
          )}
        </div>
        {showNewFolder && (
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px', alignItems: 'center' }}>
            <input
              type="text"
              value={newFolderName}
              onInput={(e) => setNewFolderName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateFolder()
                if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName('') }
              }}
              placeholder={t('folder.name')}
              autoFocus
              style={{
                flex: 1,
                padding: '6px 10px',
                minHeight: '32px',
                borderRadius: 'var(--mt-radius-sm)',
                border: '1px solid var(--mt-btn-border)',
                backgroundColor: 'var(--mt-bg-primary)',
                color: 'var(--mt-text-primary)',
                fontFamily: 'var(--mt-font-body)',
                fontSize: 'var(--mt-font-size-sm)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <button
              style={{
                padding: '4px 12px',
                minHeight: '32px',
                borderRadius: 'var(--mt-radius-sm)',
                border: '1px solid var(--mt-accent)',
                backgroundColor: 'var(--mt-accent)',
                color: '#ffffff',
                fontFamily: 'var(--mt-font-body)',
                fontSize: 'var(--mt-font-size-sm)',
                fontWeight: 600,
                cursor: creating ? 'wait' : 'pointer',
                opacity: creating ? 0.7 : 1,
                whiteSpace: 'nowrap',
              }}
              onClick={() => void handleCreateFolder()}
              disabled={creating || !newFolderName.trim()}
              type="button"
            >
              {creating ? '...' : t('common.create')}
            </button>
            <button
              style={{
                minWidth: '32px',
                minHeight: '32px',
                borderRadius: 'var(--mt-radius-sm)',
                border: '1px solid var(--mt-btn-border)',
                backgroundColor: 'var(--mt-btn-bg)',
                color: 'var(--mt-text-secondary)',
                fontSize: '14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                lineHeight: 1,
              }}
              onClick={() => { setShowNewFolder(false); setNewFolderName('') }}
              type="button"
              aria-label="Cancel"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div>
          <span style={labelStyle}>{t('batch.toggleTags')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--mt-spacing-xs)' }}>
            {tags.map((tag) => (
              <QuickTag
                key={tag.id}
                tag={tag}
                active={false}
                onToggle={onToggleTag}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unsubscribe */}
      {onUnsubscribe && (
        <div style={{ marginTop: '2px' }}>
          <button
            style={unsubButtonStyle}
            onClick={() => {
              if (confirmUnsub) {
                onUnsubscribe()
                setConfirmUnsub(false)
              } else {
                setConfirmUnsub(true)
              }
            }}
            type="button"
          >
            {confirmUnsub ? `${t('batch.confirmUnsub')} ${selectedCount}?` : t('batch.unsubscribe')}
          </button>
          {confirmUnsub && (
            <button
              style={{
                marginLeft: '6px',
                padding: '4px 12px',
                borderRadius: 'var(--mt-radius-sm)',
                border: '1px solid var(--mt-border)',
                backgroundColor: 'transparent',
                color: 'var(--mt-text-secondary)',
                fontFamily: 'var(--mt-font-body)',
                fontSize: 'var(--mt-font-size-xs)',
                cursor: 'pointer',
              }}
              onClick={() => setConfirmUnsub(false)}
              type="button"
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      )}

      {/* Delete */}
      <div style={{ marginTop: '2px' }}>
        <button
          style={deleteButtonStyle}
          onClick={() => {
            if (confirmDelete) {
              onDelete()
              setConfirmDelete(false)
            } else {
              setConfirmDelete(true)
            }
          }}
          type="button"
        >
          {confirmDelete ? `${t('batch.confirmDelete')} ${selectedCount}?` : t('batch.deleteSelected')}
        </button>
        {confirmDelete && (
          <button
            style={{
              marginLeft: '6px',
              padding: '4px 12px',
              borderRadius: 'var(--mt-radius-sm)',
              border: '1px solid var(--mt-border)',
              backgroundColor: 'transparent',
              color: 'var(--mt-text-secondary)',
              fontFamily: 'var(--mt-font-body)',
              fontSize: 'var(--mt-font-size-xs)',
              cursor: 'pointer',
            }}
            onClick={() => setConfirmDelete(false)}
            type="button"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  )
}
