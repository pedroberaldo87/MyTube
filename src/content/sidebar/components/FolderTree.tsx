import { h, Fragment } from 'preact'
import { useState, useRef, useEffect, useCallback } from 'preact/hooks'
import type { Folder, Organizable, Tag } from '../../../shared/types'
import { addFolder, updateFolder, deleteFolder, reorderFolders } from '../../../shared/storage'
import { useT } from '../../../shared/i18n'
import { loadUIState, saveUIState } from '../../../shared/ui-state'
import { sendMessage } from '../../../shared/messages'
import { triggerUnsubscribe, triggerBatchUnsubscribe } from '../../unsubscribe'
import { NewBadge } from './NewBadge'
import { BatchActionBar } from './BatchActionBar'
import { flattenFolders } from '../../../shared/folders'

const COLORS = [
  '#f44336', '#e91e63', '#9c27b0', '#673ab7',
  '#3f51b5', '#2196f3', '#03a9f4', '#009688',
  '#4caf50', '#ff9800', '#ff5722', '#795548',
]

const DEFAULT_COLOR = COLORS[5] as string

const ITEM_GRADIENTS = [
  'linear-gradient(135deg, #ff6b42, #ff2d78)',
  'linear-gradient(135deg, #7c3aed, #c026d3)',
  'linear-gradient(135deg, #0ea5e9, #22d3a7)',
  'linear-gradient(135deg, #f59e0b, #ef4444)',
  'linear-gradient(135deg, #10b981, #0ea5e9)',
  'linear-gradient(135deg, #ec4899, #8b5cf6)',
]

function hashStr(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  return hash
}

let styleInjected = false
function injectTreeStyles(root: ShadowRoot | Document) {
  if (styleInjected) return
  styleInjected = true
  const sheet = document.createElement('style')
  sheet.textContent = `
    .mt-folder-row .mt-folder-actions {
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .mt-folder-row:hover .mt-folder-actions {
      opacity: 1;
    }
    @media (hover: none) {
      .mt-folder-row .mt-folder-actions {
        opacity: 1;
      }
    }
    .mt-folder-action-btn:hover {
      background-color: var(--mt-bg-hover) !important;
      border-color: var(--mt-accent) !important;
    }
    .mt-add-folder-btn:hover {
      background-color: var(--mt-accent-soft) !important;
      transform: scale(1.01);
    }
    .mt-item-row {
      cursor: grab;
    }
    .mt-item-row:active {
      cursor: grabbing;
    }
    .mt-item-row:hover {
      background-color: var(--mt-bg-hover);
    }
    .mt-item-row .mt-item-actions {
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .mt-item-row:hover .mt-item-actions {
      opacity: 1;
    }
    @media (hover: none) {
      .mt-item-row .mt-item-actions {
        opacity: 1;
      }
    }
    .mt-item-action-btn:hover {
      background-color: var(--mt-bg-hover) !important;
      border-color: var(--mt-accent) !important;
    }
    .mt-folder-picker-item:hover {
      background-color: var(--mt-bg-hover) !important;
    }
  `
  try {
    const shadowHost = (root as ShadowRoot).host
    if (shadowHost) {
      ;(root as ShadowRoot).appendChild(sheet)
      return
    }
  } catch {
    // not a shadow root
  }
  document.head.appendChild(sheet)
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function folderHasSearchMatch(
  folderId: string,
  folders: Folder[],
  organizables: Organizable[],
  query: string,
): boolean {
  const q = normalize(query)
  const directMatch = organizables.some(
    o => o.folderId === folderId && normalize(o.name).includes(q),
  )
  if (directMatch) return true
  return folders
    .filter(f => f.parentId === folderId)
    .some(f => folderHasSearchMatch(f.id, folders, organizables, query))
}

function computeFolderNewCount(
  folderId: string,
  folders: Folder[],
  organizables: Organizable[],
  counts: Record<string, number>,
): number {
  const directItems = organizables.filter(o => o.folderId === folderId && o.type === 'channel' && !o.muted)
  let total = directItems.reduce((sum, item) => sum + (counts[item.youtubeId] ?? 0), 0)
  const childFolders = folders.filter(f => f.parentId === folderId)
  for (const child of childFolders) {
    total += computeFolderNewCount(child.id, folders, organizables, counts)
  }
  return total
}

export interface FolderTreeProps {
  folders: Folder[]
  organizables: Organizable[]
  tags: Tag[]
  newVideoCounts: Record<string, number>
  onMarkChannelRead: (channelId: string) => void
  onRefresh: () => void
  onOpenFeed: (folderId: string, folderName: string) => void
  selectMode: boolean
  onSetSelectMode: (on: boolean) => void
  onReady?: () => void
}

interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
}

function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div style={s.colorPicker}>
      {COLORS.map(c => (
        <button
          key={c}
          style={{
            ...s.colorSwatch,
            backgroundColor: c,
            border: value === c ? '2px solid var(--mt-text-primary)' : '2px solid transparent',
          }}
          onClick={() => onChange(c)}
          title={c}
          aria-label={`Color ${c}`}
          type="button"
        />
      ))}
    </div>
  )
}

interface DragHandlers {
  draggedId: string | null
  dropTarget: { parentId: string | null; index: number } | null
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOverFolder: (e: DragEvent, parentId: string | null, index: number) => void
  onDropFolder: (e: DragEvent, parentId: string | null, index: number) => void
  onItemDrop: (itemId: string, folderId: string) => void
}

