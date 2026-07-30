import { h } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { sendMessage } from '../../../shared/messages'
import { useT } from '../../../shared/i18n'
import { ensureHostPermission, normalizeEndpointUrl, type PermissionOutcome } from '../../../shared/ai/host-permission'
import type { AIConfigPublic, AIProviderPublic } from '../../../shared/ai/types'
import {
  cancelDeviceFlow,
  clearDeviceFlowError,
  getDeviceFlowState,
  startDeviceFlow,
  subscribeDeviceFlow,
  type DeviceFlowState,
} from '../deviceFlow'
import { optionBtnStyle, rowStyle, sectionStyle, sectionTitleStyle } from './SettingsPanel'

/**
 * A configuração de IA INTEIRA, dentro do painel da engrenagem: a interface do
 * app é a sidebar. Listar, ativar, testar, escolher modelo, editar, remover,
 * adicionar por chave e conectar conta ChatGPT acontecem aqui — nada de botão
 * que leve o usuário para fora.
 *
 * O único passo que a sidebar não consegue dar sozinha é o ACEITE de permissão
 * de host: no mundo isolado do content script `chrome.permissions` é undefined.
 * Esse clique vira uma janelinha própria (ensureHostPermission despacha para o
 * background e espera o desfecho real), e o fluxo continua aqui.
 *
 * Nenhum segredo chega nesta árvore: o background só devolve AIProviderPublic,
 * onde a credencial é o booleano `hasCredential`.
 */

interface FormState {
  /** null = novo provedor; string = editando o de mesmo id. */
  id: string | null
  label: string
  baseUrl: string
  /** Vazio ao editar significa "manter a chave atual". */
  apiKey: string
}

/**
 * Um formulário de EDIÇÃO fica órfão quando o provedor que ele edita sai da
 * lista (removido na linha ao lado, que continua clicável). Salvar um órfão
 * mandaria um id que já não existe, e o background trata id desconhecido como
 * criação: ressuscitaria o provedor SEM a chave e o promoveria a ativo.
 * O formulário de provedor NOVO (id null) nunca é órfão — fechá-lo apagaria
 * digitação.
 */
export function formTargetGone(
  form: Pick<FormState, 'id'> | null,
  providers: readonly Pick<AIProviderPublic, 'id'>[],
): boolean {
  const id = form?.id
  if (!id) return false
  return !providers.some(p => p.id === id)
}

