import { h, render } from 'preact'
import { FeedPage } from './FeedPage'
import { HomePage } from './HomePage'
import { HomeNudge, nudgeStyles } from './HomeNudge'
import { HomeTab, tabStyles } from './HomeTab'
import {
  getColorMode,
  watchColorMode,
  loadSettings,
  watchSettings,
  buildClassList,
  FONT_URLS,
  type StyleTheme,
  type AccentColor,
} from '../../styles/theme'
import { I18nContext, type Language } from '../../shared/i18n'
import { sendMessage } from '../../shared/messages'
import type { HomeNudgeData } from '../../shared/types'
import tokensCSS from '../../styles/tokens.css?inline'

const FEED_ROOT_ID = 'mytube-feed-root'
const YT_PAGE_MANAGER = 'ytd-page-manager'

let currentTheme: StyleTheme = 'prism'
let currentAccent: AccentColor = 'coral'
let currentLanguage: Language = 'en'
let rootEl: HTMLDivElement | null = null
let shadow: ShadowRoot | null = null
let mountPoint: HTMLDivElement | null = null

function applyClasses(): void {
  if (!rootEl) return
  const mode = getColorMode()
  rootEl.className = buildClassList(mode, currentTheme, currentAccent).join(' ')
}

function ensureRoot(): { shadow: ShadowRoot; mountPoint: HTMLDivElement; rootEl: HTMLDivElement } {
  if (rootEl && shadow && mountPoint) {
    return { shadow, mountPoint, rootEl }
  }

  rootEl = document.createElement('div')
  rootEl.id = FEED_ROOT_ID
  Object.assign(rootEl.style, {
    position: 'fixed',
    top: '56px',
    left: '0',
    width: '100%',
    height: 'calc(100vh - 56px)',
    zIndex: '2147483646',
    overflow: 'auto',
  })

  shadow = rootEl.attachShadow({ mode: 'open' })

  const styleEl = document.createElement('style')
  styleEl.textContent = tokensCSS
  shadow.appendChild(styleEl)

  const resetEl = document.createElement('style')
  resetEl.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; display: block; font-family: var(--mt-font-body); background: var(--mt-bg-primary); }
    .mt-feed-card:hover { border-color: var(--mt-accent) !important; box-shadow: var(--mt-shadow-md); }
    .mt-feed-card:hover .mt-watched-toggle { opacity: 1 !important; }
    .mt-feed-card:hover .mt-watchlater-toggle { opacity: 1 !important; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: var(--mt-scrollbar-track); }
    ::-webkit-scrollbar-thumb { background: var(--mt-scrollbar-thumb); border-radius: 3px; }
  `
  shadow.appendChild(resetEl)

  mountPoint = document.createElement('div')
  mountPoint.style.height = '100%'
  shadow.appendChild(mountPoint)

  applyClasses()

  void loadSettings().then(s => {
    currentTheme = s.theme
    currentAccent = s.accent
    currentLanguage = (s.language as Language) ?? 'en'

    const fontUrl = FONT_URLS[s.theme]
    const fontLink = document.createElement('link')
    fontLink.rel = 'stylesheet'
    fontLink.href = fontUrl
    shadow!.prepend(fontLink)

    applyClasses()
  })

  watchColorMode(applyClasses)
  watchSettings(s => {
    currentTheme = s.theme
    currentAccent = s.accent
    currentLanguage = (s.language as Language) ?? 'en'
    applyClasses()
  })

  return { shadow, mountPoint, rootEl }
}

function hideYouTube(): void {
  const pm = document.querySelector(YT_PAGE_MANAGER) as HTMLElement | null
  if (pm) pm.style.display = 'none'
}

function showYouTube(): void {
  const pm = document.querySelector(YT_PAGE_MANAGER) as HTMLElement | null
  if (pm) pm.style.display = ''
}

function openFeed(folderId: string, folderName: string): void {
  const { mountPoint: mp, rootEl: re } = ensureRoot()

  hideYouTube()
  document.body.appendChild(re)

  render(
    h(I18nContext.Provider, { value: currentLanguage },
      h(FeedPage, { folderId, folderName, onClose: closeFeed }),
    ),
    mp,
  )
}

function closeFeed(): void {
  if (mountPoint) render(null, mountPoint)
  if (rootEl && rootEl.parentElement) rootEl.remove()
  showYouTube()
}

function openHome(): void {
  const { mountPoint: mp, rootEl: re } = ensureRoot()

  hideYouTube()
  document.body.appendChild(re)

  render(
    h(I18nContext.Provider, { value: currentLanguage },
      h(HomePage, { onClose: closeFeed }),
    ),
    mp,
  )
}

document.addEventListener('mytube:open-feed', ((e: CustomEvent<{ folderId: string; folderName: string }>) => {
  openFeed(e.detail.folderId, e.detail.folderName)
}) as EventListener)

document.addEventListener('mytube:open-home', () => {
  openHome()
})

document.addEventListener('mytube:close-feed', closeFeed)

// ── Home Nudge ───────────────────────────────────────────────────────────────

const NUDGE_ROOT_ID = 'mytube-nudge-root'
let nudgeEl: HTMLDivElement | null = null
let nudgeShadow: ShadowRoot | null = null
let nudgeMount: HTMLDivElement | null = null
let nudgeDismissed = false
let wasOnHome = false

function isHomePage(): boolean {
  const path = location.pathname
  return path === '/' || path === ''
}

function dismissNudge(): void {
  nudgeDismissed = true
  setTimeout(() => {
    if (nudgeMount) render(null, nudgeMount)
    if (nudgeEl?.parentElement) nudgeEl.remove()
  }, 400)
}

function openFromNudge(): void {
  nudgeDismissed = true
  setTimeout(() => {
    if (nudgeMount) render(null, nudgeMount)
    if (nudgeEl?.parentElement) nudgeEl.remove()
    openHome()
  }, 400)
}

async function showHomeNudge(): Promise<void> {
  if (nudgeDismissed) return
  if (nudgeEl?.parentElement) return

  const settings = await loadSettings()
  if (settings.homeNudgeMode === 'off') return

  let data: HomeNudgeData
  try {
    data = await sendMessage({ type: 'GET_HOME_NUDGE_DATA' })
  } catch {
    return
  }
  if (data.total === 0) return

  nudgeEl = document.createElement('div')
  nudgeEl.id = NUDGE_ROOT_ID
  nudgeShadow = nudgeEl.attachShadow({ mode: 'open' })

  const styleEl = document.createElement('style')
  styleEl.textContent = tokensCSS + '\n' + nudgeStyles + '\n' + tabStyles
  nudgeShadow.appendChild(styleEl)

  const resetEl = document.createElement('style')
  resetEl.textContent = `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }`
  nudgeShadow.appendChild(resetEl)

  nudgeMount = document.createElement('div')
  nudgeShadow.appendChild(nudgeMount)

  const mode = getColorMode()
  nudgeEl.className = buildClassList(mode, settings.theme, settings.accent).join(' ')

  const fontLink = document.createElement('link')
  fontLink.rel = 'stylesheet'
  fontLink.href = FONT_URLS[settings.theme]
  nudgeShadow.prepend(fontLink)

  document.body.appendChild(nudgeEl)

  const lang = (settings.language as Language) ?? 'en'
  const content = settings.homeNudgeMode === 'card'
    ? h(HomeNudge, { total: data.total, folders: data.folders, onOpen: openFromNudge, onDismiss: dismissNudge })
    : h(HomeTab, {
        total: data.total,
        variant: settings.homeNudgeMode === 'tab-vertical' ? 'vertical' : 'horizontal',
        side: settings.position,
        onOpen: openFromNudge,
      })

  render(
    h(I18nContext.Provider, { value: lang }, content),
    nudgeMount,
  )
}

function removeNudge(): void {
  if (nudgeMount) render(null, nudgeMount)
  if (nudgeEl?.parentElement) nudgeEl.remove()
  nudgeEl = null
  nudgeShadow = null
  nudgeMount = null
}

// Re-render the home entry (card / tab / nothing) when its mode or the sidebar
// position changes while the user is sitting on the home page.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (!changes['mytube-home-nudge-mode'] && !changes['mytube-sidebar-position']) return
  if (!isHomePage()) return
  removeNudge()
  nudgeDismissed = false
  void showHomeNudge()
})

// ── Navigation listener ──────────────────────────────────────────────────────

document.addEventListener('yt-navigate-finish', () => {
  if (rootEl?.parentElement) closeFeed()

  const onHome = isHomePage()
  if (onHome && !wasOnHome) {
    nudgeDismissed = false
    void showHomeNudge()
  } else if (!onHome && wasOnHome) {
    if (nudgeEl?.parentElement) {
      if (nudgeMount) render(null, nudgeMount)
      nudgeEl.remove()
    }
  }
  wasOnHome = onHome
})

if (isHomePage()) {
  wasOnHome = true
  void showHomeNudge()
}
