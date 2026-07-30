import type { AppState, Folder, Organizable, Tag } from './types'

const STORAGE_KEY = 'mytube_state'

const DEFAULT_STATE: AppState = {
  organizables: [],
  folders: [],
  tags: [],
}

export async function getState(): Promise<AppState> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  return (result[STORAGE_KEY] as AppState | undefined) ?? DEFAULT_STATE
}

export async function setState(state: AppState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state })
}

function genId(): string {
  return crypto.randomUUID()
}

export async function addOrganizable(item: Omit<Organizable, 'id' | 'addedAt' | 'lastSyncedAt'>): Promise<Organizable> {
  const state = await getState()
  let existing = state.organizables.find(
    o => o.youtubeId === item.youtubeId && o.type === item.type
  )
  if (!existing && item.type === 'channel') {
    const incomingHandle = (item as Organizable).handle ?? extractHandleFromPath(item.url)
    if (incomingHandle) {
      existing = state.organizables.find(o => {
        if (o.type !== 'channel') return false
        const h = o.handle ?? extractHandleFromPath(o.url)
        return h === incomingHandle
      })
    }
  }
  if (existing) return existing

  const key = `${item.type}:${item.youtubeId}`
  if (state.deletedYoutubeIds) {
    state.deletedYoutubeIds = state.deletedYoutubeIds.filter(k => k !== key)
  }

  const organizable: Organizable = {
    ...item,
    id: genId(),
    muted: item.type === 'channel' ? true : undefined,
    addedAt: Date.now(),
    lastSyncedAt: Date.now(),
  }
  state.organizables.push(organizable)
  await setState(state)
  return organizable
}

export async function updateOrganizable(updated: Organizable): Promise<void> {
  const state = await getState()
  const idx = state.organizables.findIndex(o => o.id === updated.id)
  if (idx === -1) return
  state.organizables[idx] = updated
  await setState(state)
}

export async function deleteOrganizable(id: string): Promise<void> {
  const state = await getState()
  const item = state.organizables.find(o => o.id === id)
  state.organizables = state.organizables.filter(o => o.id !== id)
  if (item) {
    const deleted = state.deletedYoutubeIds ?? []
    const key = `${item.type}:${item.youtubeId}`
    if (!deleted.includes(key)) deleted.push(key)
    if (item.handle) {
      const handleKey = `${item.type}:@${item.handle}`
      if (!deleted.includes(handleKey)) deleted.push(handleKey)
    }
    state.deletedYoutubeIds = deleted
  }
  await setState(state)
}

export async function getOrganizableByYoutubeId(youtubeId: string, type: 'channel' | 'playlist'): Promise<Organizable | null> {
  const state = await getState()
  const exact = state.organizables.find(o => o.youtubeId === youtubeId && o.type === type)
  if (exact) return exact
  if (type === 'channel') {
    const incomingHandle = youtubeId.startsWith('@') ? youtubeId.slice(1).toLowerCase() : undefined
    if (incomingHandle) {
      return state.organizables.find(o => {
        if (o.type !== 'channel') return false
        const h = o.handle ?? extractHandleFromPath(o.url)
        return h === incomingHandle
      }) ?? null
    }
  }
  return null
}

export async function addFolder(name: string, parentId: string | null, color: string): Promise<Folder> {
  const state = await getState()
  const maxOrder = state.folders
    .filter(f => f.parentId === parentId)
    .reduce((max, f) => Math.max(max, f.order), -1)

  const folder: Folder = { id: genId(), name, parentId, color, order: maxOrder + 1 }
  state.folders.push(folder)
  await setState(state)
  return folder
}

export async function updateFolder(updated: Folder): Promise<void> {
  const state = await getState()
  const idx = state.folders.findIndex(f => f.id === updated.id)
  if (idx === -1) return
  state.folders[idx] = updated
  await setState(state)
}

/**
 * Apaga a pasta e toda a subárvore dela, devolvendo os organizables para
 * "sem pasta".
 *
 * Coleta a subárvore em memória e faz UMA leitura e UMA escrita. A versão
 * recursiva anterior relia o estado a cada nível — e `chrome.storage.local.get`
 * devolve uma cópia — então a gravação final do nível de cima sobrescrevia o que
 * os níveis de baixo já tinham apagado. As subpastas voltavam apontando para uma
 * mãe inexistente e, como a árvore só renderiza a partir de `parentId === null`,
 * elas e os canais dentro desapareciam da tela sem virar "sem pasta".
 */
