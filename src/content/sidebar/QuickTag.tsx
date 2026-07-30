import { h } from 'preact'
import type { Tag } from '../../shared/types'

interface QuickTagProps {
  tag: Tag
  active: boolean
  onToggle: (tagId: string) => void
}

/**
 * A pill-shaped chip for quickly toggling a tag on/off.
 * Active state: solid background color from the tag's color.
 * Inactive state: the tag color at low opacity as background.
 */
export function QuickTag({ tag, active, onToggle }: QuickTagProps) {
  const handleClick = () => onToggle(tag.id)

  const style: h.JSX.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    minHeight: '26px',
    borderRadius: 'var(--mt-radius-pill)',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    border: active ? `1px solid ${tag.color}` : '1px solid var(--mt-btn-border)',
    backgroundColor: active ? tag.color : 'var(--mt-btn-bg)',
    color: active ? '#ffffff' : 'var(--mt-text-primary)',
    boxShadow: active ? `0 0 10px ${tag.color}40` : 'none',
    transition: 'background-color 0.2s, color 0.2s, box-shadow 0.2s',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    lineHeight: '18px',
    boxSizing: 'border-box',
  }

  return (
    <span
      style={style}
      onClick={handleClick}
      role="checkbox"
      aria-checked={active}
      aria-label={`Tag: ${tag.name}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle(tag.id)
        }
      }}
    >
      {tag.name}
    </span>
  )
}
