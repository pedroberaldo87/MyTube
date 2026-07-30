import { h } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks'
import { sendMessage } from '../../shared/messages'
import { loadUIState } from '../../shared/ui-state'
import { loadSettings } from '../../styles/theme'
import { useT, I18nContext } from '../../shared/i18n'
import type { FeedVideo, HomeFeedFolder } from '../../shared/types'

interface HomePageProps {
  onClose: () => void
}

const CHANNEL_COLORS = [
  '#e5534b', '#c4432b', '#d4764e', '#d2995c',
  '#57ab5a', '#39825a', '#539bf5', '#6cb6ff',
]

function channelColor(channelId: string): string {
  let hash = 0
  for (let i = 0; i < channelId.length; i++) {
    hash = ((hash << 5) - hash + channelId.charCodeAt(i)) | 0
  }
  return CHANNEL_COLORS[Math.abs(hash) % CHANNEL_COLORS.length]
}

function timeAgo(timestamp: number, pt: boolean): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return pt ? 'agora' : 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return pt ? `há ${minutes}min` : `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return pt ? `há ${hours}h` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return pt ? `há ${days}d` : `${days}d ago`
  const months = Math.floor(days / 30)
  return pt ? `há ${months} meses` : `${months}mo ago`
}

export function HomePage({ onClose }: HomePageProps) {
  const t = useT()
  const lang = useContext(I18nContext)
  const isPt = lang === 'pt-BR'
  const [folders, setFolders] = useState<HomeFeedFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsedChannels, setCollapsedChannels] = useState<Set<string>>(new Set())
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [foldersDefaultExpanded, setFoldersDefaultExpanded] = useState(true)
  const [openInNewTab, setOpenInNewTab] = useState(true)
  const [watchLaterStatus, setWatchLaterStatus] = useState<Record<string, 'saving' | 'saved' | 'error'>>({})

  useEffect(() => {
    void loadSettings().then(s => setOpenInNewTab(s.openInNewTab))
  }, [])

  // Watch Later round-trip: page-bridge (MAIN world) does the InnerTube call and
  // replies over postMessage. event.detail can't cross worlds, so we use messages.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window) return
      const d = e.data as { __mytube?: string; videoId?: string; ok?: boolean } | null
      if (!d || d.__mytube !== 'watch-later-result' || typeof d.videoId !== 'string') return
      setWatchLaterStatus(prev => ({ ...prev, [d.videoId as string]: d.ok ? 'saved' : 'error' }))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    void loadUIState().then(s => {
      setFoldersDefaultExpanded(s.homeFoldersExpanded)
      setLoading(true)
      setError(null)
      sendMessage({ type: 'GET_HOME_FEED', payload: { mode: s.homeMode, latestCount: s.homeLatestCount } })
        .then(result => {
          if (Array.isArray(result)) {
            setFolders(result)
            if (!s.homeFoldersExpanded) {
              setCollapsedFolders(new Set(result.map(f => f.folderId)))
            }
          } else {
            setFolders([])
          }
        })
        .catch(() => setError(t('error.loadHomeFeed')))
        .finally(() => setLoading(false))
    })
  }, [])

  const totalNewVideos = useMemo(() => {
    return folders.reduce((sum, f) =>
      sum + f.channels.reduce((s, ch) => s + ch.newCount, 0), 0)
  }, [folders])

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

  const toggleChannel = useCallback((channelId: string) => {
    setCollapsedChannels(prev => {
      const next = new Set(prev)
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      return next
    })
  }, [])

  const handleVideoClick = useCallback((url: string) => {
    if (openInNewTab) {
      window.open(url, '_blank')
    } else {
      onClose()
      setTimeout(() => { window.location.href = url }, 100)
    }
  }, [onClose, openInNewTab])

  const handleMarkChannelRead = useCallback(async (channelId: string) => {
    await sendMessage({ type: 'MARK_CHANNEL_READ', payload: { channelId } })
    setFolders(prev => prev
      .map(f => ({
        ...f,
        channels: f.channels.filter(ch => ch.channelId !== channelId),
      }))
      .filter(f => f.channels.length > 0))
  }, [])

  const handleMarkAllRead = useCallback(async () => {
    await sendMessage({ type: 'MARK_ALL_READ' })
    setFolders([])
  }, [])

  const handleDismissVideo = useCallback(async (video: FeedVideo) => {
    await sendMessage({
      type: 'ADD_WATCH_ENTRY',
      payload: { videoId: video.videoId, channelId: video.channelId, title: video.title, watchedAt: Date.now() },
    })
    setFolders(prev => prev
      .map(f => ({
        ...f,
        channels: f.channels
          .map(ch => ({
            ...ch,
            videos: ch.videos.filter(v => v.videoId !== video.videoId),
          }))
          .filter(ch => ch.videos.length > 0),
      }))
      .filter(f => f.channels.length > 0))
  }, [])

  const handleAddWatchLater = useCallback((videoId: string) => {
    setWatchLaterStatus(prev => {
      if (prev[videoId] === 'saving' || prev[videoId] === 'saved') return prev
      return { ...prev, [videoId]: 'saving' }
    })
    window.postMessage({ __mytube: 'add-to-watch-later', videoId }, window.location.origin)
  }, [])

  // ── Styles ─────────────────────────────────────────────────

  const page: h.JSX.CSSProperties = {
    maxWidth: '960px',
    margin: '0 auto',
    padding: '32px 24px',
    fontFamily: 'var(--mt-font-body)',
    color: 'var(--mt-text-primary)',
    minHeight: '100vh',
  }

  const header: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px',
  }

  const backBtn: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    border: '1px solid var(--mt-border)',
    backgroundColor: 'var(--mt-btn-bg)',
    color: 'var(--mt-text-primary)',
    cursor: 'pointer',
    fontSize: '18px',
    flexShrink: 0,
    transition: 'background 0.15s',
  }

  const titleStyle: h.JSX.CSSProperties = {
    fontFamily: 'var(--mt-font-display)',
    fontWeight: 800,
    fontSize: '24px',
    flex: 1,
  }

  const controlsBar: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '20px',
    fontSize: 'var(--mt-font-size-sm)',
    color: 'var(--mt-text-secondary)',
  }

  const markAllBtn: h.JSX.CSSProperties = {
    marginLeft: 'auto',
    padding: '4px 12px',
    borderRadius: 'var(--mt-radius-pill)',
    border: '1px solid var(--mt-border)',
    backgroundColor: 'var(--mt-btn-bg)',
    color: 'var(--mt-text-secondary)',
    cursor: 'pointer',
    fontSize: 'var(--mt-font-size-sm)',
    transition: 'background 0.15s, color 0.15s',
  }

  const folderSection: h.JSX.CSSProperties = {
    marginBottom: '28px',
  }

  const folderHeader: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '14px',
    paddingBottom: '8px',
    borderBottom: '2px solid var(--mt-border)',
    cursor: 'pointer',
    userSelect: 'none',
  }

  const folderDot: (color: string) => h.JSX.CSSProperties = (color) => ({
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: color,
    flexShrink: 0,
  })

  const folderNameStyle: h.JSX.CSSProperties = {
    fontFamily: 'var(--mt-font-display)',
    fontWeight: 700,
    fontSize: '18px',
    flex: 1,
  }

  const folderCountStyle: h.JSX.CSSProperties = {
    fontSize: 'var(--mt-font-size-sm)',
    color: 'var(--mt-text-secondary)',
  }

  const channelSection: h.JSX.CSSProperties = {
    marginBottom: '12px',
    marginLeft: '12px',
    borderRadius: 'var(--mt-radius-md)',
    border: '1px solid var(--mt-border)',
    overflow: 'hidden',
  }

  const channelHeaderStyle: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 16px',
    cursor: 'pointer',
    backgroundColor: 'var(--mt-bg-secondary)',
    transition: 'background 0.15s',
    userSelect: 'none',
  }

  const channelAvatarStyle: h.JSX.CSSProperties = {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 700,
    flexShrink: 0,
  }

  const channelNameStyle: h.JSX.CSSProperties = {
    fontWeight: 600,
    fontSize: 'var(--mt-font-size-md)',
    fontFamily: 'var(--mt-font-body)',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }

  const newBadge: h.JSX.CSSProperties = {
    padding: '2px 8px',
    borderRadius: 'var(--mt-radius-pill)',
    backgroundColor: '#ef4444',
    color: '#fff',
    fontSize: '11px',
    fontWeight: 700,
    flexShrink: 0,
  }

  const channelMarkReadBtn: h.JSX.CSSProperties = {
    padding: '2px 8px',
    borderRadius: 'var(--mt-radius-pill)',
    border: '1px solid var(--mt-border)',
    backgroundColor: 'transparent',
    color: 'var(--mt-text-secondary)',
    cursor: 'pointer',
    fontSize: '11px',
    flexShrink: 0,
    transition: 'background 0.15s',
  }

  const grid: h.JSX.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '14px',
    padding: '12px',
  }

  const card: h.JSX.CSSProperties = {
    borderRadius: 'var(--mt-radius-md)',
    border: '1px solid var(--mt-border)',
    backgroundColor: 'var(--mt-bg-secondary)',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  }

  const thumbStyle: h.JSX.CSSProperties = {
    width: '100%',
    aspectRatio: '16/9',
    objectFit: 'cover',
    display: 'block',
    backgroundColor: 'var(--mt-bg-elevated)',
  }

  const cardBody: h.JSX.CSSProperties = {
    padding: '10px 12px',
  }

  const videoTitle: h.JSX.CSSProperties = {
    fontWeight: 600,
    fontSize: 'var(--mt-font-size-md)',
    lineHeight: 1.3,
    marginBottom: '4px',
    display: '-webkit-box',
    WebkitLineClamp: '2',
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  }

  const metaStyle: h.JSX.CSSProperties = {
    fontSize: 'var(--mt-font-size-xs)',
    color: 'var(--mt-text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  }

  const emptyStyle: h.JSX.CSSProperties = {
    textAlign: 'center',
    padding: '80px 24px',
    color: 'var(--mt-text-secondary)',
    fontSize: 'var(--mt-font-size-lg)',
  }

  return (
    <div style={page}>
      <div style={header}>
        <button style={backBtn} onClick={onClose} title="Back to YouTube">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span style={titleStyle}>{t('home.open')}</span>
        <span style={{ fontSize: 'var(--mt-font-size-sm)', color: 'var(--mt-text-secondary)' }}>
          {loading ? '...' : `${totalNewVideos} ${t('home.new')}`}
        </span>
      </div>

      <div style={controlsBar}>
        {totalNewVideos > 0 && (
          <button style={markAllBtn} onClick={() => void handleMarkAllRead()}>
            {t('home.markAllRead')}
          </button>
        )}
      </div>

      {loading && (
        <div style={emptyStyle}>{t('home.loading')}</div>
      )}

      {error && (
        <div style={{ ...emptyStyle, color: 'var(--mt-error)' }}>{error}</div>
      )}

      {!loading && !error && folders.length === 0 && (
        <div style={emptyStyle}>
          {t('home.empty')}
        </div>
      )}

      {!loading && !error && folders.map(folder => {
        const folderNewCount = folder.channels.reduce((s, ch) => s + ch.newCount, 0)
        const isFolderCollapsed = collapsedFolders.has(folder.folderId)
        return (
          <div key={folder.folderId} style={folderSection}>
            <div style={folderHeader} onClick={() => toggleFolder(folder.folderId)}>
              <span style={{
                fontSize: '14px',
                color: 'var(--mt-text-secondary)',
                transition: 'transform 0.15s',
                transform: isFolderCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                flexShrink: 0,
              }}>›</span>
              <div style={folderDot(folder.folderColor)} />
              <span style={folderNameStyle}>{folder.folderName}</span>
              <span style={folderCountStyle}>
                {folderNewCount} {t('home.new')} · {folder.channels.length} ch
              </span>
            </div>

            {!isFolderCollapsed && folder.channels.map(channel => {
              const color = channelColor(channel.channelId)
              const isCollapsed = collapsedChannels.has(channel.channelId)
              const visibleVideos = channel.videos

              return (
                <div key={channel.channelId} style={channelSection}>
                  <div style={channelHeaderStyle} onClick={() => toggleChannel(channel.channelId)}>
                    <div style={{ ...channelAvatarStyle, backgroundColor: color }}>
                      {channel.channelName.charAt(0).toUpperCase()}
                    </div>
                    <span style={channelNameStyle}>{channel.channelName}</span>
                    <span style={newBadge}>{channel.newCount} {t('home.new')}</span>
                    <button
                      style={channelMarkReadBtn}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleMarkChannelRead(channel.channelId)
                      }}
                      title={t('home.read')}
                    >
                      {t('home.read')}
                    </button>
                    <span style={{
                      fontSize: '16px',
                      color: 'var(--mt-text-secondary)',
                      transition: 'transform 0.15s',
                      transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                    }}>›</span>
                  </div>

                  {!isCollapsed && visibleVideos.length > 0 && (
                    <div style={grid}>
                      {visibleVideos.map(video => (
                        <div
                          key={video.videoId}
                          style={{
                            ...card,
                            ...(video.isNew ? { borderColor: 'var(--mt-accent)', boxShadow: '0 0 0 2px var(--mt-accent)' } : {}),
                          }}
                          class="mt-feed-card"
                          onClick={() => handleVideoClick(video.url)}
                        >
                          <div style={{ position: 'relative' }}>
                            {video.thumbnailUrl ? (
                              <img
                                src={video.thumbnailUrl}
                                alt=""
                                style={thumbStyle}
                                loading="lazy"
                              />
                            ) : (
                              <div style={{ ...thumbStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mt-text-secondary)', fontSize: '32px' }}>
                                ▶
                              </div>
                            )}
                            {video.isNew && (
                              <span style={{
                                position: 'absolute',
                                top: '8px',
                                left: '8px',
                                padding: '3px 10px',
                                borderRadius: 'var(--mt-radius-pill)',
                                backgroundColor: 'var(--mt-accent)',
                                color: '#fff',
                                fontSize: '11px',
                                fontWeight: 700,
                                letterSpacing: '0.04em',
                                lineHeight: 1.4,
                                boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                              }}>NEW</span>
                            )}
                            {video.duration && (
                              <span style={{
                                position: 'absolute',
                                bottom: '6px',
                                right: '6px',
                                padding: '3px 8px',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(0,0,0,0.85)',
                                color: '#fff',
                                fontSize: '12px',
                                fontWeight: 600,
                                fontFamily: 'var(--mt-font-body)',
                              }}>{video.duration}</span>
                            )}
                            <button
                              class="mt-watchlater-toggle"
                              style={{
                                position: 'absolute',
                                top: '8px',
                                right: '44px',
                                width: '28px',
                                height: '28px',
                                borderRadius: '50%',
                                border: 'none',
                                backgroundColor:
                                  watchLaterStatus[video.videoId] === 'saved' ? 'var(--mt-accent)'
                                  : watchLaterStatus[video.videoId] === 'error' ? 'rgba(239,68,68,0.85)'
                                  : 'rgba(0,0,0,0.6)',
                                color: '#fff',
                                cursor: watchLaterStatus[video.videoId] === 'saving' ? 'default' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: watchLaterStatus[video.videoId] === 'saving' ? 0.4
                                  : watchLaterStatus[video.videoId] ? 1 : 0.5,
                                zIndex: 2,
                                boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                                transition: 'background-color 0.15s, opacity 0.15s',
                                padding: 0,
                              }}
                              onClick={(e) => { e.stopPropagation(); handleAddWatchLater(video.videoId) }}
                              disabled={watchLaterStatus[video.videoId] === 'saving' || watchLaterStatus[video.videoId] === 'saved'}
                              title={
                                watchLaterStatus[video.videoId] === 'saved' ? t('home.watchLaterDone')
                                : watchLaterStatus[video.videoId] === 'error' ? t('home.watchLaterError')
                                : t('home.watchLater')
                              }
                              type="button"
                            >
                              {watchLaterStatus[video.videoId] === 'saved' ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 8 12 12 15 14"/></svg>
                              )}
                            </button>
                            <button
                              class="mt-watched-toggle"
                              style={{
                                position: 'absolute',
                                top: '8px',
                                right: '8px',
                                width: '28px',
                                height: '28px',
                                borderRadius: '50%',
                                border: 'none',
                                backgroundColor: 'rgba(0,0,0,0.6)',
                                color: '#fff',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '14px',
                                opacity: 0.5,
                                zIndex: 2,
                                boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                                transition: 'background-color 0.15s, opacity 0.15s',
                                padding: 0,
                              }}
                              onClick={(e) => { e.stopPropagation(); void handleDismissVideo(video) }}
                              title={t('home.markWatched')}
                              type="button"
                            >✓</button>
                          </div>
                          <div style={cardBody}>
                            <div style={videoTitle}>{video.title}</div>
                            <div style={metaStyle}>
                              <span>{timeAgo(video.publishedAt, isPt)}</span>
                              {video.viewCount && <span>·</span>}
                              {video.viewCount && <span>{video.viewCount}</span>}
                              {video.isNew && (
                                <span style={{
                                  padding: '1px 7px',
                                  borderRadius: 'var(--mt-radius-pill)',
                                  backgroundColor: 'var(--mt-accent-soft)',
                                  color: 'var(--mt-accent)',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                }}>NEW</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              )
            })}
          </div>
        )
      })}

    </div>
  )
}