export async function deleteFolder(id: string): Promise<void> {
  const state = await getState()

  // O Set também é a guarda de ciclo: `parentId` circular em dado corrompido
  // fazia a versão recursiva rodar para sempre.
  const doomed = new Set<string>()
  const pending = [id]
  while (pending.length > 0) {
    const current = pending.pop() as string
    if (doomed.has(current)) continue
    doomed.add(current)
    for (const f of state.folders) {
      if (f.parentId === current) pending.push(f.id)
    }
  }

  state.organizables = state.organizables.map(o =>
    o.folderId !== null && doomed.has(o.folderId) ? { ...o, folderId: null } : o
  )
  state.folders = state.folders.filter(f => !doomed.has(f.id))
  await setState(state)
}

export async function reorderFolders(orderedIds: string[]): Promise<void> {
  const state = await getState()
  for (let i = 0; i < orderedIds.length; i++) {
    const folder = state.folders.find(f => f.id === orderedIds[i])
    if (folder) folder.order = i
  }
  await setState(state)
}

export async function addTag(name: string, color: string): Promise<Tag> {
  const state = await getState()
  const tag: Tag = { id: genId(), name, color }
  state.tags.push(tag)
  await setState(state)
  return tag
}

export async function updateTag(updated: Tag): Promise<void> {
  const state = await getState()
  const idx = state.tags.findIndex(t => t.id === updated.id)
  if (idx === -1) return
  state.tags[idx] = updated
  await setState(state)
}

export async function deleteTag(id: string): Promise<void> {
  const state = await getState()
  state.organizables = state.organizables.map(o => ({
    ...o,
    tagIds: o.tagIds.filter(tid => tid !== id),
  }))
  state.tags = state.tags.filter(t => t.id !== id)
  await setState(state)
}

