import { h } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import type { Folder, Organizable } from '../../../shared/types'
import type { CategorizeSuggestion } from '../../../shared/ai/types'
import { sendMessage } from '../../../shared/messages'
import { addFolder } from '../../../shared/storage'
import { flattenFolders } from '../../../shared/folders'
import { useT } from '../../../shared/i18n'
import { createOverlayRoot } from '../overlayRoot'

/**
 * Categorização por IA da Library — o par automático do BatchActionBar, na mesma
 * tela onde a organização é feita à mão.
 *
 * Duas decisões que sustentam o resto:
 *
 * 1. O LAÇO DE LOTES É AQUI, não no service worker. Uma biblioteca de 300 canais
 *    são ~8 inferências em série; o MV3 mata o worker em ~30s de ociosidade e
 *    esse é exatamente o mesmo motivo pelo qual o device flow vive fora dele.
 *    O background responde UM lote por mensagem e some. De quebra, é o que dá
 *    a barra de progresso de graça.
 *
 * 2. NADA É GRAVADO SEM REVISÃO. O background devolve palpite: `folderId` quando
 *    caiu numa pasta existente, `newFolder` quando propôs um nome. Pasta só nasce
 *    no Aplicar, e o usuário pode trocar o destino ou desmarcar item a item.
 */

/**
 * 20 por chamada. O número saiu de MEDIÇÃO contra um endpoint real (Qwen3.6-35B
 * via omlx), não de intuição: 5 itens → 32s, 15 → 64s, 40 → 93s, sempre com o
 * parse casando 100%. Lote maior é mais eficiente por item, mas cada lote é um
 * trecho em que a tela não tem NADA de novo para mostrar — e foi exatamente por
 * isso que a primeira versão (lote 40) parecia travada. 20 troca um pouco de
 * eficiência por linhas aparecendo ~2× mais cedo.
 */
const BATCH_SIZE = 20

/** Mesma cor que o "+ nova pasta" do BatchActionBar usa. */
const NEW_FOLDER_COLOR = '#e8a838'

/**
 * Marca, no id, a pasta que ainda não existe. É o que permite realimentar as
 * propostas dos lotes anteriores usando o mesmo campo `folders` da mensagem, sem
 * inventar protocolo e sem criar pasta nenhuma antes do Aplicar. Vai e volta pelo
 * background intacto, porque lá o casamento é por NOME.
 */
const PROPOSED_PREFIX = 'proposed:'

/** Destino escolhido por linha. `null` = não mexe neste item. */
type Choice = { folderId: string } | { newFolder: string } | null

/** Itens que vão para o MESMO destino, a unidade de revisão do modal. */
interface Group {
  key: string
  label: string
  isNew: boolean
  items: Organizable[]
}

