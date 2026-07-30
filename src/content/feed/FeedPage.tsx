import { h } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks'
import { sendMessage } from '../../shared/messages'
import { loadSettings } from '../../styles/theme'
import { useT, I18nContext } from '../../shared/i18n'
import type { FeedVideo } from '../../shared/types'

interface FeedPageProps {
  folderId: string
  folderName: string
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

export function FeedPage({ folderId, folderName, onClose }: FeedPageProps) {
  const t = useT()
  const lang = useContext(I18nContext)
  const isPt = lang === 'pt-BR'
  const [videos, setVideos] = useState<FeedVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set())
  const [openInNewTab, setOpenInNewTab] = useState(true)

  useEffect(() => {
    void loadSettings().then(s => setOpenInNewTab(s.openInNewTab))
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    sendMessage({ type: 'GET_FOLDER_FEED', payload: { folderId } })
      .then(result => {
        if (Array.isArray(result)) {
          setVideos(result)
        } else {
          console.warn('[MyTube] GET_FOLDER_FEED returned non-array:', result)
          setVideos([])
        }
      })
      .catch(() => setError(t('error.loadFolderFeed')))
      .finally(() => setLoading(false))
  }, [folderId])

  const channelGroups = useMemo(() => {
    const groups = new Map<string, { channelName: string; videos: FeedVideo[] }>()
    for (const video of videos) {
      const existing = groups.get(video.channelId)
      if (existing) {
        existing.videos.push(video)
      } else {
        groups.set(video.channelId, { channelName: video.channelName, videos: [video] })
      }
    }
    return Array.from(groups.entries())
      .map(([channelId, { channelName, videos: vids }]) => ({
        channelId,
        channelName,
        videos: vids.sort((a, b) => b.publishedAt - a.publishedAt),
      }))
      .sort((a, b) => (b.videos[0]?.publishedAt ?? 0) - (a.videos[0]?.publishedAt ?? 0))
  }, [videos])

  const toggleChannel = useCallback((channelId: string) => {
    setExpandedChannels(prev => {
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

  const handleDismissVideo = useCallback(async (video: FeedVideo) => {
    await sendMessage({
      type: 'ADD_WATCH_ENTRY',
      payload: { videoId: video.videoId, channelId: video.channelId, title: video.title, watchedAt: Date.now() },
    })
    setVideos(prev => prev.filter(v => v.videoId !== video.videoId))
  }, [])

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

  const grid: h.JSX.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px',
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
    padding: '12px',
  }

  const videoTitle: h.JSX.CSSProperties = {
    fontWeight: 600,
    fontSize: 'var(--mt-font-size-md)',
    lineHeight: 1.3,
    marginBottom: '6px',
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

  const channelSection: h.JSX.CSSProperties = {
    marginBottom: '12px',
    borderRadius: 'var(--mt-radius-md)',
    border: '1px solid var(--mt-border)',
    overflow: 'hidden',
  }

  const channelHeaderStyle: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
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

  const channelNameHeaderStyle: h.JSX.CSSProperties = {
    fontWeight: 600,
    fontSize: 'var(--mt-font-size-md)',
    fontFamily: 'var(--mt-font-body)',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }

  const channelCountStyle: h.JSX.CSSProperties = {
    fontSize: 'var(--mt-font-size-sm)',
    color: 'var(--mt-text-secondary)',
    flexShrink: 0,
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
        <span style={titleStyle}>{folderName}</span>
        <span style={{ fontSize: 'var(--mt-font-size-sm)', color: 'var(--mt-text-secondary)' }}>
          {loading ? '...' : `${videos.length} ${videos.length === 1 ? t('feed.video') : t('feed.videos')}`}
        </span>
      </div>


      {loading && (
        <div style={emptyStyle}>{t('feed.loading')}</div>
      )}

      {error && (
        <div style={{ ...emptyStyle, color: 'var(--mt-error)' }}>{error}</div>
      )}

      {!loading && !error && channelGroups.length === 0 && (
        <div style={emptyStyle}>
          {t('feed.allWatched')}
        </div>
      )}

      {!loading && !error && channelGroups.length > 0 && channelGroups.map(group => {
        const isExpanded = expandedChannels.has(group.channelId)
        const color = channelColor(group.channelId)
        return (
          <div key={group.channelId} style={channelSection}>
            <div
              style={channelHeaderStyle}
              onClick={() => toggleChannel(group.channelId)}
            >
              <div style={{ ...channelAvatarStyle, backgroundColor: color }}>
                {group.channelName.charAt(0).toUpperCase()}
              </div>
              <span style={channelNameHeaderStyle}>{group.channelName}</span>
              <span style={channelCountStyle}>
                {group.videos.length} {group.videos.length === 1 ? t('feed.video') : t('feed.videos')}
              </span>
              <span style={{
                fontSize: '16px',
                color: 'var(--mt-text-secondary)',
                transition: 'transform 0.15s',
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}>›</span>
            </div>
            {isExpanded && (
              <div style={{ ...grid, padding: '12px' }}>
                {group.videos.map(video => (
                  <div
                    key={video.videoId}
                    style={card}
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
}