function extractHandleFromPath(url: string): string | undefined {
  try {
    const u = new URL(url)
    const match = u.pathname.match(/^\/@([\w.-]+)/)
    return match ? match[1].toLowerCase() : undefined
  } catch {
    const match = url.match(/\/@([\w.-]+)/)
    return match ? match[1].toLowerCase() : undefined
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

export async function syncOrganizables(items: Omit<Organizable, 'id' | 'addedAt' | 'lastSyncedAt'>[]): Promise<void> {
  const state = await getState()
  const deleted = new Set(state.deletedYoutubeIds ?? [])
  let normalized = 0

  for (const item of items) {
    const key = `${item.type}:${item.youtubeId}`
    if (deleted.has(key)) continue

    const incomingHandle = (item as Organizable).handle ?? extractHandleFromPath(item.url)
    if (item.type === 'channel' && incomingHandle && deleted.has(`channel:@${incomingHandle}`)) continue

    let existing = state.organizables.find(
      o => o.youtubeId === item.youtubeId && o.type === item.type
    )

    if (!existing && item.url) {
      const itemPath = normalizeUrl(item.url)
      existing = state.organizables.find(
        o => o.type === item.type && o.url && normalizeUrl(o.url) === itemPath
      )
      if (existing) {
        const oldKey = `${existing.type}:${existing.youtubeId}`
        if (deleted.has(oldKey)) {
          deleted.delete(oldKey)
          deleted.add(key)
        }
      }
    }

    if (!existing && item.type === 'channel' && incomingHandle) {
      existing = state.organizables.find(o => {
        if (o.type !== 'channel') return false
        const existingHandle = o.handle ?? extractHandleFromPath(o.url)
        return existingHandle === incomingHandle
      })
      if (existing) {
        console.log(`[MyTube] syncOrganizables: matched "${item.name}" by handle @${incomingHandle} (ID: ${existing.youtubeId} → ${item.youtubeId})`)
        const oldKey = `${existing.type}:${existing.youtubeId}`
        if (deleted.has(oldKey)) {
          deleted.delete(oldKey)
          deleted.add(key)
        }
      }
    }

    if (!existing && item.type === 'channel' && item.name) {
      existing = state.organizables.find(
        o => o.type === 'channel' && o.name === item.name
      )
      if (existing) {
        console.log(`[MyTube] syncOrganizables: matched "${item.name}" by name (ID: ${existing.youtubeId} → ${item.youtubeId})`)
        const oldKey = `${existing.type}:${existing.youtubeId}`
        if (deleted.has(oldKey)) {
          deleted.delete(oldKey)
          deleted.add(key)
        }
      }
    }

    if (existing) {
      if (existing.youtubeId !== item.youtubeId && item.youtubeId.startsWith('UC')) {
        normalized++
        existing.youtubeId = item.youtubeId
      }
      existing.name = item.name
      existing.thumbnailUrl = item.thumbnailUrl
      existing.url = item.url
      existing.isSubscribed = item.isSubscribed
      existing.lastSyncedAt = Date.now()
      if (incomingHandle) existing.handle = incomingHandle
    } else {
      state.organizables.push({
        ...item,
        id: genId(),
        muted: item.type === 'channel' ? true : undefined,
        addedAt: Date.now(),
        lastSyncedAt: Date.now(),
      })
    }
  }

  if (normalized > 0) {
    console.log(`[MyTube] syncOrganizables: normalized ${normalized} channel IDs to UCxxx format`)
  }

  const seen = new Map<string, number>()
  const toRemove = new Set<number>()
  for (let i = 0; i < state.organizables.length; i++) {
    const o = state.organizables[i]
    const dedupKey = `${o.type}:${o.youtubeId}`
    const prev = seen.get(dedupKey)
    if (prev !== undefined) {
      const prevItem = state.organizables[prev]
      if (prevItem.folderId && !o.folderId) {
        toRemove.add(i)
      } else if (!prevItem.folderId && o.folderId) {
        toRemove.add(prev)
        seen.set(dedupKey, i)
      } else {
        toRemove.add(i)
      }
    } else {
      seen.set(dedupKey, i)
    }
  }

  const seenUrls = new Map<string, number>()
  for (let i = 0; i < state.organizables.length; i++) {
    if (toRemove.has(i)) continue
    const o = state.organizables[i]
    if (!o.url) continue
    const urlKey = `${o.type}:${normalizeUrl(o.url)}`
    const prev = seenUrls.get(urlKey)
    if (prev !== undefined) {
      const prevItem = state.organizables[prev]
      if (prevItem.folderId && !o.folderId) {
        if (o.youtubeId.startsWith('UC') && !prevItem.youtubeId.startsWith('UC')) {
          prevItem.youtubeId = o.youtubeId
        }
        toRemove.add(i)
      } else if (!prevItem.folderId && o.folderId) {
        if (prevItem.youtubeId.startsWith('UC') && !o.youtubeId.startsWith('UC')) {
          o.youtubeId = prevItem.youtubeId
        }
        toRemove.add(prev)
        seenUrls.set(urlKey, i)
      } else {
        toRemove.add(i)
      }
    } else {
      seenUrls.set(urlKey, i)
    }
  }

  const seenHandles = new Map<string, number>()
  for (let i = 0; i < state.organizables.length; i++) {
    if (toRemove.has(i)) continue
    const o = state.organizables[i]
    if (o.type !== 'channel') continue
    const handle = o.handle ?? extractHandleFromPath(o.url)
    if (!handle) continue
    const handleKey = `channel:${handle}`
    const prev = seenHandles.get(handleKey)
    if (prev !== undefined) {
      const prevItem = state.organizables[prev]
      if (prevItem.folderId && !o.folderId) {
        if (o.youtubeId.startsWith('UC') && !prevItem.youtubeId.startsWith('UC')) {
          prevItem.youtubeId = o.youtubeId
        }
        if (o.handle && !prevItem.handle) prevItem.handle = o.handle
        toRemove.add(i)
      } else if (!prevItem.folderId && o.folderId) {
        if (prevItem.youtubeId.startsWith('UC') && !o.youtubeId.startsWith('UC')) {
          o.youtubeId = prevItem.youtubeId
        }
        if (prevItem.handle && !o.handle) o.handle = prevItem.handle
        toRemove.add(prev)
        seenHandles.set(handleKey, i)
      } else {
        if (o.youtubeId.startsWith('UC') && !prevItem.youtubeId.startsWith('UC')) {
          prevItem.youtubeId = o.youtubeId
        }
        if (o.handle && !prevItem.handle) prevItem.handle = o.handle
        toRemove.add(i)
      }
    } else {
      seenHandles.set(handleKey, i)
    }
  }

  if (toRemove.size > 0) {
    console.log(`[MyTube] syncOrganizables: removed ${toRemove.size} duplicate entries`)
    state.organizables = state.organizables.filter((_, i) => !toRemove.has(i))
  }

  for (const o of state.organizables) {
    if (o.type === 'channel' && !o.handle && o.url) {
      const h = extractHandleFromPath(o.url)
      if (h) o.handle = h
    }
  }

  state.deletedYoutubeIds = [...deleted]
  await setState(state)
}
