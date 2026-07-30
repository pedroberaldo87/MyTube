import { h, render } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { App } from './App'
import { I18nContext, type Language } from '../shared/i18n'
import {
  loadSettings,
  watchSettings,
  buildClassList,
  getStandaloneColorMode,
  watchStandaloneColorMode,
  FONT_URLS,
  type AppSettings,
  type ColorMode,
} from '../styles/theme'
import '../styles/tokens.css'

function Root() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [mode, setMode] = useState<ColorMode>(getStandaloneColorMode)

  useEffect(() => {
    void loadSettings().then(setSettings)
    watchSettings(setSettings)
    return watchStandaloneColorMode(setMode)
  }, [])

  // A fonte é do tema, então vive no <head> e troca quando o tema troca.
  useEffect(() => {
    if (!settings) return
    const url = FONT_URLS[settings.theme]
    let link = document.getElementById('mt-font') as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = 'mt-font'
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    if (link.href !== url) link.href = url
  }, [settings])

  // Não renderiza antes de saber o tema: senão a página pisca com o tema errado.
  if (!settings) return null

  return (
    <div
      className={buildClassList(mode, settings.theme, settings.accent).join(' ')}
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--mt-bg-primary)',
        color: 'var(--mt-text-primary)',
        fontFamily: 'var(--mt-font-body)',
      }}
    >
      <I18nContext.Provider value={(settings.language as Language) ?? 'en'}>
        <App />
      </I18nContext.Provider>
    </div>
  )
}

document.body.style.margin = '0'
render(<Root />, document.getElementById('app')!)
