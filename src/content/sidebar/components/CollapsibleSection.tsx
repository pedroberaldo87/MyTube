import { h } from 'preact'
import { useState } from 'preact/hooks'

interface Props {
  title: string
  badge?: number | string
  defaultOpen?: boolean
  open?: boolean
  onToggle?: (isOpen: boolean) => void
  headerAction?: h.JSX.Element
  children: h.JSX.Element | h.JSX.Element[]
}

export function CollapsibleSection({ title, badge, defaultOpen = false, open, onToggle, headerAction, children }: Props) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isOpen = open !== undefined ? open : internalOpen

  function toggle() {
    const next = !isOpen
    if (onToggle) onToggle(next)
    else setInternalOpen(next)
  }

  const headerStyle: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 4px',
    cursor: 'pointer',
    userSelect: 'none',
  }

  const chevronStyle: h.JSX.CSSProperties = {
    fontSize: '11px',
    color: 'var(--mt-text-secondary)',
    transition: 'transform 0.2s ease',
    transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
    flexShrink: 0,
  }

  const titleStyle: h.JSX.CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    fontFamily: 'var(--mt-font-display)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--mt-text-secondary)',
    flex: 1,
  }

  const badgeStyle: h.JSX.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--mt-text-secondary)',
    backgroundColor: 'var(--mt-bg-elevated)',
    border: '1px solid var(--mt-border)',
    borderRadius: 'var(--mt-radius-pill)',
    padding: '2px 8px',
    lineHeight: 1,
  }

  const bodyStyle: h.JSX.CSSProperties = {
    display: isOpen ? 'block' : 'none',
    paddingTop: '4px',
  }

  return (
    <div>
      <div style={headerStyle} onClick={toggle} role="button" aria-expanded={isOpen}>
        <span style={chevronStyle}>›</span>
        <span style={titleStyle}>{title}</span>
        {badge !== undefined && <span style={badgeStyle}>{badge}</span>}
        {headerAction && <span onClick={(e: MouseEvent) => e.stopPropagation()}>{headerAction}</span>}
      </div>
      <div style={bodyStyle} class={isOpen ? 'mt-reveal' : ''}>{children}</div>
    </div>
  )
}
