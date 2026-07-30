import tokensCSS from '../../styles/tokens.css?inline'
import { buildClassList, getColorMode, loadSettings } from '../../styles/theme'

/**
 * Raiz Shadow DOM PRÓPRIA, pendurada no document.body, para o que precisa cobrir
 * a página inteira a partir da sidebar.
 *
 * Existe porque `position: fixed` NÃO escapa da sidebar. Dois motivos somados, os
 * dois confirmados na tela (o modal estava no DOM e invisível no print):
 *
 *   1. `sidebar/mount.ts` mantém um `transform: translateX(0)` no host enquanto a
 *      sidebar está aberta — é o estado final da animação de entrada. Qualquer
 *      transform num ancestral vira bloco de contenção de `fixed`, então o overlay
 *      passava a ser posicionado dentro dos 420px da sidebar em vez da viewport.
 *   2. `Sidebar.tsx` fecha o container com `overflow: hidden`, que recorta o resto.
 *
 * Tirar o transform quebraria a animação; então o overlay sai da árvore da
 * sidebar, exatamente como o feed e o nudge já fazem em `feed/mount.ts`.
 */
export function createOverlayRoot(id: string): { mount: HTMLElement; destroy: () => void } {
  const host = document.createElement('div')
  host.id = id
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = `${tokensCSS}\n*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }`
  shadow.appendChild(style)

  const mount = document.createElement('div')
  shadow.appendChild(mount)
  document.body.appendChild(host)

  // O tema chega depois (leitura assíncrona do storage). Até lá o overlay usa os
  // tokens padrão — nunca fica sem cor, só sem a preferência do usuário por um quadro.
  void loadSettings().then(settings => {
    if (!host.isConnected) return
    host.className = buildClassList(getColorMode(), settings.theme, settings.accent).join(' ')
  })

  return { mount, destroy: () => host.remove() }
}
