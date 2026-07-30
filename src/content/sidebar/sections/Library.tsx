import { h } from 'preact'
import { useState, useCallback, useMemo, useEffect } from 'preact/hooks'
import type { AppState, Organizable } from '../../../shared/types'
import { useT } from '../../../shared/i18n'
import { sendMessage } from '../../../shared/messages'
import { loadUIState, saveUIState } from '../../../shared/ui-state'
import { FilterBar } from '../components/FilterBar'
import { LibraryItem } from '../components/LibraryItem'
import { BatchActionBar } from '../components/BatchActionBar'
import { AICategorizePanel } from '../components/AICategorizePanel'

const PAGE_SIZE = 50

type TypeFilter = 'all' | 'channel' | 'playlist' | 'video'

interface LibraryProps {
  appState: AppState
  newVideoCounts: Record<string, number>
  onMarkChannelRead: (channelId: string) => void
  onStateChange: () => void
}

export function Library({ appState, newVideoCounts, onMarkChannelRead, onStateChange }: LibraryProps) {
  const t = useT()
  const { organizables, folders, tags } = appState

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [activeTagIds, setActiveTagIds] = useState<string[]>([])
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    void loadUIState().then(s => {
      if (s.searchText) setSearch(s.searchText)
      if (s.typeFilter !== 'all') setTypeFilter(s.typeFilter as TypeFilter)
      if (s.unassignedOnly) setUnassignedOnly(true)
    })
  }, [])

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  /** Lote congelado no clique — a lista filtrada muda embaixo, o lote não. */
  const [aiItems, setAiItems] = useState<Organizable[] | null>(null)

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v)
    saveUIState({ searchText: v })
  }, [])

  const handleTypeFilterChange = useCallback((v: TypeFilter) => {
    setTypeFilter(v)
    saveUIState({ typeFilter: v })
  }, [])

  const handleToggleUnassigned = useCallback(() => {
    setUnassignedOnly(prev => {
      const next = !prev
      saveUIState({ unassignedOnly: next })
      return next
    })
  }, [])

  const handleTagToggle = useCallback((tagId: string) => {
    setActiveTagIds(prev =>
      prev.includes(tagId)
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    )
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    return organizables
      .filter((item) => {
        if (unassignedOnly && item.folderId !== null) return false
        if (q && !item.name.toLowerCase().includes(q)) return false
        if (typeFilter !== 'all' && item.type !== typeFilter) return false
        if (activeTagIds.length > 0 && !activeTagIds.some(id => item.tagIds.includes(id))) return false
        return true
      })
      .slice()
      .sort((a, b) => {
        const aNew = (a.type === 'channel' ? (newVideoCounts[a.youtubeId] ?? 0) : 0)
        const bNew = (b.type === 'channel' ? (newVideoCounts[b.youtubeId] ?? 0) : 0)
        if (aNew > 0 && bNew === 0) return -1
        if (bNew > 0 && aNew === 0) return 1
        if (aNew > 0 && bNew > 0) return bNew - aNew
        return b.addedAt - a.addedAt
      })
  }, [organizables, search, typeFilter, activeTagIds, unassignedOnly, newVideoCounts])

  const unassignedCount = useMemo(() =>
    organizables.filter(o => o.folderId === null).length
  , [organizables])

  const shown = showAll ? filtered : filtered.slice(0, PAGE_SIZE)
  const hasMore = filtered.length > PAGE_SIZE && !showAll

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filtered.map((item) => item.id)))
  }, [filtered])

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  const handleBatchAssignFolder = useCallback(
    async (folderId: string | null) => {
      for (const id of selectedIds) {
        const item = organizables.find((o) => o.id === id)
        if (!item) continue
        const updated: Organizable = { ...item, folderId }
        await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: updated })
      }
      onStateChange()
      exitSelectMode()
    },
    [selectedIds, organizables, onStateChange, exitSelectMode],
  )

  const handleBatchToggleTag = useCallback(
    async (tagId: string) => {
      for (const id of selectedIds) {
        const item = organizables.find((o) => o.id === id)
        if (!item) continue
        const newTagIds = item.tagIds.includes(tagId)
          ? item.tagIds.filter((t) => t !== tagId)
          : [...item.tagIds, tagId]
        const updated: Organizable = { ...item, tagIds: newTagIds }
        await sendMessage({ type: 'UPDATE_ORGANIZABLE', payload: updated })
      }
      onStateChange()
    },
    [selectedIds, organizables, onStateChange],
  )

  const handleBatchDelete = useCallback(async () => {
    for (const id of selectedIds) {
      await sendMessage({ type: 'DELETE_ORGANIZABLE', payload: { id } })
    }
    onStateChange()
    setSelectedIds(new Set())
    setSelectMode(false)
  }, [selectedIds, onStateChange])

  /**
   * O alvo da IA é o mesmo do BatchActionBar quando há seleção; sem seleção, é o
   * que está na tela e ainda não tem pasta — o caso real de quem acabou de
   * sincronizar 300 inscrições. Vídeo fica de fora: pasta aqui é de canal/lista.
   */
  const aiTargets = useMemo(() => {
    const pool = selectedIds.size > 0
      ? filtered.filter(o => selectedIds.has(o.id))
      : filtered.filter(o => o.folderId === null)
    return pool.filter(o => o.type !== 'video')
  }, [filtered, selectedIds])

  const listStyle: h.JSX.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    marginTop: '4px',
  }

  const emptyStyle: h.JSX.CSSProperties = {
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    color: 'var(--mt-text-secondary)',
    textAlign: 'center',
    padding: '12px 0',
  }

  const showMoreButtonStyle: h.JSX.CSSProperties = {
    width: '100%',
    padding: '6px',
    minHeight: '32px',
    marginTop: '6px',
    borderRadius: 'var(--mt-radius-pill)',
    border: '1px solid var(--mt-btn-border)',
    backgroundColor: 'var(--mt-btn-bg)',
    color: 'var(--mt-text-secondary)',
    fontFamily: 'var(--mt-font-body)',
    fontSize: 'var(--mt-font-size-sm)',
    cursor: 'pointer',
  }

  const selectBarStyle: h.JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '6px',
  }

  function selectPillStyle(active: boolean): h.JSX.CSSProperties {
    return {
      padding: '6px 14px',
      borderRadius: 'var(--mt-radius-pill)',
      fontSize: 'var(--mt-font-size-sm)',
      fontFamily: 'var(--mt-font-body)',
      fontWeight: active ? 600 : 400,
      cursor: 'pointer',
      border: `1px solid ${active ? 'transparent' : 'var(--mt-btn-border)'}`,
      background: active
        ? 'linear-gradient(135deg, var(--mt-accent), var(--mt-accent-hover))'
        : 'var(--mt-btn-bg)',
      color: active ? '#ffffff' : 'var(--mt-text-secondary)',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      transition: 'background 0.12s, color 0.12s',
      lineHeight: 1,
    }
  }

  const aiPillStyle: h.JSX.CSSProperties = {
    padding: '6px 14px',
    borderRadius: 'var(--mt-radius-pill)',
    fontSize: 'var(--mt-font-size-sm)',
    fontFamily: 'var(--mt-font-body)',
    fontWeight: 600,
    cursor: aiTargets.length === 0 ? 'default' : 'pointer',
    opacity: aiTargets.length === 0 ? 0.45 : 1,
    border: '2px solid var(--mt-accent)',
    background: 'var(--mt-accent-soft)',
    color: 'var(--mt-text-primary)',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    lineHeight: 1,
    marginLeft: 'auto',
  }

  return (
    <div>
      {/* Modal por cima, não no lugar da lista: revisar centenas de sugestões em
          420px de sidebar é o que tornava a revisão inviável. */}
      {aiItems && (
        <AICategorizePanel
          items={aiItems}
          folders={folders}
          onApplied={() => { setAiItems(null); exitSelectMode(); onStateChange() }}
          onClose={() => setAiItems(null)}
        />
      )}
      <FilterBar
        search={search}
        onSearchChange={handleSearchChange}
        typeFilter={typeFilter}
        onTypeFilterChange={handleTypeFilterChange}
        tags={tags}
        activeTagIds={activeTagIds}
        onTagToggle={handleTagToggle}
        unassignedOnly={unassignedOnly}
        onToggleUnassigned={handleToggleUnassigned}
        unassignedCount={unassignedCount}
      />

      <div style={selectBarStyle}>
        <button
          style={selectPillStyle(selectMode)}
          onClick={() => {
            if (selectMode) exitSelectMode()
            else setSelectMode(true)
          }}
          type="button"
        >
          {selectMode ? t('library.cancel') : t('library.select')}
        </button>

        {selectMode && (
          <>
            <span style={{ fontSize: 'var(--mt-font-size-xs)', fontFamily: 'var(--mt-font-body)', color: 'var(--mt-text-secondary)' }}>
              {selectedIds.size} {t('library.of')} {filtered.length}
            </span>
            <button
              style={{
                ...selectPillStyle(false),
              }}
              onClick={selectedIds.size === filtered.length ? deselectAll : selectAll}
              type="button"
            >
              {selectedIds.size === filtered.length ? t('library.deselectAll') : t('library.selectAll')}
            </button>
          </>
        )}

        <button
          style={aiPillStyle}
          disabled={aiTargets.length === 0}
          onClick={() => setAiItems(aiTargets)}
          type="button"
          title={`${t('cat.button')} · ${aiTargets.length} ${selectedIds.size > 0 ? t('cat.scopeSelected') : t('cat.scopeUnassigned')}`}
        >
          ✨ {t('cat.button')} {aiTargets.length > 0 ? `(${aiTargets.length})` : ''}
        </button>
      </div>

      {shown.length === 0 ? (
        organizables.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px 8px' }}>
            <div style={{ fontSize: 'var(--mt-font-size-sm)', fontFamily: 'var(--mt-font-body)', color: 'var(--mt-text-secondary)', marginBottom: '12px' }}>
              {t('library.onboarding')}
            </div>
            <button
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '8px 18px',
                borderRadius: 'var(--mt-radius-pill)',
                border: 'none',
                background: 'linear-gradient(135deg, var(--mt-accent), var(--mt-accent-hover))',
                color: '#ffffff',
                fontFamily: 'var(--mt-font-body)',
                fontWeight: 600,
                fontSize: 'var(--mt-font-size-sm)',
                cursor: 'pointer',
                boxShadow: 'var(--mt-shadow-sm)',
              }}
              onClick={() => { window.location.href = 'https://www.youtube.com/feed/channels' }}
              type="button"
            >
              {t('library.onboardingAction')}
            </button>
          </div>
        ) : (
          <div style={emptyStyle}>{t('library.noMatch')}</div>
        )
      ) : (
        <div style={listStyle}>
          {shown.map((item) => (
            <LibraryItem
              key={item.id}
              item={item}
              folders={folders}
              tags={tags}
              newCount={item.type === 'channel' ? (newVideoCounts[item.youtubeId] ?? 0) : undefined}
              onMarkRead={item.type === 'channel' ? () => onMarkChannelRead(item.youtubeId) : undefined}
              onRefresh={onStateChange}
              selectMode={selectMode}
              selected={selectedIds.has(item.id)}
              onSelect={toggleSelected}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <button
          style={showMoreButtonStyle}
          onClick={() => setShowAll(true)}
          type="button"
        >
          {filtered.length - PAGE_SIZE} {t('library.showMore')}
        </button>
      )}

      {selectMode && selectedIds.size > 0 && (
        <BatchActionBar
          selectedCount={selectedIds.size}
          folders={folders}
          tags={tags}
          onAssignFolder={(folderId) => void handleBatchAssignFolder(folderId)}
          onToggleTag={(tagId) => void handleBatchToggleTag(tagId)}
          onDelete={() => void handleBatchDelete()}
          onClose={exitSelectMode}
          onFolderCreated={onStateChange}
        />
      )}
    </div>
  )
}
