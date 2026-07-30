import { h } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { sendMessage } from '../../shared/messages'
import type { AppState } from '../../shared/types'
import { NowPlaying } from './sections/NowPlaying'
import { Library } from './sections/Library'
import { CollapsibleSection } from './components/CollapsibleSection'
import { FolderTree } from './components/FolderTree'
import { TagManager } from './components/TagManager'
import { SettingsPanel } from './components/SettingsPanel'
import { loadSettings, watchSettings } from '../../styles/theme'
import { I18nContext, t as translate, type Language, type TranslationKey } from '../../shared/i18n'
import { loadUIState, saveUIState } from '../../shared/ui-state'

interface SidebarProps {
  onClose: () => void
}

export function Sidebar({ onClose }: SidebarProps) {
  const [appState, setAppState] = useState<AppState | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [showNowPlaying, setShowNowPlaying] = useState(false)
  const [language, setLanguage] = useState<Language>('en')
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({ folders: true, library: true, tags: false })
  const [newVideoCounts, setNewVideoCounts] = useState<Record<string, number>>({})
  const [folderSelectMode, setFolderSelectMode] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollTimerRef = useRef<number>(0)

  const loadState = useCallback(async () => {
    try {
      const state = await sendMessage({ type: 'GET_STATE' })
      setAppState(state)
      setNewVideoCounts(state.newVideoCounts ?? {})
    } catch (err) {
      console.warn('[MyTube] Sidebar load error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refreshBadges = useCallback(async () => {
    try {
      const counts = await sendMessage({ type: 'GET_NEW_VIDEO_COUNTS' })
      setNewVideoCounts(counts)
    } catch (err) {
      console.warn('[MyTube] Badge refresh error:', err)
    }
  }, [])

  useEffect(() => {
    void loadState()
    void loadSettings().then((s) => {
      setShowNowPlaying(s.showNowPlaying)
      setLanguage(s.language as Language)
    })
    void loadUIState().then(s => {
      setSectionOpen(s.sectionOpen)
    })
    watchSettings((s) => {
      setShowNowPlaying(s.showNowPlaying)
      setLanguage(s.language as Language)
    })
    const storageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return
      if (changes['mytube-poll-seq']) void refreshBadges()
      if (changes['mytube_state']) void loadState()
    }
    chrome.storage.onChanged.addListener(storageListener)
    const handleSyncEvent = () => void loadState()
    document.addEventListener('mytube:state-updated', handleSyncEvent)
    return () => {
      chrome.storage.onChanged.removeListener(storageListener)
      document.removeEventListener('mytube:state-updated', handleSyncEvent)
    }
  }, [loadState, refreshBadges])

  const scrollRestoredRef = useRef(false)

  const handleFolderTreeReady = useCallback(() => {
    if (scrollRestoredRef.current) return
    scrollRestoredRef.current = true
    void loadUIState().then(s => {
      if (s.scrollTop > 0 && scrollRef.current) {
        scrollRef.current.scrollTop = s.scrollTop
      }
    })
  }, [])

  useEffect(() => {
    if (!appState || scrollRestoredRef.current) return
    const timer = window.setTimeout(() => {
      if (scrollRestoredRef.current) return
      scrollRestoredRef.current = true
      void loadUIState().then(s => {
        if (s.scrollTop > 0 && scrollRef.current) {
          scrollRef.current.scrollTop = s.scrollTop
        }
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [appState !== null])

  const handleStateChange = useCallback(() => {
    void loadState()
  }, [loadState])

  const handleMarkChannelRead = useCallback(async (channelId: string) => {
    setNewVideoCounts(prev => {
      const next = { ...prev }
      delete next[channelId]
      return next
    })
    await sendMessage({ type: 'MARK_CHANNEL_READ', payload: { channelId } })
  }, [])

  const handleOpenFeed = useCallback((folderId: string, folderName: string) => {
    document.dispatchEvent(new CustomEvent('mytube:open-feed', { detail: { folderId, folderName } }))
  }, [])

  const handleOpenHome = useCallback(() => {
    document.dispatchEvent(new CustomEvent('mytube:open-home'))
  }, [])

  const handleMarkAllRead = useCallback(async () => {
    setNewVideoCounts({})
    await sendMessage({ type: 'MARK_ALL_READ' })
  }, [])

  const handleSectionToggle = useCallback((key: string, isOpen: boolean) => {
    setSectionOpen(prev => {
      const next = { ...prev, [key]: isOpen }
      saveUIState({ sectionOpen: next })
      return next
    })
  }, [])

  const handleScroll = useCallback(() => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = window.setTimeout(() => {
      if (scrollRef.current) {
        saveUIState({ scrollTop: scrollRef.current.scrollTop })
      }
    }, 300)
  }, [])

  // Este componente MONTA o I18nContext.Provider (mais abaixo, no return), e um
  // componente não vê o próprio Provider: useT() aqui leria o default 'en' em vez
  // do idioma escolhido. Prova do defeito, da revisão: a mesma chave rendia
  // "Select" no cabeçalho da sidebar e "Selecionar" na Library, na mesma tela.
  // Quem tem o idioma no estado usa a forma standalone; os filhos, que estão
  // DENTRO do Provider, seguem com useT().
  const t = useCallback((key: TranslationKey) => translate(key, language), [language])
  const totalNewCount = Object.values(newVideoCounts).reduce((s, c) => s + c, 0)

  const sidebarStyle: h.JSX.CSSProperties = {
    position: 'relative',
    width: '420px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--mt-bg-primary)',
    color: 'var(--mt-text-primary)',
    fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-md)',
    overflow: 'hidden',
    borderLeft: '1px solid var(--mt-border)',
  }

  const headerStyle: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '18px 16px 14px',
    borderBottom: '1px solid var(--mt-border)',
    flexShrink: 0,
    position: 'relative',
    zIndex: 10,
  }

  const logoStyle: h.JSX.CSSProperties = {
    fontFamily: 'var(--mt-font-display)',
    fontWeight: 800,
    fontSize: 'var(--mt-font-size-xl)',
    color: 'var(--mt-accent)',
    letterSpacing: '-0.03em',
    lineHeight: 1,
    flexShrink: 0,
  }

  const equalizerStyle: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '2.5px',
    height: '14px',
    flexShrink: 0,
    marginLeft: '2px',
  }

  function eqBarStyle(height: number, duration: number, delay: number): h.JSX.CSSProperties {
    return {
      width: '3px',
      height: `${height}px`,
      backgroundColor: 'var(--mt-accent)',
      borderRadius: '2px',
      animation: `eq-bounce ${duration}s ease-in-out infinite alternate`,
      animationDelay: `${delay}s`,
      transformOrigin: 'bottom',
    }
  }

  const headerActionsStyle: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    marginLeft: 'auto',
  }

  const pillBtnStyle: h.JSX.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 10px',
    borderRadius: 'var(--mt-radius-pill)',
    border: '1px solid var(--mt-btn-border)',
    backgroundColor: 'var(--mt-btn-bg)',
    color: 'var(--mt-text-primary)',
    fontFamily: 'var(--mt-font-body)',
    fontWeight: 600,
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'background 0.18s, border-color 0.18s, transform 0.12s',
    lineHeight: 1,
    whiteSpace: 'nowrap',
  }

  const roundBtnStyle: h.JSX.CSSProperties = {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: '1px solid var(--mt-btn-border)',
    backgroundColor: 'var(--mt-btn-bg)',
    color: 'var(--mt-text-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'background 0.18s, color 0.18s, transform 0.12s',
    flexShrink: 0,
  }

  const scrollAreaStyle: h.JSX.CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '14px 14px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  }

  const loadingStyle: h.JSX.CSSProperties = {
    color: 'var(--mt-text-secondary)',
    fontSize: 'var(--mt-font-size-sm)',
    textAlign: 'center',
    paddingTop: '48px',
    fontFamily: 'var(--mt-font-body)',
  }

  const dividerStyle: h.JSX.CSSProperties = {
    height: '1px',
    backgroundColor: 'var(--mt-border)',
    margin: '2px 0',
  }

  const footerStyle: h.JSX.CSSProperties = {
    padding: '10px 16px 14px',
    borderTop: '1px solid var(--mt-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    flexShrink: 0,
  }

  const footerHintStyle: h.JSX.CSSProperties = {
    fontSize: '11px',
    color: 'var(--mt-text-secondary)',
    fontWeight: 500,
  }

  const footerStatsStyle: h.JSX.CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--mt-text-secondary)',
    backgroundColor: 'var(--mt-bg-elevated)',
    border: '1px solid var(--mt-border)',
    borderRadius: 'var(--mt-radius-pill)',
    padding: '3px 10px',
  }

  return (
    <I18nContext.Provider value={language}>
      <div style={sidebarStyle}>
        <div style={headerStyle}>
          <span style={logoStyle}>MyTube</span>
          <div style={equalizerStyle} aria-hidden="true">
            <div style={eqBarStyle(6, 0.7, 0)} />
            <div style={eqBarStyle(12, 0.9, 0.15)} />
            <div style={eqBarStyle(8, 0.65, 0.3)} />
            <div style={eqBarStyle(14, 0.8, 0.1)} />
          </div>
          <button
            class="mt-btn-pill"
            style={{
              ...pillBtnStyle,
              ...(totalNewCount > 0
                ? { backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--mt-error, #ef4444)', borderColor: 'rgba(239,68,68,0.3)' }
                : {}),
            }}
            onClick={handleOpenHome}
            title={t('home.open')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            {totalNewCount > 0 && <span>{totalNewCount}</span>}
          </button>
          <div style={headerActionsStyle}>
            {totalNewCount > 0 && (
              <button
                class="mt-btn-round"
                style={{ ...roundBtnStyle, backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--mt-error, #ef4444)', borderColor: 'rgba(239,68,68,0.3)' }}
                onClick={() => void handleMarkAllRead()}
                title={t('badge.markAllRead')}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            )}
            <button class="mt-btn-round" style={roundBtnStyle} onClick={() => { window.location.href = 'https://www.youtube.com/feed/channels' }} title={t('sidebar.syncSubs')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </button>
            <button class="mt-btn-round" style={roundBtnStyle} onClick={() => { window.location.href = 'https://www.youtube.com/feed/playlists' }} title={t('sidebar.syncLists')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
            <button class="mt-btn-round" style={roundBtnStyle} onClick={() => setSettingsOpen(p => !p)} title={t('sidebar.settings')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <button class="mt-btn-round" style={roundBtnStyle} onClick={onClose} title={`${t('sidebar.close')} (⌘.)`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {settingsOpen && (
          <SettingsPanel onStateChange={handleStateChange} onClose={() => setSettingsOpen(false)} />
        )}

        <div ref={scrollRef} style={scrollAreaStyle} onScroll={handleScroll}>
          {isLoading || !appState ? (
            <div style={loadingStyle}>{t('sidebar.loading')}</div>
          ) : (
            <>
              {showNowPlaying && (
                <NowPlaying appState={appState} onStateChange={handleStateChange} />
              )}

              <CollapsibleSection
                title={t('sidebar.folders')}
                badge={appState.folders.filter(f => f.parentId === null).length}
                open={sectionOpen.folders ?? true}
                onToggle={(v) => handleSectionToggle('folders', v)}
                headerAction={
                  <button
                    style={{
                      padding: '2px 10px',
                      borderRadius: 'var(--mt-radius-pill)',
                      fontSize: '10px',
                      fontFamily: 'var(--mt-font-body)',
                      fontWeight: folderSelectMode ? 600 : 400,
                      cursor: 'pointer',
                      border: folderSelectMode ? '1px solid transparent' : '1px solid var(--mt-btn-border)',
                      background: folderSelectMode
                        ? 'linear-gradient(135deg, var(--mt-accent), var(--mt-accent-hover))'
                        : 'var(--mt-btn-bg)',
                      color: folderSelectMode ? '#ffffff' : 'var(--mt-text-secondary)',
                      whiteSpace: 'nowrap',
                      userSelect: 'none',
                      transition: 'background 0.12s, color 0.12s',
                      lineHeight: 1,
                    }}
                    onClick={() => setFolderSelectMode(prev => !prev)}
                    type="button"
                  >
                    {folderSelectMode ? t('library.cancel') : t('library.select')}
                  </button>
                }
              >
                <FolderTree
                  folders={appState.folders}
                  organizables={appState.organizables}
                  tags={appState.tags}
                  newVideoCounts={newVideoCounts}
                  onMarkChannelRead={handleMarkChannelRead}
                  onRefresh={handleStateChange}
                  onOpenFeed={handleOpenFeed}
                  selectMode={folderSelectMode}
                  onSetSelectMode={setFolderSelectMode}
                  onReady={handleFolderTreeReady}
                />
              </CollapsibleSection>

              <div style={dividerStyle} />

              <CollapsibleSection title={t('sidebar.library')} badge={appState.organizables.length} open={sectionOpen.library ?? true} onToggle={(v) => handleSectionToggle('library', v)}>
                <Library appState={appState} newVideoCounts={newVideoCounts} onMarkChannelRead={handleMarkChannelRead} onStateChange={handleStateChange} />
              </CollapsibleSection>

              <div style={dividerStyle} />

              <CollapsibleSection title={t('sidebar.tags')} badge={appState.tags.length} open={sectionOpen.tags ?? false} onToggle={(v) => handleSectionToggle('tags', v)}>
                <TagManager tags={appState.tags} onRefresh={handleStateChange} />
              </CollapsibleSection>
            </>
          )}
        </div>

        {appState && (
          <div style={footerStyle}>
            <span style={footerHintStyle}>{t('sidebar.tagline')}</span>
            <span style={footerStatsStyle}>{appState.organizables.length} {t('sidebar.items')} · {appState.folders.length} {t('sidebar.folders').toLowerCase()}</span>
          </div>
        )}
      </div>
    </I18nContext.Provider>
  )
}
