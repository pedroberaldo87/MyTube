import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { Tag } from '../../shared/types'

const TAG_COLORS = [
  '#f44336', '#e91e63', '#9c27b0', '#673ab7',
  '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4',
  '#009688', '#4caf50', '#8bc34a', '#ffeb3b',
  '#ff9800', '#ff5722', '#795548', '#9e9e9e',
]

interface TagManagerProps {
  tags: Tag[]
  onAdd: (name: string, color: string) => void
  onUpdate: (tag: Tag) => void
  onDelete: (id: string) => void
}

interface EditingTag {
  id: string
  name: string
  color: string
}

export function TagManager({ tags, onAdd, onUpdate, onDelete }: TagManagerProps) {
  const [editing, setEditing] = useState<EditingTag | null>(null)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(TAG_COLORS[0] ?? '#f44336')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const handleAdd = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    onAdd(trimmed, newColor)
    setNewName('')
    setNewColor(TAG_COLORS[0] ?? '#f44336')
  }

  const handleSaveEdit = () => {
    if (!editing) return
    const trimmed = editing.name.trim()
    if (!trimmed) return
    onUpdate({ id: editing.id, name: trimmed, color: editing.color })
    setEditing(null)
  }

  const handleDelete = (id: string) => {
    if (confirmDelete === id) {
      onDelete(id)
      setConfirmDelete(null)
    } else {
      setConfirmDelete(id)
    }
  }

  return (
    <div style={styles.container}>
      {/* Tag list */}
      <div style={styles.list}>
        {tags.length === 0 && (
          <p style={{ color: 'var(--mt-text-secondary)', fontSize: 14, margin: 0 }}>No tags yet.</p>
        )}
        {tags.map(tag => (
          <div key={tag.id} style={styles.tagRow}>
            {editing?.id === tag.id ? (
              <div style={styles.editRow}>
                <ColorPicker
                  value={editing.color}
                  onChange={color => setEditing(e => e ? { ...e, color } : e)}
                />
                <input
                  style={styles.input}
                  value={editing.name}
                  onInput={e => setEditing(prev => prev ? { ...prev, name: (e.target as HTMLInputElement).value } : prev)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditing(null) }}
                  autoFocus
                />
                <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={handleSaveEdit}>Save</button>
                <button style={{ ...styles.btn, ...styles.btnGhost }} onClick={() => setEditing(null)}>Cancel</button>
              </div>
            ) : (
              <>
                <span style={{ ...styles.chip, backgroundColor: tag.color + '33', borderColor: tag.color }}>
                  <span style={{ ...styles.colorDot, backgroundColor: tag.color }} />
                  <span style={{ color: 'var(--mt-text-primary)', fontSize: 13 }}>{tag.name}</span>
                </span>
                <div style={styles.actions}>
                  <button
                    style={{ ...styles.btn, ...styles.btnGhost }}
                    onClick={() => setEditing({ id: tag.id, name: tag.name, color: tag.color })}
                  >
                    Edit
                  </button>
                  <button
                    style={{
                      ...styles.btn,
                      ...(confirmDelete === tag.id ? styles.btnDanger : styles.btnGhost),
                    }}
                    onClick={() => handleDelete(tag.id)}
                  >
                    {confirmDelete === tag.id ? 'Confirm?' : 'Delete'}
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Add new tag */}
      <div style={styles.addRow}>
        <ColorPicker value={newColor} onChange={setNewColor} />
        <input
          style={styles.input}
          placeholder="New tag name..."
          value={newName}
          onInput={e => setNewName((e.target as HTMLInputElement).value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
        />
        <button
          style={{ ...styles.btn, ...styles.btnPrimary }}
          onClick={handleAdd}
          disabled={!newName.trim()}
        >
          Add Tag
        </button>
      </div>
    </div>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        style={{ ...styles.colorBtn, backgroundColor: value }}
        onClick={() => setOpen(v => !v)}
        title="Pick color"
      />
      {open && (
        <div style={styles.colorPickerPopover}>
          {TAG_COLORS.map(c => (
            <button
              key={c}
              style={{
                ...styles.colorSwatch,
                backgroundColor: c,
                outline: value === c ? '2px solid var(--mt-accent)' : 'none',
                outlineOffset: 2,
              }}
              onClick={() => { onChange(c); setOpen(false) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, h.JSX.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  tagRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  editRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 10px',
    borderRadius: 12,
    border: '1px solid transparent',
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  actions: {
    display: 'flex',
    gap: 6,
    flexShrink: 0,
  },
  addRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderTop: '1px solid var(--mt-border)',
    paddingTop: 16,
  },
  input: {
    flex: 1,
    backgroundColor: 'var(--mt-bg-secondary)',
    border: '1px solid var(--mt-border)',
    borderRadius: 6,
    padding: '7px 12px',
    color: 'var(--mt-text-primary)',
    fontSize: 14,
    outline: 'none',
  },
  btn: {
    border: 'none',
    borderRadius: 6,
    padding: '6px 14px',
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
    backgroundColor: 'var(--mt-bg-secondary)',
    color: 'var(--mt-text-primary)',
    border: '1px solid var(--mt-border)',
  },
  btnDanger: {
    backgroundColor: 'var(--mt-btn-bg)',
    border: '1px solid var(--mt-error)',
    color: 'var(--mt-error)',
  },
  colorBtn: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: '2px solid var(--mt-border)',
    cursor: 'pointer',
  },
  colorPickerPopover: {
    position: 'absolute',
    top: 34,
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
