import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { Tag } from '../../../shared/types'
import { addTag, updateTag, deleteTag } from '../../../shared/storage'
import { useT } from '../../../shared/i18n'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLORS = [
  '#f44336', '#e91e63', '#9c27b0', '#673ab7',
  '#3f51b5', '#2196f3', '#03a9f4', '#009688',
  '#4caf50', '#ff9800', '#ff5722', '#795548',
]

const DEFAULT_COLOR = COLORS[4] as string

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TagManagerProps {
  tags: Tag[]
  onRefresh: () => void
}

// ---------------------------------------------------------------------------
// ColorPicker
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// TagRow
// ---------------------------------------------------------------------------

interface TagRowProps {
  tag: Tag
  onRefresh: () => void
}

function TagRow({ tag, onRefresh }: TagRowProps) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(tag.name)
  const [editColor, setEditColor] = useState(tag.color)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const trimmed = editName.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await updateTag({ ...tag, name: trimmed, color: editColor })
      onRefresh()
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  function handleCancelEdit() {
    setEditing(false)
    setEditName(tag.name)
    setEditColor(tag.color)
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    await deleteTag(tag.id)
    onRefresh()
  }

  if (editing) {
    return (
      <div style={s.editBlock}>
        <div style={s.editRow}>
          <span style={{ ...s.chip, backgroundColor: editColor }} />
          <span style={s.editingLabel}>{tag.name}</span>
        </div>
        <ColorPicker value={editColor} onChange={setEditColor} />
        <input
          style={s.input}
          value={editName}
          onInput={e => setEditName((e.target as HTMLInputElement).value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void handleSave()
            if (e.key === 'Escape') handleCancelEdit()
          }}
          onFocus={e => { (e.target as HTMLInputElement).style.boxShadow = '0 0 0 2px var(--mt-accent-soft)' }}
          onBlur={e => { (e.target as HTMLInputElement).style.boxShadow = 'none' }}
          autoFocus
        />
        <div style={s.editActions}>
          <button style={s.btnPrimary} onClick={() => void handleSave()} disabled={saving} type="button">
            {saving ? '…' : t('common.save')}
          </button>
          <button style={s.btnGhost} onClick={handleCancelEdit} type="button">
            {t('common.cancel')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={s.tagRow}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--mt-bg-hover)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent' }}
    >
      {/* Color chip */}
      <span style={{ ...s.chip, backgroundColor: tag.color }} />

      {/* Name */}
      <span style={s.tagName}>{tag.name}</span>

      {/* Actions */}
      {confirmDelete ? (
        <div style={s.confirmRow}>
          <span style={s.confirmLabel}>{t('tag.deleteConfirm')}</span>
          <button style={{ ...s.iconBtn, color: 'var(--mt-error)' }} onClick={() => void handleDelete()} type="button">
            {t('tag.yes')}
          </button>
          <button style={s.iconBtn} onClick={() => setConfirmDelete(false)} type="button">
            {t('tag.no')}
          </button>
        </div>
      ) : (
        <div style={s.rowActions}>
          <button style={s.iconBtn} title="Edit tag" onClick={() => setEditing(true)} type="button">
            ✎
          </button>
          <button style={s.iconBtn} title="Delete tag" onClick={() => void handleDelete()} type="button">
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TagManager
// ---------------------------------------------------------------------------

export function TagManager({ tags, onRefresh }: TagManagerProps) {
  const t = useT()
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_COLOR)
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    const trimmed = newName.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await addTag(trimmed, newColor)
      onRefresh()
    } finally {
      setSaving(false)
      setShowAdd(false)
      setNewName('')
      setNewColor(DEFAULT_COLOR)
    }
  }

  return (
    <div style={s.container}>
      {tags.length === 0 && !showAdd && (
        <div style={s.empty}>{t('tag.empty')}</div>
      )}

      {tags.map(tag => (
        <TagRow key={tag.id} tag={tag} onRefresh={onRefresh} />
      ))}

      {/* New tag form */}
      {showAdd && (
        <div style={s.addForm}>
          <div style={s.editRow}>
            <span style={{ ...s.chip, backgroundColor: newColor }} />
            <span style={{ ...s.tagName, color: 'var(--mt-text-secondary)' }}>{t('tag.newLabel')}</span>
          </div>
          <ColorPicker value={newColor} onChange={setNewColor} />
          <input
            style={s.input}
            placeholder={t('tag.namePlaceholder')}
            value={newName}
            onInput={e => setNewName((e.target as HTMLInputElement).value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleCreate()
              if (e.key === 'Escape') { setShowAdd(false); setNewName('') }
            }}
            onFocus={e => { (e.target as HTMLInputElement).style.boxShadow = '0 0 0 2px var(--mt-accent-soft)' }}
            onBlur={e => { (e.target as HTMLInputElement).style.boxShadow = 'none' }}
            autoFocus
          />
          <div style={s.editActions}>
            <button style={s.btnPrimary} onClick={() => void handleCreate()} disabled={saving} type="button">
              {saving ? '…' : t('common.create')}
            </button>
            <button style={s.btnGhost} onClick={() => { setShowAdd(false); setNewName('') }} type="button">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Add button */}
      {!showAdd && (
        <button style={s.addBtn} onClick={() => setShowAdd(true)} type="button">
          {t('tag.new')}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s: Record<string, h.JSX.CSSProperties> = {
  container: {
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
  },
  tagRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 6px',
    borderRadius: 'var(--mt-radius-sm)',
    backgroundColor: 'transparent',
    transition: 'background 0.1s',
    minWidth: 0,
    minHeight: '32px',
  },
  chip: {
    display: 'inline-block',
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  tagName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--mt-text-primary)',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
  },
  rowActions: {
    display: 'flex',
    gap: '2px',
    flexShrink: 0,
  },
  confirmRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
  },
  confirmLabel: {
    fontSize: 'var(--mt-font-size-xs)',
    color: 'var(--mt-error)',
  },
  iconBtn: {
    backgroundColor: 'var(--mt-btn-bg)',
    border: '1px solid var(--mt-btn-border)',
    cursor: 'pointer',
    color: 'var(--mt-text-primary)',
    fontSize: '12px',
    padding: '4px 6px',
    borderRadius: 'var(--mt-radius-sm)',
    lineHeight: 1,
    minWidth: '26px',
    minHeight: '26px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 0.1s',
  },
  editBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px',
    backgroundColor: 'var(--mt-bg-elevated)',
    borderRadius: 'var(--mt-radius-sm)',
    border: '1px solid var(--mt-border)',
    marginBottom: '4px',
  },
  editRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  editingLabel: {
    fontSize: 'var(--mt-font-size-xs)',
    color: 'var(--mt-text-secondary)',
    fontStyle: 'italic',
    fontFamily: 'var(--mt-font-body)',
  },
  editActions: {
    display: 'flex',
    gap: '6px',
  },
  addForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px',
    backgroundColor: 'var(--mt-bg-elevated)',
    borderRadius: 'var(--mt-radius-sm)',
    border: '1px solid var(--mt-border)',
    marginTop: '4px',
    marginBottom: '4px',
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
    width: '22px',
    height: '22px',
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
    marginTop: '8px',
    width: '100%',
    backgroundColor: 'var(--mt-btn-bg)',
    borderStyle: 'dashed',
    borderWidth: '1px',
    borderColor: 'var(--mt-btn-border)',
    borderRadius: 'var(--mt-radius-sm)',
    color: 'var(--mt-text-primary)',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    fontWeight: 600,
    padding: '10px',
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'background-color 0.15s, color 0.15s, border-color 0.15s',
  },
  empty: {
    color: 'var(--mt-text-secondary)',
    fontSize: 'var(--mt-font-size-xs)',
    fontFamily: 'var(--mt-font-body)',
    padding: '8px 4px',
    textAlign: 'center',
  },
}
