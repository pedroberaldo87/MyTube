import { h } from 'preact'
import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { ExportImport } from './ExportImport'
import { AISection } from './AISection'
import {
  loadSettings,
  saveSetting,
  ACCENT_COLORS,
  type StyleTheme,
  type AccentColor,
  type SidebarPosition,
  type HomeNudgeMode,
  type AppSettings,
} from '../../../styles/theme'
import { useT } from '../../../shared/i18n'
import { sendMessage } from '../../../shared/messages'
import { loadUIState, saveUIState, type HomeMode } from '../../../shared/ui-state'

interface SettingsPanelProps {
  onStateChange: () => void
  onClose: () => void
}

// ── Estilos compartilhados do painel ────────────────────────────────────────
// No escopo do módulo porque quem desenha uma seção do painel não é só este
// arquivo: AISection.tsx importa daqui para a seção de IA nascer com a MESMA
// linguagem visual das vizinhas, em vez de reinventar título, linha e botão.

export const sectionStyle: h.JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
}

export const sectionTitleStyle: h.JSX.CSSProperties = {
  fontSize: 'var(--mt-font-size-xs)',
  fontWeight: 700,
  fontFamily: 'var(--mt-font-display)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--mt-text-secondary)',
  marginBottom: '2px',
}

export const rowStyle: h.JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
}

export function optionBtnStyle(active: boolean): h.JSX.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '36px',
    minHeight: '36px',
    padding: '6px 12px',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    fontWeight: active ? 600 : 400,
    lineHeight: 1,
    borderRadius: 'var(--mt-radius-sm)',
    cursor: 'pointer',
    transition: 'var(--mt-transition-fast)',
    backgroundColor: active ? 'var(--mt-accent-soft)' : 'var(--mt-btn-bg)',
    border: active
      ? '2px solid var(--mt-accent)'
      : '1px solid var(--mt-btn-border)',
    color: active ? 'var(--mt-accent)' : 'var(--mt-text-secondary)',
  }
}

