import { h } from 'preact'
import { useCallback, useEffect, useState } from 'preact/hooks'
import { useT } from '../../shared/i18n'

interface FolderCount {
  name: string
  color: string
  count: number
}

interface HomeNudgeProps {
  total: number
  folders: FolderCount[]
  onOpen: () => void
  onDismiss: () => void
}

export function HomeNudge({ total, folders, onOpen, onDismiss }: HomeNudgeProps) {
  const t = useT()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  const handleDismiss = useCallback(() => {
    setVisible(false)
    setTimeout(onDismiss, 350)
  }, [onDismiss])

  const handleOpen = useCallback(() => {
    setVisible(false)
    setTimeout(onOpen, 350)
  }, [onOpen])

  return (
    <div class={`mt-nudge ${visible ? 'mt-nudge-in' : 'mt-nudge-out'}`}>
      <button class="mt-nudge-close" onClick={handleDismiss} aria-label="Close">✕</button>
      <div class="mt-nudge-brand">
        <svg width="24" height="24" viewBox="0 0 128 128">
          <rect width="128" height="128" rx="19" fill="#FF0000"/>
          <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="bold" font-size="51">M</text>
        </svg>
        <span class="mt-nudge-brand-name">MyTube</span>
      </div>
      <div class="mt-nudge-header">
        <span class="mt-nudge-count">{total}</span>
        <span class="mt-nudge-label">{t('nudge.newVideos')}</span>
      </div>
      <div class="mt-nudge-folders-title">{t('nudge.byFolder')}</div>
      <div class="mt-nudge-folders">
        {folders.map(f => (
          <div class="mt-nudge-folder-row" key={f.name}>
            <span class="mt-nudge-folder-dot" style={{ background: f.color }} />
            <span class="mt-nudge-folder-name">{f.name}</span>
            <span class="mt-nudge-folder-count">{f.count}</span>
          </div>
        ))}
      </div>
      <button class="mt-nudge-cta" onClick={handleOpen}>{t('nudge.openFeed')}</button>
    </div>
  )
}

export const nudgeStyles = `
  .mt-nudge {
    position: fixed;
    top: 80px;
    right: 20px;
    width: 260px;
    background: var(--mt-bg-primary);
    border: 1px solid var(--mt-border);
    border-radius: var(--mt-radius-md);
    padding: 20px 18px;
    box-shadow: var(--mt-shadow-md);
    font-family: var(--mt-font-body);
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 2147483645;
    transform: translateX(calc(100% + 40px));
    opacity: 0;
    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .mt-nudge.mt-nudge-in {
    transform: translateX(0);
    opacity: 1;
  }
  .mt-nudge.mt-nudge-out {
    transform: translateX(calc(100% + 40px));
    opacity: 0;
    transition: transform 0.3s cubic-bezier(0.7, 0, 0.84, 0), opacity 0.3s cubic-bezier(0.7, 0, 0.84, 0);
  }
  .mt-nudge-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
  }
  .mt-nudge-brand svg {
    flex-shrink: 0;
    border-radius: 5px;
    box-shadow: 0 2px 6px rgba(255, 0, 0, 0.2);
  }
  .mt-nudge-brand-name {
    font-family: var(--mt-font-display);
    font-size: 16px;
    font-weight: 800;
    color: var(--mt-text-primary);
  }
  .mt-nudge-close {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 24px;
    height: 24px;
    border-radius: var(--mt-radius-sm);
    border: 1px solid var(--mt-border);
    background: var(--mt-bg-elevated);
    color: var(--mt-text-secondary);
    font-size: 11px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }
  .mt-nudge-close:hover {
    background: var(--mt-bg-hover);
    color: var(--mt-text-primary);
    border-color: var(--mt-accent);
  }
  .mt-nudge-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 12px;
  }
  .mt-nudge-count {
    font-family: var(--mt-font-display);
    font-size: 36px;
    font-weight: 800;
    color: var(--mt-accent);
    line-height: 1;
  }
  .mt-nudge-label {
    font-size: 12px;
    color: var(--mt-text-secondary);
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .mt-nudge-folders-title {
    font-size: 10px;
    color: var(--mt-text-secondary);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .mt-nudge-folders {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 14px;
  }
  .mt-nudge-folder-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: var(--mt-radius-sm);
    background: var(--mt-bg-secondary);
    transition: background 0.15s;
  }
  .mt-nudge-folder-row:hover {
    background: var(--mt-bg-elevated);
  }
  .mt-nudge-folder-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .mt-nudge-folder-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--mt-text-primary);
    flex: 1;
  }
  .mt-nudge-folder-count {
    font-size: 13px;
    font-weight: 700;
    color: var(--mt-accent);
  }
  .mt-nudge-cta {
    background: var(--mt-accent);
    color: white;
    border: none;
    padding: 11px 16px;
    border-radius: var(--mt-radius-sm);
    font-size: 13px;
    font-weight: 700;
    font-family: var(--mt-font-body);
    cursor: pointer;
    transition: all 0.2s;
    text-align: center;
  }
  .mt-nudge-cta:hover {
    background: var(--mt-accent-hover);
    box-shadow: var(--mt-shadow-glow);
    transform: translateY(-1px);
  }
`
