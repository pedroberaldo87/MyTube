/**
 * Entrada de chave de API — página da EXTENSÃO, aberta em janela popup.
 *
 * A sidebar roda dentro do DOM do youtube.com: um script da página (ou de outra
 * extensão) alcança o campo que ela renderiza e lê o que está sendo digitado.
 * Esta página mora na origem da extensão, onde nenhum script do youtube.com
 * chega. Por isso a chave é digitada AQUI e nunca na sidebar, que só mostra o
 * estado (configurado ou não) e um botão que abre esta janela.
 *
 * O salvamento vai direto ao service worker (AI_SAVE_PROVIDER), que valida o
 * endereço, prende a chave a ele e a grava no IndexedDB da extensão.
 *
 * Sem Preact de propósito, como a página de permissão: é um formulário curto.
 */
import {
  endpointProblem,
  normalizeEndpointUrl,
  originFromUrl,
} from '../shared/ai/host-permission'
import { getLanguage, t, type Language, type TranslationKey } from '../shared/i18n'
import type { AIConfigPublic, AIProviderPublic } from '../shared/ai/types'
import {
  buildClassList,
  getStandaloneColorMode,
  loadSettings,
  FONT_URLS,
} from '../styles/theme'
import '../styles/tokens.css'

/** Id do provedor que está sendo editado; ausente = adicionar um novo. */
const editingId = new URLSearchParams(location.search).get('provider')

function errorKey(code: string | undefined): TranslationKey {
  switch (code) {
    case 'insecure-http': return 'ai.errInsecureHttp'
    case 'invalid-url': return 'ai.errInvalidUrl'
    case 'provider-not-found': return 'ai.errProviderNotFound'
    case 'forbidden-sender':
    case 'forbidden-kind': return 'ai.errInternal'
    default: return 'ai.errInternal'
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node.style, style)
  if (text !== undefined) node.textContent = text
  return node
}

async function loadEditTarget(): Promise<AIProviderPublic | 'gone' | null> {
  if (!editingId) return null
  try {
    const config = (await chrome.runtime.sendMessage({ type: 'AI_LIST_PROVIDERS' })) as AIConfigPublic
    const found = config.providers.find(p => p.id === editingId)
    // Provedor OAuth não tem chave nem endereço editáveis aqui.
    return found && found.kind === 'api-key' ? found : 'gone'
  } catch {
    return 'gone'
  }
}

