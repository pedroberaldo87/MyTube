import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { Tag } from '../../../shared/types'
import { useT } from '../../../shared/i18n'

type TypeFilter = 'all' | 'channel' | 'playlist' | 'video'

interface FilterBarProps {
  search: string
  onSearchChange: (val: string) => void
  typeFilter: TypeFilter
  onTypeFilterChange: (val: TypeFilter) => void
  tags: Tag[]
  activeTagIds: string[]
  onTagToggle: (tagId: string) => void
  unassignedOnly: boolean
  onToggleUnassigned: () => void
  unassignedCount: number
}

export function FilterBar({
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  tags,
  activeTagIds,
  onTagToggle,
  unassignedOnly,
  onToggleUnassigned,
  unassignedCount,
}: FilterBarProps) {
  const t = useT()
  const [searchFocused, setSearchFocused] = useState(false)

  const TYPE_PILLS: { value: TypeFilter; label: string }[] = [
    { value: 'all', label: t('filter.all') },
    { value: 'channel', label: t('filter.channels') },
    { value: 'playlist', label: t('filter.playlists') },
    { value: 'video', label: t('filter.videos') },
  ]

  const wrapperStyle: h.JSX.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '8px',
  }

  const searchWrapStyle: h.JSX.CSSProperties = {
    position: 'relative',
  }

  const searchStyle: h.JSX.CSSProperties = {
    width: '100%',
    padding: '9px 16px 9px 38px',
    borderRadius: 'var(--mt-radius-pill)',
    border: `1px solid ${searchFocused ? 'var(--mt-accent)' : 'var(--mt-border)'}`,
    backgroundColor: 'var(--mt-bg-secondary)',
    color: 'var(--mt-text-primary)',
    fontSize: '14px',
    fontFamily: 'var(--mt-font-body)',
    fontWeight: 400,
    outline: 'none',
    boxSizing: 'border-box',
    boxShadow: searchFocused ? '0 0 0 3px var(--mt-accent-soft)' : 'none',
    transition: 'border-color 0.18s, box-shadow 0.18s',
  }

  const searchIconStyle: h.JSX.CSSProperties = {
    position: 'absolute',
    left: '13px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--mt-text-secondary)',
    fontSize: '14px',
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
  }

  const pillRowStyle: h.JSX.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  }

  function tagPillStyle(active: boolean): h.JSX.CSSProperties {
    return {
      padding: '6px 14px',
      borderRadius: 'var(--mt-radius-pill)',
      border: `1px solid ${active ? 'var(--mt-accent)' : 'var(--mt-btn-border)'}`,
      backgroundColor: active ? 'var(--mt-accent-soft)' : 'var(--mt-btn-bg)',
      color: active ? 'var(--mt-accent)' : 'var(--mt-text-secondary)',
      fontSize: '12px',
      fontFamily: 'var(--mt-font-body)',
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'background 0.15s, border-color 0.15s, color 0.15s, transform 0.12s',
      whiteSpace: 'nowrap',
      lineHeight: 1,
    }
  }

  return (
    <div style={wrapperStyle}>
      {/* Search */}
      <div style={searchWrapStyle}>
        <span style={searchIconStyle}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </span>
        <input
          type="text"
          placeholder={t('filter.search')}
          value={search}
          onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          style={searchStyle}
          aria-label={t('filter.search')}
        />
      </div>

      {/* Type filter pills */}
      <div style={pillRowStyle}>
        {TYPE_PILLS.map(({ value, label }) => (
          <button
            key={value}
            style={tagPillStyle(typeFilter === value)}
            onClick={() => onTypeFilterChange(value)}
            type="button"
            aria-pressed={typeFilter === value}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Folder assignment filter */}
      <div style={pillRowStyle}>
        <button
          style={tagPillStyle(unassignedOnly)}
          onClick={onToggleUnassigned}
          type="button"
          aria-pressed={unassignedOnly}
        >
          📂 {t('filter.noFolder')} ({unassignedCount})
        </button>
      </div>

      {/* Tag filter pills */}
      {tags.length > 0 && (
        <div style={pillRowStyle}>
          {tags.map(tag => (
            <button
              key={tag.id}
              style={tagPillStyle(activeTagIds.includes(tag.id))}
              onClick={() => onTagToggle(tag.id)}
              type="button"
              aria-pressed={activeTagIds.includes(tag.id)}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
