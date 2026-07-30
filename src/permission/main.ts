/**
 * Diálogo de permissão de host — página de propósito único.
 *
 * `chrome.permissions.request` só existe em página da extensão, e a interface do
 * app é a sidebar (mundo isolado do content script, onde `chrome.permissions` é
 * undefined). Então UM clique — o aceite — sai da sidebar e vem para cá, numa
 * janela popup pequena que pede a permissão e se fecha. Não é tela de
 * configuração: é um diálogo com uma linha e um botão.
 *
 * Sem Preact de propósito: é um parágrafo e um botão.
 */
import { originFromUrl, type PermissionOutcome } from '../shared/ai/host-permission'
import { getLanguage, t } from '../shared/i18n'
import {
  buildClassList,
  getStandaloneColorMode,
  loadSettings,
  FONT_URLS,
} from '../styles/theme'
import '../styles/tokens.css'

const params = new URLSearchParams(location.search)

/** Correlaciona o desfecho com quem pediu (contém o id da aba da sidebar). */
const requestId = params.get('request') ?? ''

/**
 * A origem chega já normalizada do background, mas a página passa ela de novo
 * pelo `originFromUrl`: é o mesmo validador do resto do app e recusa o que não
 * for http(s) — a página não pede permissão para o que veio cru na URL.
 */
const origin = originFromUrl(params.get('origin') ?? '')

/** Entrega o desfecho e sai. A janela existe só para este clique. */
async function report(outcome: PermissionOutcome): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'AI_HOST_PERMISSION_RESULT',
      payload: { requestId, outcome },
    })
  } catch {
    // Quem pediu já desistiu (aba fechada, worker reiniciado): fechar é o que resta.
  }
  window.close()
}

async function main(): Promise<void> {
  const lang = await getLanguage()
  const settings = await loadSettings()
  document.title = t('perm.title', lang)

  if (!origin) {
    await report('invalid-url')
    return
  }

  // A fonte é do tema, igual ao dashboard.
  const fontLink = document.createElement('link')
  fontLink.rel = 'stylesheet'
  fontLink.href = FONT_URLS[settings.theme]
  document.head.appendChild(fontLink)

  document.body.style.margin = '0'

  const root = document.getElementById('app')
  if (!root) return

  root.className = buildClassList(
    getStandaloneColorMode(),
    settings.theme,
    settings.accent,
  ).join(' ')
  Object.assign(root.style, {
    boxSizing: 'border-box',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--mt-spacing-lg)',
    padding: 'var(--mt-spacing-xl)',
    backgroundColor: 'var(--mt-bg-primary)',
    color: 'var(--mt-text-primary)',
    fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-md)',
  })

  const title = document.createElement('h1')
  title.textContent = t('perm.title', lang)
  Object.assign(title.style, {
    margin: '0',
    fontFamily: 'var(--mt-font-display)',
    fontSize: 'var(--mt-font-size-xl)',
    fontWeight: '700',
  })

  const line = document.createElement('p')
  Object.assign(line.style, { margin: '0' })
  line.append(`${t('perm.line', lang)} `)
  const hostEl = document.createElement('strong')
  hostEl.textContent = new URL(origin).host
  line.append(hostEl)

  // Mesma ênfase do botão ativo do painel (accent-soft + borda 2px accent), com
  // o rótulo em --mt-text-primary: --mt-accent como cor de texto falha WCAG AA
  // em 4 dos 14 cruzamentos de tema.
  const button = document.createElement('button')
  button.textContent = t('perm.allow', lang)
  Object.assign(button.style, {
    alignSelf: 'flex-start',
    padding: 'var(--mt-spacing-sm) var(--mt-spacing-md)',
    fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-sm)',
    fontWeight: '600',
    borderRadius: 'var(--mt-radius-sm)',
    cursor: 'pointer',
    transition: 'var(--mt-transition-fast)',
    backgroundColor: 'var(--mt-accent-soft)',
    border: '2px solid var(--mt-accent)',
    color: 'var(--mt-text-primary)',
  })

  button.addEventListener('click', () => {
    // `permissions.request` é a primeira instrução do clique: qualquer await
    // antes dela gasta o gesto do usuário e o Chrome recusa sem perguntar.
    let request: Promise<boolean>
    try {
      request = chrome.permissions.request({ origins: [origin] })
    } catch {
      void report('cannot-request')
      return
    }
    button.disabled = true
    void request
      .then(granted => report(granted ? 'granted' : 'denied'))
      .catch(() => report('cannot-request'))
  })

  root.append(title, line, button)
}

void main()
