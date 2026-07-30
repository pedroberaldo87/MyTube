import { isDarkMode } from '../shared/selectors'

export type ColorMode = 'dark' | 'light'
export type StyleTheme = 'void' | 'prism'
export type AccentColor = 'coral' | 'teal' | 'violet' | 'rose' | 'emerald' | 'gold'
export type SidebarPosition = 'left' | 'right'
export type HomeNudgeMode = 'card' | 'tab-vertical' | 'tab-horizontal' | 'off'

export const ACCENT_COLORS: { id: AccentColor; label: string; hex: string }[] = [
  { id: 'coral', label: 'Coral', hex: '#ff6b42' },
  { id: 'teal', label: 'Teal', hex: '#14b8a6' },
  { id: 'violet', label: 'Violet', hex: '#a855f7' },
  { id: 'rose', label: 'Rose', hex: '#f43f5e' },
  { id: 'emerald', label: 'Emerald', hex: '#10b981' },
  { id: 'gold', label: 'Gold', hex: '#f59e0b' },
]

export const FONT_URLS: Record<StyleTheme, string> = {
  void: 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@600;700&family=Inter:wght@400;500;600&display=swap',
  prism: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
}

const STORAGE_KEYS = {
  theme: 'mytube-style-theme',
  accent: 'mytube-accent-color',
  position: 'mytube-sidebar-position',
  nowPlaying: 'mytube-show-nowplaying',
  language: 'mytube-language',
  openInNewTab: 'mytube-open-new-tab',
  homeNudgeMode: 'mytube-home-nudge-mode',
} as const

export interface AppSettings {
  theme: StyleTheme
  accent: AccentColor
  position: SidebarPosition
  showNowPlaying: boolean
  language: string
  openInNewTab: boolean
  homeNudgeMode: HomeNudgeMode
}

const DEFAULTS: AppSettings = {
  theme: 'prism',
  accent: 'coral',
  position: 'right',
  showNowPlaying: false,
  language: 'en',
  openInNewTab: true,
  homeNudgeMode: 'card',
}

export async function loadSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.theme,
    STORAGE_KEYS.accent,
    STORAGE_KEYS.position,
    STORAGE_KEYS.nowPlaying,
    STORAGE_KEYS.language,
    STORAGE_KEYS.openInNewTab,
    STORAGE_KEYS.homeNudgeMode,
  ])
  return {
    theme: (result[STORAGE_KEYS.theme] as StyleTheme) || DEFAULTS.theme,
    accent: (result[STORAGE_KEYS.accent] as AccentColor) || DEFAULTS.accent,
    position: (result[STORAGE_KEYS.position] as SidebarPosition) || DEFAULTS.position,
    showNowPlaying: result[STORAGE_KEYS.nowPlaying] === true,
    language: (result[STORAGE_KEYS.language] as string) || DEFAULTS.language,
    openInNewTab: result[STORAGE_KEYS.openInNewTab] !== false,
    homeNudgeMode: (result[STORAGE_KEYS.homeNudgeMode] as HomeNudgeMode) || DEFAULTS.homeNudgeMode,
  }
}

const SETTING_TO_STORAGE: Record<keyof AppSettings, string> = {
  theme: STORAGE_KEYS.theme,
  accent: STORAGE_KEYS.accent,
  position: STORAGE_KEYS.position,
  showNowPlaying: STORAGE_KEYS.nowPlaying,
  language: STORAGE_KEYS.language,
  openInNewTab: STORAGE_KEYS.openInNewTab,
  homeNudgeMode: STORAGE_KEYS.homeNudgeMode,
}

export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  const storageKey = SETTING_TO_STORAGE[key]
  await chrome.storage.local.set({ [storageKey]: value })
}

export function getColorMode(): ColorMode {
  return isDarkMode() ? 'dark' : 'light'
}

export function watchColorMode(callback: (mode: ColorMode) => void): () => void {
  const observer = new MutationObserver(() => {
    callback(getColorMode())
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['dark'],
  })
  return () => observer.disconnect()
}

export function buildClassList(
  mode: ColorMode,
  theme: StyleTheme,
  accent: AccentColor,
): string[] {
  const classes = [`mytube-${mode}`, `mytube-${theme}`]
  if (theme === 'prism') {
    classes.push(`mytube-accent-${accent}`)
  }
  return classes
}

export function watchSettings(callback: (settings: AppSettings) => void): void {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') {
      void loadSettings().then(callback)
    }
  })
}

/**
 * Modo para páginas PRÓPRIAS da extensão (dashboard/options).
 *
 * `getColorMode()` não serve aqui: ele passa por `isDarkMode()`, que procura o
 * seletor `html[dark]` do YouTube (`shared/selectors.ts`). Numa página da
 * extensão esse seletor nunca casa, então o modo ficaria travado em claro.
 * Aqui o sinal certo é a preferência do sistema — que é, aliás, o que o
 * dashboard já seguia antes de ganhar tema.
 */
export function getStandaloneColorMode(): ColorMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function watchStandaloneColorMode(callback: (mode: ColorMode) => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => { callback(mq.matches ? 'dark' : 'light') }
  mq.addEventListener('change', handler)
  return () => { mq.removeEventListener('change', handler) }
}
