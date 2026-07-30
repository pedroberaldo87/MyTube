import { h } from 'preact'

interface NewBadgeProps {
  count: number
  size?: 'sm' | 'md'
  style?: h.JSX.CSSProperties
}

export function NewBadge({ count, size = 'sm', style }: NewBadgeProps) {
  if (count <= 0) return null

  const isSm = size === 'sm'
  const baseStyle: h.JSX.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--mt-error, #ef4444)',
    color: '#ffffff',
    fontFamily: 'var(--mt-font-body)',
    fontWeight: 700,
    borderRadius: 'var(--mt-radius-pill, 999px)',
    lineHeight: 1,
    flexShrink: 0,
    fontSize: isSm ? '9px' : '10px',
    minWidth: isSm ? '16px' : '18px',
    height: isSm ? '16px' : '18px',
    padding: isSm ? '0 4px' : '0 5px',
    ...style,
  }

  return (
    <span style={baseStyle} title={`${count} new`}>
      {count > 99 ? '99+' : count}
    </span>
  )
}
