import { h } from 'preact'
import { useState, useCallback, useEffect, useRef } from 'preact/hooks'
import { sendMessage } from '../../../shared/messages'
import type { Folder, Organizable, Tag } from '../../../shared/types'
import { triggerUnsubscribe } from '../../unsubscribe'
import { QuickTag } from '../QuickTag'
import { NewBadge } from './NewBadge'
import { useT } from '../../../shared/i18n'
import { flattenFolders } from '../../../shared/folders'

interface LibraryItemProps {
  item: Organizable
  folders: Folder[]
  tags: Tag[]
  onRefresh: () => void
  newCount?: number
  onMarkRead?: () => void
  selectMode?: boolean
  selected?: boolean
  onSelect?: (id: string) => void
}

const THUMB_GRADIENTS = [
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

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function LibraryItem({ item, folders, tags, onRefresh, newCount, onMarkRead, selectMode, selected, onSelect }: LibraryItemProps) {
  const t = useT()
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmUnsub, setConfirmUnsub] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showFolderPicker && !showTagPicker) return
    function handleClick(e: MouseEvent) {
      const path = e.composedPath()
      if (rowRef.current && !path.includes(rowRef.current)) {
        setShowFolderPicker(false)
        setShowTagPicker(false)
        setPickerSearch('')
      }
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [showFolderPicker, showTagPicker])

  const activeTags = tags.filter(tg => item.tagIds.includes(tg.id))
  const itemNewCount = newCount ?? 0

  const handleFolderSelect = useCallback(async (folderId: string | null) => {
    await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: { ...item, folderId } })
    setShowFolderPicker(false)
    setPickerSearch('')
    onRefresh()
  }, [item, onRefresh])

  const handleTagToggle = useCallback(async (tagId: string) => {
    const newTagIds = item.tagIds.includes(tagId)
      ? item.tagIds.filter(id => id !== tagId)
      : [...item.tagIds, tagId]
    await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: { ...item, tagIds: newTagIds } })
    onRefresh()
  }, [item, onRefresh])

  const handleMuteToggle = useCallback(async () => {
    const muting = !item.muted
    if (muting && itemNewCount > 0 && onMarkRead) onMarkRead()
    await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: { ...item, muted: muting } })
    onRefresh()
  }, [item, itemNewCount, onMarkRead, onRefresh])

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setConfirmUnsub(false)
      return
    }
    await sendMessage({ type: 'DELETE_ORGANIZABLE', payload: { id: item.id } })
    setConfirmDelete(false)
    onRefresh()
  }, [confirmDelete, item.id, onRefresh])

  const handleUnsub = useCallback(() => {
    if (!confirmUnsub) {
      setConfirmUnsub(true)
      setConfirmDelete(false)
      return
    }
    setConfirmUnsub(false)
    triggerUnsubscribe(item.url)
  }, [confirmUnsub, item.url])

  const openFolderPicker = useCallback(() => {
    setShowFolderPicker(v => !v)
    setShowTagPicker(false)
    setPickerSearch('')
    setConfirmDelete(false)
    setConfirmUnsub(false)
  }, [])

  const openTagPicker = useCallback(() => {
    setShowTagPicker(v => !v)
    setShowFolderPicker(false)
    setConfirmDelete(false)
    setConfirmUnsub(false)
  }, [])

  const rowStyle: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 6px',
    borderRadius: 'var(--mt-radius-sm)',
    cursor: 'default',
    transition: 'background 0.12s',
    minHeight: '38px',
    position: 'relative',
    fontFamily: 'var(--mt-font-body)',
    userSelect: 'none',
    background: selectMode && selected ? 'var(--mt-accent-soft)' : 'transparent',
    ...(showFolderPicker || showTagPicker ? { zIndex: 50 } : {}),
  }

  const thumbStyle: h.JSX.CSSProperties = {
    width: '30px',
    height: '30px',
    borderRadius: '6px',
    objectFit: 'cover',
    flexShrink: 0,
    backgroundColor: 'var(--mt-bg-hover)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  }

  const thumbPlaceholder: h.JSX.CSSProperties = {
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
  }

  const nameStyle: h.JSX.CSSProperties = {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--mt-text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'block',
    textDecoration: 'none',
    lineHeight: '1.3',
  }

  const metaStyle: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    marginTop: '1px',
    flexWrap: 'wrap',
  }

  const channelStyle: h.JSX.CSSProperties = {
    fontSize: '10px',
    color: 'var(--mt-text-secondary)',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }

  const tagChipStyle = (color: string): h.JSX.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1px 6px',
    borderRadius: 'var(--mt-radius-pill)',
    fontSize: '9px',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    lineHeight: 1.3,
    backgroundColor: `${color}30`,
    color,
  })

  const actionsStyle: h.JSX.CSSProperties = {
    display: 'flex',
    gap: '2px',
    flexShrink: 0,
    marginLeft: 'auto',
  }

  const btnStyle: h.JSX.CSSProperties = {
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
  }

  const pickerStyle: h.JSX.CSSProperties = {
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
  }

  const pickerItemStyle: h.JSX.CSSProperties = {
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
  }

  const checkboxStyle: h.JSX.CSSProperties = {
    width: '18px',
    height: '18px',
    borderRadius: '4px',
    border: `1.5px solid ${selected ? 'var(--mt-accent)' : 'var(--mt-border)'}`,
    backgroundColor: selected ? 'var(--mt-accent)' : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    cursor: 'pointer',
    transition: 'background-color 0.12s, border-color 0.12s',
  }

  const typeIcon = item.type === 'video' ? '♪' : item.type === 'channel' ? '📺' : '📋'

  return (
    <div
      ref={rowRef}
      class="mt-item-row"
      style={rowStyle}
      draggable={!selectMode && !showFolderPicker && !showTagPicker}
      onDragStart={(e: DragEvent) => {
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/x-mytube-item', item.id)
        }
      }}
      onClick={selectMode ? () => onSelect?.(item.id) : undefined}
    >
      {selectMode && (
        <div style={checkboxStyle} onClick={(e) => { e.stopPropagation(); onSelect?.(item.id) }}>
          {selected && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path d="M1 3.5L3.5 6L9 1" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          )}
        </div>
      )}

      <div style={{ position: 'relative', flexShrink: 0 }}>
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt="" style={thumbStyle} />
        ) : (
          <div style={{ ...thumbPlaceholder, background: THUMB_GRADIENTS[Math.abs(hashStr(item.id)) % THUMB_GRADIENTS.length] }}>
            {typeIcon}
          </div>
        )}
        {!item.muted && <NewBadge count={itemNewCount} size="sm" style={{ position: 'absolute', top: '-4px', right: '-4px' }} />}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <a
          href={item.url}
          target="_top"
          rel="noopener"
          style={nameStyle}
          title={item.name}
          onClick={() => { if (itemNewCount > 0 && onMarkRead) onMarkRead() }}
        >
          {item.type === 'channel' && !item.muted && <span style={{ marginRight: '4px', fontSize: '10px' }}>🔔</span>}
          {item.name}
        </a>
        <div style={metaStyle}>
          {item.channelName && <span style={channelStyle}>📺 {item.channelName}</span>}
          {!item.channelName && item.type !== 'video' && <span style={channelStyle}>{item.type}</span>}
          {activeTags.slice(0, 2).map(tg => (
            <span key={tg.id} style={tagChipStyle(tg.color)}>{tg.name}</span>
          ))}
        </div>
      </div>

      {!selectMode && (
        <>
          <div class="mt-item-actions" style={actionsStyle}>
            <button
              class="mt-item-action-btn"
              style={btnStyle}
              title={t('batch.assignFolder')}
              onClick={(e) => { e.stopPropagation(); openFolderPicker() }}
              type="button"
            >📁</button>

            {tags.length > 0 && (
              <button
                class="mt-item-action-btn"
                style={btnStyle}
                title={t('batch.toggleTags')}
                onClick={(e) => { e.stopPropagation(); openTagPicker() }}
                type="button"
              >🏷</button>
            )}

            {item.type === 'channel' && itemNewCount > 0 && !item.muted && (
              <button
                class="mt-item-action-btn"
                style={btnStyle}
                title={t('badge.markRead')}
                onClick={(e) => { e.stopPropagation(); onMarkRead?.() }}
                type="button"
              >✓</button>
            )}

            {item.type === 'channel' && (
              <button
                class="mt-item-action-btn"
                style={btnStyle}
                title={item.muted ? t('item.enableNotifications') : t('item.disableNotifications')}
                onClick={(e) => { e.stopPropagation(); void handleMuteToggle() }}
                type="button"
              >{item.muted ? '🔔' : '🔇'}</button>
            )}

            {item.type === 'channel' && (
              <button
                class="mt-item-action-btn"
                style={{
                  ...btnStyle,
                  ...(confirmUnsub ? { color: 'var(--mt-warning, #e5a00d)', fontWeight: 700 } : {}),
                }}
                title={confirmUnsub ? t('item.confirmUnsubscribe') : t('item.unsubscribe')}
                onClick={(e) => { e.stopPropagation(); handleUnsub() }}
                type="button"
              >{confirmUnsub ? '🚫?' : '🚫'}</button>
            )}

            <button
              class="mt-item-action-btn"
              style={{
                ...btnStyle,
                ...(confirmDelete ? { color: 'var(--mt-error)', fontWeight: 700 } : {}),
              }}
              title={confirmDelete ? t('item.confirmDelete') : t('item.delete')}
              onClick={(e) => { e.stopPropagation(); void handleDelete() }}
              type="button"
            >{confirmDelete ? '✓?' : '🗑'}</button>
          </div>

          {showFolderPicker && (
            <div style={pickerStyle} onClick={(e) => e.stopPropagation()}>
              <div style={{ padding: '4px 6px', position: 'sticky', top: 0, backgroundColor: 'var(--mt-bg-elevated)', zIndex: 1 }}>
                <input
                  style={{
                    width: '100%',
                    padding: '5px 8px',
                    fontSize: '11px',
                    borderRadius: 'var(--mt-radius-sm)',
                    border: '1px solid var(--mt-border)',
                    backgroundColor: 'var(--mt-bg-primary)',
                    color: 'var(--mt-text-primary)',
                    fontFamily: 'var(--mt-font-body)',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                  placeholder={t('folder.search')}
                  value={pickerSearch}
                  onInput={e => setPickerSearch((e.target as HTMLInputElement).value)}
                  onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setShowFolderPicker(false); setPickerSearch('') } }}
                  autoFocus
                />
              </div>
              {flattenFolders(folders)
                .filter(({ folder: f }) => !pickerSearch || normalize(f.name).includes(normalize(pickerSearch)))
                .map(({ folder: f, depth }) => (
                    <button
                      key={f.id}
                      class="mt-folder-picker-item"
                      style={{ ...pickerItemStyle, paddingLeft: `${8 + depth * 14}px`, fontWeight: f.id === item.folderId ? 700 : 400 }}
                      onClick={() => void handleFolderSelect(f.id)}
                      type="button"
                    >
                      📁 {f.name}
                    </button>
                ))}
              <button
                class="mt-folder-picker-item"
                style={pickerItemStyle}
                onClick={() => void handleFolderSelect(null)}
                type="button"
              >
                ↩ {t('batch.noFolder')}
              </button>
            </div>
          )}

          {showTagPicker && (
            <div style={{ ...pickerStyle, padding: '8px', minWidth: '180px', maxHeight: 'none' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {tags.map(tg => (
                  <QuickTag
                    key={tg.id}
                    tag={tg}
                    active={item.tagIds.includes(tg.id)}
                    onToggle={(id) => void handleTagToggle(id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
