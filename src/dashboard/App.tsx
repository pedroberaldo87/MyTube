import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import type { AppState } from '../shared/types'
import { sendMessage } from '../shared/messages'
import { useT } from '../shared/i18n'
import { Channels } from './pages/Channels'
import { Playlists } from './pages/Playlists'
import { Folders } from './pages/Folders'
import { Settings } from './pages/Settings'

type Tab = 'channels' | 'playlists' | 'folders' | 'settings'

export function App() {
  const t = useT()

  const tabs: { id: Tab; label: string }[] = [
    { id: 'channels', label: t('dashboard.channels') },
    { id: 'playlists', label: t('dashboard.playlists') },
    { id: 'folders', label: t('dashboard.folders') },
    { id: 'settings', label: t('dashboard.settings') },
  ]
  const [activeTab, setActiveTab] = useState<Tab>('channels')
  const [appState, setAppState] = useState<AppState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadState = async () => {
    try {
      setLoading(true)
      setError(null)
      const state = await sendMessage({ type: 'GET_STATE' })
      setAppState(state)
    } catch (err) {
      setError(t('dashboard.error'))
      console.error('[Dashboard] Failed to load state:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadState()
  }, [])

  const renderPage = () => {
    if (loading) {
      return (
        <div style={styles.centered}>
          <div style={styles.spinner} />
          <p style={{ color: 'var(--mt-text-secondary)', marginTop: 16 }}>{t('dashboard.loading')}</p>
        </div>
      )
    }

    if (error || !appState) {
      return (
        <div style={styles.centered}>
          <p style={{ color: 'var(--mt-error)' }}>{error ?? t('dashboard.error')}</p>
          <button style={styles.retryBtn} onClick={() => void loadState()}>
            {t('dashboard.retry')}
          </button>
        </div>
      )
    }

    const props = { appState, onRefresh: loadState }

    switch (activeTab) {
      case 'channels':  return <Channels {...props} />
      case 'playlists': return <Playlists {...props} />
      case 'folders':   return <Folders {...props} />
      case 'settings':  return <Settings {...props} />
    }
  }

  return (
    <div style={styles.root}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <span style={styles.logo}>
            <span style={{ color: '#ff0000', fontWeight: 700 }}>My</span>
            <span style={{ color: 'var(--mt-text-primary)', fontWeight: 700 }}>Tube</span>
          </span>
          <nav style={styles.nav}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                style={{
                  ...styles.navBtn,
                  ...(activeTab === tab.id ? styles.navBtnActive : {}),
                }}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main style={styles.main}>
        {renderPage()}
      </main>
    </div>
  )
}

const styles: Record<string, h.JSX.CSSProperties> = {
  root: {
    minHeight: '100vh',
    backgroundColor: 'var(--mt-bg-primary)',
    color: 'var(--mt-text-primary)',
  },
  header: {
    backgroundColor: 'var(--mt-bg-secondary)',
    borderBottom: '1px solid var(--mt-border)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  headerInner: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    gap: 32,
    height: 56,
  },
  logo: {
    fontSize: 20,
    letterSpacing: '-0.3px',
    flexShrink: 0,
  },
  nav: {
    display: 'flex',
    gap: 4,
  },
  navBtn: {
    // longhand de propósito: `background: none` é expandido em longhands no parse,
    // então ao sair do estado ativo o Preact remove o background-color e nada mais
    // o declara — o botão cairia no buttonface do UA e a aba inativa pareceria a
    // selecionada
    backgroundColor: 'transparent',
    // a caixa da aba ativa já fica reservada aqui: a borda de 2px é transparente
    // no estado base e o peso não muda ao ativar, senão a barra pularia a cada clique
    border: '2px solid transparent',
    // mesmo token do estado ativo: a aba inativa é controle interativo, não texto
    // auxiliar. Sobre o --mt-bg-secondary do header, --mt-text-secondary mede 2,42
    // (void/light) a 5,74 (prism/dark) e reprova AA em 3 dos 4 cruzamentos de base;
    // --mt-text-primary mede 15,18 a 17,18. O par ativo/inativo difere por fundo e
    // borda — o padrão de ênfase — nunca por legibilidade
    color: 'var(--mt-text-primary)',
    fontSize: 14,
    fontWeight: 500,
    padding: '6px 14px',
    borderRadius: 20,
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  },
  navBtnActive: {
    backgroundColor: 'var(--mt-accent-soft)',
    border: '2px solid var(--mt-accent)',
    color: 'var(--mt-text-primary)',
  },
  main: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '32px 24px',
  },
  centered: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 300,
    gap: 12,
  },
  spinner: {
    width: 36,
    height: 36,
    border: '3px solid var(--mt-border)',
    borderTop: '3px solid var(--mt-accent)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  retryBtn: {
    backgroundColor: 'var(--mt-accent-soft)',
    border: '2px solid var(--mt-accent)',
    color: 'var(--mt-text-primary)',
    fontWeight: 600,
    borderRadius: 20,
    padding: '8px 20px',
    fontSize: 14,
    cursor: 'pointer',
  },
}

// Inject keyframes for spinner
const styleEl = document.createElement('style')
styleEl.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`
document.head.appendChild(styleEl)
