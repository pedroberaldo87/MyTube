import { h, render } from 'preact'
import { Sidebar } from './Sidebar'
import {
  getColorMode,
  watchColorMode,
  loadSettings,
  watchSettings,
  buildClassList,
  FONT_URLS,
  type StyleTheme,
  type AccentColor,
  type SidebarPosition,
} from '../../styles/theme'
import tokensCSS from '../../styles/tokens.css?inline'

const ROOT_ID = 'mytube-sidebar-root'

if (!document.getElementById(ROOT_ID)) {
  const rootEl = document.createElement('div')
  rootEl.id = ROOT_ID
  Object.assign(rootEl.style, {
    position: 'fixed',
    top: '0',
    height: '100vh',
    zIndex: '2147483647',
    pointerEvents: 'none',
  })

  document.body.appendChild(rootEl)

  const shadow = rootEl.attachShadow({ mode: 'open' })

  // ── Font management ─────────────────────────────────────────────────────

  let fontLink: HTMLLinkElement | null = null

  function loadFont(theme: StyleTheme): void {
    const url = FONT_URLS[theme]
    if (fontLink && fontLink.href === url) return
    if (fontLink) fontLink.remove()
    fontLink = document.createElement('link')
    fontLink.rel = 'stylesheet'
    fontLink.href = url
    shadow.prepend(fontLink)
    if (!document.querySelector(`link[href="${url}"]`)) {
      const docLink = document.createElement('link')
      docLink.rel = 'stylesheet'
      docLink.href = url
      document.head.appendChild(docLink)
    }
  }

  // ── Design tokens ───────────────────────────────────────────────────────

  const styleEl = document.createElement('style')
  styleEl.textContent = tokensCSS
  shadow.appendChild(styleEl)

  // ── Reset + keyframes + scrollbar ───────────────────────────────────────

  const resetEl = document.createElement('style')
  resetEl.textContent = `
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    :host {
      all: initial;
      display: block;
      font-family: var(--mt-font-body);
    }

    @keyframes mt-slideInRight {
      from { transform: translateX(100%); opacity: 0.5; }
      to   { transform: translateX(0);    opacity: 1; }
    }
    @keyframes mt-slideOutRight {
      from { transform: translateX(0);    opacity: 1; }
      to   { transform: translateX(100%); opacity: 0.5; }
    }
    @keyframes mt-slideInLeft {
      from { transform: translateX(-100%); opacity: 0.5; }
      to   { transform: translateX(0);     opacity: 1; }
    }
    @keyframes mt-slideOutLeft {
      from { transform: translateX(0);     opacity: 1; }
      to   { transform: translateX(-100%); opacity: 0.5; }
    }
    @keyframes mt-fadeReveal {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes mt-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes mt-slide-down {
      from { opacity: 0; transform: translateY(-8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes eq-bounce {
      0%   { transform: scaleY(0.3); opacity: 0.55; }
      100% { transform: scaleY(1);   opacity: 1; }
    }
    @keyframes mt-spin {
      to { transform: rotate(360deg); }
    }

    .mt-btn-pill:hover {
      background: var(--mt-bg-hover) !important;
      border-color: var(--mt-accent) !important;
      transform: scale(1.03);
    }
    .mt-btn-round:hover {
      background: var(--mt-bg-hover) !important;
      color: var(--mt-text-primary) !important;
      transform: scale(1.08);
    }
    .mt-item-row:hover { background: var(--mt-bg-elevated); }
    .mt-item-row:hover .mt-item-menu { opacity: 1 !important; }
    .mt-folder-card:hover { border-color: rgba(255,107,66,0.3); }
    .mt-video-card:hover { background-color: var(--mt-bg-hover) !important; }

    ::-webkit-scrollbar {
      width: 6px;
    }
    ::-webkit-scrollbar-track {
      background: var(--mt-scrollbar-track);
    }
    ::-webkit-scrollbar-thumb {
      background: var(--mt-scrollbar-thumb);
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--mt-bg-hover);
    }

    .mt-reveal {
      animation: mt-fadeReveal 200ms ease-out both;
    }
  `
  shadow.appendChild(resetEl)

  const mountPoint = document.createElement('div')
  mountPoint.style.height = '100%'
  shadow.appendChild(mountPoint)

  for (const evt of ['keydown', 'keyup', 'keypress'] as const) {
    mountPoint.addEventListener(evt, (e) => { e.stopPropagation() })
  }

  // ── State ───────────────────────────────────────────────────────────────

  let currentPosition: SidebarPosition = 'right'
  let currentTheme: StyleTheme = 'prism'
  let currentAccent: AccentColor = 'coral'

  // ── Theme + class management ────────────────────────────────────────────

  function applyClasses(theme: StyleTheme, accent: AccentColor): void {
    const mode = getColorMode()
    const classes = buildClassList(mode, theme, accent)
    rootEl.className = classes.join(' ')
    currentTheme = theme
    currentAccent = accent
  }

  function reapplyMode(): void {
    applyClasses(currentTheme, currentAccent)
  }

  // ── Position management ─────────────────────────────────────────────────

  function applyPosition(pos: SidebarPosition): void {
    currentPosition = pos
    if (pos === 'left') {
      rootEl.style.left = '0'
      rootEl.style.right = ''
    } else {
      rootEl.style.right = '0'
      rootEl.style.left = ''
    }
    if (!visible) {
      rootEl.style.transform = pos === 'left' ? 'translateX(-100%)' : 'translateX(100%)'
    }
  }

  // ── Initialize from settings ────────────────────────────────────────────

  void loadSettings().then((settings) => {
    loadFont(settings.theme)
    applyClasses(settings.theme, settings.accent)
    applyPosition(settings.position)
  })

  watchColorMode(reapplyMode)

  watchSettings((settings) => {
    loadFont(settings.theme)
    applyClasses(settings.theme, settings.accent)
    applyPosition(settings.position)
  })

  // ── Visibility toggle with slide animation ────────────────────────────

  let visible = false

  function slideInAnim(): string {
    return currentPosition === 'left'
      ? 'mt-slideInLeft 280ms cubic-bezier(0.16, 1, 0.3, 1) forwards'
      : 'mt-slideInRight 280ms cubic-bezier(0.16, 1, 0.3, 1) forwards'
  }

  function slideOutAnim(): string {
    return currentPosition === 'left'
      ? 'mt-slideOutLeft 220ms cubic-bezier(0.4, 0, 1, 1) forwards'
      : 'mt-slideOutRight 220ms cubic-bezier(0.4, 0, 1, 1) forwards'
  }

  function hiddenTransform(): string {
    return currentPosition === 'left' ? 'translateX(-100%)' : 'translateX(100%)'
  }

  function show(animate = true): void {
    if (visible) return
    visible = true
    chrome.storage.local.set({ 'mytube-sidebar-open': true })
    rootEl.style.pointerEvents = 'auto'
    rootEl.style.transform = 'translateX(0)'

    if (animate) {
      rootEl.style.animation = 'none'
      rootEl.offsetHeight
      rootEl.style.animation = slideInAnim()
      rootEl.addEventListener('animationend', () => {
        rootEl.style.animation = ''
        rootEl.style.transform = 'translateX(0)'
      }, { once: true })
    } else {
      rootEl.style.animation = ''
    }
  }

  function hide(): void {
    if (!visible) return
    visible = false
    chrome.storage.local.set({ 'mytube-sidebar-open': false })
    rootEl.style.animation = slideOutAnim()

    rootEl.addEventListener('animationend', () => {
      rootEl.style.animation = ''
      rootEl.style.transform = hiddenTransform()
      rootEl.style.pointerEvents = 'none'
    }, { once: true })

    setTimeout(() => {
      if (!visible) {
        rootEl.style.animation = ''
        rootEl.style.transform = hiddenTransform()
        rootEl.style.pointerEvents = 'none'
      }
    }, 300)
  }

  chrome.storage.local.get('mytube-sidebar-open', (result) => {
    if (result['mytube-sidebar-open'] === true) {
      show(false)
    }
  })

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // ⌘ no Mac, Ctrl no resto. Só `metaKey` deixava Windows e Linux sem atalho
    // nenhum — e o README anunciava o atalho, então a tecla não respondia e
    // parecia defeito da extensão.
    if ((e.metaKey || e.ctrlKey) && e.key === '.') {
      e.preventDefault()
      if (visible) hide()
      else show()
    }
  })

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'TOGGLE_SIDEBAR') {
      if (visible) hide()
      else show()
    }
  })

  // ── Render Preact app ─────────────────────────────────────────────────

  render(
    h(Sidebar, { onClose: hide }),
    mountPoint
  )
}