interface FolderNodeProps {
  folder: Folder
  folders: Folder[]
  organizables: Organizable[]
  tags: Tag[]
  depth: number
  onRefresh: () => void
  expandedIds: Set<string>
  onToggleExpand: (id: string) => void
  siblingIndex: number
  drag: DragHandlers
  newVideoCounts: Record<string, number>
  onMarkChannelRead: (channelId: string) => void
  onOpenFeed: (folderId: string, folderName: string) => void
  searchQuery: string
  selectMode: boolean
  selectedIds: Set<string>
  onToggleSelected: (id: string) => void
  onSelectAllInFolder: (folderId: string) => void
}

function FolderNode({ folder, folders, organizables, tags, depth, onRefresh, expandedIds, onToggleExpand, siblingIndex, drag, newVideoCounts, onMarkChannelRead, onOpenFeed, searchQuery, selectMode, selectedIds, onToggleSelected, onSelectAllInFolder }: FolderNodeProps) {
  const t = useT()
  const expanded = expandedIds.has(folder.id)
  const [itemDropTarget, setItemDropTarget] = useState(false)
  const itemDragCounter = useRef(0)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(folder.name)
  const [editColor, setEditColor] = useState(folder.color)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showAddChild, setShowAddChild] = useState(false)
  const [childName, setChildName] = useState('')
  const [childColor, setChildColor] = useState(DEFAULT_COLOR)
  const [saving, setSaving] = useState(false)
  const [activeItemMenu, setActiveItemMenu] = useState<string | null>(null)
  const [pickerSearch, setPickerSearch] = useState('')
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<string | null>(null)
  const [confirmRemoveItem, setConfirmRemoveItem] = useState<string | null>(null)
  const [confirmUnsubItem, setConfirmUnsubItem] = useState<string | null>(null)

  const children = folders
    .filter(f => f.parentId === folder.id)
    .sort((a, b) => a.order - b.order)

  const isSearching = searchQuery.length > 0
  const allFolderItems = organizables.filter(o => o.folderId === folder.id).sort((a, b) => b.addedAt - a.addedAt)
  const folderItems = isSearching
    ? allFolderItems.filter(o => normalize(o.name).includes(normalize(searchQuery)))
    : allFolderItems
  const itemCount = allFolderItems.length
  const hasChildren = children.length > 0
  const hasContent = hasChildren || itemCount > 0
  const isRoot = depth === 0

  if (isSearching && !folderHasSearchMatch(folder.id, folders, organizables, searchQuery)) {
    return null
  }

  const effectiveExpanded = isSearching ? true : expanded

  async function handleSaveEdit() {
    const trimmed = editName.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await updateFolder({ ...folder, name: trimmed, color: editColor })
      onRefresh()
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  function handleCancelEdit() {
    setEditing(false)
    setEditName(folder.name)
    setEditColor(folder.color)
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    await deleteFolder(folder.id)
    onRefresh()
  }

  async function handleAddChild() {
    const trimmed = childName.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await addFolder(trimmed, folder.id, childColor)
      onRefresh()
    } finally {
      setSaving(false)
      setShowAddChild(false)
      setChildName('')
      setChildColor(DEFAULT_COLOR)
    }
  }

  const cardStyle: h.JSX.CSSProperties = isRoot ? {
    backgroundColor: 'var(--mt-bg-secondary)',
    borderRadius: 'var(--mt-radius-md)',
    border: effectiveExpanded ? '1px solid var(--mt-accent)' : '1px solid var(--mt-border)',
    padding: '6px 8px',
    transition: 'border-color 0.18s, box-shadow 0.18s',
    boxShadow: effectiveExpanded ? 'var(--mt-shadow-glow)' : 'none',
  } : {
    backgroundColor: 'transparent',
    borderLeft: '3px solid transparent',
    paddingLeft: '10px',
    borderRadius: 'var(--mt-radius-sm)',
    transition: 'background-color 0.15s',
  }

  const folderRowStyle: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 6px',
    borderRadius: 'var(--mt-radius-sm)',
    cursor: 'pointer',
    transition: 'background 0.15s',
  }

  const chevronStyle: h.JSX.CSSProperties = {
    fontSize: '11px',
    color: 'var(--mt-text-secondary)',
    transition: 'transform 0.2s',
    transform: effectiveExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
    flexShrink: 0,
  }

  const childrenContainerStyle: h.JSX.CSSProperties = {
    padding: '4px 0 2px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    borderTop: '1px solid rgba(54,46,62,0.5)',
    marginTop: '4px',
  }

  if (editing) {
    return (
      <div class="mt-folder-card" style={isRoot ? cardStyle : undefined}>
        <div style={s.editForm}>
          <span style={s.formLabel}>{t('folder.edit')}</span>
          <ColorPicker value={editColor} onChange={setEditColor} />
          <input
            style={s.input}
            value={editName}
            onInput={e => setEditName((e.target as HTMLInputElement).value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleSaveEdit()
              if (e.key === 'Escape') handleCancelEdit()
            }}
            autoFocus
          />
          <div style={s.formActions}>
            <button style={s.btnPrimary} onClick={() => void handleSaveEdit()} disabled={saving} type="button">
              {saving ? '...' : t('common.save')}
            </button>
            <button style={s.btnGhost} onClick={handleCancelEdit} type="button">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      class={isRoot ? 'mt-folder-card' : undefined}
      style={{
        ...cardStyle,
        opacity: drag.draggedId === folder.id ? 0.35 : 1,
        ...(itemDropTarget ? { border: '2px solid var(--mt-accent)', boxShadow: '0 0 8px var(--mt-accent)' } : {}),
      }}
      draggable={true}
      onDragStart={(e: DragEvent) => {
        e.stopPropagation()
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', folder.id) }
        drag.onDragStart(folder.id)
      }}
      onDragEnd={(e: DragEvent) => { e.stopPropagation(); drag.onDragEnd() }}
      onDragEnter={(e: DragEvent) => {
        if (!drag.draggedId && e.dataTransfer?.types.includes('text/x-mytube-item')) {
          itemDragCounter.current++
          if (itemDragCounter.current === 1) setItemDropTarget(true)
        }
      }}
      onDragLeave={() => {
        if (!drag.draggedId) {
          itemDragCounter.current--
          if (itemDragCounter.current <= 0) { itemDragCounter.current = 0; setItemDropTarget(false) }
        }
      }}
      onDragOver={(e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        if (drag.draggedId) {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const idx = e.clientY < rect.top + rect.height / 2 ? siblingIndex : siblingIndex + 1
          drag.onDragOverFolder(e, folder.parentId, idx)
        }
      }}
      onDrop={(e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        itemDragCounter.current = 0
        setItemDropTarget(false)
        if (drag.draggedId) {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const idx = e.clientY < rect.top + rect.height / 2 ? siblingIndex : siblingIndex + 1
          drag.onDropFolder(e, folder.parentId, idx)
        } else if (e.dataTransfer?.types.includes('text/x-mytube-item')) {
          const itemId = e.dataTransfer.getData('text/x-mytube-item')
          if (itemId) drag.onItemDrop(itemId, folder.id)
        }
      }}
    >
      <div
        class="mt-folder-row"
        style={folderRowStyle}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--mt-bg-hover)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent' }}
        onClick={() => onToggleExpand(folder.id)}
      >
        <span style={{ fontSize: '15px', flexShrink: 0 }}>📁</span>
        <span style={{ ...s.folderName, color: effectiveExpanded ? 'var(--mt-accent)' : 'var(--mt-text-primary)' }}>{folder.name}</span>
        {itemCount > 0 && <span style={s.countBadge}>{itemCount}</span>}
        <NewBadge count={computeFolderNewCount(folder.id, folders, organizables, newVideoCounts)} size="md" />
        <span style={chevronStyle}>›</span>

        <div class="mt-folder-actions" style={s.rowActions}>
          {selectMode && folderItems.length > 0 && (
            <button
              class="mt-folder-action-btn"
              style={s.actionBtn}
              title={t('folder.selectAll')}
              onClick={e => { e.stopPropagation(); onSelectAllInFolder(folder.id) }}
              type="button"
            >☑</button>
          )}
          {computeFolderNewCount(folder.id, folders, organizables, newVideoCounts) > 0 && (
            <button
              class="mt-folder-action-btn"
              style={s.actionBtn}
              title={t('folder.markAllRead')}
              onClick={async (e) => {
                e.stopPropagation()
                await sendMessage({ type: 'MARK_FOLDER_READ', payload: { folderId: folder.id } })
                onRefresh()
              }}
              type="button"
            >✓</button>
          )}
          <button
            class="mt-folder-action-btn"
            style={s.actionBtn}
            title={t('folder.openFeed')}
            onClick={e => { e.stopPropagation(); onOpenFeed(folder.id, folder.name) }}
            type="button"
          >▶</button>
          <button
            class="mt-folder-action-btn"
            style={s.actionBtn}
            title={t('folder.addSubfolder')}
            onClick={e => { e.stopPropagation(); setShowAddChild(v => !v) }}
            type="button"
          >＋</button>
          <button
            class="mt-folder-action-btn"
            style={s.actionBtn}
            title={t('folder.editFolder')}
            onClick={e => { e.stopPropagation(); setEditing(true) }}
            type="button"
          >✏</button>
          <button
            class="mt-folder-action-btn"
            style={{
              ...s.actionBtn,
              ...(confirmDelete ? { color: 'var(--mt-error)', fontWeight: 700 } : {}),
            }}
            title={confirmDelete ? t('folder.confirmDelete') : t('folder.deleteTitle')}
            onClick={e => { e.stopPropagation(); void handleDelete() }}
            type="button"
          >{confirmDelete ? '✓?' : '🗑'}</button>
        </div>
      </div>

      {showAddChild && (
        <div style={s.addForm}>
          <span style={s.formLabel}>{t('folder.newSub')}</span>
          <ColorPicker value={childColor} onChange={setChildColor} />
          <input
            style={s.input}
            placeholder={t('folder.subName')}
            value={childName}
            onInput={e => setChildName((e.target as HTMLInputElement).value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleAddChild()
              if (e.key === 'Escape') { setShowAddChild(false); setChildName('') }
            }}
            autoFocus
          />
          <div style={s.formActions}>
            <button style={s.btnPrimary} onClick={() => void handleAddChild()} disabled={saving} type="button">
              {saving ? '...' : t('common.add')}
            </button>
            <button style={s.btnGhost} onClick={() => { setShowAddChild(false); setChildName('') }} type="button">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {effectiveExpanded && hasContent && (
        <div style={childrenContainerStyle}>
          {children.map((child, i) => (
            <Fragment key={child.id}>
              {drag.dropTarget?.parentId === folder.id && drag.dropTarget?.index === i && drag.draggedId !== child.id && (
                <div style={s.dropIndicator} />
              )}
              <FolderNode
                folder={child}
                folders={folders}
                organizables={organizables}
                tags={tags}
                depth={depth + 1}
                onRefresh={onRefresh}
                expandedIds={expandedIds}
                onToggleExpand={onToggleExpand}
                siblingIndex={i}
                drag={drag}
                newVideoCounts={newVideoCounts}
                onMarkChannelRead={onMarkChannelRead}
                onOpenFeed={onOpenFeed}
                searchQuery={searchQuery}
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelected={onToggleSelected}
                onSelectAllInFolder={onSelectAllInFolder}
              />
            </Fragment>
          ))}
          {children.length > 0 && drag.dropTarget?.parentId === folder.id && drag.dropTarget?.index === children.length && (
            <div style={s.dropIndicator} />
          )}
          {folderItems.map(item => {
            const itemTags = tags.filter(t => item.tagIds.includes(t.id))
            const itemNewCount = item.type === 'channel' ? (newVideoCounts[item.youtubeId] ?? 0) : 0
            const isMenuOpen = activeItemMenu === item.id
            const isConfirmDelete = confirmDeleteItem === item.id
            const isConfirmRemove = confirmRemoveItem === item.id
            const isConfirmUnsub = confirmUnsubItem === item.id
            return (
              <div
                key={item.id}
                class="mt-item-row"
                style={{ ...s.inlineItem, position: 'relative' as const, ...(isMenuOpen ? { zIndex: 50 } : {}) }}
                draggable={!isMenuOpen && !selectMode}
                onDragStart={(e: DragEvent) => {
                  e.stopPropagation()
                  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-mytube-item', item.id) }
                }}
                onClick={selectMode ? (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); onToggleSelected(item.id) } : undefined}
              >
                {selectMode && (
                  <div
                    style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '4px',
                      border: `1.5px solid ${selectedIds.has(item.id) ? 'var(--mt-accent)' : 'var(--mt-border)'}`,
                      backgroundColor: selectedIds.has(item.id) ? 'var(--mt-accent)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      cursor: 'pointer',
                      transition: 'background-color 0.12s, border-color 0.12s',
                    }}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleSelected(item.id) }}
                  >
                    {selectedIds.has(item.id) && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 3.5L3.5 6L9 1" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    )}
                  </div>
                )}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt="" style={s.inlineThumb} />
                  ) : (
                    <div style={{ ...s.inlineThumbPlaceholder, background: ITEM_GRADIENTS[Math.abs(hashStr(item.id)) % ITEM_GRADIENTS.length] }}>
                      {item.type === 'video' ? '♪' : item.type === 'channel' ? '📺' : '📋'}
                    </div>
                  )}
                  {!item.muted && <NewBadge count={itemNewCount} size="sm" style={{ position: 'absolute', top: '-4px', right: '-4px' }} />}
                </div>
                <div style={s.inlineInfo}>
                  <a
                    href={item.url}
                    target="_top"
                    rel="noopener"
                    style={s.inlineItemName}
                    title={item.name}
                    onClick={() => { if (itemNewCount > 0) onMarkChannelRead(item.youtubeId) }}
                  >
                    {item.type === 'channel' && !item.muted && <span style={{ marginRight: '4px', fontSize: '10px' }}>🔔</span>}{item.name}
                  </a>
                  <div style={s.inlineMeta}>
                    {item.channelName && <span style={s.inlineChannel}>📺 {item.channelName}</span>}
                    {!item.channelName && item.type !== 'video' && <span style={s.inlineChannel}>{item.type}</span>}
                    {itemTags.slice(0, 2).map(tag => (
                      <span key={tag.id} style={{ ...s.inlineTag, backgroundColor: `${tag.color}30`, color: tag.color }}>{tag.name}</span>
                    ))}
                  </div>
                </div>
                {!selectMode && (
                  <>
                    <div class="mt-item-actions" style={s.itemActions}>
                      <button
                        class="mt-item-action-btn"
                        style={s.itemActionBtn}
                        title={t('folder.moveToFolder')}
                        onClick={(e) => { e.stopPropagation(); setActiveItemMenu(isMenuOpen ? null : item.id); setPickerSearch(''); setConfirmDeleteItem(null); setConfirmRemoveItem(null); setConfirmUnsubItem(null) }}
                        type="button"
                      >📁</button>
                      <button
                        class="mt-item-action-btn"
                        style={{
                          ...s.itemActionBtn,
                          ...(isConfirmRemove ? { color: 'var(--mt-warning, #e5a00d)', fontWeight: 700 } : {}),
                        }}
                        title={isConfirmRemove ? t('folder.confirmRemove') : t('folder.removeFromFolder')}
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (!isConfirmRemove) {
                            setConfirmRemoveItem(item.id)
                            setConfirmDeleteItem(null)
                            setConfirmUnsubItem(null)
                            return
                          }
                          await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: { ...item, folderId: null } })
                          setConfirmRemoveItem(null)
                          onRefresh()
                        }}
                        type="button"
                      >{isConfirmRemove ? '↩?' : '↩'}</button>
                      {itemNewCount > 0 && !item.muted && (
                        <button
                          class="mt-item-action-btn"
                          style={s.itemActionBtn}
                          title={t('item.markRead')}
                          onClick={(e) => { e.stopPropagation(); onMarkChannelRead(item.youtubeId) }}
                          type="button"
                        >✓</button>
                      )}
                      {item.type === 'channel' && (
                        <button
                          class="mt-item-action-btn"
                          style={s.itemActionBtn}
                          title={item.muted ? t('item.enableNotifications') : t('item.disableNotifications')}
                          onClick={async (e) => {
                            e.stopPropagation()
                            const muting = !item.muted
                            if (muting && itemNewCount > 0) onMarkChannelRead(item.youtubeId)
                            await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: { ...item, muted: muting } })
                            onRefresh()
                          }}
                          type="button"
                        >{item.muted ? '🔔' : '🔇'}</button>
                      )}
                      {item.type === 'channel' && (
                        <button
                          class="mt-item-action-btn"
                          style={{
                            ...s.itemActionBtn,
                            ...(isConfirmUnsub ? { color: 'var(--mt-warning, #e5a00d)', fontWeight: 700 } : {}),
                          }}
                          title={isConfirmUnsub ? t('item.confirmUnsubscribe') : t('item.unsubscribe')}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!isConfirmUnsub) {
                              setConfirmUnsubItem(item.id)
                              setConfirmDeleteItem(null)
                              setConfirmRemoveItem(null)
                              return
                            }
                            setConfirmUnsubItem(null)
                            triggerUnsubscribe(item.url)
                          }}
                          type="button"
                        >{isConfirmUnsub ? '🚫?' : '🚫'}</button>
                      )}
                      <button
                        class="mt-item-action-btn"
                        style={{
                          ...s.itemActionBtn,
                          ...(isConfirmDelete ? { color: 'var(--mt-error)', fontWeight: 700 } : {}),
                        }}
                        title={isConfirmDelete ? t('folder.confirmDelete') : t('item.delete')}
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (!isConfirmDelete) {
                            setConfirmDeleteItem(item.id)
                            setConfirmRemoveItem(null)
                            setConfirmUnsubItem(null)
                            return
                          }
                          await sendMessage({ type: 'DELETE_ORGANIZABLE', payload: { id: item.id } })
                          setConfirmDeleteItem(null)
                          onRefresh()
                        }}
                        type="button"
                      >{isConfirmDelete ? '✓?' : '🗑'}</button>
                    </div>
                    {isMenuOpen && (
                      <div style={s.folderPicker} onClick={(e) => e.stopPropagation()}>
                        <div style={{ padding: '4px 6px', position: 'sticky' as const, top: 0, backgroundColor: 'var(--mt-bg-elevated)', zIndex: 1 }}>
                          <input
                            style={{ ...s.searchInput, padding: '5px 8px', fontSize: '11px', borderRadius: 'var(--mt-radius-sm)' }}
                            placeholder={t('folder.search')}
                            value={pickerSearch}
                            onInput={e => setPickerSearch((e.target as HTMLInputElement).value)}
                            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setPickerSearch('') } }}
                            autoFocus
                          />
                        </div>
                        {flattenFolders(folders)
                          .filter(({ folder: f }) => f.id !== folder.id && (!pickerSearch || normalize(f.name).includes(normalize(pickerSearch))))
                          .map(({ folder: f, depth }) => (
                              <button
                                key={f.id}
                                class="mt-folder-picker-item"
                                style={{ ...s.folderPickerItem, paddingLeft: `${8 + depth * 14}px` }}
                                onClick={async () => {
                                  await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: { ...item, folderId: f.id } })
                                  setActiveItemMenu(null)
                                  onRefresh()
                                }}
                                type="button"
                              >
                                📁 {f.name}
                              </button>
                          ))}
                        <button
                          class="mt-folder-picker-item"
                          style={s.folderPickerItem}
                          onClick={async () => {
                            await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: { ...item, folderId: null } })
                            setActiveItemMenu(null)
                            onRefresh()
                          }}
                          type="button"
                        >
                          ↩ {t('folder.noFolder')}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function FolderTree({ folders, organizables, tags, newVideoCounts, onMarkChannelRead, onRefresh, onOpenFeed, selectMode, onSetSelectMode, onReady }: FolderTreeProps) {
  const t = useT()
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_COLOR)
  const [saving, setSaving] = useState(false)
  const treeRef = useRef<HTMLDivElement>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<'manual' | 'az' | 'za' | 'newFirst' | 'oldFirst'>('manual')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAllInFolder = useCallback((folderId: string) => {
    const items = organizables.filter(o => o.folderId === folderId)
    setSelectedIds(prev => {
      const next = new Set(prev)
      const allSelected = items.every(o => next.has(o.id))
      if (allSelected) {
        items.forEach(o => next.delete(o.id))
      } else {
        items.forEach(o => next.add(o.id))
      }
      return next
    })
  }, [organizables])

  const exitSelectMode = useCallback(() => {
    onSetSelectMode(false)
    setSelectedIds(new Set())
  }, [onSetSelectMode])

  const handleBatchAssignFolder = useCallback(async (folderId: string | null) => {
    for (const id of selectedIds) {
      const item = organizables.find(o => o.id === id)
      if (!item) continue
      await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: { ...item, folderId } })
    }
    onRefresh()
    exitSelectMode()
  }, [selectedIds, organizables, onRefresh, exitSelectMode])

  const handleBatchToggleTag = useCallback(async (tagId: string) => {
    for (const id of selectedIds) {
      const item = organizables.find(o => o.id === id)
      if (!item) continue
      const newTagIds = item.tagIds.includes(tagId)
        ? item.tagIds.filter(t => t !== tagId)
        : [...item.tagIds, tagId]
      await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: { ...item, tagIds: newTagIds } })
    }
    onRefresh()
  }, [selectedIds, organizables, onRefresh])

  const handleBatchDelete = useCallback(async () => {
    for (const id of selectedIds) {
      await sendMessage({ type: 'DELETE_ORGANIZABLE', payload: { id } })
    }
    onRefresh()
    exitSelectMode()
  }, [selectedIds, onRefresh, exitSelectMode])

  const handleBatchUnsubscribe = useCallback(() => {
    const urls = [...selectedIds]
      .map(id => organizables.find(o => o.id === id))
      .filter((o): o is Organizable => o !== undefined && o.type === 'channel')
      .map(o => o.url)
    if (urls.length > 0) {
      triggerBatchUnsubscribe(urls)
    }
  }, [selectedIds, organizables])

  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    void loadUIState().then(s => {
      if (s.expandedFolderIds.length > 0) setExpandedIds(new Set(s.expandedFolderIds))
      if (s.folderSearchQuery) setSearchQuery(s.folderSearchQuery)
      if (s.folderSortMode && s.folderSortMode !== 'manual') setSortMode(s.folderSortMode as typeof sortMode)
      requestAnimationFrame(() => onReadyRef.current?.())
    })
  }, [])

  function handleToggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveUIState({ expandedFolderIds: [...next] })
      return next
    })
  }

  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ parentId: string | null; index: number } | null>(null)

  const handleDragStart = useCallback((id: string) => { setDraggedId(id) }, [])
  const handleDragEnd = useCallback(() => { setDraggedId(null); setDropTarget(null) }, [])

  const handleDragOverFolder = useCallback((e: DragEvent, parentId: string | null, index: number) => {
    if (!draggedId) return
    const dragged = folders.find(f => f.id === draggedId)
    if (!dragged || dragged.parentId !== parentId) return
    setDropTarget({ parentId, index })
  }, [draggedId, folders])

  const handleItemDrop = useCallback(async (itemId: string, folderId: string) => {
    const item = organizables.find(o => o.id === itemId)
    if (!item) return
    await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: { ...item, folderId } })
    onRefresh()
  }, [organizables, onRefresh])

  const handleDropFolder = useCallback(async (_e: DragEvent, parentId: string | null, index: number) => {
    if (!draggedId) return
    const siblings = folders.filter(f => f.parentId === parentId).sort((a, b) => a.order - b.order)
    const fromIndex = siblings.findIndex(f => f.id === draggedId)
    if (fromIndex === -1) { handleDragEnd(); return }

    const ids = siblings.map(f => f.id)
    ids.splice(fromIndex, 1)
    const adjusted = index > fromIndex ? index - 1 : index
    ids.splice(adjusted, 0, draggedId)

    await reorderFolders(ids)
    onRefresh()
    handleDragEnd()
  }, [draggedId, folders, onRefresh, handleDragEnd])

  const drag: DragHandlers = {
    draggedId, dropTarget,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onDragOverFolder: handleDragOverFolder,
    onDropFolder: handleDropFolder,
    onItemDrop: handleItemDrop,
  }

  useEffect(() => {
    if (treeRef.current) {
      const root = treeRef.current.getRootNode() as ShadowRoot | Document
      injectTreeStyles(root)
    }
  }, [])

  const rootFolders = folders
    .filter(f => f.parentId === null)
    .sort((a, b) => {
      switch (sortMode) {
        case 'az':
          return a.name.localeCompare(b.name)
        case 'za':
          return b.name.localeCompare(a.name)
        case 'newFirst': {
          const ca = computeFolderNewCount(a.id, folders, organizables, newVideoCounts)
          const cb = computeFolderNewCount(b.id, folders, organizables, newVideoCounts)
          return cb - ca || a.order - b.order
        }
        case 'oldFirst': {
          const ca = computeFolderNewCount(a.id, folders, organizables, newVideoCounts)
          const cb = computeFolderNewCount(b.id, folders, organizables, newVideoCounts)
          return ca - cb || a.order - b.order
        }
        default:
          return a.order - b.order
      }
    })

  async function handleCreateRoot() {
    const trimmed = newName.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await addFolder(trimmed, null, newColor)
      onRefresh()
    } finally {
      setSaving(false)
      setShowAdd(false)
      setNewName('')
      setNewColor(DEFAULT_COLOR)
    }
  }

  const hasAnyItems = organizables.some(o => o.folderId !== null)
  const noSearchResults = searchQuery.length > 0 && rootFolders.every(
    f => !folderHasSearchMatch(f.id, folders, organizables, searchQuery),
  )

  const sortOptions = [
    { key: 'manual' as const, label: t('folder.sortManual'), icon: '⇅' },
    { key: 'az' as const, label: t('folder.sortAZ'), icon: 'A↓' },
    { key: 'za' as const, label: t('folder.sortZA'), icon: 'Z↓' },
    { key: 'newFirst' as const, label: t('folder.sortNewFirst'), icon: '🔔' },
    { key: 'oldFirst' as const, label: t('folder.sortOldFirst'), icon: '📅' },
  ]

  return (
    <div ref={treeRef} style={s.tree}>
      {hasAnyItems && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <div style={{ ...s.searchRow, flex: 1 }}>
              <input
                style={s.searchInput}
                placeholder={t('folder.search')}
                value={searchQuery}
                onInput={e => { const v = (e.target as HTMLInputElement).value; setSearchQuery(v); saveUIState({ folderSearchQuery: v }) }}
                onKeyDown={e => { if (e.key === 'Escape') { setSearchQuery(''); saveUIState({ folderSearchQuery: '' }) } }}
              />
              {searchQuery && (
                <button
                  style={s.searchClear}
                  onClick={() => { setSearchQuery(''); saveUIState({ folderSearchQuery: '' }) }}
                  type="button"
                  aria-label="Clear search"
                >×</button>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <button
                style={{
                  ...s.actionBtn,
                  backgroundColor: sortMode !== 'manual' ? 'var(--mt-accent-soft)' : 'var(--mt-btn-bg)',
                  color: sortMode !== 'manual' ? 'var(--mt-accent)' : 'var(--mt-text-primary)',
                  border: sortMode !== 'manual' ? '1px solid var(--mt-accent)' : '1px solid var(--mt-btn-border)',
                }}
                title={t('folder.sort')}
                onClick={() => setShowSortMenu(!showSortMenu)}
                type="button"
              >⇅</button>
              {showSortMenu && (
                <div style={{ ...s.folderPicker, right: 0, left: 'auto', minWidth: '180px' }}>
                  {sortOptions.map(opt => (
                    <button
                      key={opt.key}
                      class="mt-folder-picker-item"
                      style={{
                        ...s.folderPickerItem,
                        fontWeight: sortMode === opt.key ? 700 : 400,
                        color: sortMode === opt.key ? 'var(--mt-accent)' : 'var(--mt-text-primary)',
                      }}
                      onClick={() => { setSortMode(opt.key); setShowSortMenu(false); saveUIState({ folderSortMode: opt.key }) }}
                      type="button"
                    >
                      {opt.icon} {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {selectMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: 'var(--mt-font-size-xs)', fontFamily: 'var(--mt-font-body)', color: 'var(--mt-text-secondary)' }}>
                {selectedIds.size} {t('batch.selected')}
              </span>
            </div>
          )}
        </div>
      )}

      {rootFolders.length === 0 && !showAdd && !searchQuery && (
        <div style={s.empty}>{t('folder.empty')}</div>
      )}

      {noSearchResults && (
        <div style={s.empty}>{t('folder.noResults')}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {rootFolders.map((folder, i) => (
          <Fragment key={folder.id}>
            {dropTarget?.parentId === null && dropTarget?.index === i && draggedId !== folder.id && (
              <div style={s.dropIndicator} />
            )}
            <FolderNode
              folder={folder}
              folders={folders}
              organizables={organizables}
              tags={tags}
              depth={0}
              onRefresh={onRefresh}
              expandedIds={expandedIds}
              onToggleExpand={handleToggleExpand}
              siblingIndex={i}
              drag={drag}
              newVideoCounts={newVideoCounts}
              onMarkChannelRead={onMarkChannelRead}
              onOpenFeed={onOpenFeed}
              searchQuery={searchQuery}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
              onSelectAllInFolder={selectAllInFolder}
            />
          </Fragment>
        ))}
        {rootFolders.length > 0 && dropTarget?.parentId === null && dropTarget?.index === rootFolders.length && (
          <div style={s.dropIndicator} />
        )}
      </div>

      {showAdd && (
        <div style={s.addForm}>
          <span style={s.formLabel}>{t('folder.new')}</span>
          <ColorPicker value={newColor} onChange={setNewColor} />
          <input
            style={s.input}
            placeholder={t('folder.name')}
            value={newName}
            onInput={e => setNewName((e.target as HTMLInputElement).value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleCreateRoot()
              if (e.key === 'Escape') { setShowAdd(false); setNewName('') }
            }}
            autoFocus
          />
          <div style={s.formActions}>
            <button style={s.btnPrimary} onClick={() => void handleCreateRoot()} disabled={saving} type="button">
              {saving ? '...' : t('common.create')}
            </button>
            <button style={s.btnGhost} onClick={() => { setShowAdd(false); setNewName('') }} type="button">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {!showAdd && (
        <button
          class="mt-add-folder-btn"
          style={s.addBtn}
          onClick={() => setShowAdd(true)}
          type="button"
        >
          {t('folder.new')}
        </button>
      )}

      {selectMode && selectedIds.size > 0 && (
        <BatchActionBar
          selectedCount={selectedIds.size}
          folders={folders}
          tags={tags}
          onAssignFolder={(folderId) => void handleBatchAssignFolder(folderId)}
          onToggleTag={(tagId) => void handleBatchToggleTag(tagId)}
          onDelete={() => void handleBatchDelete()}
          onUnsubscribe={handleBatchUnsubscribe}
          onClose={exitSelectMode}
          onFolderCreated={onRefresh}
        />
      )}
    </div>
  )
}

const s: Record<string, h.JSX.CSSProperties> = {
  tree: {
    userSelect: 'none',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  searchRow: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchInput: {
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: 'var(--mt-bg-primary)',
    border: '1px solid var(--mt-btn-border)',
    borderRadius: 'var(--mt-radius-pill)',
    padding: '7px 30px 7px 12px',
    color: 'var(--mt-text-primary)',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  searchClear: {
    position: 'absolute',
    right: '6px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: 'var(--mt-text-secondary)',
    fontSize: '16px',
    cursor: 'pointer',
    padding: '2px 4px',
    lineHeight: 1,
  },
  folderName: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--mt-text-primary)',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  countBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--mt-text-secondary)',
    backgroundColor: 'var(--mt-bg-elevated)',
    border: '1px solid var(--mt-border)',
    borderRadius: 'var(--mt-radius-pill)',
    padding: '2px 8px',
    flexShrink: 0,
    lineHeight: 1,
  },
  rowActions: {
    display: 'flex',
    gap: '2px',
    flexShrink: 0,
    marginLeft: 'auto',
  },
  actionBtn: {
    backgroundColor: 'var(--mt-btn-bg)',
    border: '1px solid var(--mt-btn-border)',
    cursor: 'pointer',
    color: 'var(--mt-text-primary)',
    fontSize: '14px',
    padding: 0,
    borderRadius: 'var(--mt-radius-sm)',
    lineHeight: 1,
    width: '26px',
    height: '26px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 0.1s',
  },
  editForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px 8px',
    backgroundColor: 'var(--mt-bg-elevated)',
    borderRadius: 'var(--mt-radius-sm)',
    border: '1px solid var(--mt-border)',
  },
  addForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px 8px',
    backgroundColor: 'var(--mt-bg-elevated)',
    borderRadius: 'var(--mt-radius-sm)',
    border: '1px solid var(--mt-border)',
    marginTop: '6px',
    marginBottom: '6px',
  },
  formLabel: {
    fontSize: 'var(--mt-font-size-xs)',
    color: 'var(--mt-text-secondary)',
    fontFamily: 'var(--mt-font-body)',
    fontWeight: 500,
    letterSpacing: '0.02em',
  },
  formActions: {
    display: 'flex',
    gap: '6px',
    justifyContent: 'flex-end',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: 'var(--mt-bg-primary)',
    border: '1px solid var(--mt-btn-border)',
    borderRadius: 'var(--mt-radius-sm)',
    padding: '8px 10px',
    color: 'var(--mt-text-primary)',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    outline: 'none',
    transition: 'box-shadow 0.15s',
  },
  colorPicker: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: '4px',
    padding: '2px',
  },
  colorSwatch: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    border: '2px solid transparent',
    cursor: 'pointer',
    padding: 0,
    boxSizing: 'border-box' as const,
  },
  btnPrimary: {
    background: 'linear-gradient(135deg, var(--mt-accent), var(--mt-accent-hover))',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    padding: '6px 14px',
    minHeight: '32px',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
    boxShadow: 'var(--mt-shadow-sm)',
  },
  btnGhost: {
    backgroundColor: 'var(--mt-btn-bg)',
    color: 'var(--mt-text-primary)',
    border: '1px solid var(--mt-btn-border)',
    borderRadius: '10px',
    padding: '6px 12px',
    minHeight: '32px',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  addBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '8px 16px',
    borderRadius: 'var(--mt-radius-pill)',
    border: '2px dashed var(--mt-accent)',
    background: 'transparent',
    color: 'var(--mt-accent)',
    fontFamily: 'var(--mt-font-body)',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'background 0.18s, transform 0.12s',
    width: '100%',
    marginTop: '4px',
  },
  empty: {
    color: 'var(--mt-text-secondary)',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    padding: '12px 8px',
    textAlign: 'center',
  },
  dropIndicator: {
    height: '3px',
    background: 'linear-gradient(90deg, var(--mt-accent), var(--mt-accent-hover))',
    borderRadius: '2px',
    margin: '2px 4px',
    boxShadow: '0 0 6px var(--mt-accent)',
  },
  inlineItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 6px',
    borderRadius: 'var(--mt-radius-sm)',
    cursor: 'default',
    transition: 'background 0.12s',
    minHeight: '38px',
  },
  inlineThumb: {
    width: '30px',
    height: '30px',
    borderRadius: '6px',
    objectFit: 'cover' as const,
    flexShrink: 0,
    backgroundColor: 'var(--mt-bg-hover)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  },
  inlineThumbPlaceholder: {
    width: '30px',
    height: '30px',
    borderRadius: '6px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '12px',
    fontWeight: 700,
  },
  inlineInfo: {
    flex: 1,
    minWidth: 0,
  },
  inlineItemName: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--mt-text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'block',
    textDecoration: 'none',
    lineHeight: '1.3',
  },
  inlineMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    marginTop: '1px',
    flexWrap: 'wrap',
  },
  inlineChannel: {
    fontSize: '10px',
    color: 'var(--mt-text-secondary)',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  inlineTag: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1px 6px',
    borderRadius: 'var(--mt-radius-pill)',
    fontSize: '9px',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    lineHeight: 1.3,
  },
  itemActions: {
    display: 'flex',
    gap: '2px',
    flexShrink: 0,
    marginLeft: 'auto',
  },
  itemActionBtn: {
    backgroundColor: 'var(--mt-btn-bg)',
    border: '1px solid var(--mt-btn-border)',
    cursor: 'pointer',
    color: 'var(--mt-text-primary)',
    fontSize: '12px',
    padding: 0,
    borderRadius: 'var(--mt-radius-sm)',
    lineHeight: 1,
    width: '24px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 0.1s',
  },
  folderPicker: {
    position: 'absolute',
    top: '100%',
    right: 0,
    zIndex: 100,
    backgroundColor: 'var(--mt-bg-elevated)',
    border: '1px solid var(--mt-border)',
    borderRadius: 'var(--mt-radius-md)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    padding: '4px 0',
    minWidth: '160px',
    maxHeight: '200px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  folderPickerItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 8px',
    border: 'none',
    background: 'none',
    color: 'var(--mt-text-primary)',
    fontSize: '12px',
    fontFamily: 'var(--mt-font-body)',
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    transition: 'background 0.1s',
  },
}