async function main(): Promise<void> {
  const lang: Language = await getLanguage()
  const settings = await loadSettings()
  document.title = t('aikey.title', lang)

  const fontLink = document.createElement('link')
  fontLink.rel = 'stylesheet'
  fontLink.href = FONT_URLS[settings.theme]
  document.head.appendChild(fontLink)
  document.body.style.margin = '0'

  const root = document.getElementById('app')
  if (!root) return
  root.className = buildClassList(getStandaloneColorMode(), settings.theme, settings.accent).join(' ')
  Object.assign(root.style, {
    boxSizing: 'border-box',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--mt-spacing-md)',
    padding: 'var(--mt-spacing-xl)',
    backgroundColor: 'var(--mt-bg-primary)',
    color: 'var(--mt-text-primary)',
    fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-md)',
  })

  const title = el('h1', {
    margin: '0', fontFamily: 'var(--mt-font-display)',
    fontSize: 'var(--mt-font-size-xl)', fontWeight: '700',
  }, t(editingId ? 'aikey.titleEdit' : 'aikey.title', lang))
  root.append(title)

  const target = await loadEditTarget()
  if (target === 'gone') {
    // O provedor saiu da lista (removido na sidebar enquanto esta janela estava
    // aberta). Salvar mandaria um id morto e RECRIARIA o provedor sem chave.
    const gone = el('p', { color: 'var(--mt-error)', margin: '0' }, t('ai.errProviderNotFound', lang))
    gone.setAttribute('role', 'alert')
    root.append(gone)
    return
  }

  const fieldStyle = {
    padding: 'var(--mt-spacing-sm)', borderRadius: 'var(--mt-radius-sm)',
    border: '1px solid var(--mt-btn-border)', backgroundColor: 'var(--mt-bg-primary)',
    color: 'var(--mt-text-primary)', fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)', width: '100%', boxSizing: 'border-box',
  } satisfies Partial<CSSStyleDeclaration>

  function field(labelKey: TranslationKey, helpKey: TranslationKey, input: HTMLInputElement): HTMLLabelElement {
    const wrap = el('label', { display: 'flex', flexDirection: 'column', gap: 'var(--mt-spacing-xs)' })
    const help = el('span', { color: 'var(--mt-text-secondary)', fontSize: 'var(--mt-font-size-xs)' }, t(helpKey, lang))
    wrap.append(el('span', { fontSize: 'var(--mt-font-size-sm)', fontWeight: '600' }, t(labelKey, lang)), input, help)
    return wrap
  }

  const labelInput = el('input', fieldStyle)
  labelInput.value = target?.label ?? ''
  const urlInput = el('input', fieldStyle)
  urlInput.value = target?.baseUrl ?? ''
  urlInput.setAttribute('autocomplete', 'off')
  const keyInput = el('input', fieldStyle)
  keyInput.type = 'password'
  keyInput.setAttribute('autocomplete', 'off')

  const rebind = el('p', { color: 'var(--mt-error)', fontSize: 'var(--mt-font-size-xs)', margin: '0', display: 'none' },
    t('aikey.rebindWarning', lang))
  // O worker prende a chave ao endereço: trocar o endereço sem digitar a chave
  // de novo apaga a guardada. Avisar antes, não depois.
  const syncRebind = (): void => {
    const changed = target !== null
      && (normalizeEndpointUrl(urlInput.value) ?? urlInput.value.trim())
        !== (normalizeEndpointUrl(target.baseUrl) ?? target.baseUrl.trim())
    rebind.style.display = changed && !keyInput.value && target?.hasCredential ? 'block' : 'none'
  }
  urlInput.addEventListener('input', syncRebind)
  keyInput.addEventListener('input', syncRebind)

  const error = el('p', { color: 'var(--mt-error)', fontSize: 'var(--mt-font-size-sm)', margin: '0' })
  error.setAttribute('role', 'alert')

  const btnStyle = {
    padding: 'var(--mt-spacing-sm) var(--mt-spacing-md)',
    fontFamily: 'var(--mt-font-body)', fontSize: 'var(--mt-font-size-sm)', fontWeight: '600',
    borderRadius: 'var(--mt-radius-sm)', cursor: 'pointer',
    color: 'var(--mt-text-primary)',
  } satisfies Partial<CSSStyleDeclaration>
  const save = el('button', {
    ...btnStyle,
    backgroundColor: 'var(--mt-accent-soft)', border: '2px solid var(--mt-accent)',
  }, t('ai.save', lang))
  const cancel = el('button', {
    ...btnStyle,
    backgroundColor: 'var(--mt-btn-bg)', border: '1px solid var(--mt-btn-border)',
  }, t('ai.cancel', lang))
  cancel.addEventListener('click', () => window.close())

  save.addEventListener('click', () => {
    error.textContent = ''
    const problem = endpointProblem(urlInput.value)
    const baseUrl = normalizeEndpointUrl(urlInput.value)
    const origin = baseUrl ? originFromUrl(baseUrl) : null
    if (problem || !baseUrl || !origin) {
      error.textContent = t(errorKey(problem ?? 'invalid-url'), lang)
      return
    }
    // `permissions.request` é a primeira chamada assíncrona do clique: um await
    // antes dela gasta o gesto do usuário e o Chrome recusa sem perguntar.
    let request: Promise<boolean>
    try {
      request = chrome.permissions.request({ origins: [origin] })
    } catch {
      error.textContent = t('ai.errCannotRequest', lang)
      return
    }
    save.disabled = true
    void request
      .then(async granted => {
        if (!granted) { error.textContent = t('ai.errPermissionDenied', lang); return }
        const apiKey = keyInput.value
        const response = (await chrome.runtime.sendMessage({
          type: 'AI_SAVE_PROVIDER',
          payload: {
            id: editingId ?? crypto.randomUUID(),
            ...(editingId ? {} : { intent: 'create' as const }),
            label: labelInput.value.trim() || baseUrl,
            kind: 'api-key',
            baseUrl,
            // Sem `model`: o worker preserva o gravado, ou zera se o endereço mudou.
            ...(apiKey ? { apiKey } : {}),
          },
        })) as { ok: boolean; error?: string } | undefined
        if (!response?.ok) { error.textContent = t(errorKey(response?.error), lang); return }
        keyInput.value = ''
        window.close()
      })
      .catch(() => { error.textContent = t('ai.errCannotRequest', lang) })
      .finally(() => { save.disabled = false })
  })

  const buttons = el('div', { display: 'flex', gap: 'var(--mt-spacing-sm)' })
  buttons.append(save, cancel)
  root.append(
    field('ai.labelField', 'ai.labelHelp', labelInput),
    field('ai.urlField', 'ai.urlHelp', urlInput),
    field('ai.keyField', target ? 'ai.keyHelpEdit' : 'ai.keyHelp', keyInput),
    rebind,
    error,
    buttons,
  )
}

void main()
