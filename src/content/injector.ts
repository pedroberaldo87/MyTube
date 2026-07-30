import { sendMessage } from '../shared/messages'
import { $, isDarkMode, YT } from '../shared/selectors'
import { flattenFolders } from '../shared/folders'
import { getLanguage, t } from '../shared/i18n'
import type { Language } from '../shared/i18n'
import type { Folder, Organizable } from '../shared/types'
import { triggerUnsubscribe } from './unsubscribe'
import { ACCENT_COLORS, FONT_URLS } from '../styles/theme'
import type { AccentColor, StyleTheme } from '../styles/theme'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOLBAR_ID = 'mytube-toolbar'
const STYLE_ID = 'mytube-injector-styles'
const FONT_LINK_ID = 'mytube-injector-font'
const CONFIRM_TIMEOUT = 3000

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentLang: Language = 'en'
let accentHex = '#ff6b42'
let fontFamily = "'Inter Tight', sans-serif"
let confirmTimers: Record<string, ReturnType<typeof setTimeout>> = {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dark(): boolean { return isDarkMode() }
function themeClass(): string { return dark() ? 'mytube-dark' : 'mytube-light' }

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

async function loadAccentAndTheme(): Promise<void> {
  const result = await chrome.storage.local.get(['mytube-accent-color', 'mytube-style-theme'])
  const accent = (result['mytube-accent-color'] as AccentColor) || 'coral'
  const theme = (result['mytube-style-theme'] as StyleTheme) || 'prism'
  accentHex = ACCENT_COLORS.find(c => c.id === accent)?.hex ?? '#ff6b42'
  fontFamily = theme === 'void' ? "'Inter Tight', sans-serif" : "'Bricolage Grotesque', sans-serif"

  if (!document.getElementById(FONT_LINK_ID)) {
    const link = document.createElement('link')
    link.id = FONT_LINK_ID
    link.rel = 'stylesheet'
    link.href = FONT_URLS[theme]
    document.head.appendChild(link)
  }
}

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------

function createStyleSheet(): void {
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* ── Branded bar wrapper ─────────────────────────────────────── */
    #${TOOLBAR_ID} {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 16px;
      border-radius: 10px;
      border: 1px solid;
      margin: 10px 0;
      font-family: Roboto, Arial, sans-serif;
      position: relative;
    }
    #${TOOLBAR_ID}.mytube-dark {
      background: #1a1a1a;
      border-color: #333;
    }
    #${TOOLBAR_ID}.mytube-light {
      background: #f8f8f8;
      border-color: #e0e0e0;
    }

    /* ── Logo ─────────────────────────────────────────────────────── */
    .mytube-tb-logo {
      font-weight: 800;
      font-size: 15px;
      letter-spacing: -0.03em;
      line-height: 1;
      flex-shrink: 0;
      user-select: none;
    }

    /* ── Separator ───────────────────────────────────────────────── */
    .mytube-tb-sep {
      width: 1px;
      height: 20px;
      flex-shrink: 0;
    }
    .mytube-dark .mytube-tb-sep { background: #3f3f3f; }
    .mytube-light .mytube-tb-sep { background: #d9d9d9; }

    /* ── Add button (pill) ───────────────────────────────────────── */
    .mytube-tb-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 14px;
      border-radius: 18px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid;
      transition: filter 0.15s ease;
      white-space: nowrap;
      line-height: 1.4;
    }
    .mytube-dark .mytube-tb-pill {
      background: #272727;
      color: #fff;
      border-color: #3f3f3f;
    }
    .mytube-light .mytube-tb-pill {
      background: #fff;
      color: #0f0f0f;
      border-color: #d9d9d9;
    }
    .mytube-tb-pill:hover {
      filter: brightness(1.18);
    }

    /* ── Status label (when already added) ───────────────────────── */
    .mytube-tb-status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      line-height: 1.4;
      opacity: 0.6;
    }
    .mytube-dark .mytube-tb-status { color: #aaa; }
    .mytube-light .mytube-tb-status { color: #606060; }

    /* ── Action buttons (round icons) ────────────────────────────── */
    .mytube-tb-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: 1px solid;
      cursor: pointer;
      font-size: 13px;
      padding: 0;
      transition: filter 0.15s ease, border-color 0.15s ease;
      line-height: 1;
      flex-shrink: 0;
    }
    .mytube-dark .mytube-tb-btn {
      background: #272727;
      color: #fff;
      border-color: #3f3f3f;
    }
    .mytube-light .mytube-tb-btn {
      background: #fff;
      color: #0f0f0f;
      border-color: #d9d9d9;
    }
    .mytube-tb-btn:hover {
      filter: brightness(1.18);
    }
    .mytube-tb-btn[data-confirm="true"] {
      border-color: #e5a00d !important;
      animation: mytube-pulse 0.6s ease-in-out;
    }
    .mytube-tb-btn[data-confirm-delete="true"] {
      border-color: #f87171 !important;
      animation: mytube-pulse 0.6s ease-in-out;
    }

    @keyframes mytube-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }

    /* ── Folder current label ────────────────────────────────────── */
    .mytube-tb-folder-label {
      font-size: 12px;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.7;
    }
    .mytube-dark .mytube-tb-folder-label { color: #aaa; }
    .mytube-light .mytube-tb-folder-label { color: #606060; }

    /* ── Dropdown ─────────────────────────────────────────────────── */
    .mytube-tb-dropdown {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      min-width: 220px;
      max-height: 280px;
      overflow-y: auto;
      border-radius: 8px;
      border: 1px solid;
      z-index: 9999;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      font-size: 13px;
    }
    .mytube-dark .mytube-tb-dropdown {
      background: #212121;
      border-color: #3f3f3f;
      color: #fff;
    }
    .mytube-light .mytube-tb-dropdown {
      background: #fff;
      border-color: #d9d9d9;
      color: #0f0f0f;
    }
    .mytube-tb-dropdown-search {
      display: block;
      width: calc(100% - 16px);
      margin: 6px 8px;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid;
      font-size: 12px;
      outline: none;
      box-sizing: border-box;
    }
    .mytube-dark .mytube-tb-dropdown-search {
      background: #181818;
      border-color: #3f3f3f;
      color: #fff;
    }
    .mytube-light .mytube-tb-dropdown-search {
      background: #f8f8f8;
      border-color: #d9d9d9;
      color: #0f0f0f;
    }
    .mytube-tb-dropdown-item {
      display: block;
      width: 100%;
      padding: 8px 12px;
      border: none;
      background: none;
      text-align: left;
      cursor: pointer;
      font-size: 13px;
      font-family: Roboto, Arial, sans-serif;
    }
    .mytube-dark .mytube-tb-dropdown-item { color: #fff; }
    .mytube-light .mytube-tb-dropdown-item { color: #0f0f0f; }
    .mytube-tb-dropdown-item:hover {
      background: rgba(255,255,255,0.08);
    }
    .mytube-light .mytube-tb-dropdown-item:hover {
      background: rgba(0,0,0,0.05);
    }
    .mytube-tb-dropdown-item[data-active="true"] {
      font-weight: 700;
    }
  `
  document.head.appendChild(style)
}

// ---------------------------------------------------------------------------
// ID extraction helpers
// ---------------------------------------------------------------------------

function extractChannelId(): string {
  const path = location.pathname
  const channelMatch = path.match(/\/channel\/(UC[\w-]+)/)
  if (channelMatch) return channelMatch[1]
  const handleMatch = path.match(/\/@([\w.-]+)/)
  if (handleMatch) return `@${handleMatch[1]}`
  return path
}

function extractPlaylistId(): string {
  return new URLSearchParams(location.search).get('list') ?? ''
}

// ---------------------------------------------------------------------------
// DOM creation helpers
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}

function actionBtn(emoji: string, title: string): HTMLButtonElement {
  const btn = el('button', 'mytube-tb-btn')
  btn.textContent = emoji
  btn.title = title
  btn.type = 'button'
  return btn
}

function createLogo(): HTMLSpanElement {
  const logo = el('span', 'mytube-tb-logo')
  logo.textContent = 'MyTube'
  logo.style.fontFamily = fontFamily
  logo.style.color = accentHex
  return logo
}

function createWrapper(): HTMLDivElement {
  const toolbar = el('div')
  toolbar.id = TOOLBAR_ID
  toolbar.className = themeClass()
  return toolbar
}

// ---------------------------------------------------------------------------
// Folder picker dropdown
// ---------------------------------------------------------------------------

function renderFolderPicker(
  container: HTMLElement,
  folders: Folder[],
  currentFolderId: string | null,
  onSelect: (folderId: string | null) => void,
): HTMLDivElement {
  const dropdown = el('div', 'mytube-tb-dropdown')

  const search = el('input', 'mytube-tb-dropdown-search') as HTMLInputElement
  search.placeholder = t('folder.search', currentLang)
  search.type = 'text'
  dropdown.appendChild(search)

  const listContainer = el('div')
  dropdown.appendChild(listContainer)

  function renderList(filter: string) {
    listContainer.innerHTML = ''
    const flat = flattenFolders(folders)
      .filter(({ folder: f }) => !filter || normalize(f.name).includes(normalize(filter)))

    for (const { folder: f, depth } of flat) {
      const item = el('button', 'mytube-tb-dropdown-item')
      item.style.paddingLeft = `${12 + depth * 14}px`
      item.textContent = `📁 ${f.name}`
      if (f.id === currentFolderId) item.dataset.active = 'true'
      item.type = 'button'
      item.addEventListener('click', () => onSelect(f.id))
      listContainer.appendChild(item)
    }

    const noFolder = el('button', 'mytube-tb-dropdown-item')
    noFolder.textContent = `↩ ${t('batch.noFolder', currentLang)}`
    noFolder.type = 'button'
    if (!currentFolderId) noFolder.dataset.active = 'true'
    noFolder.addEventListener('click', () => onSelect(null))
    listContainer.appendChild(noFolder)
  }

  renderList('')
  search.addEventListener('input', () => renderList(search.value))
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); dropdown.remove() }
  })

  container.appendChild(dropdown)
  requestAnimationFrame(() => search.focus())

  const dismiss = (e: MouseEvent) => {
    if (!dropdown.contains(e.target as Node)) {
      dropdown.remove()
      document.removeEventListener('click', dismiss, true)
    }
  }
  setTimeout(() => document.addEventListener('click', dismiss, true), 0)

  return dropdown
}

// ---------------------------------------------------------------------------
// Toolbar content: "Add" state
// ---------------------------------------------------------------------------

function renderAddContent(
  toolbar: HTMLElement,
  youtubeId: string,
  type: 'channel' | 'video',
  getItemData: () => Omit<Organizable, 'id' | 'addedAt' | 'lastSyncedAt'>,
): void {
  toolbar.innerHTML = ''
  toolbar.appendChild(createLogo())
  toolbar.appendChild(el('span', 'mytube-tb-sep'))

  const pill = el('button', 'mytube-tb-pill')
  pill.textContent = t('injector.addMyTube', currentLang)
  pill.type = 'button'

  pill.addEventListener('click', async () => {
    try {
      await sendMessage({ type: 'ADD_ORGANIZABLE', payload: getItemData() as Organizable })
      const existing = await sendMessage({ type: 'GET_CHANNEL_INFO', payload: { channelId: youtubeId } })
      if (existing) {
        renderManageContent(toolbar, existing)
      } else {
        pill.textContent = '✓'
        pill.style.opacity = '0.75'
        pill.disabled = true
      }
    } catch (err) {
      console.error('[MyTube] ADD_ORGANIZABLE failed:', err)
    }
  })

  toolbar.appendChild(pill)
}

// ---------------------------------------------------------------------------
// Toolbar content: "Manage" state
// ---------------------------------------------------------------------------

function renderManageContent(toolbar: HTMLElement, item: Organizable): void {
  toolbar.innerHTML = ''
  clearConfirmTimers()

  toolbar.appendChild(createLogo())
  toolbar.appendChild(el('span', 'mytube-tb-sep'))

  // Status
  const status = el('span', 'mytube-tb-status')
  status.textContent = '✓'
  toolbar.appendChild(status)

  // Folder button
  const folderBtn = actionBtn('📁', t('batch.assignFolder', currentLang))
  folderBtn.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (toolbar.querySelector('.mytube-tb-dropdown')) {
      toolbar.querySelector('.mytube-tb-dropdown')?.remove()
      return
    }
    try {
      const state = await sendMessage({ type: 'GET_STATE' })
      renderFolderPicker(toolbar, state.folders, item.folderId, async (folderId) => {
        toolbar.querySelector('.mytube-tb-dropdown')?.remove()
        const updated = { ...item, folderId }
        await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: updated })
        renderManageContent(toolbar, updated)
      })
    } catch (err) {
      console.error('[MyTube] GET_STATE failed:', err)
    }
  })
  toolbar.appendChild(folderBtn)

  // Folder name label
  const folderLabel = el('span', 'mytube-tb-folder-label')
  toolbar.appendChild(folderLabel)
  if (item.folderId) {
    folderLabel.textContent = '…'
    sendMessage({ type: 'GET_STATE' }).then(state => {
      const folder = state.folders.find((f: Folder) => f.id === item.folderId)
      if (folder) {
        folderLabel.textContent = folder.name
        folderLabel.title = folder.name
      }
    }).catch(() => {})
  }

  // Mute/Unmute (only for channels)
  if (item.type === 'channel') {
    const isMuted = item.muted ?? false
    const muteBtn = actionBtn(
      isMuted ? '🔔' : '🔇',
      t(isMuted ? 'item.enableNotifications' : 'item.disableNotifications', currentLang)
    )
    muteBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const updated = { ...item, muted: !isMuted }
      try {
        await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: updated })
        renderManageContent(toolbar, updated)
      } catch (err) {
        console.error('[MyTube] UPDATE_ORGANIZABLE mute failed:', err)
      }
    })
    toolbar.appendChild(muteBtn)

    // Unsubscribe (double-click confirm)
    const unsubBtn = actionBtn('🚫', t('item.unsubscribe', currentLang))
    unsubBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (unsubBtn.dataset.confirm === 'true') {
        triggerUnsubscribe(item.url)
        unsubBtn.dataset.confirm = ''
        clearTimer('unsub')
      } else {
        unsubBtn.dataset.confirm = 'true'
        unsubBtn.textContent = '🚫?'
        unsubBtn.title = t('item.confirmUnsubscribe', currentLang)
        setTimer('unsub', () => {
          unsubBtn.dataset.confirm = ''
          unsubBtn.textContent = '🚫'
          unsubBtn.title = t('item.unsubscribe', currentLang)
        })
      }
    })
    toolbar.appendChild(unsubBtn)
  }

  // Delete (double-click confirm)
  const deleteBtn = actionBtn('🗑', t('item.delete', currentLang))
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (deleteBtn.dataset.confirmDelete === 'true') {
      try {
        await sendMessage({ type: 'DELETE_ORGANIZABLE', payload: { id: item.id } })
        renderAddContent(toolbar, item.youtubeId, item.type as 'channel' | 'video', () => ({
          type: item.type,
          youtubeId: item.youtubeId,
          name: item.name,
          thumbnailUrl: item.thumbnailUrl,
          url: item.url,
          folderId: null,
          tagIds: [],
          isSubscribed: false,
        }))
      } catch (err) {
        console.error('[MyTube] DELETE_ORGANIZABLE failed:', err)
      }
      clearTimer('delete')
    } else {
      deleteBtn.dataset.confirmDelete = 'true'
      deleteBtn.textContent = '🗑?'
      deleteBtn.title = t('item.confirmDelete', currentLang)
      setTimer('delete', () => {
        deleteBtn.dataset.confirmDelete = ''
        deleteBtn.textContent = '🗑'
        deleteBtn.title = t('item.delete', currentLang)
      })
    }
  })
  toolbar.appendChild(deleteBtn)
}

// ---------------------------------------------------------------------------
// Confirm timer management
// ---------------------------------------------------------------------------

function setTimer(key: string, cb: () => void): void {
  clearTimer(key)
  confirmTimers[key] = setTimeout(cb, CONFIRM_TIMEOUT)
}

function clearTimer(key: string): void {
  if (confirmTimers[key]) { clearTimeout(confirmTimers[key]); delete confirmTimers[key] }
}

function clearConfirmTimers(): void {
  for (const key of Object.keys(confirmTimers)) clearTimer(key)
}

// ---------------------------------------------------------------------------
// Channel page injection
// ---------------------------------------------------------------------------

function findChannelInsertionPoint(): { anchor: Element; position: InsertPosition } | null {
  const selectors: Array<{ sel: string; pos: InsertPosition }> = [
    { sel: 'yt-page-header-renderer', pos: 'afterend' },
    { sel: 'ytd-c4-tabbed-header-renderer', pos: 'afterend' },
    { sel: '#page-header', pos: 'afterend' },
    { sel: '#channel-header', pos: 'afterend' },
    { sel: '#tabsContainer', pos: 'beforebegin' },
    { sel: 'yt-tab-group-shape', pos: 'beforebegin' },
    { sel: '#tabs-inner-container', pos: 'beforebegin' },
  ]
  for (const { sel, pos } of selectors) {
    const el = document.querySelector(sel)
    if (el) return { anchor: el, position: pos }
  }
  const sub = $(YT.channelSubscribeButton)
  if (sub) {
    const container = sub.closest('#inner-header-container')
      ?? sub.closest('#channel-header-container')
      ?? sub.closest('.page-header-view-model-wiz__page-header-headline')
      ?? sub.parentElement
    if (container) return { anchor: container, position: 'afterend' }
  }
  return null
}

async function injectOnChannelPage(): Promise<void> {
  if (document.getElementById(TOOLBAR_ID)) return

  const youtubeId = extractChannelId()
  if (!youtubeId) return

  await Promise.all([loadAccentAndTheme(), getLanguage().then(l => { currentLang = l })])

  const nameEl = $(YT.channelPageName)
  const avatarEl = $(YT.channelPageAvatar) as HTMLImageElement | null

  const insertPoint = findChannelInsertionPoint()
  if (!insertPoint) return

  let existing: Organizable | null = null
  try {
    existing = await sendMessage({ type: 'GET_CHANNEL_INFO', payload: { channelId: youtubeId } })
  } catch { /* not found */ }

  if (document.getElementById(TOOLBAR_ID)) return

  const toolbar = createWrapper()

  if (existing) {
    renderManageContent(toolbar, existing)
  } else {
    renderAddContent(toolbar, youtubeId, 'channel', () => ({
      type: 'channel' as const,
      youtubeId,
      name: nameEl?.textContent?.trim() ?? youtubeId,
      thumbnailUrl: avatarEl?.src ?? '',
      url: location.href,
      folderId: null,
      tagIds: [],
      isSubscribed: false,
    }))
  }

  insertPoint.anchor.insertAdjacentElement(insertPoint.position, toolbar)
}

// ---------------------------------------------------------------------------
// Video (watch) page injection
// ---------------------------------------------------------------------------

async function injectOnWatchPage(): Promise<void> {
  if (document.getElementById(TOOLBAR_ID)) return

  const titleEl = $(YT.videoTitle)
  if (!titleEl) return

  const titleContainer = titleEl.closest('h1')?.parentElement
  if (!titleContainer) return

  const videoId = new URLSearchParams(location.search).get('v')
  if (!videoId) return

  await Promise.all([loadAccentAndTheme(), getLanguage().then(l => { currentLang = l })])

  const channelNameEl = $(YT.channelName)
  const channelName = channelNameEl?.textContent?.trim() ?? ''

  // Try to find the channel in MyTube by looking at the channel link
  const channelLinkEl = $(YT.channelLink) as HTMLAnchorElement | null
  const channelUrl = channelLinkEl?.href ?? ''
  let channelYoutubeId = ''
  if (channelUrl) {
    const urlMatch = channelUrl.match(/\/@([\w.-]+)/) ?? channelUrl.match(/\/channel\/(UC[\w-]+)/)
    if (urlMatch) channelYoutubeId = urlMatch[0].startsWith('/@') ? `@${urlMatch[1]}` : urlMatch[1]
  }

  let existing: Organizable | null = null
  if (channelYoutubeId) {
    try {
      existing = await sendMessage({ type: 'GET_CHANNEL_INFO', payload: { channelId: channelYoutubeId } })
    } catch { /* not found */ }
  }

  if (document.getElementById(TOOLBAR_ID)) return

  const toolbar = createWrapper()

  if (existing) {
    renderManageContent(toolbar, existing)
  } else {
    renderAddContent(toolbar, channelYoutubeId || videoId, 'channel', () => {
      if (channelYoutubeId) {
        return {
          type: 'channel' as const,
          youtubeId: channelYoutubeId,
          name: channelName || channelYoutubeId,
          thumbnailUrl: '',
          url: channelUrl,
          folderId: null,
          tagIds: [],
          isSubscribed: false,
        }
      }
      return {
        type: 'video' as const,
        youtubeId: videoId,
        name: titleEl?.textContent?.trim() ?? videoId,
        thumbnailUrl: '',
        url: location.href,
        folderId: null,
        tagIds: [],
        isSubscribed: false,
        channelName: channelName || undefined,
      }
    })
  }

  titleContainer.insertAdjacentElement('afterend', toolbar)
}

// ---------------------------------------------------------------------------
// Playlist page injection
// ---------------------------------------------------------------------------

async function injectOnPlaylistPage(): Promise<void> {
  if (document.getElementById(TOOLBAR_ID)) return

  const youtubeId = extractPlaylistId()
  if (!youtubeId) return

  const headerEl =
    $(YT.playlistTitle)?.closest('ytd-playlist-header-renderer') ??
    $(YT.playlistTitle)?.parentElement
  if (!headerEl) return

  await Promise.all([loadAccentAndTheme(), getLanguage().then(l => { currentLang = l })])

  const titleEl = $(YT.playlistTitle)
  const thumbnailEl = $(YT.playlistThumbnail) as HTMLImageElement | null

  if (document.getElementById(TOOLBAR_ID)) return

  const toolbar = createWrapper()

  toolbar.appendChild(createLogo())
  toolbar.appendChild(el('span', 'mytube-tb-sep'))

  const pill = el('button', 'mytube-tb-pill')
  pill.textContent = t('injector.addMyTube', currentLang)
  pill.type = 'button'

  pill.addEventListener('click', () => {
    const name = titleEl?.textContent?.trim() ?? youtubeId
    const thumbnailUrl = thumbnailEl?.src ?? ''
    const url = location.href

    const item: Omit<Organizable, 'id' | 'addedAt' | 'lastSyncedAt'> = {
      type: 'playlist',
      youtubeId,
      name,
      thumbnailUrl,
      url,
      folderId: null,
      tagIds: [],
      isSubscribed: false,
    }

    sendMessage({ type: 'ADD_ORGANIZABLE', payload: item as Organizable })
      .then(() => { pill.textContent = '✓'; pill.style.opacity = '0.75'; pill.disabled = true })
      .catch(err => console.error('[MyTube] ADD_ORGANIZABLE playlist failed:', err))
  })

  toolbar.appendChild(pill)
  headerEl.insertAdjacentElement('afterend', toolbar)
}

// ---------------------------------------------------------------------------
// Page type detection and injection dispatcher
// ---------------------------------------------------------------------------

function detectAndInject(): void {
  const path = location.pathname
  const search = location.search

  if (path === '/watch' && search.includes('v=')) {
    void injectOnWatchPage()
    return
  }

  if (path.includes('/@') || path.includes('/channel/')) {
    void injectOnChannelPage()
    return
  }

  if (path === '/playlist' && search.includes('list=')) {
    void injectOnPlaylistPage()
    return
  }
}

// ---------------------------------------------------------------------------
// Remove stale toolbar on navigation
// ---------------------------------------------------------------------------

function removeInjected(): void {
  document.getElementById(TOOLBAR_ID)?.remove()
  clearConfirmTimers()
}

// ---------------------------------------------------------------------------
// Theme observer
// ---------------------------------------------------------------------------

function observeTheme(): void {
  const observer = new MutationObserver(() => {
    const toolbar = document.getElementById(TOOLBAR_ID)
    if (toolbar) toolbar.className = themeClass()
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] })
}

// ---------------------------------------------------------------------------
// Storage change listener
// ---------------------------------------------------------------------------

function observeStorageChanges(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return

    // Refresh accent/theme if settings change
    if (changes['mytube-accent-color'] || changes['mytube-style-theme']) {
      void loadAccentAndTheme().then(() => {
        const logo = document.querySelector(`#${TOOLBAR_ID} .mytube-tb-logo`) as HTMLElement | null
        if (logo) {
          logo.style.color = accentHex
          logo.style.fontFamily = fontFamily
        }
      })
    }

    if (!changes['mytube_state']) return
    const toolbar = document.getElementById(TOOLBAR_ID)
    if (!toolbar) return

    const path = location.pathname
    if (path.includes('/@') || path.includes('/channel/')) {
      const youtubeId = extractChannelId()
      if (!youtubeId) return
      sendMessage({ type: 'GET_CHANNEL_INFO', payload: { channelId: youtubeId } })
        .then(existing => {
          if (existing) {
            renderManageContent(toolbar, existing)
          } else {
            const nameEl = $(YT.channelPageName)
            const avatarEl = $(YT.channelPageAvatar) as HTMLImageElement | null
            renderAddContent(toolbar, youtubeId, 'channel', () => ({
              type: 'channel' as const,
              youtubeId,
              name: nameEl?.textContent?.trim() ?? youtubeId,
              thumbnailUrl: avatarEl?.src ?? '',
              url: location.href,
              folderId: null,
              tagIds: [],
              isSubscribed: false,
            }))
          }
        })
        .catch(() => {})
    } else if (path === '/watch') {
      // Re-inject video toolbar on state change
      removeInjected()
      void injectOnWatchPage()
    }
  })
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

createStyleSheet()
observeTheme()
observeStorageChanges()

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', detectAndInject)
} else {
  detectAndInject()
}

document.addEventListener('yt-navigate-finish', () => {
  removeInjected()
  detectAndInject()
})

document.addEventListener('yt-page-data-updated', () => {
  if (!document.getElementById(TOOLBAR_ID)) {
    detectAndInject()
  }
})