export function SettingsPanel({ onStateChange, onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [homeMode, setHomeMode] = useState<HomeMode>('new-only')
  const [homeLatestCount, setHomeLatestCount] = useState(5)
  const [homeFoldersExpanded, setHomeFoldersExpanded] = useState(true)
  const [countSaved, setCountSaved] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadSettings().then(setSettings)
    void loadUIState().then(s => {
      setHomeMode(s.homeMode)
      setHomeLatestCount(s.homeLatestCount)
      setHomeFoldersExpanded(s.homeFoldersExpanded)
    })
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleBackdropClick = useCallback(
    (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    },
    [onClose],
  )

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => prev ? { ...prev, [key]: value } : prev)
    void saveSetting(key, value)
  }

  const t = useT()

  if (!settings) return null

  // ── Styles ──────────────────────────────────────────────────────────────

  const backdropStyle: h.JSX.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 50,
    animation: 'mt-fade-in 0.15s ease-out',
  }

  const panelStyle: h.JSX.CSSProperties = {
    position: 'absolute',
    top: '49px',
    left: 0,
    right: 0,
    zIndex: 51,
    maxHeight: 'calc(100% - 49px)',
    overflowY: 'auto',
    overflowX: 'hidden',
    backgroundColor: 'var(--mt-glass-bg)',
    backdropFilter: 'blur(12px)',
    borderBottom: '1px solid var(--mt-accent)',
    boxShadow: 'var(--mt-shadow-md)',
    padding: 'var(--mt-spacing-lg)',
    animation: 'mt-slide-down 0.2s ease-out',
  }

  const dividerStyle: h.JSX.CSSProperties = {
    height: '1px',
    backgroundColor: 'var(--mt-border)',
    margin: '14px 0',
  }

  function accentSwatchStyle(hex: string, active: boolean): h.JSX.CSSProperties {
    return {
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      backgroundColor: hex,
      border: active ? '3px solid var(--mt-text-primary)' : '2px solid transparent',
      cursor: 'pointer',
      transition: 'var(--mt-transition-fast)',
      boxShadow: active ? `0 0 10px ${hex}50` : 'none',
      outline: 'none',
    }
  }

  const toggleRowStyle: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  }

  const toggleLabelStyle: h.JSX.CSSProperties = {
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    color: 'var(--mt-text-primary)',
  }

  function toggleStyle(on: boolean): h.JSX.CSSProperties {
    return {
      width: '40px',
      height: '22px',
      borderRadius: '11px',
      backgroundColor: on ? 'var(--mt-accent)' : 'var(--mt-btn-bg)',
      border: on ? 'none' : '1px solid var(--mt-btn-border)',
      cursor: 'pointer',
      position: 'relative',
      transition: 'var(--mt-transition-fast)',
      flexShrink: 0,
    }
  }

  function toggleKnobStyle(on: boolean): h.JSX.CSSProperties {
    return {
      width: '18px',
      height: '18px',
      borderRadius: '50%',
      backgroundColor: on ? '#ffffff' : 'var(--mt-text-secondary)',
      position: 'absolute',
      top: '2px',
      left: on ? '20px' : '2px',
      transition: 'var(--mt-transition-fast)',
    }
  }

  const flagBtnBase: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '36px',
    minHeight: '36px',
    padding: '6px',
    fontSize: '24px',
    lineHeight: 1,
    borderRadius: 'var(--mt-radius-sm)',
    cursor: 'pointer',
    transition: 'var(--mt-transition-fast)',
  }

  function flagStyle(isActive: boolean): h.JSX.CSSProperties {
    return {
      ...flagBtnBase,
      backgroundColor: isActive ? 'var(--mt-accent-soft)' : 'var(--mt-btn-bg)',
      border: isActive
        ? '2px solid var(--mt-accent)'
        : '1px solid var(--mt-btn-border)',
    }
  }

  const versionStyle: h.JSX.CSSProperties = {
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-display)',
    fontWeight: 700,
    color: 'var(--mt-accent)',
  }

  const taglineStyle: h.JSX.CSSProperties = {
    fontSize: 'var(--mt-font-size-xs)',
    fontFamily: 'var(--mt-font-body)',
    fontStyle: 'italic',
    color: 'var(--mt-text-secondary)',
  }

  return (
    <div>
      <div style={backdropStyle} onClick={handleBackdropClick} />
      <div ref={panelRef} style={panelStyle}>

        {/* Theme */}
        <div style={sectionStyle}>
          <span style={sectionTitleStyle}>{t('settings.theme')}</span>
          <div style={rowStyle}>
            <button
              style={optionBtnStyle(settings.theme === 'prism')}
              onClick={() => updateSetting('theme', 'prism' as StyleTheme)}
            >
              {t('settings.prism')}
            </button>
            <button
              style={optionBtnStyle(settings.theme === 'void')}
              onClick={() => updateSetting('theme', 'void' as StyleTheme)}
            >
              {t('settings.void')}
            </button>
          </div>
        </div>

        {/* Accent color (Prism only) */}
        {settings.theme === 'prism' && (
          <>
            <div style={{ ...sectionStyle, marginTop: '12px' }}>
              <span style={sectionTitleStyle}>{t('settings.accent')}</span>
              <div style={rowStyle}>
                {ACCENT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    style={accentSwatchStyle(c.hex, settings.accent === c.id)}
                    onClick={() => updateSetting('accent', c.id as AccentColor)}
                    title={c.label}
                    aria-label={c.label}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        <div style={dividerStyle} />

        {/* Sidebar position */}
        <div style={sectionStyle}>
          <span style={sectionTitleStyle}>{t('settings.position')}</span>
          <div style={rowStyle}>
            <button
              style={optionBtnStyle(settings.position === 'left')}
              onClick={() => updateSetting('position', 'left' as SidebarPosition)}
            >
              {t('settings.left')}
            </button>
            <button
              style={optionBtnStyle(settings.position === 'right')}
              onClick={() => updateSetting('position', 'right' as SidebarPosition)}
            >
              {t('settings.right')}
            </button>
          </div>
        </div>

        <div style={dividerStyle} />

        {/* Home entry mode */}
        <div style={sectionStyle}>
          <span style={sectionTitleStyle}>{t('settings.homeEntry')}</span>
          <div style={rowStyle}>
            <button
              style={optionBtnStyle(settings.homeNudgeMode === 'card')}
              onClick={() => updateSetting('homeNudgeMode', 'card' as HomeNudgeMode)}
            >
              {t('settings.homeEntryCard')}
            </button>
            <button
              style={optionBtnStyle(settings.homeNudgeMode === 'tab-vertical')}
              onClick={() => updateSetting('homeNudgeMode', 'tab-vertical' as HomeNudgeMode)}
            >
              {t('settings.homeEntryTabV')}
            </button>
            <button
              style={optionBtnStyle(settings.homeNudgeMode === 'tab-horizontal')}
              onClick={() => updateSetting('homeNudgeMode', 'tab-horizontal' as HomeNudgeMode)}
            >
              {t('settings.homeEntryTabH')}
            </button>
            <button
              style={optionBtnStyle(settings.homeNudgeMode === 'off')}
              onClick={() => updateSetting('homeNudgeMode', 'off' as HomeNudgeMode)}
            >
              {t('settings.homeEntryOff')}
            </button>
          </div>
        </div>

        <div style={dividerStyle} />

        {/* Now Playing toggle */}
        <div style={sectionStyle}>
          <div style={toggleRowStyle}>
            <span style={toggleLabelStyle}>{t('settings.nowPlaying')}</span>
            <button
              style={toggleStyle(settings.showNowPlaying)}
              onClick={() => updateSetting('showNowPlaying', !settings.showNowPlaying)}
              aria-label="Toggle Now Playing"
            >
              <div style={toggleKnobStyle(settings.showNowPlaying)} />
            </button>
          </div>
        </div>

        <div style={dividerStyle} />

        {/* Language */}
        <div style={sectionStyle}>
          <span style={sectionTitleStyle}>{t('settings.language')}</span>
          <div style={rowStyle}>
            <button
              style={flagStyle(settings.language === 'en')}
              onClick={() => updateSetting('language', 'en')}
              aria-label="English"
              title="English"
            >
              {'🇺🇸'}
            </button>
            <button
              style={flagStyle(settings.language === 'pt-BR')}
              onClick={() => updateSetting('language', 'pt-BR')}
              aria-label="Português (Brasil)"
              title="Português (Brasil)"
            >
              {'🇧🇷'}
            </button>
          </div>
        </div>

        <div style={dividerStyle} />

        {/* Home feed mode */}
        <div style={sectionStyle}>
          <span style={sectionTitleStyle}>{t('home.settingsTitle')}</span>
          <div style={rowStyle}>
            <button
              style={optionBtnStyle(homeMode === 'new-only')}
              onClick={() => { setHomeMode('new-only'); saveUIState({ homeMode: 'new-only' }) }}
            >
              {t('home.modeNewOnly')}
            </button>
            <button
              style={optionBtnStyle(homeMode === 'latest')}
              onClick={() => { setHomeMode('latest'); saveUIState({ homeMode: 'latest' }) }}
            >
              {t('home.modeLatest')}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="number"
              min={1}
              max={50}
              value={homeLatestCount}
              onChange={(e) => {
                const v = Math.max(1, Math.min(50, Number((e.target as HTMLInputElement).value) || 1))
                setHomeLatestCount(v)
                saveUIState({ homeLatestCount: v })
                setCountSaved(true)
                setTimeout(() => setCountSaved(false), 1500)
              }}
              style={{
                width: '48px',
                padding: '6px 4px',
                fontSize: 'var(--mt-font-size-sm)',
                fontFamily: 'var(--mt-font-body)',
                borderRadius: 'var(--mt-radius-sm)',
                border: '1px solid var(--mt-btn-border)',
                backgroundColor: 'var(--mt-btn-bg)',
                color: 'var(--mt-text-primary)',
                textAlign: 'center',
              }}
            />
            <span style={{ fontSize: 'var(--mt-font-size-sm)', color: 'var(--mt-text-secondary)' }}>
              {t('home.videosPerChannel')}
            </span>
            {countSaved && (
              <span style={{ fontSize: 'var(--mt-font-size-xs)', color: 'var(--mt-accent)', fontWeight: 600, transition: 'opacity 0.3s' }}>
                ✓
              </span>
            )}
          </div>
          <div style={toggleRowStyle}>
            <span style={toggleLabelStyle}>{t('home.foldersExpanded')}</span>
            <button
              style={toggleStyle(homeFoldersExpanded)}
              onClick={() => {
                const next = !homeFoldersExpanded
                setHomeFoldersExpanded(next)
                saveUIState({ homeFoldersExpanded: next })
              }}
              aria-label="Toggle folders expanded"
            >
              <div style={toggleKnobStyle(homeFoldersExpanded)} />
            </button>
          </div>
          <div style={toggleRowStyle}>
            <span style={toggleLabelStyle}>{t('settings.openNewTab')}</span>
            <button
              style={toggleStyle(settings.openInNewTab)}
              onClick={() => updateSetting('openInNewTab', !settings.openInNewTab)}
              aria-label="Toggle open in new tab"
            >
              <div style={toggleKnobStyle(settings.openInNewTab)} />
            </button>
          </div>
        </div>

        <div style={dividerStyle} />

        {/* AI — a configuração inteira mora AQUI: a interface do app é a sidebar,
            e um botão que abrisse página cheia seria teleporte, não conserto. */}
        <AISection />

        <div style={dividerStyle} />

        {/* Data */}
        <div style={sectionStyle}>
          <span style={sectionTitleStyle}>{t('settings.data')}</span>
          <ExportImport onStateChange={onStateChange} />
          <button
            style={{ marginTop: '8px', padding: '6px 12px', borderRadius: 'var(--mt-radius-md)', border: '1px solid var(--mt-border)', backgroundColor: 'var(--mt-btn-bg)', color: 'var(--mt-text-secondary)', fontSize: 'var(--mt-font-size-sm)', cursor: 'pointer' }}
            onClick={async () => {
              await sendMessage({ type: 'MUTE_ALL_CHANNELS' })
              onStateChange()
            }}
          >🔇 {t('settings.muteAll')}</button>
        </div>

        <div style={dividerStyle} />

        {/* About */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={versionStyle}>MyTube v1.0.0</span>
          <span style={taglineStyle}>{t('settings.tagline')}</span>
        </div>
      </div>
    </div>
  )
}
