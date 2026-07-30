import { h } from 'preact'
import { useState, useEffect, useCallback } from 'preact/hooks'
import type { AppState, Organizable } from '../../../shared/types'
import { YT, $ } from '../../../shared/selectors'
import { sendMessage } from '../../../shared/messages'
import { CollapsibleSection } from '../components/CollapsibleSection'
import { QuickTag } from '../QuickTag'
import { useT } from '../../../shared/i18n'

// ---------------------------------------------------------------------------
// Page detection helpers
// ---------------------------------------------------------------------------

type PageType = 'watch' | 'channel' | 'playlist' | 'other'

function getPageType(): PageType {
  const { pathname, search } = window.location
  if (pathname === '/watch' || pathname.startsWith('/watch?') || search.includes('v=')) return 'watch'
  if (pathname.startsWith('/@') || pathname.startsWith('/channel/')) return 'channel'
  if (pathname === '/playlist' || new URLSearchParams(search).has('list')) {
    // Exclude /watch pages that happen to have ?list= in addition to ?v=
    if (!search.includes('v=')) return 'playlist'
  }
  return 'other'
}

function getVideoId(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('v')
}

function getPlaylistId(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('list')
}

/** Extracts channel ID from a channel link href. Returns UCxxx or @handle. */
function parseChannelId(href: string): string | null {
  const channelMatch = href.match(/\/channel\/(UC[^/?&#]+)/)
  if (channelMatch) return channelMatch[1]
  const handleMatch = href.match(/\/@([^/?&#]+)/)
  if (handleMatch) return `@${handleMatch[1]}`
  return null
}

/** Returns channel ID from the current channel page URL. */
function getChannelIdFromUrl(): string | null {
  const { pathname } = window.location
  const channelMatch = pathname.match(/^\/channel\/(UC[^/?&#]+)/)
  if (channelMatch) return channelMatch[1]
  const handleMatch = pathname.match(/^\/@([^/?&#]+)/)
  if (handleMatch) return `@${handleMatch[1]}`
  return null
}

// ---------------------------------------------------------------------------
// DOM extraction helpers — watch page
// ---------------------------------------------------------------------------

interface WatchPageInfo {
  videoId: string | null
  videoTitle: string
  channelId: string | null
  channelName: string
  channelAvatarUrl: string
  channelHref: string
}

function extractWatchPageInfo(): WatchPageInfo {
  const videoId = getVideoId()

  const titleEl = $(YT.videoTitle)
  const videoTitle = titleEl?.textContent?.trim() ?? ''

  const channelNameEl = $(YT.channelName)
  const channelName = channelNameEl?.textContent?.trim() ?? ''

  const channelLinkEl = $(YT.channelLink)
  const channelHref = channelLinkEl?.getAttribute('href') ?? ''
  const channelId = channelHref ? parseChannelId(channelHref) : null

  const avatarEl = $(YT.channelAvatar) as HTMLImageElement | null
  const channelAvatarUrl = avatarEl?.src ?? ''

  return { videoId, videoTitle, channelId, channelName, channelAvatarUrl, channelHref }
}

// ---------------------------------------------------------------------------
// DOM extraction helpers — channel page
// ---------------------------------------------------------------------------

interface ChannelPageInfo {
  channelId: string | null
  channelName: string
  channelAvatarUrl: string
}

function extractChannelPageInfo(): ChannelPageInfo {
  const channelId = getChannelIdFromUrl()

  const nameEl = $(YT.channelPageName)
  const channelName = nameEl?.textContent?.trim() ?? ''

  const avatarEl = $(YT.channelPageAvatar) as HTMLImageElement | null
  const channelAvatarUrl = avatarEl?.src ?? ''

  return { channelId, channelName, channelAvatarUrl }
}

// ---------------------------------------------------------------------------
// DOM extraction helpers — playlist page
// ---------------------------------------------------------------------------

interface PlaylistPageInfo {
  playlistId: string | null
  playlistTitle: string
  thumbnailUrl: string
}

function extractPlaylistPageInfo(): PlaylistPageInfo {
  const playlistId = getPlaylistId()

  const titleEl = $(YT.playlistTitle)
  const playlistTitle = titleEl?.textContent?.trim() ?? ''

  const thumbEl = $(YT.playlistThumbnail) as HTMLImageElement | null
  const thumbnailUrl = thumbEl?.src ?? ''

  return { playlistId, playlistTitle, thumbnailUrl }
}

// ---------------------------------------------------------------------------
// generateId — simple unique ID for new Organizables
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NowPlayingProps {
  appState: AppState
  onStateChange: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NowPlaying({ appState, onStateChange }: NowPlayingProps) {
  const t = useT()
  const [pageType, setPageType] = useState<PageType>('other')
  const [watchInfo, setWatchInfo] = useState<WatchPageInfo | null>(null)
  const [channelInfo, setChannelInfo] = useState<ChannelPageInfo | null>(null)
  const [playlistInfo, setPlaylistInfo] = useState<PlaylistPageInfo | null>(null)
  const [saving, setSaving] = useState(false)

  // Detect page and extract DOM info
  const detect = useCallback(() => {
    const type = getPageType()
    setPageType(type)

    if (type === 'watch') {
      setWatchInfo(extractWatchPageInfo())
      setChannelInfo(null)
      setPlaylistInfo(null)
    } else if (type === 'channel') {
      setChannelInfo(extractChannelPageInfo())
      setWatchInfo(null)
      setPlaylistInfo(null)
    } else if (type === 'playlist') {
      setPlaylistInfo(extractPlaylistPageInfo())
      setWatchInfo(null)
      setChannelInfo(null)
    } else {
      setWatchInfo(null)
      setChannelInfo(null)
      setPlaylistInfo(null)
    }
  }, [])

  useEffect(() => {
    // Initial detection after a short delay to let SPA settle
    const timer = setTimeout(detect, 500)

    function onNavigate() {
      setTimeout(detect, 500)
    }

    document.addEventListener('yt-navigate-finish', onNavigate)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('yt-navigate-finish', onNavigate)
    }
  }, [detect])

  // ── Derived lookups ─────────────────────────────────────────────────────────

  const { organizables, folders, tags } = appState

  function findOrganizable(type: Organizable['type'], youtubeId: string | null): Organizable | null {
    if (!youtubeId) return null
    return organizables.find(o => o.type === type && o.youtubeId === youtubeId) ?? null
  }

  const savedVideo = pageType === 'watch' && watchInfo?.videoId
    ? findOrganizable('video', watchInfo.videoId)
    : null

  const savedChannel: Organizable | null = (() => {
    if (pageType === 'watch' && watchInfo?.channelId) return findOrganizable('channel', watchInfo.channelId)
    if (pageType === 'channel' && channelInfo?.channelId) return findOrganizable('channel', channelInfo.channelId)
    return null
  })()

  const savedPlaylist = pageType === 'playlist' && playlistInfo?.playlistId
    ? findOrganizable('playlist', playlistInfo.playlistId)
    : null

  // The "active" organizable for folder/tag controls (primary item for the current page)
  const activeOrganizable: Organizable | null = (() => {
    if (pageType === 'watch') return savedVideo ?? null
    if (pageType === 'channel') return savedChannel ?? null
    if (pageType === 'playlist') return savedPlaylist ?? null
    return null
  })()

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleSaveVideo() {
    if (!watchInfo?.videoId || saving) return
    setSaving(true)
    try {
      const org: Organizable = {
        id: generateId(),
        type: 'video',
        youtubeId: watchInfo.videoId,
        name: watchInfo.videoTitle || t('np.untitledVideo'),
        thumbnailUrl: '',
        url: window.location.href,
        folderId: null,
        tagIds: [],
        isSubscribed: false,
        addedAt: Date.now(),
        lastSyncedAt: Date.now(),
        channelName: watchInfo.channelName || undefined,
      }
      await sendMessage({ type: 'ADD_ORGANIZABLE', payload: org })
      onStateChange()
    } catch (err) {
      console.warn('[MyTube] NowPlaying save video error:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveChannel(channelId: string, channelName: string, avatarUrl: string, href: string) {
    if (saving) return
    setSaving(true)
    try {
      const url = href.startsWith('http') ? href : `https://www.youtube.com${href}`
      const org: Organizable = {
        id: generateId(),
        type: 'channel',
        youtubeId: channelId,
        name: channelName || t('np.unknownChannel'),
        thumbnailUrl: avatarUrl,
        url,
        folderId: null,
        tagIds: [],
        isSubscribed: false,
        addedAt: Date.now(),
        lastSyncedAt: Date.now(),
      }
      await sendMessage({ type: 'ADD_ORGANIZABLE', payload: org })
      onStateChange()
    } catch (err) {
      console.warn('[MyTube] NowPlaying save channel error:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePlaylist() {
    if (!playlistInfo?.playlistId || saving) return
    setSaving(true)
    try {
      const org: Organizable = {
        id: generateId(),
        type: 'playlist',
        youtubeId: playlistInfo.playlistId,
        name: playlistInfo.playlistTitle || t('np.untitledPlaylist'),
        thumbnailUrl: playlistInfo.thumbnailUrl,
        url: window.location.href,
        folderId: null,
        tagIds: [],
        isSubscribed: false,
        addedAt: Date.now(),
        lastSyncedAt: Date.now(),
      }
      await sendMessage({ type: 'ADD_ORGANIZABLE', payload: org })
      onStateChange()
    } catch (err) {
      console.warn('[MyTube] NowPlaying save playlist error:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleFolderChange(folderId: string) {
    if (!activeOrganizable || saving) return
    setSaving(true)
    try {
      const updated: Organizable = { ...activeOrganizable, folderId: folderId || null }
      await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: updated })
      onStateChange()
    } catch (err) {
      console.warn('[MyTube] NowPlaying folder change error:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleTagToggle(tagId: string) {
    if (!activeOrganizable) return
    const newTagIds = activeOrganizable.tagIds.includes(tagId)
      ? activeOrganizable.tagIds.filter(id => id !== tagId)
      : [...activeOrganizable.tagIds, tagId]
    const updated: Organizable = { ...activeOrganizable, tagIds: newTagIds }
    try {
      await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: updated })
      onStateChange()
    } catch (err) {
      console.warn('[MyTube] NowPlaying tag toggle error:', err)
    }
  }

  // ── Styles ───────────────────────────────────────────────────────────────────

  const innerPadding: h.JSX.CSSProperties = {
    padding: 'var(--mt-spacing-md) var(--mt-spacing-lg)',
  }

  const identityRowStyle: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: 'var(--mt-spacing-sm)',
  }

  const avatarStyle: h.JSX.CSSProperties = {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    objectFit: 'cover',
    flexShrink: 0,
    backgroundColor: 'var(--mt-bg-hover)',
    border: '1px solid var(--mt-accent-soft)',
    boxShadow: 'var(--mt-shadow-sm)',
  }

  const avatarPlaceholderStyle: h.JSX.CSSProperties = {
    ...avatarStyle,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  const titleStyle: h.JSX.CSSProperties = {
    fontFamily: 'var(--mt-font-body)',
    fontWeight: 600,
    fontSize: 'var(--mt-font-size-md)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--mt-text-primary)',
  }

  const subtitleStyle: h.JSX.CSSProperties = {
    fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-sm)',
    color: 'var(--mt-text-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }

  const mutedStyle: h.JSX.CSSProperties = {
    fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-sm)',
    color: 'var(--mt-text-secondary)',
    textAlign: 'center',
    padding: '16px 0',
    opacity: 0.7,
    fontStyle: 'italic',
  }

  const fieldLabelStyle: h.JSX.CSSProperties = {
    fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-xs)',
    color: 'var(--mt-text-secondary)',
    marginBottom: 'var(--mt-spacing-xs)',
    display: 'block',
  }

  const selectStyle: h.JSX.CSSProperties = {
    width: '100%',
    padding: '8px var(--mt-spacing-sm)',
    borderRadius: 'var(--mt-radius-sm)',
    border: '1px solid var(--mt-btn-border)',
    backgroundColor: 'var(--mt-btn-bg)',
    color: 'var(--mt-text-primary)',
    fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-sm)',
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23aaa'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
    paddingRight: '24px',
    transition: 'border-color 0.15s',
  }

  const actionRowStyle: h.JSX.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--mt-spacing-xs)',
    marginTop: 'var(--mt-spacing-sm)',
  }

  function pillButtonStyle(active: boolean): h.JSX.CSSProperties {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '6px 14px',
      borderRadius: 'var(--mt-radius-pill)',
      fontFamily: 'var(--mt-font-body)',
      fontSize: 'var(--mt-font-size-sm)',
      fontWeight: 600,
      border: active ? 'none' : '1px solid var(--mt-btn-border)',
      cursor: active ? 'pointer' : 'default',
      background: active
        ? 'linear-gradient(135deg, var(--mt-accent), var(--mt-accent-hover))'
        : undefined,
      backgroundColor: active ? undefined : 'var(--mt-btn-bg)',
      color: active ? '#ffffff' : 'var(--mt-text-primary)',
      boxShadow: active ? 'var(--mt-shadow-sm)' : 'none',
      transition: 'background-color 0.2s, box-shadow 0.2s',
      opacity: saving ? 0.6 : 1,
    }
  }

  const savedBadgeStyle: h.JSX.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 14px',
    borderRadius: 'var(--mt-radius-pill)',
    fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-sm)',
    fontWeight: 600,
    backgroundColor: 'var(--mt-btn-bg)',
    color: 'var(--mt-accent)',
    border: '1px solid var(--mt-btn-border)',
  }

  // ── Renders ───────────────────────────────────────────────────────────────────

  function renderFolderAndTags(org: Organizable) {
    return (
      <div style={{ marginTop: 'var(--mt-spacing-md)' }}>
        {/* Folder selector */}
        <div style={{ marginBottom: 'var(--mt-spacing-md)' }}>
          <span style={fieldLabelStyle}>{t('np.folder')}</span>
          <select
            style={selectStyle}
            value={org.folderId ?? ''}
            onChange={(e) => void handleFolderChange((e.target as HTMLSelectElement).value)}
            disabled={saving}
            aria-label="Assign to folder"
          >
            <option value="">{t('np.noFolder')}</option>
            {folders.map(folder => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
        </div>

        {/* Tag chips */}
        {tags.length > 0 && (
          <div>
            <span style={fieldLabelStyle}>{t('np.tags')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--mt-spacing-xs)' }}>
              {tags.map(tag => (
                <QuickTag
                  key={tag.id}
                  tag={tag}
                  active={org.tagIds.includes(tag.id)}
                  onToggle={(id) => void handleTagToggle(id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderWatchPage() {
    if (!watchInfo) return null

    const { videoId, videoTitle, channelId, channelName, channelAvatarUrl, channelHref } = watchInfo

    return (
      <div style={innerPadding}>
        {/* Video identity */}
        <div style={{ marginBottom: 'var(--mt-spacing-md)' }}>
          <div style={{ ...titleStyle, marginBottom: '2px' }}>
            {videoTitle || t('np.loadingVideo')}
          </div>

          {/* Channel row */}
          <div style={identityRowStyle}>
            {channelAvatarUrl ? (
              <img src={channelAvatarUrl} alt={channelName} style={avatarStyle} />
            ) : (
              <div style={avatarPlaceholderStyle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--mt-text-secondary)">
                  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                </svg>
              </div>
            )}
            <span style={subtitleStyle}>{channelName || t('np.unknownChannel')}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div style={actionRowStyle}>
          {/* Video save / saved */}
          {savedVideo ? (
            <span style={savedBadgeStyle}>{t('np.videoSaved')}</span>
          ) : (
            <button
              style={pillButtonStyle(!!videoId)}
              onClick={() => void handleSaveVideo()}
              disabled={!videoId || saving}
              aria-label="Save this video"
            >
              {t('np.saveVideo')}
            </button>
          )}

          {/* Channel save / saved */}
          {savedChannel ? (
            <span style={savedBadgeStyle}>{t('np.channelSaved')}</span>
          ) : (
            <button
              style={pillButtonStyle(!!channelId)}
              onClick={() => channelId
                ? void handleSaveChannel(channelId, channelName, channelAvatarUrl, channelHref)
                : undefined}
              disabled={!channelId || saving}
              aria-label="Save this channel"
            >
              {t('np.saveChannel')}
            </button>
          )}
        </div>

        {/* Controls for saved video */}
        {savedVideo && renderFolderAndTags(savedVideo)}
      </div>
    )
  }

  function renderChannelPage() {
    if (!channelInfo) return null

    const { channelId, channelName, channelAvatarUrl } = channelInfo
    const channelUrl = window.location.href

    return (
      <div style={innerPadding}>
        {/* Channel identity */}
        <div style={identityRowStyle}>
          {channelAvatarUrl ? (
            <img src={channelAvatarUrl} alt={channelName} style={avatarStyle} />
          ) : (
            <div style={avatarPlaceholderStyle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--mt-text-secondary)">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
              </svg>
            </div>
          )}
          <div style={{ overflow: 'hidden' }}>
            <div style={titleStyle}>{channelName || t('np.unknownChannel')}</div>
          </div>
        </div>

        {/* Action button */}
        <div style={actionRowStyle}>
          {savedChannel ? (
            <span style={savedBadgeStyle}>{t('np.channelSaved')}</span>
          ) : (
            <button
              style={pillButtonStyle(!!channelId)}
              onClick={() => channelId
                ? void handleSaveChannel(channelId, channelName, channelAvatarUrl, channelUrl)
                : undefined}
              disabled={!channelId || saving}
              aria-label="Save this channel"
            >
              {t('np.saveChannel')}
            </button>
          )}
        </div>

        {/* Controls for saved channel */}
        {savedChannel && renderFolderAndTags(savedChannel)}
      </div>
    )
  }

  function renderPlaylistPage() {
    if (!playlistInfo) return null

    const { playlistId, playlistTitle, thumbnailUrl } = playlistInfo

    return (
      <div style={innerPadding}>
        {/* Playlist identity */}
        <div style={identityRowStyle}>
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={playlistTitle}
              style={{ ...avatarStyle, borderRadius: '4px' }}
            />
          ) : (
            <div style={{ ...avatarPlaceholderStyle, borderRadius: '4px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--mt-text-secondary)">
                <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
              </svg>
            </div>
          )}
          <div style={{ overflow: 'hidden' }}>
            <div style={titleStyle}>{playlistTitle || t('np.untitledPlaylist')}</div>
          </div>
        </div>

        {/* Action button */}
        <div style={actionRowStyle}>
          {savedPlaylist ? (
            <span style={savedBadgeStyle}>{t('np.playlistSaved')}</span>
          ) : (
            <button
              style={pillButtonStyle(!!playlistId)}
              onClick={() => void handleSavePlaylist()}
              disabled={!playlistId || saving}
              aria-label="Save this playlist"
            >
              {t('np.savePlaylist')}
            </button>
          )}
        </div>

        {/* Controls for saved playlist */}
        {savedPlaylist && renderFolderAndTags(savedPlaylist)}
      </div>
    )
  }

  function renderOtherPage() {
    return (
      <div style={{ ...innerPadding, ...mutedStyle }}>
        {t('np.navigate')}
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────────

  return (
    <CollapsibleSection title={t('np.title')} defaultOpen={true}>
      <div style={{ margin: 'calc(-1 * var(--mt-spacing-md)) calc(-1 * var(--mt-spacing-lg))' }}>
        {pageType === 'watch' && renderWatchPage()}
        {pageType === 'channel' && renderChannelPage()}
        {pageType === 'playlist' && renderPlaylistPage()}
        {pageType === 'other' && renderOtherPage()}
      </div>
    </CollapsibleSection>
  )
}
