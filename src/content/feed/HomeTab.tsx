import { h } from 'preact'
import { useCallback, useEffect, useState } from 'preact/hooks'
import { useT } from '../../shared/i18n'

interface HomeTabProps {
  total: number
  variant: 'vertical' | 'horizontal'
  side: 'left' | 'right'
  onOpen: () => void
}

export function HomeTab({ total, variant, side, onOpen }: HomeTabProps) {
  const t = useT()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  const handleOpen = useCallback(() => {
    setVisible(false)
    setTimeout(onOpen, 300)
  }, [onOpen])

  const hint = t('tab.hint')
  const cls = [
    'mt-tab',
    `mt-tab-${variant}`,
    `mt-tab-${side}`,
    visible ? 'mt-tab-in' : 'mt-tab-out',
  ].join(' ')

  return (
    <button class={cls} onClick={handleOpen} aria-label={hint} title={hint}>
      <span class="mt-tab-logo">
        <svg width="22" height="22" viewBox="0 0 128 128">
          <rect width="128" height="128" rx="19" fill="#FF0000" />
          <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="bold" font-size="51">M</text>
        </svg>
      </span>
      <span class="mt-tab-count">{total > 99 ? '99+' : total}</span>
      <span class="mt-tab-hint">{hint}</span>
      <span class="mt-tab-chevron">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </span>
    </button>
  )
}

export const tabStyles = `
  .mt-tab {
    position: fixed;
    top: 50%;
    z-index: 2147483645;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: 1px solid var(--mt-border);
    background: var(--mt-bg-primary);
    box-shadow: var(--mt-shadow-md);
    color: var(--mt-text-primary);
    font-family: var(--mt-font-body);
    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
                box-shadow 0.2s, border-color 0.2s;
  }
  .mt-tab:hover { border-color: var(--mt-accent); box-shadow: var(--mt-shadow-glow); }
  .mt-tab:focus-visible { outline: none; border-color: var(--mt-accent); box-shadow: var(--mt-shadow-glow); }

  .mt-tab-logo { display: flex; flex-shrink: 0; }
  .mt-tab-logo svg { display: block; border-radius: 5px; box-shadow: 0 2px 6px rgba(255, 0, 0, 0.2); }
  .mt-tab-count {
    font-family: var(--mt-font-display);
    font-weight: 800;
    color: var(--mt-accent);
    line-height: 1;
  }
  .mt-tab-hint {
    font-size: 12px;
    font-weight: 600;
    color: var(--mt-text-secondary);
    white-space: nowrap;
    max-width: 0;
    overflow: hidden;
    opacity: 0;
    transition: max-width 0.3s ease, opacity 0.3s ease;
  }
  .mt-tab-chevron { display: flex; align-items: center; color: var(--mt-text-secondary); flex-shrink: 0; }
  .mt-tab-chevron svg { display: block; }

  /* ── Side: edge anchoring + inner-corner rounding ─────────────────────── */
  .mt-tab-right {
    right: 0;
    border-right: none;
    border-top-left-radius: var(--mt-radius-md);
    border-bottom-left-radius: var(--mt-radius-md);
  }
  .mt-tab-left {
    left: 0;
    border-left: none;
    border-top-right-radius: var(--mt-radius-md);
    border-bottom-right-radius: var(--mt-radius-md);
    flex-direction: row-reverse;
  }
  .mt-tab-left .mt-tab-chevron { transform: rotate(180deg); }

  /* ── Variant: vertical (bookmark column) ──────────────────────────────── */
  .mt-tab-vertical { flex-direction: column; gap: 7px; width: 46px; padding: 14px 0; }
  .mt-tab-left.mt-tab-vertical { flex-direction: column; }
  .mt-tab-vertical .mt-tab-count { font-size: 18px; }
  .mt-tab-vertical .mt-tab-hint { display: none; }

  /* ── Variant: horizontal (pill peeking from edge) ─────────────────────── */
  .mt-tab-horizontal { flex-direction: row; gap: 9px; padding: 11px 15px; }
  .mt-tab-horizontal .mt-tab-count { font-size: 17px; }
  .mt-tab-horizontal:hover .mt-tab-hint { max-width: 130px; opacity: 1; }

  /* ── Slide states (transform also carries top:50% centering) ──────────── */
  .mt-tab-right.mt-tab-out { transform: translateY(-50%) translateX(120%); opacity: 0; }
  .mt-tab-left.mt-tab-out  { transform: translateY(-50%) translateX(-120%); opacity: 0; }

  .mt-tab-right.mt-tab-vertical.mt-tab-in { transform: translateY(-50%) translateX(0); opacity: 1; }
  .mt-tab-left.mt-tab-vertical.mt-tab-in  { transform: translateY(-50%) translateX(0); opacity: 1; }
  .mt-tab-right.mt-tab-vertical.mt-tab-in:hover { transform: translateY(-50%) translateX(-6px); }
  .mt-tab-left.mt-tab-vertical.mt-tab-in:hover  { transform: translateY(-50%) translateX(6px); }

  .mt-tab-right.mt-tab-horizontal.mt-tab-in { transform: translateY(-50%) translateX(22%); opacity: 1; }
  .mt-tab-left.mt-tab-horizontal.mt-tab-in  { transform: translateY(-50%) translateX(-22%); opacity: 1; }
  .mt-tab-right.mt-tab-horizontal.mt-tab-in:hover { transform: translateY(-50%) translateX(0); }
  .mt-tab-left.mt-tab-horizontal.mt-tab-in:hover  { transform: translateY(-50%) translateX(0); }
`
