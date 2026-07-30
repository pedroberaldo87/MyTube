import { sendMessage } from '../../shared/messages'
import { pollDeviceAuthOnce, type DeviceAuthStart } from '../../shared/ai/device-auth'

/**
 * Dono do device flow do ChatGPT. Vive no MÓDULO, não no componente:
 * o service worker MV3 morre em ~30 s e o componente desmonta a cada refresh
 * de tag ou troca de aba — se o laço morresse com ele, o código que o usuário
 * já aprovou ficaria órfão em silêncio.
 *
 * Sobrevive à remontagem do COMPONENTE, não a reload da página nem a fechar a
 * aba: todo o estado é memória, sem persistência.
 */

/**
 * 'finishing' = o código já foi trocado por tokens e a gravação está em voo.
 * Estado próprio porque cancelar aqui é impossível: a mensagem já saiu para o
 * background e o provedor vai ser gravado. A UI para de oferecer o Cancelar em
 * vez de prometer o que não pode cumprir.
 */
export type DeviceFlowStatus = 'idle' | 'waiting' | 'finishing' | 'done' | 'error' | 'cancelled'

export interface DeviceFlowState {
  start: DeviceAuthStart | null
  status: DeviceFlowStatus
  /** Código de erro (a UI traduz) ou mensagem crua do provedor. */
  error: string | null
}

const TOTAL_MS = 15 * 60 * 1000

let state: DeviceFlowState = { start: null, status: 'idle', error: null }
/**
 * Identidade da execução viva. Cancelar ou começar de novo incrementa: qualquer
 * laço com geração velha morre no próximo checkpoint — não pola, não grava token,
 * não emite estado. Um booleano compartilhado não serve, porque o start seguinte
 * o zeraria e ressuscitaria o laço cancelado.
 */
let generation = 0
const listeners = new Set<(s: DeviceFlowState) => void>()

function emit(patch: Partial<DeviceFlowState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener(state)
}

export function getDeviceFlowState(): DeviceFlowState {
  return state
}

export function subscribeDeviceFlow(listener: (s: DeviceFlowState) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Só o usuário encerra um fluxo em andamento — desmontar a UI não encerra.
 * Só vale em 'waiting': em 'finishing' a troca já foi despachada e cancelar não
 * desfaria a gravação, então o botão nem é oferecido nessa janela.
 */
export function cancelDeviceFlow(): void {
  if (state.status !== 'waiting') return
  generation++
  emit({ start: null, status: 'cancelled', error: null })
}

/**
 * O erro é do device flow, mas quem o exibe é a UI — e quando a UI começa OUTRA
 * ação (salvar endpoint, abrir/fechar o formulário) esse erro já foi consumido:
 * deixá-lo vivo faz a tela mostrar o motivo de uma ação no lugar do da outra.
 * Só zera `error`, e só fora de fluxo em andamento; nunca toca em `generation`,
 * senão uma ação qualquer da UI mataria em silêncio o laço que roda fora da
 * árvore Preact.
 */
export function clearDeviceFlowError(): void {
  if (state.status === 'waiting' || state.status === 'finishing') return
  if (state.error === null) return
  emit({ error: null })
}

export async function startDeviceFlow(): Promise<void> {
  if (state.status === 'waiting') return
  const myGen = ++generation
  emit({ start: null, status: 'waiting', error: null })
  try {
    const start = await sendMessage({ type: 'AI_OAUTH_BEGIN' })
    if (myGen !== generation) return
    if ('error' in start) { emit({ start: null, status: 'error', error: start.error }); return }
    emit({ start })
    const deadline = Date.now() + TOTAL_MS
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, start.interval * 1000))
      if (myGen !== generation) return
      const code = await pollDeviceAuthOnce(start.deviceAuthId, start.userCode)
      if (myGen !== generation) return
      if (code) {
        // A partir daqui não há volta: a troca vai gravar o provedor. Sinaliza
        // ANTES de despachar, para a UI já ter tirado o Cancelar da tela.
        emit({ status: 'finishing' })
        const done = await sendMessage({ type: 'AI_OAUTH_COMPLETE', payload: { label: 'ChatGPT', code } })
        if (myGen !== generation) return
        if (!done.ok) { emit({ start: null, status: 'error', error: done.error ?? 'internal-error' }); return }
        emit({ start: null, status: 'done', error: null })
        return
      }
    }
    if (myGen === generation) emit({ start: null, status: 'error', error: 'device-expired' })
  } catch (err) {
    if (myGen !== generation) return
    emit({ start: null, status: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