interface Props {
  items: Organizable[]
  folders: Folder[]
  onApplied: () => void
  onClose: () => void
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

export function AICategorizePanel({ items, folders, onApplied, onClose }: Props) {
  const t = useT()
  const [done, setDone] = useState(0)
  const [running, setRunning] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  /** Ordem de exibição: só os itens que a IA de fato classificou. */
  const [answered, setAnswered] = useState<string[]>([])
  const [applying, setApplying] = useState(false)
  /**
   * Gravar 813 itens leva ~165s: cada UPDATE_ORGANIZABLE relê e regrava o estado
   * inteiro. Sem contador, o Aplicar reproduzia exatamente o defeito que a análise
   * acabou de perder — quase três minutos de tela imóvel depois de um clique.
   */
  const [applied, setApplied] = useState(0)
  /** Ver a nota em `isChecked`: guarda-se quem SAIU, não quem entrou. */
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [applyTotal, setApplyTotal] = useState(0)
  /**
   * Fechar o painel no meio do laço não pode deixar os lotes seguintes rodando
   * (custam token) nem pintar estado num componente desmontado.
   */
  const alive = useRef(true)
  const [runId, setRunId] = useState(0)
  /**
   * Segundos desde o clique. É o ÚNICO sinal de vida durante uma chamada — que,
   * medida contra um endpoint real, leva de 30s a 95s. Sem ele a tela fica
   * literalmente parada por mais de um minuto e o usuário conclui, com razão,
   * que quebrou. Um relógio que anda transforma "travado" em "devagar".
   */
  const [elapsed, setElapsed] = useState(0)
  /**
   * Quem opinou. Vem do background junto com o primeiro lote — a UI so conhece a
   * forma sanitizada do provedor e nao teria como saber qual modelo de fato rodou.
   * Fica visivel no cabecalho porque e ali que a sugestao e julgada: trocar de
   * modelo muda o resultado, e uma sugestao sem autoria e palpite anonimo.
   */
  const [author, setAuthor] = useState<string | null>(null)

  useEffect(() => () => { alive.current = false }, [])

  /**
   * O modal vive FORA da árvore da sidebar — ver a nota em overlayRoot.ts. Sem
   * isto ele fica no DOM e invisível: o transform da animação da sidebar prende
   * o `position: fixed` dentro dos 420px, e o overflow:hidden recorta o resto.
   */
  const [overlay, setOverlay] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const root = createOverlayRoot('mytube-ai-modal-root')
    setOverlay(root.mount)
    return () => root.destroy()
  }, [])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => {
    alive.current = true
    setDone(0); setRunning(true); setError(null); setChoices({}); setAnswered([]); setElapsed(0)
    setUnchecked(new Set()); setExpanded(new Set()); setAuthor(null)

    /**
     * Nomes que os lotes ANTERIORES já propuseram, realimentados como se fossem
     * pastas existentes. Sem isto cada lote decide no escuro: medido com 813 itens
     * em 41 lotes, a IA inventou 76 pastas — quase-duplicatas nascidas de o lote
     * 12 não saber que o lote 3 já tinha criado "Ciência". Realimentar é o que
     * transforma 41 decisões independentes numa taxonomia só.
     */
    const proposed = new Map<string, string>()

    void (async () => {
      const folderList = folders.map(f => ({ id: f.id, name: f.name }))
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        if (!alive.current) return
        const batch = items.slice(i, i + BATCH_SIZE)
        const res = await sendMessage({
          type: 'AI_CATEGORIZE',
          payload: {
            items: batch.map(o => ({ id: o.id, name: o.name, type: o.type })),
            // O prefixo marca a pasta que ainda NÃO existe: o background só casa
            // nome→id, então o id de ida volta igual e a UI o traduz de volta em
            // proposta. Nada é criado antes do Aplicar.
            folders: [
              ...folderList,
              ...[...proposed.values()].map(name => ({ id: PROPOSED_PREFIX + name, name })),
            ],
          },
        })
        if (!alive.current) return
        if (!res.ok) {
          setError(
            res.error === 'no-active-provider' ? t('cat.errNoProvider')
            : res.error === 'no-model' ? t('cat.errNoModel')
            : res.error ?? t('ai.errInternal')
          )
          setRunning(false)
          return
        }
        if (res.provider) setAuthor(res.model ? `${res.provider} · ${res.model}` : res.provider)
        applySuggestions(res.suggestions ?? [])
        setDone(Math.min(i + BATCH_SIZE, items.length))
      }
      if (alive.current) setRunning(false)
    })()

    function applySuggestions(suggestions: CategorizeSuggestion[]) {
      // Toda proposta entra no dicionário — inclusive a que veio realimentada —
      // para que o lote seguinte a enxergue.
      for (const s of suggestions) {
        const name = s.folderId?.startsWith(PROPOSED_PREFIX)
          ? s.folderId.slice(PROPOSED_PREFIX.length)
          : s.newFolder
        if (name) proposed.set(norm(name), name)
      }
      setChoices(prev => {
        const next = { ...prev }
        for (const s of suggestions) {
          const asProposed = s.folderId?.startsWith(PROPOSED_PREFIX)
            ? s.folderId.slice(PROPOSED_PREFIX.length)
            : null
          next[s.id] = asProposed
            ? { newFolder: asProposed }
            : s.folderId ? { folderId: s.folderId }
            : s.newFolder ? { newFolder: s.newFolder } : null
        }
        return next
      })
      setAnswered(prev => [...prev, ...suggestions.map(s => s.id)])
    }
    // `items`/`folders` são recalculados a cada render do pai; depender deles
    // relançaria o laço sem parar. O disparo é o runId, que só muda no Rodar de novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const flat = flattenFolders(folders)
  const byId = new Map(items.map(o => [o.id, o]))
  const rows = answered.map(id => byId.get(id)).filter((o): o is Organizable => !!o)
  const picked = rows.filter(o => choices[o.id] != null)

  /**
   * A seleção é registrada pela NEGATIVA — quem o usuário desmarcou. Com lista
   * que chega em lotes, guardar os marcados obrigaria a lembrar de marcar cada
   * item novo; guardar os desmarcados faz o padrão "vem marcado" cair de graça.
   */
  const isChecked = useCallback((id: string) => !unchecked.has(id), [unchecked])
  const selected = picked.filter(o => isChecked(o.id))

  /**
   * Agrupado por DESTINO, não plano. Com 813 itens uma lista corrida é
   * irrevisável: ninguém confere 813 linhas. Por pasta são 8 grupos, e o usuário
   * julga a decisão inteira ("tudo isso vai pra Ciência?") em vez de item a item.
   */
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>()
    for (const item of picked) {
      const choice = choices[item.id]
      if (!choice) continue
      const isNew = 'newFolder' in choice
      const label = isNew ? choice.newFolder : (folders.find(f => f.id === choice.folderId)?.name ?? '?')
      const key = isNew ? `n:${norm(choice.newFolder)}` : `f:${choice.folderId}`
      const g = map.get(key) ?? { key, label, isNew, items: [] }
      g.items.push(item)
      map.set(key, g)
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length)
  }, [choices, folders, picked])

  const toggleGroup = useCallback((g: Group) => {
    setUnchecked(prev => {
      const next = new Set(prev)
      const allOn = g.items.every(i => !next.has(i.id))
      for (const i of g.items) { if (allOn) next.add(i.id); else next.delete(i.id) }
      return next
    })
  }, [])

  const toggleItem = useCallback((id: string) => {
    setUnchecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const toggleExpand = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])

  const setChoice = useCallback((id: string, value: string) => {
    setChoices(prev => {
      const next = { ...prev }
      if (value === '__skip__') next[id] = null
      else if (value.startsWith('new:')) next[id] = { newFolder: value.slice(4) }
      else next[id] = { folderId: value }
      return next
    })
  }, [])

  /** Recebe a lista de propósito: "aceitar marcados" e "aceitar tudo" são a mesma escrita. */
  const apply = useCallback(async (list: Organizable[]) => {
    if (applying || list.length === 0) return
    setApplying(true)
    setApplied(0)
    setApplyTotal(list.length)
    try {
      // Pastas novas nascem UMA vez por nome: sem esta memória, dez canais que a
      // IA mandou para "Programação" criariam dez pastas homônimas.
      const created = new Map<string, string>(folders.map(f => [norm(f.name), f.id]))
      let n = 0
      for (const item of list) {
        setApplied(++n)
        const choice = choices[item.id]
        if (!choice) continue
        let folderId: string
        if ('folderId' in choice) {
          folderId = choice.folderId
        } else {
          const key = norm(choice.newFolder)
          const existing = created.get(key)
          folderId = existing ?? (await addFolder(choice.newFolder, null, NEW_FOLDER_COLOR)).id
          created.set(key, folderId)
        }
        await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: { ...item, folderId } })
      }
      onApplied()
    } finally {
      setApplying(false)
    }
  }, [applying, choices, folders, onApplied])
  const pct = items.length > 0 ? Math.round((done / items.length) * 100) : 0
  const allOn = picked.length > 0 && unchecked.size === 0

  function destinationSelect(item: Organizable) {
    const choice = choices[item.id]
    const isNew = choice != null && 'newFolder' in choice
    const value = choice == null ? '__skip__'
      : 'folderId' in choice ? choice.folderId
      : `new:${choice.newFolder}`
    return (
      <select
        style={{ ...S.select, ...(isNew ? S.selectNew : null) }}
        value={value}
        aria-label={t('cat.moveTo')}
        onChange={e => setChoice(item.id, (e.target as HTMLSelectElement).value)}
      >
        {isNew && choice != null && 'newFolder' in choice && (
          <option value={`new:${choice.newFolder}`}>＋ {choice.newFolder} ({t('cat.newTag')})</option>
        )}
        {flat.map(({ folder: f, depth: d }) => (
          <option key={f.id} value={f.id}>
            {'　'.repeat(d)}{d > 0 ? '└ ' : ''}{f.name}
          </option>
        ))}
        <option value="__skip__">—</option>
      </select>
    )
  }

  if (!overlay) return null

  return createPortal((
    // Backdrop clicável: fechar por fora é o gesto que todo mundo já tenta num
    // modal, e aqui fechar não perde nada — nada foi gravado ainda.
    <div style={S.backdrop} onClick={e => { if (e.target === e.currentTarget && !applying) onClose() }}>
      <div style={S.modal} role="dialog" aria-modal="true">
        <div style={S.head}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={S.title}>✨ {t('cat.title')}</div>
            {author && <div style={S.author} title={author}>{t('cat.by')} {author}</div>}
            {!running && rows.length > 0 && (
              <div style={S.meta}>
                {groups.length} {t('cat.foldersWord')} · {picked.length} {t('cat.itemsWord')}
                {rows.length > picked.length ? ` · ${rows.length - picked.length} ${t('cat.skipped')}` : ''}
              </div>
            )}
          </div>
          <button style={S.close} onClick={onClose} disabled={applying} type="button" aria-label={t('common.cancel')}>×</button>
        </div>

        {running && (
          <div style={S.progressBlock}>
            {/* A FAIXA em voo, não o contador de concluídos: com lote de 20 o
                "0/200" ficava parado o primeiro minuto inteiro. */}
            <span style={S.meta}>
              {t('cat.running')} {done + 1}–{Math.min(done + BATCH_SIZE, items.length)} {t('cat.of')} {items.length} · {elapsed}s
            </span>
            <div style={S.track}><div style={{ ...S.fill, width: `${pct}%` }} /></div>
            <span style={S.meta}>{t('cat.slowHint')}</span>
          </div>
        )}

        {error && <p style={S.error}>{error}</p>}
        {!running && !error && rows.length === 0 && <p style={S.meta}>{t('cat.none')}</p>}

        {groups.length > 0 && (
          <>
            <div style={S.toolbar}>
              <span style={S.count}>
                <strong style={S.countStrong}>{selected.length}</strong>/{picked.length} {t('cat.selectedCount')}
              </span>
              <button style={S.chip} type="button" disabled={allOn} onClick={() => setUnchecked(new Set())}>
                {t('cat.selectAll')}
              </button>
              <button style={S.chip} type="button" disabled={selected.length === 0}
                onClick={() => setUnchecked(new Set(picked.map(o => o.id)))}>
                {t('cat.deselectAll')}
              </button>
            </div>

            <div style={S.list}>
              {groups.map(g => {
                const on = g.items.filter(i => isChecked(i.id)).length
                const open = expanded.has(g.key)
                return (
                  <div key={g.key} style={S.group}>
                    <div style={S.groupHead}>
                      <input
                        type="checkbox" style={S.check}
                        checked={on === g.items.length}
                        // Grupo meio marcado mostra o traço, não uma caixa vazia
                        // que mentiria dizendo "nada daqui vai".
                        ref={el => { if (el) el.indeterminate = on > 0 && on < g.items.length }}
                        onChange={() => toggleGroup(g)}
                        aria-label={g.label}
                      />
                      <button style={S.groupBtn} type="button" onClick={() => toggleExpand(g.key)}>
                        <span style={S.caret}>{open ? '▾' : '▸'}</span>
                        <span style={S.groupName}>📁 {g.label}</span>
                        {g.isNew && <span style={S.newBadge}>{t('cat.newTag')}</span>}
                        <span style={S.groupCount}>{on === g.items.length ? g.items.length : `${on}/${g.items.length}`}</span>
                      </button>
                    </div>
                    {open && (
                      <div style={S.groupItems}>
                        {g.items.map(item => (
                          <div key={item.id} style={S.itemRow}>
                            <input type="checkbox" style={S.check} checked={isChecked(item.id)}
                              onChange={() => toggleItem(item.id)} aria-label={item.name} />
                            <span style={S.itemName} title={item.name}>{item.name}</span>
                            {destinationSelect(item)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {!running && (
          <div style={S.footer}>
            {groups.length > 0 && (
              <>
                <button style={S.primary} type="button"
                  disabled={applying || selected.length === 0}
                  onClick={() => void apply(selected)}>
                  {applying
                    ? `${t('cat.applying')} ${applied}/${applyTotal}`
                    : `${t('cat.acceptSelected')} · ${selected.length}`}
                </button>
                <button style={S.secondary} type="button"
                  disabled={applying || picked.length === 0 || selected.length === picked.length}
                  onClick={() => void apply(picked)}>
                  {t('cat.acceptAll')} · {picked.length}
                </button>
              </>
            )}
            <button style={S.secondary} type="button" disabled={applying}
              onClick={() => setRunId(n => n + 1)}>
              {t('cat.retry')}
            </button>
            <button style={S.secondary} type="button" disabled={applying} onClick={onClose}>
              {t('common.cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  ), overlay)
}

/**
 * Modal de verdade, não um cartão dentro da sidebar: revisar 813 sugestões em
 * 420px de largura é o que tornava a lista irrevisável. O overlay é `fixed`
 * dentro do Shadow DOM da sidebar, então herda os tokens de tema sem vazar CSS
 * para o YouTube.
 */
const S: Record<string, h.JSX.CSSProperties> = {
  backdrop: {
    // Mesmo teto da sidebar; a raiz do modal entra no body DEPOIS dela, entao a
    // ordem do DOM desempata a favor do modal — que precisa cobrir tudo, senao a
    // sidebar segue clicavel por baixo de um dialogo modal.
    position: 'fixed', inset: 0, zIndex: 2147483647,
    background: 'rgba(0, 0, 0, 0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 'var(--mt-spacing-md)',
  },
  modal: {
    width: 'min(680px, 94vw)', maxHeight: '88vh',
    display: 'flex', flexDirection: 'column', gap: 'var(--mt-spacing-sm)',
    backgroundColor: 'var(--mt-bg-primary)',
    border: '2px solid var(--mt-accent)', borderRadius: 'var(--mt-radius-md)',
    padding: 'var(--mt-spacing-md)', boxShadow: 'var(--mt-shadow-lg, 0 16px 48px rgba(0,0,0,.35))',
    boxSizing: 'border-box',
  },
  head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' },
  title: {
    fontFamily: 'var(--mt-font-display)', fontWeight: 700,
    fontSize: 'var(--mt-font-size-md)', color: 'var(--mt-text-primary)',
  },
  close: {
    width: '28px', height: '28px', flexShrink: 0, borderRadius: '50%',
    border: '1px solid var(--mt-btn-border)', backgroundColor: 'var(--mt-btn-bg)',
    color: 'var(--mt-text-secondary)', fontSize: '16px', lineHeight: 1,
    cursor: 'pointer', padding: 0,
  },
  progressBlock: { display: 'flex', flexDirection: 'column', gap: '6px' },
  track: {
    height: '4px', borderRadius: 'var(--mt-radius-pill)',
    backgroundColor: 'var(--mt-btn-bg)', overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: 'var(--mt-accent)', transition: 'width 0.2s' },
  meta: { color: 'var(--mt-text-secondary)', fontSize: 'var(--mt-font-size-xs)', margin: 0 },
  author: {
    color: 'var(--mt-accent)', fontSize: 'var(--mt-font-size-xs)', fontWeight: 600,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  error: { color: 'var(--mt-error)', fontSize: 'var(--mt-font-size-sm)', margin: 0 },

  toolbar: {
    display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
    paddingBottom: 'var(--mt-spacing-xs)',
    borderBottom: '1px solid var(--mt-border)',
  },
  count: {
    flex: 1, minWidth: '120px',
    fontSize: 'var(--mt-font-size-xs)', color: 'var(--mt-text-secondary)',
    fontFamily: 'var(--mt-font-body)',
  },
  countStrong: { color: 'var(--mt-text-primary)', fontSize: 'var(--mt-font-size-sm)' },
  chip: {
    padding: '4px 12px', minHeight: '28px',
    borderRadius: 'var(--mt-radius-pill)', border: '1px solid var(--mt-btn-border)',
    backgroundColor: 'var(--mt-btn-bg)', color: 'var(--mt-text-primary)',
    fontFamily: 'var(--mt-font-body)', fontSize: 'var(--mt-font-size-xs)',
    cursor: 'pointer', whiteSpace: 'nowrap',
  },

  list: { display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto', flex: 1, minHeight: 0 },
  group: {
    // flexShrink 0 nao e detalhe: sem ele o grupo ABERTO consome a altura e
    // espreme os colapsados numa tira em que o texto sai cortado no meio.
    flexShrink: 0,
    border: '1px solid var(--mt-border)', borderRadius: 'var(--mt-radius-sm)',
    overflow: 'hidden',
  },
  groupHead: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '8px', minHeight: '38px', backgroundColor: 'var(--mt-bg-secondary)',
  },
  groupBtn: {
    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px',
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    color: 'var(--mt-text-primary)', fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-sm)', textAlign: 'left',
  },
  caret: { color: 'var(--mt-accent)', fontSize: '12px', width: '12px', flexShrink: 0 },
  groupName: {
    flex: 1, minWidth: 0, fontWeight: 600,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  newBadge: {
    flexShrink: 0, padding: '1px 8px', borderRadius: 'var(--mt-radius-pill)',
    border: '1px solid var(--mt-accent)', backgroundColor: 'var(--mt-accent-soft)',
    color: 'var(--mt-text-primary)', fontSize: 'var(--mt-font-size-xs)', fontWeight: 600,
  },
  groupCount: {
    flexShrink: 0, minWidth: '32px', textAlign: 'right',
    color: 'var(--mt-text-secondary)', fontSize: 'var(--mt-font-size-xs)',
  },
  groupItems: { display: 'flex', flexDirection: 'column' },
  itemRow: {
    display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
    padding: '5px 8px 5px 10px', borderTop: '1px solid var(--mt-border)',
  },
  check: { width: '15px', height: '15px', flexShrink: 0, margin: 0, accentColor: 'var(--mt-accent)', cursor: 'pointer' },
  itemName: {
    flex: 1, minWidth: 0,
    fontSize: 'var(--mt-font-size-sm)', fontFamily: 'var(--mt-font-body)',
    color: 'var(--mt-text-primary)', overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  select: {
    width: '190px', flexShrink: 0, padding: '4px 8px', minHeight: '28px',
    borderRadius: 'var(--mt-radius-sm)', border: '1px solid var(--mt-btn-border)',
    backgroundColor: 'var(--mt-bg-primary)', color: 'var(--mt-text-primary)',
    fontFamily: 'var(--mt-font-body)', fontSize: 'var(--mt-font-size-xs)',
    cursor: 'pointer', boxSizing: 'border-box',
  },
  /** Pasta que ainda não existe é o único destino que muda o estado além do item. */
  selectNew: { border: '2px solid var(--mt-accent)', backgroundColor: 'var(--mt-accent-soft)' },

  footer: {
    display: 'flex', gap: '6px', flexWrap: 'wrap',
    paddingTop: 'var(--mt-spacing-xs)', borderTop: '1px solid var(--mt-border)',
  },
  primary: {
    flex: 1, minWidth: '160px', minHeight: '34px', padding: '6px 12px',
    borderRadius: 'var(--mt-radius-sm)', border: '2px solid var(--mt-accent)',
    backgroundColor: 'var(--mt-accent-soft)', color: 'var(--mt-text-primary)',
    fontFamily: 'var(--mt-font-body)', fontSize: 'var(--mt-font-size-sm)',
    fontWeight: 600, cursor: 'pointer',
  },
  secondary: {
    minHeight: '34px', padding: '6px 12px',
    borderRadius: 'var(--mt-radius-sm)', border: '1px solid var(--mt-btn-border)',
    backgroundColor: 'var(--mt-btn-bg)', color: 'var(--mt-text-primary)',
    fontFamily: 'var(--mt-font-body)', fontSize: 'var(--mt-font-size-sm)',
    cursor: 'pointer',
  },
}