export function AISection() {
  const t = useT()
  const [config, setConfig] = useState<AIConfigPublic>({ providers: [], activeProviderId: null })
  const [flow, setFlow] = useState<DeviceFlowState>(getDeviceFlowState)
  const [formError, setFormError] = useState<string | null>(null)
  const [testing, setTesting] = useState<Record<string, string>>({})
  const [models, setModels] = useState<Record<string, string[] | 'loading'>>({})
  const [form, setForm] = useState<FormState | null>(null)
  /** Guarda de in-flight por ação: sem ela, duplo clique em Salvar cria dois provedores. */
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  /**
   * Geração por provedor, incrementada a cada save daquele id. É o que identifica
   * uma escrita TARDIA: limpar `testing`/`models` no save só resolve se o save
   * responder primeiro, e quem responde primeiro ninguém combinou — um Testar em
   * voo volta depois e repinta "Conectado" e o combo do servidor antigo. A resposta
   * só pinta se a geração capturada antes do envio ainda for a corrente. Fica em
   * ref porque é lida no meio de um await, e não em render.
   */
  const generation = useRef<Record<string, number>>({})

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    if (busy[key]) return
    setBusy(prev => ({ ...prev, [key]: true }))
    try { await fn() } finally { setBusy(prev => ({ ...prev, [key]: false })) }
  }, [busy])

  const reload = useCallback(async () => {
    const next = await sendMessage({ type: 'AI_LIST_PROVIDERS' })
    setConfig(next)
    // Só o formulário que perdeu o alvo fecha; o resto (inclusive o de provedor
    // novo) sobrevive à recarga com o que já foi digitado.
    let orphan = false
    setForm(prev => {
      orphan = formTargetGone(prev, next.providers)
      return orphan ? null : prev
    })
    // O erro é DO formulário e morre com ele: fechar o órfão sem apagá-lo deixa
    // a linha vermelha acusando um campo que saiu da tela, colada no resultado
    // da ação que fechou o formulário (o Remover, que deu certo). Só aqui —
    // zerar em toda recarga apagaria o erro da ação que acabou de acontecer.
    if (orphan) setFormError(null)
  }, [])

  // O background devolve código de erro, nunca texto — a tradução é aqui.
  // Mensagem do provedor (HTTP, rede) não tem código e passa direto.
  const errorText = useCallback((code: string) => {
    switch (code) {
      case 'provider-not-found': return t('ai.errProviderNotFound')
      case 'oauth-exchange-failed': return t('ai.errOAuthExchange')
      case 'internal-error': return t('ai.errInternal')
      case 'device-expired': return t('ai.deviceExpired')
      default: return code
    }
  }, [t])

  const permissionText = useCallback((outcome: PermissionOutcome) => {
    switch (outcome) {
      case 'invalid-url': return t('ai.errInvalidUrl')
      case 'cannot-request': return t('ai.errCannotRequest')
      default: return t('ai.errPermissionDenied')
    }
  }, [t])

  useEffect(() => { void reload() }, [reload])

  // O laço de polling é do módulo, não deste componente: desmontar (fechar o
  // painel da engrenagem, trocar de aba) não pode cancelar um fluxo em andamento.
  useEffect(() => {
    setFlow(getDeviceFlowState())
    return subscribeDeviceFlow(next => {
      setFlow(next)
      if (next.status === 'done') void reload()
    })
  }, [reload])

  const connectChatGPT = useCallback(() => {
    setFormError(null)
    void startDeviceFlow()
  }, [])

  const saveProvider = useCallback(() => run('save', async () => {
    if (!form) return
    setFormError(null)
    clearDeviceFlowError()
    // A permissão é pedida na PRIMEIRA operação depois do clique.
    const outcome = await ensureHostPermission(form.baseUrl)
    if (outcome !== 'granted') { setFormError(permissionText(outcome)); return }
    const baseUrl = normalizeEndpointUrl(form.baseUrl)
    if (!baseUrl) { setFormError(t('ai.errInvalidUrl')); return }
    // O modelo é derivado do ENDEREÇO pelo mesmo motivo do resultado de teste
    // abaixo: foi escolhido numa lista que AQUELE endpoint devolveu. Trocado o
    // endereço, o modelo perde o dono e vai null — a linha volta a não afirmar
    // modelo até um novo Testar listar os do servidor novo, em vez de exibir
    // `novoEndereço · modeloAntigo` como configuração válida. A comparação é do
    // normalizado contra o que está GRAVADO para este id, nunca contra o texto
    // digitado: editar só o rótulo ou só a chave preserva o modelo.
    // O valor preservado sai do MESMO objeto, e é por isso que o formulário não
    // carrega modelo nenhum: um snapshot tirado no clique em Editar envelhece,
    // porque o combo da linha fica na tela junto do formulário e pode gravar outro
    // modelo depois — e aí um save que só trocava o rótulo reverteria em silêncio
    // a escolha que o usuário acabou de fazer.
    const stored = config.providers.find(p => p.id === form.id)
    const model = stored && stored.baseUrl === baseUrl ? stored.model : null
    await sendMessage({
      type: 'AI_SAVE_PROVIDER',
      payload: {
        id: form.id ?? crypto.randomUUID(),
        label: form.label.trim() || baseUrl,
        kind: 'api-key',
        baseUrl,
        model,
        // Chave vazia é omitida: o background preserva a que já está guardada.
        ...(form.apiKey ? { apiKey: form.apiKey } : {}),
      },
    })
    // Resultado de teste e lista de modelos são derivados do ENDEREÇO e da
    // credencial, não do id: como o id sobrevive à edição, sem isto a linha
    // continuaria afirmando "Conectado" sobre um endpoint que ninguém testou e
    // oferecendo modelos do servidor antigo. Não se compara URL — a chave, que
    // nem aparece aqui, também invalida um resultado.
    const savedId = form.id
    if (savedId) {
      generation.current[savedId] = (generation.current[savedId] ?? 0) + 1
      setTesting(prev => { const next = { ...prev }; delete next[savedId]; return next })
      setModels(prev => { const next = { ...prev }; delete next[savedId]; return next })
    }
    setForm(null)
    await reload()
  }), [config, form, permissionText, reload, run, t])

  const test = useCallback((p: AIProviderPublic) => run(`test:${p.id}`, async () => {
    // Capturada ANTES do envio: se um save daquele id acontecer no meio, a resposta
    // que voltar é de outro endereço/credencial e não pinta nada.
    const gen = generation.current[p.id] ?? 0
    const current = () => (generation.current[p.id] ?? 0) === gen
    setTesting(prev => ({ ...prev, [p.id]: t('ai.testing') }))
    const r = await sendMessage({ type: 'AI_TEST_PROVIDER', payload: { id: p.id } })
    if (!current()) return
    setTesting(prev => ({
      ...prev,
      [p.id]: r.ok
        ? `${t('ai.testOk')} · ${r.latencyMs} ms`
        : `${t('ai.testFail')}: ${r.error ? errorText(r.error) : ''}`,
    }))
    if (!r.ok) return
    setModels(prev => ({ ...prev, [p.id]: 'loading' }))
    const list = await sendMessage({ type: 'AI_LIST_MODELS', payload: { id: p.id } })
    if (!current()) return
    setModels(prev => ({ ...prev, [p.id]: list }))
  }), [errorText, run, t])

  const pickModel = useCallback((p: AIProviderPublic, model: string) => run(`model:${p.id}`, async () => {
    await sendMessage({
      type: 'AI_SAVE_PROVIDER',
      payload: { id: p.id, label: p.label, kind: p.kind, baseUrl: p.baseUrl, model },
    })
    await reload()
  }), [reload, run])

  const setActive = useCallback((p: AIProviderPublic) => run(`active:${p.id}`, async () => {
    await sendMessage({ type: 'AI_SET_ACTIVE_PROVIDER', payload: { id: p.id } })
    await reload()
  }), [reload, run])

  const remove = useCallback((p: AIProviderPublic) => run(`del:${p.id}`, async () => {
    await sendMessage({ type: 'AI_DELETE_PROVIDER', payload: { id: p.id } })
    await reload()
  }), [reload, run])

  // Cada erro se exibe onde MORA, nunca disputando uma linha única: uma linha só
  // faz um esconder o outro nos DOIS sentidos. O caso que doía: com o formulário
  // em erro, o fluxo morre no polling e o painel do código evapora da tela sem
  // uma palavra, porque o motivo dele perdia a vez para o do formulário.
  const deviceError = flow.error ? errorText(flow.error) : null

  return (
    <div style={sectionStyle}>
      <span style={sectionTitleStyle}>{t('ai.sectionTitle')}</span>

      {flow.start && (
        <div style={S.device}>
          <p style={S.deviceLabel}>{t('ai.deviceInstructions')}</p>
          <div style={S.deviceCode}>{flow.start.userCode}</div>
          <a href={flow.start.verificationUrl} target="_blank" rel="noreferrer" style={S.deviceLink}>
            {t('ai.deviceOpen')}
          </a>
          {/* Em 'finishing' a troca já foi despachada: cancelar não desfaria a
              gravação, então o botão sai da tela em vez de mentir. */}
          {flow.status === 'finishing'
            ? <p style={S.deviceWaiting}>{t('ai.deviceFinishing')}</p>
            : (
              <>
                <p style={S.deviceWaiting}>{t('ai.deviceWaiting')}</p>
                <button style={btnStyle(false)} onClick={cancelDeviceFlow}>{t('ai.cancel')}</button>
              </>
            )}
        </div>
      )}

      {/* Fica no lugar do painel: todo emit de erro do fluxo zera `start`, então
          esta linha é literalmente o que sobra onde o código estava. */}
      {deviceError && <p style={S.error}>{deviceError}</p>}

      {config.providers.length === 0 && !flow.start && !form && (
        <p style={S.empty}>{t('ai.empty')}</p>
      )}

      {config.providers.map(p => {
        const list = models[p.id]
        const isActive = config.activeProviderId === p.id
        return (
          <div key={p.id} style={{ ...S.providerRow, ...(isActive ? S.providerRowActive : null) }}>
            {/* Escolher o provedor ativo é SELEÇÃO, não comando: vira um rádio,
                a forma que já significa "um entre vários" em qualquer interface.
                Antes era um botão retangular ("Usar este") idêntico a Testar e
                Editar, três coisas de natureza diferente com o mesmo peso. */}
            <label style={S.head}>
              <input
                type="radio"
                name="mt-ai-active"
                checked={isActive}
                disabled={busy[`active:${p.id}`]}
                onChange={() => setActive(p)}
                style={S.radio}
                aria-label={t('ai.useThis')}
              />
              <strong style={S.rowLabel}>{p.label}</strong>
              {isActive && <span style={S.activeTag}>{t('ai.active')}</span>}
            </label>
            <div style={S.meta}>{p.baseUrl}{p.model ? ` · ${p.model}` : ''}</div>
            {/* Grid em vez de flex-wrap: com wrap, um rótulo longo empurrava o
                último botão sozinho para a linha de baixo (o "Remover" órfão).
                auto-fit reparte a largura entre os que couberem. */}
            <div style={S.actions}>
              <button style={btnStyle(false)} disabled={busy[`test:${p.id}`]} onClick={() => test(p)}>
                {busy[`test:${p.id}`] ? t('ai.testing') : t('ai.test')}
              </button>
              {p.kind === 'api-key' && (
                <button
                  style={btnStyle(false)}
                  onClick={() => { setFormError(null); clearDeviceFlowError(); setForm({ id: p.id, label: p.label, baseUrl: p.baseUrl, apiKey: '' }) }}
                >
                  {t('ai.edit')}
                </button>
              )}
              <button style={dangerBtnStyle()} disabled={busy[`del:${p.id}`]} onClick={() => remove(p)}>{t('ai.remove')}</button>
            </div>
            {/* Sem isso, um provedor gravado sem chave (ex.: save de um
                formulário órfão) fica indistinguível de um configurado. */}
            {!p.hasCredential && <div style={S.warn}>{t('ai.noCredential')}</div>}
            {testing[p.id] && <div style={S.meta}>{testing[p.id]}</div>}
            {list === 'loading' && <div style={S.meta}>{t('ai.loadingModels')}</div>}
            {Array.isArray(list) && list.length === 0 && <div style={S.meta}>{t('ai.noModels')}</div>}
            {Array.isArray(list) && list.length > 0 && (
              <label style={S.fieldBlock}>
                <span style={S.label}>{t('ai.model')}</span>
                <select
                  style={S.input}
                  value={p.model ?? ''}
                  disabled={busy[`model:${p.id}`]}
                  onChange={e => pickModel(p, (e.target as HTMLSelectElement).value)}
                >
                  <option value="">{t('ai.model')}…</option>
                  {list.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            )}
          </div>
        )
      })}

      {/* Colada no formulário, seu dono. Fora do ternário de propósito: dentro,
          um erro gravado depois de o formulário fechar ficaria invisível. */}
      {formError && <p style={S.error}>{formError}</p>}

      {form ? (
        <div style={S.providerRow}>
          <label style={S.fieldBlock}>
            <span style={S.label}>{t('ai.labelField')}</span>
            <input style={S.input} value={form.label}
              onInput={e => setForm({ ...form, label: (e.target as HTMLInputElement).value })} />
            <span style={S.help}>{t('ai.labelHelp')}</span>
          </label>
          <label style={S.fieldBlock}>
            <span style={S.label}>{t('ai.urlField')}</span>
            <input style={S.input} value={form.baseUrl}
              onInput={e => setForm({ ...form, baseUrl: (e.target as HTMLInputElement).value })} />
            <span style={S.help}>{t('ai.urlHelp')}</span>
          </label>
          <label style={S.fieldBlock}>
            <span style={S.label}>{t('ai.keyField')}</span>
            <input style={S.input} type="password" value={form.apiKey}
              onInput={e => setForm({ ...form, apiKey: (e.target as HTMLInputElement).value })} />
            <span style={S.help}>{form.id ? t('ai.keyHelpEdit') : t('ai.keyHelp')}</span>
          </label>
          <div style={rowStyle}>
            <button style={btnStyle(true)} disabled={busy['save']} onClick={saveProvider}>
              {busy['save'] ? t('ai.saving') : t('ai.save')}
            </button>
            <button style={btnStyle(false)} onClick={() => { setForm(null); setFormError(null); clearDeviceFlowError() }}>{t('ai.cancel')}</button>
          </div>
        </div>
      ) : (
        <div style={S.providerRow}>
          <strong style={S.rowLabel}>{t('ai.addTitle')}</strong>
          <div style={S.pathBlock}>
            <p style={S.help}>{t('ai.pathOAuth')}</p>
            <button style={btnStyle(true)} onClick={connectChatGPT}>{t('ai.connectChatGPT')}</button>
          </div>
          <div style={S.pathBlock}>
            <p style={S.help}>{t('ai.pathApiKey')}</p>
            <button style={btnStyle(false)} onClick={() => { setFormError(null); clearDeviceFlowError(); setForm({ id: null, label: '', baseUrl: '', apiKey: '' }) }}>
              {t('ai.addEndpoint')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * O par ênfase/normal é o `optionBtnStyle` do painel com UMA propriedade
 * desviando: a cor do texto. Os dois rotulam com `var(--mt-text-primary)` —
 * o par difere por fundo, borda e peso, nunca por legibilidade.
 *
 * Medido: ênfase sobre `--mt-accent-soft` passa AA nos 14 cruzamentos de tema,
 * pior caso 10,35 (o `var(--mt-accent)` do original falhava em 4 deles, prism/
 * light gold = 2,54). Normal sobre `--mt-btn-bg` passa nos 4 cruzamentos de base,
 * pior caso 13,79 (o `var(--mt-text-secondary)`, cor de texto auxiliar, dava 2,31
 * em void/light). Guarda em test/ai-button-label-contrast.test.mjs.
 */
function btnStyle(emphasis: boolean): h.JSX.CSSProperties {
  return { ...optionBtnStyle(emphasis), color: 'var(--mt-text-primary)' }
}

/**
 * Remover é o único destrutivo da seção: mesma forma do botão normal, com a
 * BORDA no token de erro. O rótulo segue em --mt-text-primary porque
 * `var(--mt-error)` sobre `var(--mt-btn-bg)` mede 4,43 em void/light — reprova
 * AA por pouco, e o aviso de perigo não precisa custar legibilidade.
 */
function dangerBtnStyle(): h.JSX.CSSProperties {
  return {
    ...optionBtnStyle(false),
    border: '1px solid var(--mt-error)',
    color: 'var(--mt-text-primary)',
  }
}

/** Tudo daqui sai dos tokens: nenhum valor visual novo nasce nesta seção. */
const S: Record<string, h.JSX.CSSProperties> = {
  empty: { color: 'var(--mt-text-secondary)', fontSize: 'var(--mt-font-size-sm)', margin: 0 },
  error: { color: 'var(--mt-error)', fontSize: 'var(--mt-font-size-sm)', margin: 0 },
  device: {
    border: '1px solid var(--mt-accent)', borderRadius: 'var(--mt-radius-md)',
    padding: 'var(--mt-spacing-md)', textAlign: 'center',
    display: 'flex', flexDirection: 'column', gap: 'var(--mt-spacing-sm)', alignItems: 'center',
  },
  deviceLabel: { color: 'var(--mt-text-secondary)', fontSize: 'var(--mt-font-size-sm)', margin: 0 },
  deviceCode: {
    fontSize: 'var(--mt-font-size-xl)', fontWeight: 800, letterSpacing: '4px',
    color: 'var(--mt-text-primary)', fontFamily: 'var(--mt-font-display)',
  },
  deviceLink: { color: 'var(--mt-accent)', fontSize: 'var(--mt-font-size-sm)', fontWeight: 600 },
  deviceWaiting: { color: 'var(--mt-text-secondary)', fontSize: 'var(--mt-font-size-xs)', margin: 0 },
  providerRow: {
    border: '1px solid var(--mt-border)', borderRadius: 'var(--mt-radius-md)',
    padding: 'var(--mt-spacing-md)',
    display: 'flex', flexDirection: 'column', gap: 'var(--mt-spacing-sm)',
  },
  /** O card ativo se distingue pela BORDA, não por fundo: o card já é a moldura. */
  providerRowActive: { border: '2px solid var(--mt-accent)' },
  head: { display: 'flex', alignItems: 'center', gap: 'var(--mt-spacing-sm)', cursor: 'pointer' },
  radio: { width: '16px', height: '16px', flexShrink: 0, margin: 0, accentColor: 'var(--mt-accent)', cursor: 'pointer' },
  /**
   * TRÊS colunas fixas porque são exatamente três os comandos possíveis (testar,
   * editar, remover) e só o editar é condicional. O card sem editar deixa a
   * coluna vazia — botão nenhum muda de tamanho por vizinhança, e nenhum sobra
   * sozinho na linha de baixo.
   *
   * As duas alternativas foram medidas na tela e reprovaram: `flex-wrap` (o que
   * havia) jogava o Remover para a linha seguinte quando o rótulo do provedor
   * era longo, e `auto-fit minmax(88px,132px)` fazia o mesmo — auto-fit decide
   * quantas colunas cabem pelo MÁXIMO do track, então 132px só rendia duas.
   */
  actions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 'var(--mt-spacing-xs)',
  },
  rowLabel: {
    color: 'var(--mt-text-primary)', fontSize: 'var(--mt-font-size-md)',
    flex: 1, fontFamily: 'var(--mt-font-display)',
  },
  meta: { color: 'var(--mt-text-secondary)', fontSize: 'var(--mt-font-size-xs)', wordBreak: 'break-all' },
  warn: { color: 'var(--mt-error)', fontSize: 'var(--mt-font-size-xs)' },
  activeTag: {
    color: 'var(--mt-accent)', fontSize: 'var(--mt-font-size-xs)',
    fontWeight: 700, textTransform: 'uppercase',
  },
  pathBlock: {
    display: 'flex', flexDirection: 'column',
    gap: 'var(--mt-spacing-xs)', alignItems: 'flex-start',
  },
  fieldBlock: { display: 'flex', flexDirection: 'column', gap: 'var(--mt-spacing-xs)' },
  label: { color: 'var(--mt-text-primary)', fontSize: 'var(--mt-font-size-sm)', fontWeight: 600 },
  help: { color: 'var(--mt-text-secondary)', fontSize: 'var(--mt-font-size-xs)', margin: 0 },
  input: {
    padding: 'var(--mt-spacing-sm)', borderRadius: 'var(--mt-radius-sm)',
    border: '1px solid var(--mt-btn-border)', backgroundColor: 'var(--mt-bg-primary)',
    color: 'var(--mt-text-primary)', fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)', minWidth: 0, width: '100%', boxSizing: 'border-box',
  },
}
